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
 * SQL Server's side of {@link SqlApi} — reading is done, and so are the three row-write methods.
 *
 * `database` means what it means on MySQL rather than on PostgreSQL: a database to reach into over
 * the one connection, not a pool to pick. See `mssql_pool` in the backend.
 *
 * Everything else is still `notImplemented()` — DDL, dump/restore — and `mssqlDialect` closes each
 * of them in the UI too, so nothing routes to one. They land plan by plan, the same way ClickHouse
 * shipped read-only, then row-writes, before DDL; see
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

  updateRow(id, database, table, updates, key) {
    return invoke<void>("mssql_update_row", { id, database, table, updates, key });
  },

  insertRows(id, database, table, rows) {
    return invoke<void>("mssql_insert_rows", { id, database, table, rows });
  },

  deleteRows(id, database, table, keys, all, resetAutoIncrement) {
    return invoke<void>("mssql_delete_rows", {
      id,
      database,
      table,
      keys,
      all,
      resetAutoIncrement,
    });
  },

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
  runScript(id, runId, sql, database) {
    return invoke<SqlStatementResult[]>("mssql_run_script", { id, runId, sql, database });
  },

  cancelQuery(id, runId) {
    return invoke<void>("mssql_cancel_query", { id, runId });
  },

  validateSql(id, sql, database) {
    return invoke<SqlProblem | null>("mssql_validate_sql", { id, sql, database });
  },
};

/** Not `notSupported`, the way the other engines spell it: those name features one engine has and
 *  another never will, whereas every one of these is on its way in a later plan. Nothing can reach
 *  one today — this api is not in `SQL_ENGINES`, so no tab is ever handed it. */
function notImplemented(): Promise<never> {
  return Promise.reject(new Error("error.mssqlNotImplementedYet"));
}
