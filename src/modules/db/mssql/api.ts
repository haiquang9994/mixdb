import { invoke } from "@tauri-apps/api/core";
import type {
  SqlCollation,
  SqlSchemaOutline,
  SqlTablePage,
  SqlTableStructure,
  TableStats,
} from "../types";
import type { SqlApi, SqlPageQuery, SqlServerInfo } from "../sql/api";

/**
 * SQL Server's side of {@link SqlApi} — three methods of it, so far.
 *
 * `database` means what it means on MySQL rather than on PostgreSQL: a database to reach into over
 * the one connection, not a pool to pick. See `mssql_pool` in the backend.
 *
 * Reading is done: tables, their structure, their statistics, and the outline the Query tab's
 * completion works from. Everything that writes is still `notImplemented()` — rows, DDL,
 * dump/restore — and `mssqlDialect` closes each of them in the UI too, so nothing routes to one.
 * They land plan by plan, the same way ClickHouse shipped read-only before it shipped writes; see
 * `docs/superpowers/specs/2026-09-05-mssql-support-design.md`.
 */
export const mssqlApi: SqlApi = {
  listDatabases(id) {
    return invoke<string[]>("mssql_list_databases", { id });
  },

  listTables(id, database) {
    return invoke<string[]>("mssql_list_tables", { id, database });
  },

  serverInfo(id) {
    return invoke<SqlServerInfo>("mssql_server_info", { id });
  },

  tableStats(id, database) {
    return invoke<TableStats[]>("mssql_table_stats", { id, database });
  },

  tableData(id, database, table, query: SqlPageQuery) {
    return invoke<SqlTablePage>("mssql_table_data", { id, database, table, query });
  },

  updateRow: () => notImplemented(),
  insertRows: () => notImplemented(),
  deleteRows: () => notImplemented(),
  tableStructure(id, database, table) {
    return invoke<SqlTableStructure>("mssql_table_structure", { id, database, table });
  },

  schemaOutline(id, database) {
    return invoke<SqlSchemaOutline>("mssql_schema_outline", { id, database });
  },

  collations(id) {
    return invoke<SqlCollation[]>("mssql_collations", { id });
  },

  dump: () => notImplemented(),
  restore: () => notImplemented(),
  dropDatabase: () => notImplemented(),
  createDatabase: () => notImplemented(),
  createTable: () => notImplemented(),
  renameTable: () => notImplemented(),
  dropTable: () => notImplemented(),
  addColumn: () => notImplemented(),
  modifyColumn: () => notImplemented(),
  dropColumn: () => notImplemented(),
  addIndex: () => notImplemented(),
  modifyIndex: () => notImplemented(),
  dropIndex: () => notImplemented(),
  addSkipIndex: () => notImplemented(),
  modifySkipIndex: () => notImplemented(),
  dropSkipIndex: () => notImplemented(),
  rebuildOrderBy: () => notImplemented(),
  rowCount: () => notImplemented(),
  runScript: () => notImplemented(),
  /** Nothing can be running to cancel: `runScript` is still `notImplemented`, and the Cancel button
   *  is closed by `mssqlDialect.cancellable` anyway. */
  cancelQuery: () => Promise.resolve(),

  /** The editor asks the server for an opinion on the statement under the cursor as it is typed.
   *  There is nothing to ask yet — `mssql_validate_sql` lands with the Query tab — and a rejection
   *  here would surface as a lint error on every keystroke. No opinion is the honest answer, and a
   *  null is how the linter spells one. */
  validateSql: () => Promise.resolve(null),
};

/** Not `notSupported`, the way the other engines spell it: those name features one engine has and
 *  another never will, whereas every one of these is on its way in a later plan. Nothing can reach
 *  one today — this api is not in `SQL_ENGINES`, so no tab is ever handed it. */
function notImplemented(): Promise<never> {
  return Promise.reject(new Error("error.mssqlNotImplementedYet"));
}
