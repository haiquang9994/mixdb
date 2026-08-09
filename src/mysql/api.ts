import { invoke } from "@tauri-apps/api/core";
import type {
  MysqlCollation,
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

/** Every collation this server supports, ordered by character set. A property of the server and not
 *  of a table, so one read per connection covers every column editor opened on it. */
export function mysqlCollations(id: string): Promise<MysqlCollation[]> {
  return invoke<MysqlCollation[]>("mysql_collations", { id });
}

/** What of a database a dump carries. */
export type MysqlDumpMode = "structure" | "data" | "all";

/**
 * Writes the database to `path` as SQL, by running mysqldump against the same server this
 * connection is on (through the same SSH tunnel, when there is one).
 *
 * The file carries no `CREATE DATABASE` or `USE`, only the tables — so it restores into whichever
 * database it is pointed at rather than insisting on the one it came from.
 */
export function mysqlDump(
  id: string,
  database: string,
  mode: MysqlDumpMode,
  path: string
): Promise<void> {
  return invoke<void>("mysql_dump", { id, database, mode, path });
}

/** Replays a SQL file through the mysql client, into `database` — which is where a dump written
 *  here lands, since such a dump names no database of its own. */
export function mysqlRestore(id: string, database: string, path: string): Promise<void> {
  return invoke<void>("mysql_restore", { id, database, path });
}

/** Drops a database and every table in it. */
export function mysqlDropDatabase(id: string, database: string): Promise<void> {
  return invoke<void>("mysql_drop_database", { id, database });
}

/** Creates a database. `collation` is its default collation, or null to inherit the server's — the
 *  character set follows from the collation, so it is not asked for separately. */
export function mysqlCreateDatabase(
  id: string,
  name: string,
  collation: string | null
): Promise<void> {
  return invoke<void>("mysql_create_database", { id, name, collation });
}

/**
 * Creates an empty table, with an `id int(11) unsigned AUTO_INCREMENT` primary key for its one
 * column — every other column is added from the Structure tab afterwards.
 *
 * `collation` names the table's default collation, or null to inherit the database's. The character
 * set follows from the collation, so it is not asked for separately.
 */
export function mysqlCreateTable(
  id: string,
  database: string,
  table: string,
  collation: string | null
): Promise<void> {
  return invoke<void>("mysql_create_table", { id, database, table, collation });
}

/** Renames a table within its database. Atomic: nothing ever sees both names, or neither. */
export function mysqlRenameTable(
  id: string,
  database: string,
  table: string,
  newName: string
): Promise<void> {
  return invoke<void>("mysql_rename_table", { id, database, table, newName });
}

/** Drops a table and every row in it. */
export function mysqlDropTable(id: string, database: string, table: string): Promise<void> {
  return invoke<void>("mysql_drop_table", { id, database, table });
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
