import { invoke } from "@tauri-apps/api/core";
import type {
  SqlProblem,
  SqlSchemaOutline,
  SqlStatementResult,
  SqlTablePage,
  SqlTableStructure,
  TableStats,
} from "../types";
import type { SqlApi, SqlPageQuery, SqlServerInfo } from "../sql/api";

/**
 * ClickHouse's side of {@link SqlApi} — read-only throughout in v1.
 *
 * Every write method below is `notSupported()`: no Tauri command exists for any of them, and none
 * is ever registered — a call here fails as a rejected promise carrying `error.clickhouseReadOnly`
 * rather than as "command not found". `writable: false` on {@link clickhouseDialect} is what keeps
 * the workspace from offering a path to any of them in the first place; these exist only to
 * satisfy {@link SqlApi}, the same way `sqliteApi`'s `createDatabase`/`dropDatabase` do for a kind
 * that has none.
 */
export const clickhouseApi: SqlApi = {
  listDatabases(id) {
    return invoke<string[]>("clickhouse_list_databases", { id });
  },

  listTables(id, database) {
    return invoke<string[]>("clickhouse_list_tables", { id, database });
  },

  serverInfo(id) {
    return invoke<SqlServerInfo>("clickhouse_server_info", { id });
  },

  tableData(id, database, table, query: SqlPageQuery) {
    return invoke<SqlTablePage>("clickhouse_table_data", { id, database, table, query });
  },

  tableStats(id, database) {
    return invoke<TableStats[]>("clickhouse_table_stats", { id, database });
  },

  tableStructure(id, database, table) {
    return invoke<SqlTableStructure>("clickhouse_table_structure", { id, database, table });
  },

  schemaOutline(id, database) {
    return invoke<SqlSchemaOutline>("clickhouse_schema_outline", { id, database });
  },

  collations() {
    // No per-database/table/column collation to list — see `clickhouseDialect`'s and `SqlApi`'s
    // own docs on `collations`. Not a rejection: an empty list is the honest answer, not a refusal.
    return Promise.resolve([]);
  },

  runScript(id, runId, sql, database) {
    return invoke<SqlStatementResult[]>("clickhouse_run_script", { id, runId, sql, database });
  },

  validateSql(id, sql, database) {
    return invoke<SqlProblem | null>("clickhouse_validate_sql", { id, sql, database });
  },

  cancelQuery() {
    /* Not `notSupported`: there will never be a command here in v1. The button that would call
       this is closed by `cancellable: false` on the dialect, and this exists only to satisfy the
       interface — the same posture `sqliteApi.cancelQuery` takes, for a different reason. */
    return Promise.resolve();
  },

  updateRow: () => notSupported(),
  insertRows: () => notSupported(),
  deleteRows: () => notSupported(),
  dump: () => notSupported(),
  restore: () => notSupported(),
  dropDatabase: () => notSupported(),
  createDatabase: () => notSupported(),
  createTable: () => notSupported(),
  renameTable: () => notSupported(),
  dropTable: () => notSupported(),
  addColumn: () => notSupported(),
  modifyColumn: () => notSupported(),
  dropColumn: () => notSupported(),
  addIndex: () => notSupported(),
  modifyIndex: () => notSupported(),
  dropIndex: () => notSupported(),
};

/** What every write method reports: no command is invoked, so none fails as "command not found". */
function notSupported(): Promise<never> {
  return Promise.reject(new Error("error.clickhouseReadOnly"));
}
