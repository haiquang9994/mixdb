//! Running whatever SQL the Query tab sends, against ClickHouse — the counterpart of
//! `mysql_script.rs`/`postgres_script.rs`/`sqlite_script.rs`, and two of their three jobs: split a
//! script, and run it statement by statement. There is no third: ClickHouse's `KILL QUERY` needs a
//! `query_id` tracked per request, which nothing here does yet, so the Cancel button is closed —
//! see `cancellable` on the dialect.
//!
//! What the splitter has to know matches `CLICKHOUSE_SYNTAX` in `src/modules/db/sql/syntax.ts`,
//! checked against a running server rather than only documented: `#` opens a comment
//! (`SELECT 1 # x;\n...`), `--` needs no trailing space (`SELECT 5--3` is `5`, not `2`), `/* */`
//! nests, and a single-quoted string takes both a doubled quote and a backslash as an escape
//! (`'it''s'` and `'it\'s'` both read back as `it's`). Backtick and double quote are both
//! identifier quotes, backslash-escaped rather than doubled the way `quote_ident` writes one.
//!
//! Every statement is sent to the server as its own HTTP request — ClickHouse's HTTP interface
//! refuses a body holding more than one — which is the reason this module exists at all rather
//! than handing `run_script`'s whole text to `query` in one call.

use super::clickhouse::{execute_check, query_in_database, Connection};
use crate::error::AppError;
use crate::modules::db::models::{SqlProblem, StatementResult};
use serde_json::Value;
use std::time::Instant;

/// How many rows of one result set are read back — the same ceiling the other three engines hold
/// a script's result set to.
const MAX_ROWS: usize = 10_000;

/// One statement carved out of the editor's text.
struct Statement {
    text: String,
    /// The keyword it opens with, upper-cased. Empty for a run of nothing but comments.
    verb: String,
}

/// Splits a script into the statements that are to be sent one at a time.
///
/// Ported from `src/modules/db/sql/statements.ts`, which the editor splits with so that the
/// statement it highlights is the one that ends up running — **a change to either splitter
/// belongs in the same commit as the other**, and in both sets of tests. Comments are kept in the
/// text: they may carry a hint (`SETTINGS`, say), and dropping them would change what is run.
fn split_statements(sql: &str) -> Vec<Statement> {
    let chars: Vec<char> = sql.chars().collect();
    let mut statements: Vec<Statement> = Vec::new();
    let mut current = String::new();
    let mut verb = String::new();
    let mut verb_done = false;
    let mut i = 0;

    fn push(statements: &mut Vec<Statement>, current: &mut String, verb: &mut String) {
        let text = current.trim().to_string();
        let opening = std::mem::take(verb);
        current.clear();
        if opening.is_empty() {
            return;
        }
        statements.push(Statement { text, verb: opening });
    }

    while i < chars.len() {
        let c = chars[i];

        // `#` to the end of the line.
        if c == '#' {
            while i < chars.len() && chars[i] != '\n' {
                current.push(chars[i]);
                i += 1;
            }
            continue;
        }

        // `--` to the end of the line, needing no whitespace after it.
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            while i < chars.len() && chars[i] != '\n' {
                current.push(chars[i]);
                i += 1;
            }
            continue;
        }

        // `/* ... */`, which nests.
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            current.push('/');
            current.push('*');
            i += 2;
            let mut depth = 1u32;
            while i < chars.len() && depth > 0 {
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    current.push('/');
                    current.push('*');
                    i += 2;
                    depth += 1;
                    continue;
                }
                if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    current.push('*');
                    current.push('/');
                    i += 2;
                    depth -= 1;
                    continue;
                }
                current.push(chars[i]);
                i += 1;
            }
            continue;
        }

        // Backtick or double-quoted identifiers: backslash-escaped, same as `quote_ident` writes.
        if c == '`' || c == '"' {
            current.push(c);
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                if ch == '\\' && i + 1 < chars.len() {
                    current.push(ch);
                    current.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                current.push(ch);
                i += 1;
                if ch == c {
                    break;
                }
            }
            continue;
        }

        // Single-quoted strings: both a doubled quote and a backslash escape one.
        if c == '\'' {
            current.push(c);
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                if ch == '\\' && i + 1 < chars.len() {
                    current.push(ch);
                    current.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                current.push(ch);
                i += 1;
                if ch == '\'' {
                    if chars.get(i) == Some(&'\'') {
                        current.push('\'');
                        i += 1;
                        continue;
                    }
                    break;
                }
            }
            continue;
        }

        if c == ';' {
            push(&mut statements, &mut current, &mut verb);
            verb_done = false;
            i += 1;
            continue;
        }

        if !verb_done {
            if c.is_alphanumeric() || c == '_' {
                verb.push(c.to_ascii_uppercase());
            } else if !verb.is_empty() {
                verb_done = true;
            }
        }
        current.push(c);
        i += 1;
    }

    push(&mut statements, &mut current, &mut verb);
    statements
}

/// The server's own words out of a failed call, rather than `AppError`'s debug form
/// (`"error.clickhouse message=…"`) its `Display` would give — this module reports server errors
/// as text meant for the Query tab to show beside the statement, not as a translation code.
fn server_message(error: &AppError) -> String {
    error.params.get("message").cloned().unwrap_or_else(|| error.to_string())
}

/// One value, as the closest JSON the frontend can show — the counterpart of `column_value` on
/// the other engines. `FORMAT JSON` has already turned it into JSON, so this is only about the
/// shape a table cell wants: a `Vec<Value>` in column order rather than a `Map`.
fn row_to_columns(row: &serde_json::Map<String, Value>, columns: &[String]) -> Vec<Value> {
    columns.iter().map(|c| row.get(c).cloned().unwrap_or(Value::Null)).collect()
}

/// One token of a statement's own text that D3/D4 of
/// `docs/superpowers/specs/2026-09-04-clickhouse-query-dml-design.md` need — nothing more. Walked
/// fresh here rather than reusing `split_statements`'s loop: that function only tracks a
/// statement's own boundaries and its opening verb, never what comes after, and its quoting rules
/// (backtick/double-quote identifiers, both escape styles, nesting block comments, `#`/`--` line
/// comments) are exactly what this needs too — see that function's own doc for where each rule was
/// checked against the test server.
enum Word {
    /// An unquoted run of letters/digits/underscore — a keyword or a bare identifier. Original
    /// case kept: SQL keywords compare case-insensitively, but a bare table name's case is part of
    /// its name.
    Bare(String),
    /// Backtick- or double-quoted, quoting undone (backslash-escaped, the same convention
    /// `quote_ident` writes one in).
    Quoted(String),
    Comma,
    Dot,
}

impl Word {
    fn is_keyword(&self, kw: &str) -> bool {
        matches!(self, Word::Bare(s) if s.eq_ignore_ascii_case(kw))
    }

    fn name(&self) -> Option<&str> {
        match self {
            Word::Bare(s) | Word::Quoted(s) => Some(s),
            _ => None,
        }
    }
}

/// Splits `sql` into the [`Word`]s above, dropping whitespace, comments and string literals, and
/// everything inside a bracketed group — `ALTER TABLE <name> UPDATE`/`DELETE FROM <name> WHERE`
/// never need to look inside one, the name always sits at the top level.
fn dml_words(sql: &str) -> Vec<Word> {
    let chars: Vec<char> = sql.chars().collect();
    let mut words = Vec::new();
    let mut depth = 0i32;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        if c == '#' || (c == '-' && chars.get(i + 1) == Some(&'-')) {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            let mut nesting = 1u32;
            while i < chars.len() && nesting > 0 {
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    i += 2;
                    nesting += 1;
                    continue;
                }
                if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    i += 2;
                    nesting -= 1;
                    continue;
                }
                i += 1;
            }
            continue;
        }
        if c == '`' || c == '"' {
            let quote = c;
            i += 1;
            let mut value = String::new();
            while i < chars.len() {
                let ch = chars[i];
                if ch == '\\' && i + 1 < chars.len() {
                    value.push(chars[i + 1]);
                    i += 2;
                    continue;
                }
                i += 1;
                if ch == quote {
                    break;
                }
                value.push(ch);
            }
            if depth == 0 {
                words.push(Word::Quoted(value));
            }
            continue;
        }
        if c == '\'' {
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                if ch == '\\' && i + 1 < chars.len() {
                    i += 2;
                    continue;
                }
                i += 1;
                if ch == '\'' {
                    if chars.get(i) == Some(&'\'') {
                        i += 1;
                        continue;
                    }
                    break;
                }
            }
            continue;
        }
        if c == '(' {
            depth += 1;
            i += 1;
            continue;
        }
        if c == ')' {
            depth -= 1;
            i += 1;
            continue;
        }
        if depth == 0 && c == ',' {
            words.push(Word::Comma);
            i += 1;
            continue;
        }
        if depth == 0 && c == '.' {
            words.push(Word::Dot);
            i += 1;
            continue;
        }
        if c.is_alphanumeric() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            if depth == 0 {
                words.push(Word::Bare(chars[start..i].iter().collect()));
            }
            continue;
        }
        i += 1;
    }
    words
}

/// The `[database.]table` reference starting at `words[at]` — a bare/quoted name, optionally
/// followed by `.` and a second bare/quoted name. `None` when `words[at]` is not a name.
fn read_table_ref(words: &[Word], at: usize) -> Option<(Option<String>, String, usize)> {
    let first = words.get(at)?.name()?.to_string();
    if matches!(words.get(at + 1), Some(Word::Dot)) {
        let second = words.get(at + 2)?.name()?.to_string();
        Some((Some(first), second, at + 3))
    } else {
        Some((None, first, at + 1))
    }
}

/// `Some((database, table))` when `sql` is `ALTER TABLE [db.]name UPDATE ...` and nothing else —
/// one `AlterCommand`, no comma anywhere at the top level. A comma means more than one command is
/// packed into the `ALTER` (ClickHouse allows `ALTER TABLE t DROP COLUMN x, UPDATE y = 1 WHERE
/// ...`) — left unrecognised on purpose (D3 of the design doc): the safe default is to fall through
/// to the existing, still-blocked DDL path rather than guess.
///
/// `sql` is one statement's own text; the caller already knows its opening verb is `ALTER` from
/// `Statement::verb` before calling this.
fn alter_table_update_target(sql: &str) -> Option<(Option<String>, String)> {
    let words = dml_words(sql);
    if words.iter().any(|w| matches!(w, Word::Comma)) {
        return None;
    }
    if !words.first()?.is_keyword("ALTER") {
        return None;
    }
    if !words.get(1)?.is_keyword("TABLE") {
        return None;
    }
    let (database, table, next) = read_table_ref(&words, 2)?;
    if !words.get(next)?.is_keyword("UPDATE") {
        return None;
    }
    Some((database, table))
}

/// `Some((database, table))` when `sql` is `DELETE FROM [db.]name ...` — ClickHouse's lightweight
/// delete. `sql` is one statement's own text; the caller already knows its opening verb is
/// `DELETE`.
fn delete_from_target(sql: &str) -> Option<(Option<String>, String)> {
    let words = dml_words(sql);
    if !words.first()?.is_keyword("DELETE") {
        return None;
    }
    if !words.get(1)?.is_keyword("FROM") {
        return None;
    }
    let (database, table, _next) = read_table_ref(&words, 2)?;
    Some((database, table))
}

/// Runs a script, statement by statement, each on its own request — see the module doc for why.
///
/// v1 never writes, so every statement's `kind` is `"rows"` or `"ok"`: there is no `"affected"`
/// here, and `last_insert_id` is always `None`. A failed statement stops the script, the way it
/// would in `clickhouse-client`.
pub async fn run(
    conn: &Connection,
    sql: &str,
    database: Option<&str>,
) -> Result<Vec<StatementResult>, AppError> {
    let statements = split_statements(sql);
    if statements.is_empty() {
        return Err(err!("error.nothingToRun"));
    }

    let mut results: Vec<StatementResult> = Vec::new();

    for statement in statements {
        let started = Instant::now();
        let outcome = query_in_database(conn, &statement.text, database).await;

        let (columns, rows, truncated, failure) = match outcome {
            Ok(result) => {
                let columns: Vec<String> =
                    result.data.first().map(|row| row.keys().cloned().collect()).unwrap_or_default();
                let truncated = result.data.len() > MAX_ROWS;
                let rows: Vec<Vec<Value>> = result
                    .data
                    .iter()
                    .take(MAX_ROWS)
                    .map(|row| row_to_columns(row, &columns))
                    .collect();
                (columns, rows, truncated, None)
            }
            // `message` rather than `e.to_string()`: the latter is `AppError`'s own debug form
            // ("error.clickhouse message=…"), meant for a log line — this field is what the Query
            // tab shows beside the statement, and what belongs there is the server's own words.
            Err(e) => (Vec::new(), Vec::new(), false, Some(server_message(&e))),
        };

        let failed = failure.is_some();
        let kind = if failed {
            "error"
        } else if !columns.is_empty() {
            "rows"
        } else {
            "ok"
        };
        results.push(StatementResult {
            statement: statement.text,
            verb: statement.verb,
            kind: kind.to_string(),
            columns,
            rows,
            truncated,
            rows_affected: 0,
            last_insert_id: None,
            duration_ms: started.elapsed().as_millis() as u64,
            error: failure,
        });
        if failed {
            break;
        }
    }

    Ok(results)
}

/// Asks ClickHouse what it makes of one statement, without running it — `EXPLAIN AST` parses the
/// statement and throws the result away without executing anything past that, which is what makes
/// this safe to fire at a half-typed statement.
///
/// Only a parse failure is reported: `EXPLAIN AST` has nothing to say about a name that does not
/// exist, since resolving names is not part of what it does. That leaves nothing to report as a
/// `"warning"` the way the other three engines can — everything this returns is `"error"`, or
/// `None`.
///
/// Goes through [`execute_check`] rather than [`query_in_database`], and has to: `EXPLAIN AST`'s
/// own output is a plain-text tree, and `FORMAT JSON` appended after the statement is parsed as
/// part of *what is being explained* rather than as a format for the explanation — see that
/// function's own doc for what that looks like when it goes wrong.
pub async fn validate(
    conn: &Connection,
    sql: &str,
    database: Option<&str>,
) -> Result<Option<SqlProblem>, AppError> {
    if sql.trim().is_empty() {
        return Ok(None);
    }
    match execute_check(conn, &format!("EXPLAIN AST {sql}"), database).await {
        Ok(()) => Ok(None),
        Err(e) => Ok(Some(SqlProblem {
            message: server_message(&e),
            number: 0,
            line: None,
            severity: "error".to_string(),
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split(sql: &str) -> Vec<(String, String)> {
        split_statements(sql).into_iter().map(|s| (s.verb, s.text)).collect()
    }

    #[test]
    fn alter_table_update_target_reads_an_unqualified_table() {
        assert_eq!(
            alter_table_update_target("ALTER TABLE t UPDATE x = 1 WHERE id = 2"),
            Some((None, "t".to_string()))
        );
    }

    #[test]
    fn alter_table_update_target_reads_a_qualified_table() {
        assert_eq!(
            alter_table_update_target("ALTER TABLE mydb.t UPDATE x = 1"),
            Some((Some("mydb".to_string()), "t".to_string()))
        );
    }

    #[test]
    fn alter_table_update_target_understands_backtick_and_double_quote() {
        assert_eq!(
            alter_table_update_target("ALTER TABLE `my db`.`my table` UPDATE x = 1"),
            Some((Some("my db".to_string()), "my table".to_string()))
        );
        assert_eq!(
            alter_table_update_target(r#"ALTER TABLE "t" UPDATE x = 1"#),
            Some((None, "t".to_string()))
        );
    }

    #[test]
    fn alter_table_update_target_refuses_more_than_one_command() {
        assert_eq!(alter_table_update_target("ALTER TABLE t DROP COLUMN x, UPDATE y = 1 WHERE z = 2"), None);
    }

    #[test]
    fn alter_table_update_target_refuses_a_plain_drop_column() {
        assert_eq!(alter_table_update_target("ALTER TABLE t DROP COLUMN x"), None);
    }

    #[test]
    fn alter_table_update_target_refuses_alter_delete() {
        // D2 of the design: only DELETE FROM...WHERE is supported, not this older mutation spelling.
        assert_eq!(alter_table_update_target("ALTER TABLE t DELETE WHERE id = 1"), None);
    }

    #[test]
    fn alter_table_update_target_skips_comments() {
        assert_eq!(
            alter_table_update_target("ALTER TABLE /* c */ t UPDATE x = 1 -- trailing\nWHERE id = 1"),
            Some((None, "t".to_string()))
        );
    }

    #[test]
    fn delete_from_target_reads_the_table() {
        assert_eq!(delete_from_target("DELETE FROM t WHERE id = 1"), Some((None, "t".to_string())));
        assert_eq!(
            delete_from_target("DELETE FROM mydb.t WHERE id = 1"),
            Some((Some("mydb".to_string()), "t".to_string()))
        );
    }

    #[test]
    fn delete_from_target_refuses_a_shape_with_no_from() {
        assert_eq!(delete_from_target("DELETE"), None);
    }

    #[test]
    fn a_semicolon_inside_a_string_does_not_split() {
        let statements = split("select 'a;b'; select 2");
        assert_eq!(statements.len(), 2);
        assert_eq!(statements[0].1, "select 'a;b'");
    }

    #[test]
    fn a_doubled_quote_and_a_backslash_both_escape() {
        assert_eq!(split("select 'it''s; here'; select 2").len(), 2);
        assert_eq!(split(r"select 'it\'s; here'; select 2").len(), 2);
    }

    #[test]
    fn both_identifier_quotes_are_understood() {
        assert_eq!(split(r#"select "a;b" from t; select 2"#).len(), 2);
        assert_eq!(split("select `a;b` from t; select 2").len(), 2);
    }

    /// Checked against the server: `SELECT 5--3` is `5`, not `2` — no space is needed to open the
    /// comment, unlike MySQL.
    #[test]
    fn a_dash_comment_needs_no_space_after_it() {
        let statements = split("select 1 --3;\nselect 2");
        assert_eq!(statements.len(), 1);
    }

    /// Checked against the server: a comment inside a comment does not end the outer one early.
    #[test]
    fn a_block_comment_nests() {
        let statements = split("select /* a /* b */ 1 */ ; select 2");
        assert_eq!(statements.len(), 2);
        assert_eq!(statements[0].1, "select /* a /* b */ 1 */");
    }

    #[test]
    fn a_hash_comment_runs_to_the_end_of_the_line() {
        let statements = split("select 1 # a;b\n; select 2");
        assert_eq!(statements.len(), 2);
    }

    #[test]
    fn comments_are_kept_and_a_run_of_them_alone_is_not_a_statement() {
        assert!(split("-- nothing here\n").is_empty());
        assert!(split("  ;  ; ").is_empty());
        let statements = split("/* keep me */ select 1");
        assert_eq!(statements[0].1, "/* keep me */ select 1");
    }

    #[test]
    fn the_verb_is_the_opening_word() {
        let statements = split("  select 1 from t");
        assert_eq!(statements[0].0, "SELECT");
    }

    /// The Query tab shows this beside the statement — it has to be the server's own sentence, not
    /// `AppError`'s `code`+`params` debug form.
    #[test]
    fn server_message_reads_the_driver_s_words_not_the_error_code() {
        let error = err!("error.clickhouse", message = "Code: 62. Syntax error");
        assert_eq!(server_message(&error), "Code: 62. Syntax error");
    }

    /// A code carrying no `message` param falls back to its own `Display` rather than panicking or
    /// silently losing what went wrong.
    #[test]
    fn server_message_falls_back_when_there_is_no_message_param() {
        let error = err!("error.nothingToRun");
        assert_eq!(server_message(&error), "error.nothingToRun");
    }
}
