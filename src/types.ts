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
  rows: Record<string, unknown>[];
  total: number;
}
