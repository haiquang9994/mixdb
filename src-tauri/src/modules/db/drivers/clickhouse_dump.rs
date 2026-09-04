//! Dumping and restoring a ClickHouse database over its HTTP interface — no `clickhouse-client`,
//! no child process. See `docs/superpowers/specs/2026-09-04-clickhouse-dump-restore-design.md` for
//! the decisions this implements (referenced as D1..D9 below).

use super::clickhouse::{self, Connection};
use super::clickhouse_script::{Fed, Scanner};
use super::dump::{self, Tracker};
use crate::error::AppError;

/// Removes every `database.` qualifier from `sql` that stands immediately before an identifier —
/// the leading name of the table/view being created, and every reference to the same database
/// inside a `VIEW`/`MATERIALIZED VIEW`'s `AS SELECT`/`TO` clause (D4). Leaves every other
/// occurrence of `database` untouched: inside a single-quoted string, and specifically the database
/// argument of `ENGINE = Distributed('cluster', 'database', 'table')` — that one is a data value,
/// not a scoped reference, and rewriting it would point the proxy somewhere it never meant to go
/// (D4's documented exception).
///
/// Whole-string rather than built on [`Scanner`]: this runs once per table at dump time on a single
/// `SHOW CREATE TABLE` result already held in memory in full — there is no file to read in chunks,
/// so `Scanner`'s resumability buys nothing here. It uses the same quote/comment rules by hand
/// instead (checked against `split_statements`' own doc for where each was verified against the
/// test server).
pub(super) fn strip_database_qualifiers(sql: &str, database: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let mut out = String::new();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        if c == '#' || (c == '-' && chars.get(i + 1) == Some(&'-')) {
            while i < chars.len() && chars[i] != '\n' {
                out.push(chars[i]);
                i += 1;
            }
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            out.push('/');
            out.push('*');
            i += 2;
            let mut depth = 1u32;
            while i < chars.len() && depth > 0 {
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    out.push('/');
                    out.push('*');
                    i += 2;
                    depth += 1;
                    continue;
                }
                if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    out.push('*');
                    out.push('/');
                    i += 2;
                    depth -= 1;
                    continue;
                }
                out.push(chars[i]);
                i += 1;
            }
            continue;
        }

        // A single-quoted string is copied verbatim — this is the position `Distributed(...)` puts
        // the database name in, and D4 says it must not be touched.
        if c == '\'' {
            out.push(c);
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                out.push(ch);
                i += 1;
                if ch == '\\' && i < chars.len() {
                    out.push(chars[i]);
                    i += 1;
                    continue;
                }
                if ch == '\'' {
                    if chars.get(i) == Some(&'\'') {
                        out.push('\'');
                        i += 1;
                        continue;
                    }
                    break;
                }
            }
            continue;
        }

        // A backtick- or double-quoted identifier: dropped along with a following `.` if it names
        // `database` exactly, copied through untouched otherwise.
        if c == '`' || c == '"' {
            let start = i;
            let quote = c;
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                if ch == '\\' && i + 1 < chars.len() {
                    i += 2;
                    continue;
                }
                i += 1;
                if ch == quote {
                    break;
                }
            }
            let raw: String = chars[start..i].iter().collect();
            let inner = &raw[1..raw.len().saturating_sub(1)];
            if inner == database && chars.get(i) == Some(&'.') {
                i += 1;
            } else {
                out.push_str(&raw);
            }
            continue;
        }

        // A bare (unquoted) identifier — the same check without quotes. `SHOW CREATE TABLE` always
        // backtick-quotes what it names, so this is a defensive fallback rather than the common
        // case; kept for the same reason `split_statements` handles bare identifiers too.
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word: String = chars[start..i].iter().collect();
            if word == database && chars.get(i) == Some(&'.') {
                i += 1;
            } else {
                out.push_str(&word);
            }
            continue;
        }

        out.push(c);
        i += 1;
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_the_leading_qualifier_of_a_table() {
        assert_eq!(
            strip_database_qualifiers("CREATE TABLE `db`.`t` (`a` Int32) ENGINE = MergeTree", "db"),
            "CREATE TABLE `t` (`a` Int32) ENGINE = MergeTree"
        );
    }

    #[test]
    fn strips_every_reference_in_a_view() {
        assert_eq!(
            strip_database_qualifiers("CREATE VIEW `db`.`v` AS SELECT * FROM `db`.`t`", "db"),
            "CREATE VIEW `v` AS SELECT * FROM `t`"
        );
    }

    #[test]
    fn strips_every_reference_in_a_materialized_view_including_to() {
        assert_eq!(
            strip_database_qualifiers(
                "CREATE MATERIALIZED VIEW `db`.`mv` TO `db`.`target` AS SELECT * FROM `db`.`source`",
                "db"
            ),
            "CREATE MATERIALIZED VIEW `mv` TO `target` AS SELECT * FROM `source`"
        );
    }

    #[test]
    fn leaves_the_database_name_alone_inside_a_string_literal() {
        assert_eq!(
            strip_database_qualifiers("CREATE TABLE `db`.`t` (`a` String DEFAULT 'db') ENGINE = X", "db"),
            "CREATE TABLE `t` (`a` String DEFAULT 'db') ENGINE = X"
        );
    }

    #[test]
    fn leaves_a_distributed_engines_database_argument_alone() {
        let sql = "CREATE TABLE `db`.`d` AS `db`.`local` \
                    ENGINE = Distributed('cluster', 'db', 'local')";
        assert_eq!(
            strip_database_qualifiers(sql, "db"),
            "CREATE TABLE `d` AS `local` ENGINE = Distributed('cluster', 'db', 'local')"
        );
    }

    #[test]
    fn a_different_database_named_the_same_word_as_a_column_value_is_not_touched() {
        // Sanity check on the string-literal test above: an unrelated database name is never a
        // false-positive match target either.
        assert_eq!(
            strip_database_qualifiers("CREATE TABLE `other`.`t` (`a` Int32)", "db"),
            "CREATE TABLE `other`.`t` (`a` Int32)"
        );
    }
}
