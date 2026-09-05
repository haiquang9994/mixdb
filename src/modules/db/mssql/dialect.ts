import type { SqlDialect } from "../sql/dialect";
import type { SqlSyntax } from "../sql/syntax";
import { isAutoIncrement, isBinary, isGenerated, isServerAssigned } from "./columns";
import { MSSQL } from "@codemirror/lang-sql";
import { reservedWords } from "../sql/lint";
import { isMssqlSystemDatabase } from "./system";
import { mssqlEditing } from "./editing";

/**
 * T-SQL's lexical rules, as much of them as the current {@link SqlSyntax} can hold.
 *
 * `identifierQuote` is null rather than `[`, and that is deliberate: SQL Server's own identifier
 * quote is a **pair** — `[name]`, closed with `]]` doubled inside — and this field holds a single
 * character that opens and closes. Naming `[` here would leave the tokenizer looking for a second
 * `[` to close on and swallowing the rest of the statement. Null costs a bracketed name its
 * highlighting and nothing else, since the Query tab cannot run anything yet.
 *
 * Splitting this field into an open/close pair is the syntax plan, which is also where this moves
 * into `sql/syntax.ts` beside the other engines' as `MSSQL_SYNTAX`. See
 * `docs/superpowers/specs/2026-09-05-mssql-support-design.md`'s D4.
 */
const MSSQL_SYNTAX_PROVISIONAL: SqlSyntax = {
  // `#` opens a temporary table's name here, not a comment.
  hashComments: false,
  dashCommentNeedsSpace: false,
  nestedBlockComments: false,
  identifierQuote: null,
  // With QUOTED_IDENTIFIER ON — which every client driver sets, tiberius included — a double-quoted
  // run is a name.
  doubleQuoteIsIdentifier: true,
  backslashEscapes: false,
  escapeStringPrefix: false,
  dollarQuoting: false,
};

/**
 * SQL Server's side of {@link SqlDialect}. Rows can be read and written now — data, structure,
 * statistics, and the Data tab's edit/add/delete. The Query tab, DDL and dump/restore still close:
 * `writable`, `ddlWritable` and `dumpRestoreWritable` stay false, and each lands in a plan of its
 * own — see `docs/superpowers/specs/2026-09-05-mssql-support-design.md`.
 */
export const mssqlDialect: SqlDialect = {
  kind: "mssql",
  syntax: MSSQL_SYNTAX_PROVISIONAL,
  cmDialect: MSSQL,
  reserved: reservedWords(MSSQL),
  editing: mssqlEditing,
  isSystemDatabase: isMssqlSystemDatabase,
  isAutoIncrement,
  isGenerated,
  isServerAssigned,
  isBinary,
  // There is a session to reach in and `KILL`, but nothing runs long enough to need it until the
  // Query tab opens — and the button is closed rather than left to press and do nothing.
  cancellable: false,
  writable: false,
  dumpRestoreWritable: false,
  ddlWritable: false,
  rowsWritable: true,
  // SQL Server has no regex operator before its 2025 release, so the dropdown does not offer one —
  // and `build_where` in `drivers/mssql.rs` has no arm for it either. See D12.
  regexpFilter: false,
};
