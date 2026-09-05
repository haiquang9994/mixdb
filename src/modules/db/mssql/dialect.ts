import type { SqlDialect } from "../sql/dialect";
import { MSSQL_SYNTAX } from "../sql/syntax";
import { isAutoIncrement, isBinary, isGenerated, isServerAssigned } from "./columns";
import { MSSQL } from "@codemirror/lang-sql";
import { reservedWords } from "../sql/lint";
import { isMssqlSystemDatabase } from "./system";
import { mssqlEditing } from "./editing";

/**
 * SQL Server's side of {@link SqlDialect}. Rows can be read and written now — data, structure,
 * statistics, and the Data tab's edit/add/delete. `syntax` is real as of this plan too: bracketed
 * identifiers and `GO` batches split correctly, which the Query tab (Plan 5) needs before it can
 * run anything against a script it did not write itself. `writable`, `ddlWritable` and
 * `dumpRestoreWritable` stay false, and each lands in a plan of its own — see
 * `docs/superpowers/specs/2026-09-05-mssql-support-design.md`.
 */
export const mssqlDialect: SqlDialect = {
  kind: "mssql",
  syntax: MSSQL_SYNTAX,
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
