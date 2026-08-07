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

export function mysqlTableData(
  id: string,
  database: string,
  table: string,
  page: number,
  pageSize: number
): Promise<MysqlTablePage> {
  return invoke<MysqlTablePage>("mysql_table_data", { id, database, table, page, pageSize });
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
