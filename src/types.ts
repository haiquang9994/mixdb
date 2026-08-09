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

export interface MysqlTablePage {
  columns: string[];
  columnTypes: Record<string, string>;
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
