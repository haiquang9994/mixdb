export type DbKind = "mysql" | "mongo" | "redis";

export type SshAuth =
  | { type: "password"; password: string }
  | { type: "privatekey"; key_path: string; passphrase?: string };

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
}

export interface ConnectionConfig {
  kind: DbKind;
  host: string;
  port: number;
  username?: string;
  password?: string;
  database?: string;
  /** MongoDB only: a full `mongodb://` / `mongodb+srv://` connection string. It carries host,
   *  port, credentials and options in one value, so those fields are ignored for that kind. */
  uri?: string;
  ssh?: SshConfig;
  use_ssl?: boolean;
}

export interface SavedConnection {
  id: string;
  name: string;
  config: ConnectionConfig;
  sidebarWidth?: number;
}

export const DEFAULT_PORTS: Record<DbKind, number> = {
  mysql: 3306,
  mongo: 27017,
  redis: 6379,
};

/** The row a foreign key column points at: what it references, not what it is declared as. */
export interface MysqlForeignKey {
  table: string;
  column: string;
}

/** What the server knows about one column beyond its name — what a new row has to respect. */
export interface MysqlColumnMeta {
  /** The declared type as MySQL spells it, e.g. `varchar(255)` or `int unsigned`. */
  dataType: string;
  nullable: boolean;
  /** The column's DEFAULT, or null when it has none. An expression default (`CURRENT_TIMESTAMP`,
   *  `(uuid())`) arrives here unquoted, indistinguishable from a literal on its own — `extra` is
   *  what tells the two apart. */
  defaultValue: string | null;
  /** `SHOW COLUMNS`' Extra: `auto_increment`, `DEFAULT_GENERATED`, `STORED GENERATED`, ... */
  extra: string;
  /** What this column references, or null when it is not part of a foreign key. */
  foreignKey: MysqlForeignKey | null;
}

export interface MysqlTablePage {
  columns: string[];
  /** Keyed by column name; `columns` is what carries their order. */
  columnMeta: Record<string, MysqlColumnMeta>;
  primaryKey: string[];
  /** The AUTO_INCREMENT column, or null when the table has none — only such a table has a
   *  counter that resetting after a delete would mean anything for. */
  autoIncrementColumn: string | null;
  rows: Record<string, unknown>[];
  total: number;
}

export interface MongoCollectionPage {
  documents: Record<string, unknown>[];
  total: number;
}
