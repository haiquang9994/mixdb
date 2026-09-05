import { invoke } from "@tauri-apps/api/core";
import type { SqlApi, SqlServerInfo } from "../sql/api";

/**
 * SQL Server's side of {@link SqlApi} — three methods of it, so far.
 *
 * `database` means what it means on MySQL rather than on PostgreSQL: a database to reach into over
 * the one connection, not a pool to pick. See `mssql_pool` in the backend.
 *
 * Everything else is `notImplemented()`, and this api is deliberately **not** in `SQL_ENGINES`
 * yet: `isSqlKind` is read off that map and gates both the Data tab and the sidebar's table list,
 * so registering it now would open a workspace onto a table nothing can read. It goes in there
 * when table reads land — see `docs/superpowers/specs/2026-09-05-mssql-support-design.md`'s
 * Plan 2, the same way ClickHouse shipped read-only before it shipped writes.
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

  tableStats: () => notImplemented(),
  tableData: () => notImplemented(),
  updateRow: () => notImplemented(),
  insertRows: () => notImplemented(),
  deleteRows: () => notImplemented(),
  tableStructure: () => notImplemented(),
  schemaOutline: () => notImplemented(),
  collations: () => notImplemented(),
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
  cancelQuery: () => notImplemented(),
  validateSql: () => notImplemented(),
};

/** Not `notSupported`, the way the other engines spell it: those name features one engine has and
 *  another never will, whereas every one of these is on its way in a later plan. Nothing can reach
 *  one today — this api is not in `SQL_ENGINES`, so no tab is ever handed it. */
function notImplemented(): Promise<never> {
  return Promise.reject(new Error("error.mssqlNotImplementedYet"));
}
