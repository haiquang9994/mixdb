import { invoke } from "@tauri-apps/api/core";
import type {
  SqlCollation,
  SqlProblem,
  SqlSchemaOutline,
  SqlStatementResult,
  SqlTablePage,
  SqlTableStructure,
  TableStats,
} from "../types";
import type { SqlApi, SqlPageQuery, SqlServerInfo } from "../sql/api";

/**
 * SQLite's side of {@link SqlApi}.
 *
 * `database` is carried by every call the way it is on the other two engines, and is always the
 * same value: `main`, the one database a file holds. The backend takes it and ignores it. Kept in
 * the signatures rather than dropped, so the workspace above has one shape to hold whichever engine
 * it was opened on.
 */
export const sqliteApi: SqlApi = {
  listDatabases(id) {
    return invoke<string[]>("sqlite_list_databases", { id });
  },

  listTables(id, database) {
    return invoke<string[]>("sqlite_list_tables", { id, database });
  },

  serverInfo(id) {
    return invoke<SqlServerInfo>("sqlite_server_info", { id });
  },

  tableData(id, database, table, query: SqlPageQuery) {
    return invoke<SqlTablePage>("sqlite_table_data", { id, database, table, query });
  },

  /* Everything below is a command that does not exist yet. Each throws rather than invoking a name
     nothing answers to, so that a control reached before its task lands says one sentence instead
     of failing as "command not found" — and so that this list is the checklist of what is left.
     They go in the order of the tasks that remove them: structure and stats, then writing rows,
     then DDL, then the Query tab, then dump and restore. */

  tableStats(): Promise<TableStats[]> {
    return notYet();
  },

  tableStructure(): Promise<SqlTableStructure> {
    return notYet();
  },

  schemaOutline(): Promise<SqlSchemaOutline> {
    return notYet();
  },

  collations(): Promise<SqlCollation[]> {
    return notYet();
  },

  updateRow() {
    return notYet();
  },

  insertRows() {
    return notYet();
  },

  deleteRows() {
    return notYet();
  },

  createTable() {
    return notYet();
  },

  renameTable() {
    return notYet();
  },

  dropTable() {
    return notYet();
  },

  addColumn() {
    return notYet();
  },

  modifyColumn() {
    return notYet();
  },

  dropColumn() {
    return notYet();
  },

  addIndex() {
    return notYet();
  },

  modifyIndex() {
    return notYet();
  },

  dropIndex() {
    return notYet();
  },

  runScript(): Promise<SqlStatementResult[]> {
    return notYet();
  },

  cancelQuery() {
    /* Not `notYet`: there will never be a command here. SQLite runs the statement in this process
       against a file, so there is no session to reach in and stop — the button that would call this
       is closed by `cancellable` on the dialect, and this exists only to satisfy the interface. */
    return Promise.resolve();
  },

  validateSql(): Promise<SqlProblem | null> {
    return notYet();
  },

  dump() {
    return notYet();
  },

  restore() {
    return notYet();
  },

  /* No such statement, and no such concept: a SQLite database is a file, so creating one is
     creating a file and dropping one is deleting it. Neither is something the workspace's buttons
     should do behind a name that means "run some DDL" — the buttons are closed instead. */

  createDatabase() {
    return notYet();
  },

  dropDatabase() {
    return notYet();
  },
};

/** The one error every unfinished call reports, so that none of them fails as a missing command. */
function notYet(): Promise<never> {
  return Promise.reject(new Error("error.sqliteNotImplemented"));
}
