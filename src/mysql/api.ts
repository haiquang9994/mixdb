import { invoke } from "@tauri-apps/api/core";
import type {
  MysqlColumnSpec,
  MysqlIndexSpec,
  MysqlStatementResult,
  MysqlTablePage,
  MysqlTableStructure,
} from "../types";
import type { MysqlFilter } from "./filters";

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
 * order MySQL returns them. `filters` narrows the table down before either happens, ANDed
 * together — the page's `total` counts what is left after them.
 */
export function mysqlTableData(
  id: string,
  database: string,
  table: string,
  page: number,
  pageSize: number,
  sortColumn: string | null = null,
  sortDesc = false,
  filters: MysqlFilter[] = []
): Promise<MysqlTablePage> {
  return invoke<MysqlTablePage>("mysql_table_data", {
    id,
    database,
    table,
    page,
    pageSize,
    sortColumn,
    sortDesc,
    filters,
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

/** Reads what the table is made of: its columns in table order, and its indexes with the primary
 *  key first. Only what the connected user has privileges to see is reported. */
export function mysqlTableStructure(
  id: string,
  database: string,
  table: string
): Promise<MysqlTableStructure> {
  return invoke<MysqlTableStructure>("mysql_table_structure", { id, database, table });
}

export function mysqlAddColumn(
  id: string,
  database: string,
  table: string,
  spec: MysqlColumnSpec
): Promise<void> {
  return invoke<void>("mysql_add_column", { id, database, table, spec });
}

/** Redefines the column currently called `name` — the spec's own name is what it will be called
 *  afterwards, so this is also how a column is renamed. */
export function mysqlModifyColumn(
  id: string,
  database: string,
  table: string,
  name: string,
  spec: MysqlColumnSpec
): Promise<void> {
  return invoke<void>("mysql_modify_column", { id, database, table, name, spec });
}

export function mysqlDropColumn(
  id: string,
  database: string,
  table: string,
  name: string
): Promise<void> {
  return invoke<void>("mysql_drop_column", { id, database, table, name });
}

export function mysqlAddIndex(
  id: string,
  database: string,
  table: string,
  spec: MysqlIndexSpec
): Promise<void> {
  return invoke<void>("mysql_add_index", { id, database, table, spec });
}

/** Replaces the index called `name`. MySQL cannot alter one in place, so it is dropped and rebuilt
 *  in a single ALTER TABLE — the table never spends any time without it. */
export function mysqlModifyIndex(
  id: string,
  database: string,
  table: string,
  name: string,
  spec: MysqlIndexSpec
): Promise<void> {
  return invoke<void>("mysql_modify_index", { id, database, table, name, spec });
}

export function mysqlDropIndex(
  id: string,
  database: string,
  table: string,
  name: string
): Promise<void> {
  return invoke<void>("mysql_drop_index", { id, database, table, name });
}

/**
 * Runs user-authored SQL, statement by statement, and reports each statement's outcome. Everything
 * runs on one connection, so a `USE`, a `SET` or a transaction from one statement still holds for
 * the next; a statement that fails stops the script, and the results before it still come back.
 *
 * `database` is applied as a `USE` first, so unqualified table names resolve the way they do
 * everywhere else in the workspace.
 */
export function mysqlRunScript(
  id: string,
  sql: string,
  database?: string
): Promise<MysqlStatementResult[]> {
  return invoke<MysqlStatementResult[]>("mysql_run_script", { id, sql, database });
}
