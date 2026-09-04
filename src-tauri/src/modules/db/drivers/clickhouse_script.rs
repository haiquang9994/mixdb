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
