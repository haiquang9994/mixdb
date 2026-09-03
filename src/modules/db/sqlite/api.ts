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

  tableStats(id, database) {
    return invoke<TableStats[]>("sqlite_table_stats", { id, database });
  },

  tableStructure(id, database, table) {
    return invoke<SqlTableStructure>("sqlite_table_structure", { id, database, table });
  },

  schemaOutline(id, database) {
    return invoke<SqlSchemaOutline>("sqlite_schema_outline", { id, database });
  },

  collations(id) {
    return invoke<SqlCollation[]>("sqlite_collations", { id });
  },

  updateRow(id, database, table, updates, key) {
    return invoke<void>("sqlite_update_row", { id, database, table, updates, key });
  },

  insertRows(id, database, table, rows) {
    return invoke<void>("sqlite_insert_rows", { id, database, table, rows });
  },

  deleteRows(id, database, table, keys, all, resetAutoIncrement) {
    return invoke<void>("sqlite_delete_rows", {
      id,
      database,
      table,
      keys,
      all,
      resetAutoIncrement,
    });
  },

  createTable(id, database, table, collation) {
    return invoke<void>("sqlite_create_table", { id, database, table, collation });
  },

  renameTable(id, database, table, newName) {
    return invoke<void>("sqlite_rename_table", { id, database, table, newName });
  },

  dropTable(id, database, table) {
    return invoke<void>("sqlite_drop_table", { id, database, table });
  },

  addColumn(id, database, table, spec) {
    return invoke<void>("sqlite_add_column", { id, database, table, spec });
  },

  modifyColumn(id, database, table, name, spec) {
    return invoke<void>("sqlite_modify_column", { id, database, table, name, spec });
  },

  dropColumn(id, database, table, name) {
    return invoke<void>("sqlite_drop_column", { id, database, table, name });
  },

  addIndex(id, database, table, spec) {
    return invoke<void>("sqlite_add_index", { id, database, table, spec });
  },

  modifyIndex(id, database, table, name, spec) {
    return invoke<void>("sqlite_modify_index", { id, database, table, name, spec });
  },

  dropIndex(id, database, table, name) {
    return invoke<void>("sqlite_drop_index", { id, database, table, name });
  },

  /* Everything below is a command that does not exist yet. Each throws rather than invoking a name
     nothing answers to, so that a control reached before its task lands says one sentence instead
     of failing as "command not found" — and so that this list is the checklist of what is left.
     They go in the order of the tasks that remove them: the Query tab, then dump and restore. */

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
