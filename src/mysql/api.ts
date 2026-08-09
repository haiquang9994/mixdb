import { invoke } from "@tauri-apps/api/core";
import type { MysqlTablePage } from "../types";

export function mysqlListDatabases(id: string): Promise<string[]> {
  return invoke<string[]>("mysql_list_databases", { id });
}

export function mysqlListTables(id: string, database: string): Promise<string[]> {
  return invoke<string[]>("mysql_list_tables", { id, database });
}

export interface MysqlServerInfo {
  version: string;
  os: string;
}

export function mysqlServerInfo(id: string): Promise<MysqlServerInfo> {
  return invoke<MysqlServerInfo>("mysql_server_info", { id });
}

/**
 * Reads one page of a table. `sortColumn` orders the whole table before the page is cut out of it,
 * so paging through a sorted table stays in that order; passing null leaves the rows in whatever
 * order MySQL returns them.
 */
export function mysqlTableData(
  id: string,
  database: string,
  table: string,
  page: number,
  pageSize: number,
  sortColumn: string | null = null,
  sortDesc = false
): Promise<MysqlTablePage> {
  return invoke<MysqlTablePage>("mysql_table_data", {
    id,
    database,
    table,
    page,
    pageSize,
    sortColumn,
    sortDesc,
  });
}

export function mysqlQuery(
  id: string,
  sql: string,
  database?: string
): Promise<Record<string, unknown>[]> {
  return invoke<Record<string, unknown>[]>("mysql_query", { id, sql, database });
}

export function mysqlUpdateRow(
  id: string,
  database: string,
  table: string,
  updates: Record<string, string | null>,
  key: Record<string, string | null>
): Promise<void> {
  return invoke<void>("mysql_update_row", { id, database, table, updates, key });
}

/**
 * Inserts one or more rows in a single transaction — one rejected row means none of them land.
 * Each entry maps a column to the text to write, or to null for an explicit SQL NULL; a column
 * left out of the map is left out of that row's INSERT, so the table's own default fills it.
 */
export function mysqlInsertRows(
  id: string,
  database: string,
  table: string,
  rows: Record<string, string | null>[]
): Promise<void> {
  return invoke<void>("mysql_insert_rows", { id, database, table, rows });
}

/**
 * Deletes the rows matched by `keys` — or, with `all`, every row in the table regardless of what
 * `keys` holds. `resetAutoIncrement` puts the table's AUTO_INCREMENT counter back to 1 afterwards.
 */
export function mysqlDeleteRows(
  id: string,
  database: string,
  table: string,
  keys: Record<string, string | null>[],
  all: boolean,
  resetAutoIncrement: boolean
): Promise<void> {
  return invoke<void>("mysql_delete_rows", {
    id,
    database,
    table,
    keys,
    all,
    resetAutoIncrement,
  });
}
