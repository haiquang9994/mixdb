//! Running whatever T-SQL the user typed in the Query tab. The counterpart of `mysql_script.rs`/
//! `postgres_script.rs`, and the same three jobs — split a script, run it statement by statement,
//! and answer what the server makes of one statement without running it — plus a fourth SQL Server
//! alone needs: carving `GO` batches out before any of that starts (D9).
//!
//! Kept in step with `src/modules/db/sql/syntax.ts`'s `MSSQL_SYNTAX` and
//! `src/modules/db/sql/statements.ts`'s `splitStatements` by a parallel test suite below — same
//! input, same statement count — not by a shared shape: Rust has no `SqlSyntax`, and the frontend
//! splitter runs before any command reaches this file at all (Plan 4).
//!
//! **`tiberius` has no call that returns both rows and a rows-affected count, unlike `sqlx`.**
//! `Client::query`/`simple_query` return a `QueryStream` whose `into_results()` only collects `Row`
//! and result-set `Metadata` tokens — a plain `UPDATE` with no result set comes back as an empty
//! `Vec<Vec<Row>>`, its `Done` token silently dropped. `Client::execute` reads the opposite way: it
//! collects only `Done`/`DoneProc`/`DoneInProc` tokens into an `ExecuteResult`, discarding any row
//! data those same tokens might have accompanied. `sqlx::raw_sql(...).fetch_many()`, which
//! `mysql_script`/`postgres_script` use for both at once via `Either<QueryResult, Row>`, has no
//! `tiberius` equivalent — confirmed by reading `tiberius-0.12.3`'s `result.rs`/`client.rs`, not
//! assumed. So [`run`] has to guess, from a statement's verb and whether it carries an `OUTPUT`
//! clause, which of the two calls to make *before* running it — see [`returns_rows`].

use super::mssql::{column_value, map_error, quote_ident, Connection, Pool};
use crate::error::AppError;
use crate::modules::db::models::StatementResult;
use deadpool::managed::Object;
use serde_json::Value;
use std::time::Instant;
use tiberius::Row;

/// One statement carved out of the editor's text, already past its `GO` batch boundary.
struct Statement {
    text: String,
    /// The keyword it opens with, upper-cased. Empty for a run of nothing but comments or a lone
    /// `GO` line, which is how either is recognised as not being a statement at all.
    verb: String,
}

/// A line holding nothing but `GO`, optionally with a repeat count — case-insensitive, mirroring
/// `src/modules/db/sql/statements.ts`'s `GO_SEPARATOR`. `GO` is a client-side convention (`sqlcmd`,
/// SSMS), not a keyword: sent to the server as text it is a syntax error, so it has to be carved out
/// before the `;`-splitter below ever sees it as code.
fn is_go_line(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.len() < 2 || !trimmed.is_char_boundary(2) {
        return trimmed.eq_ignore_ascii_case("go");
    }
    let (head, rest) = trimmed.split_at(2);
    if !head.eq_ignore_ascii_case("go") {
        return false;
    }
    // `\bgo\b` in spirit: nothing but whitespace and an optional digit run may follow, so
    // `GOOD`/`GO3`/`GO_TABLE` are rejected — a real repeat count needs a space before its digits.
    let rest = rest.trim();
    rest.is_empty() || rest.chars().all(|c| c.is_ascii_digit() || c.is_whitespace())
}

/// Splits a script into batches on a line holding nothing but `GO` (or `GO n`), the first of the two
/// tiers D9 calls for. Each batch is handed whole to [`split_statements`] next, so a semicolon inside
/// one still separates statements the normal way.
///
/// Reads line by line rather than tracking open strings/comments/brackets the way
/// `src/modules/db/sql/statements.ts`'s `matchBatchSeparator` does, because this runs first, on the
/// raw text, before anything else has a chance to. A line holding nothing but `GO` inside a string or
/// a multi-line comment would be cut here as if it were a real separator — a real gap from the JS
/// version, and a narrow enough one to accept for v1 (a multi-line string or comment whose own text
/// is exactly a `GO` line is vanishingly rare in real T-SQL). If this ever needs to be exact, the fix
/// is to give this the same open-string/comment/bracket tracking `split_statements` already has,
/// not to special-case `GO` inside it.
fn split_batches(sql: &str) -> Vec<String> {
    sql.lines().fold(vec![String::new()], |mut batches, line| {
        if is_go_line(line) {
            batches.push(String::new());
        } else {
            let current = batches.last_mut().unwrap();
            if !current.is_empty() {
                current.push('\n');
            }
            current.push_str(line);
        }
        batches
    })
}

/// Splits one `GO` batch into the statements sent one at a time. Only a semicolon outside a string,
/// a bracketed or double-quoted identifier, and a comment separates two — the same set of rules
/// `postgres_script::split_statements` reads for PostgreSQL, minus dollar quoting and plus SQL
/// Server's own two quirks:
///
/// * **`"` is always an identifier, never a string** — `QUOTED_IDENTIFIER ON` is the default every
///   client driver sets, `tiberius` included, so unlike MySQL/PostgreSQL there is no double-quoted
///   string branch to fall back to here at all.
/// * **`[name]` is a second identifier quote, asymmetric** — `]` doubled escapes one inside the
///   name, `[` doubled means nothing (the name is already open by the time a second `[` is read).
///
/// Block comments do not nest (like MySQL, unlike PostgreSQL); `--` always opens a comment whatever
/// follows it (like PostgreSQL, unlike MySQL); there is no `#` comment (`#` opens a temp table name).
fn split_statements(sql: &str) -> Vec<Statement> {
    let chars: Vec<char> = sql.chars().collect();
    let mut statements: Vec<Statement> = Vec::new();
    let mut current = String::new();
    let mut verb = String::new();
    let mut verb_done = false;
    let mut i = 0;

    fn push(
        statements: &mut Vec<Statement>,
        current: &mut String,
        verb: &mut String,
        verb_done: &mut bool,
    ) {
        let text = current.trim().to_string();
        current.clear();
        *verb_done = false;
        let verb = std::mem::take(verb);
        // No opening keyword means there was no statement here — only whitespace, or a comment
        // sitting between two separators.
        if verb.is_empty() {
            return;
        }
        statements.push(Statement { text, verb });
    }

    while i < chars.len() {
        let c = chars[i];

        // `--` always opens a comment in T-SQL, whatever follows it — unlike MySQL, which wants
        // whitespace after it so `5--3` stays arithmetic.
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            while i < chars.len() && chars[i] != '\n' {
                current.push(chars[i]);
                i += 1;
            }
            continue;
        }
        // T-SQL's block comments do not nest: a second `/*` inside one is just text, and the first
        // `*/` closes the whole thing — like MySQL, unlike PostgreSQL.
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            current.push('/');
            current.push('*');
            i += 2;
            while i < chars.len() {
                if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    current.push('*');
                    current.push('/');
                    i += 2;
                    break;
                }
                current.push(chars[i]);
                i += 1;
            }
            continue;
        }

        if c == '\'' || c == '"' || c == '[' {
            // `"` and `[` both open an identifier; `'` opens a string. Neither kind escapes with a
            // backslash here — doubling the close character is the only escape T-SQL has, for both.
            let close = if c == '[' { ']' } else { c };
            current.push(c);
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                current.push(ch);
                i += 1;
                if ch == close {
                    // Two of the close character in a row are an escaped one, not the end of the run.
                    if chars.get(i) == Some(&close) {
                        current.push(close);
                        i += 1;
                        continue;
                    }
                    break;
                }
            }
            continue;
        }

        if c == ';' {
            push(&mut statements, &mut current, &mut verb, &mut verb_done);
            i += 1;
            continue;
        }

        // Plain code: the first word of it is the statement's keyword.
        if !verb_done {
            if c.is_alphanumeric() || c == '_' {
                verb.extend(c.to_uppercase());
            } else if !verb.is_empty() {
                verb_done = true;
            }
        }
        current.push(c);
        i += 1;
    }

    push(&mut statements, &mut current, &mut verb, &mut verb_done);
    statements
}

/// Splits a whole script into the statements `run` sends one at a time, `GO` batches carved out
/// first (D9). Comments and whitespace between two `GO`s, or before the first one, produce no
/// statement — the same "empty verb is not a statement" rule `split_statements` already applies
/// inside a batch.
fn split_script(sql: &str) -> Vec<Statement> {
    split_batches(sql)
        .iter()
        .flat_map(|batch| split_statements(batch))
        .collect()
}

/// The four verbs whose point is the number of rows they changed, so that a count of zero is still
/// worth reporting as a count — the same list `postgres_script::is_write_verb` reads, minus MySQL's
/// `REPLACE`/`LOAD` and plus `MERGE`, which T-SQL has and MySQL does not.
fn is_write_verb(verb: &str) -> bool {
    matches!(verb, "INSERT" | "UPDATE" | "DELETE" | "MERGE")
}

/// Whether `verb`/`text` is one [`run`] must send through `query()` rather than `execute()` — see
/// this module's top-level doc comment for why the two calls cannot be told apart by running the
/// statement and looking, the way `mysql_script`/`postgres_script` do through `sqlx`.
///
/// `EXEC`/`EXECUTE` always goes through `query()`: a stored procedure may or may not return a result
/// set, and there is no way to know ahead of time — sending it through `execute()` on the chance it
/// does not would silently drop any rows one does return. The cost is symmetric and accepted: a
/// procedure that only writes, with no `SELECT` of its own, reports `"ok"` rather than a row count,
/// because that count is not visible through this call either way.
fn returns_rows(verb: &str, text: &str) -> bool {
    match verb {
        "SELECT" | "WITH" | "EXEC" | "EXECUTE" => true,
        _ if is_write_verb(verb) => has_output_clause(text),
        _ => false,
    }
}

/// A case-insensitive, word-bounded search for `OUTPUT` outside a string, a quoted identifier and a
/// comment. `INSERT`/`UPDATE`/`DELETE`/`MERGE ... OUTPUT inserted.*` (or `deleted.*`) turns an
/// otherwise row-free statement into one with a real result set — reusing the exact scan
/// [`split_statements`] already does for strings/identifiers/comments rather than writing a second
/// lexer, so a column or string merely containing the word cannot be misread as the clause.
fn has_output_clause(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i < chars.len() && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                i += 1;
            }
            i += 2;
            continue;
        }
        if c == '\'' || c == '"' || c == '[' {
            let close = if c == '[' { ']' } else { c };
            i += 1;
            while i < chars.len() {
                if chars[i] == close {
                    i += 1;
                    if chars.get(i) == Some(&close) {
                        i += 1;
                        continue;
                    }
                    break;
                }
                i += 1;
            }
            continue;
        }
        if c.is_alphabetic() {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            if word.eq_ignore_ascii_case("output") {
                return true;
            }
            continue;
        }
        i += 1;
    }
    false
}

/// How many rows of one result set are read back. A query without a `TOP` can name more rows than
/// there is memory for, so the client stops here and says that it did — the same ceiling
/// `mysql_script`/`postgres_script` use, for the same reason: the grid only ever shows the rows on
/// screen now.
const MAX_ROWS: usize = 10_000;

/// The server's own words for one failed statement — never routed through [`map_error`], which
/// produces a translation code for the *command's* own `Result`, not the per-statement text this
/// app has always shown the way the server worded it (see `mysql_script`/`postgres_script`, which
/// keep the same distinction).
fn statement_error(e: tiberius::error::Error) -> String {
    match &e {
        tiberius::error::Error::Server(token) => token.message().to_string(),
        _ => e.to_string(),
    }
}

fn failed(statement: &Statement, started: Instant, message: String) -> StatementResult {
    StatementResult {
        statement: statement.text.clone(),
        verb: statement.verb.clone(),
        kind: "error".to_string(),
        columns: Vec::new(),
        rows: Vec::new(),
        truncated: false,
        rows_affected: 0,
        last_insert_id: None,
        duration_ms: started.elapsed().as_millis() as u64,
        error: Some(message),
    }
}

/// Runs one statement expected to return a result set — see [`returns_rows`]. `kind` is `"ok"`
/// rather than `"rows"` when the set turns out empty of columns too: an `EXEC` of a procedure that
/// writes but selects nothing still has to land somewhere.
async fn run_returning_rows(client: &mut Connection, statement: &Statement, started: Instant) -> StatementResult {
    let stream = match client.simple_query(statement.text.clone()).await {
        Ok(stream) => stream,
        Err(e) => return failed(statement, started, statement_error(e)),
    };
    let rows = match stream.into_first_result().await {
        Ok(rows) => rows,
        Err(e) => return failed(statement, started, statement_error(e)),
    };

    let columns: Vec<String> = rows
        .first()
        .map(|row: &Row| row.columns().iter().map(|c| c.name().to_string()).collect())
        .unwrap_or_default();
    let truncated = rows.len() > MAX_ROWS;
    let values: Vec<Vec<Value>> = rows
        .iter()
        .take(MAX_ROWS)
        .map(|row| row.cells().map(|(_, data)| column_value(data)).collect())
        .collect();

    StatementResult {
        statement: statement.text.clone(),
        verb: statement.verb.clone(),
        kind: if columns.is_empty() { "ok" } else { "rows" }.to_string(),
        columns,
        rows: values,
        truncated,
        rows_affected: 0,
        last_insert_id: None,
        duration_ms: started.elapsed().as_millis() as u64,
        error: None,
    }
}

/// Runs one statement expected to carry no result set — see [`returns_rows`]. A count of zero is
/// still reported as `"affected"` for one of the four write verbs, the same rule
/// `mysql_script::is_write_verb`'s callers use: `UPDATE ... 0 rows` says something,
/// `SET @x = 1 ... 0 rows` does not.
async fn run_affecting_rows(client: &mut Connection, statement: &Statement, started: Instant) -> StatementResult {
    match client.execute(statement.text.clone(), &[]).await {
        Ok(result) => {
            let rows_affected = result.total();
            let kind = if is_write_verb(&statement.verb) || rows_affected > 0 {
                "affected"
            } else {
                "ok"
            };
            StatementResult {
                statement: statement.text.clone(),
                verb: statement.verb.clone(),
                kind: kind.to_string(),
                columns: Vec::new(),
                rows: Vec::new(),
                truncated: false,
                rows_affected,
                last_insert_id: None,
                duration_ms: started.elapsed().as_millis() as u64,
                error: None,
            }
        }
        Err(e) => failed(statement, started, statement_error(e)),
    }
}

/// The session's own SPID, which is what [`cancel`] names to `KILL` — the counterpart of
/// `mysql::thread_id`/`postgres_script::backend_pid`.
async fn session_id(client: &mut Connection) -> Result<u64, AppError> {
    let row = client
        .simple_query("SELECT @@SPID")
        .await
        .map_err(map_error)?
        .into_row()
        .await
        .map_err(map_error)?
        .ok_or_else(|| err!("error.mssql", message = "the server reported no @@SPID"))?;
    Ok(row.get::<i16, _>(0).unwrap_or(0).max(0) as u64)
}

/// Runs the editor's text batch by batch (D9) and statement by statement within each batch,
/// reporting each statement's outcome. Everything runs on one connection, so a `USE`, a `SET`, a
/// temporary table or a transaction opened by one statement is still in force for the next — a
/// script reads the way it would in `sqlcmd`.
///
/// The connection is detached from the pool with [`Object::take`] before the first statement runs,
/// and simply dropped — closing the TDS session — when `run` returns or is dropped early. Handing it
/// back to the pool instead would carry whatever the script left set: another database (`USE`), an
/// open transaction, a temp table, a `SET` no other borrower expects. `Manager::recycle`'s
/// `SELECT 1` would not catch any of that — only a dead connection fails it. Same reasoning as
/// `mysql_script::run`'s identical `close_on_drop`.
///
/// A statement that fails stops the script: its own result carries the error, and the results
/// before it are still returned. `announce` is handed the session's SPID once, before the first
/// statement runs — the only handle another connection has on it, and what [`cancel`] needs to stop
/// it.
pub async fn run(
    pool: &Pool,
    sql: &str,
    database: Option<&str>,
    announce: impl FnOnce(u64),
) -> Result<Vec<StatementResult>, AppError> {
    let statements = split_script(sql);
    if statements.is_empty() {
        return Err(err!("error.nothingToRun"));
    }

    let guard = pool.get().await.map_err(|e| err!("error.mssql", message = e))?;
    let mut client = Object::take(guard);

    if let Some(db) = database.filter(|d| !d.is_empty()) {
        client
            .simple_query(format!("USE {}", quote_ident(db)))
            .await
            .map_err(map_error)?;
    }

    announce(session_id(&mut client).await?);

    let mut results = Vec::new();
    for statement in &statements {
        let started = Instant::now();
        let result = if returns_rows(&statement.verb, &statement.text) {
            run_returning_rows(&mut client, statement, started).await
        } else {
            run_affecting_rows(&mut client, statement, started).await
        };
        let failed = result.kind == "error";
        results.push(result);
        if failed {
            break;
        }
    }

    Ok(results)
}

/// What the splitter has to get right is where one statement ends and one batch ends — a semicolon
/// or `GO` line inside a string, a quoted identifier or a comment is text, not a separator, and
/// sending the halves of a statement separately is a syntax error at best and half an operation at
/// worst. These mirror `src/modules/db/sql/statements.test.ts`'s `MSSQL_SYNTAX` describe blocks
/// (Plan 4) one for one — same input, same statement count — per D9's "kept in step by a parallel
/// test suite" note.
#[cfg(test)]
mod tests {
    use super::split_script;

    fn verbs(sql: &str) -> Vec<String> {
        split_script(sql).into_iter().map(|s| s.verb).collect()
    }

    fn texts(sql: &str) -> Vec<String> {
        split_script(sql).into_iter().map(|s| s.text).collect()
    }

    #[test]
    fn bracket_identifier_hides_its_semicolon() {
        assert_eq!(
            texts("SELECT * FROM [Order;Details]; SELECT 1"),
            ["SELECT * FROM [Order;Details]", "SELECT 1"]
        );
    }

    #[test]
    fn doubled_close_bracket_is_one_literal_bracket() {
        assert_eq!(texts("SELECT * FROM [a]]b]"), ["SELECT * FROM [a]]b]"]);
    }

    #[test]
    fn double_quote_is_always_an_identifier() {
        assert_eq!(
            texts(r#"SELECT * FROM "Order;Details""#),
            [r#"SELECT * FROM "Order;Details""#]
        );
    }

    #[test]
    fn go_ends_the_previous_statement_without_becoming_one() {
        assert_eq!(verbs("SELECT 1\nGO\nSELECT 2"), ["SELECT", "SELECT"]);
    }

    #[test]
    fn semicolons_still_split_inside_each_batch() {
        assert_eq!(
            verbs("SELECT 1; SELECT 2\nGO\nSELECT 3"),
            ["SELECT", "SELECT", "SELECT"]
        );
    }

    #[test]
    fn go_accepts_a_repeat_count() {
        assert_eq!(verbs("SELECT 1\nGO 3\nSELECT 2"), ["SELECT", "SELECT"]);
    }

    #[test]
    fn go_is_case_insensitive() {
        assert_eq!(verbs("SELECT 1\ngo\nSELECT 2"), ["SELECT", "SELECT"]);
    }

    #[test]
    fn two_gos_in_a_row_add_no_empty_statement() {
        assert_eq!(verbs("SELECT 1\nGO\nGO\nSELECT 2"), ["SELECT", "SELECT"]);
    }

    #[test]
    fn go_needs_the_line_to_itself() {
        assert_eq!(verbs("SELECT 1 GO\nSELECT 2"), ["SELECT"]);
        // Read as one statement, not two — `GO` here is just two more words of the SELECT list.
        assert_eq!(texts("SELECT 1 GO\nSELECT 2"), ["SELECT 1 GO\nSELECT 2"]);
    }

    #[test]
    fn a_name_merely_starting_with_go_is_not_a_separator() {
        assert_eq!(verbs("SELECT good_column FROM t"), ["SELECT"]);
    }

    #[test]
    fn is_not_fooled_by_a_comment_that_merely_contains_the_word() {
        assert_eq!(
            texts("SELECT 1 -- go\nSELECT 2"),
            ["SELECT 1 -- go\nSELECT 2"]
        );
    }
}
