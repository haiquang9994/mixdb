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

/** One column as the table currently declares it — a row of the Structure tab's column grid. */
export interface MysqlStructureColumn {
  name: string;
  /** The full declared type as MySQL spells it: `varchar(255)`, `int unsigned`, `enum('a','b')`. */
  dataType: string;
  nullable: boolean;
  /** The DEFAULT, or null when the column has none — which is also how `DEFAULT NULL` reads. */
  defaultValue: string | null;
  /** Whether the default above is an expression (`uuid()`) rather than a literal. */
  defaultIsExpression: boolean;
  autoIncrement: boolean;
  onUpdateCurrentTimestamp: boolean;
  /** A column MySQL computes from the others. Its expression is not read, so such a column can
   *  only be dropped here, never redefined. */
  generated: boolean;
  collation: string | null;
  comment: string;
  /** `PRI`, `UNI`, `MUL` or empty: which kind of key this column leads. */
  key: string;
  /** `SHOW COLUMNS`' Extra, verbatim — shown as-is so nothing unmodelled disappears. */
  extra: string;
}

/** What a column is to be declared as: the write-side counterpart of {@link MysqlStructureColumn},
 *  carrying only the parts that go into an `ADD`/`CHANGE COLUMN` clause. */
export interface MysqlColumnSpec {
  name: string;
  dataType: string;
  nullable: boolean;
  /** null writes no DEFAULT clause at all. */
  defaultValue: string | null;
  defaultIsExpression: boolean;
  autoIncrement: boolean;
  onUpdateCurrentTimestamp: boolean;
  collation: string | null;
  comment: string;
  /** Left out, the column stays where it is (or a new one is appended); `""` puts it first, and a
   *  column name puts it directly after that column. */
  after?: string;
}

export interface MysqlIndexColumn {
  /** null for a functional index, which indexes an expression rather than a column. */
  name: string | null;
  /** How many leading characters are indexed, when only a prefix of the column is. */
  prefixLength: number | null;
}

export interface MysqlTableIndex {
  name: string;
  unique: boolean;
  primary: boolean;
  /** `BTREE`, `HASH`, `FULLTEXT` or `SPATIAL` as MySQL reports it. */
  indexType: string;
  columns: MysqlIndexColumn[];
  comment: string;
}

export type MysqlIndexKind = "index" | "unique" | "fulltext" | "spatial" | "primary";

export interface MysqlIndexColumnSpec {
  name: string;
  prefixLength: number | null;
}

export interface MysqlIndexSpec {
  /** Left empty, MySQL names the index after its first column. Ignored for a primary key. */
  name: string;
  kind: MysqlIndexKind;
  /** `BTREE`/`HASH`, or null for the engine's own default. Only meaningful for a plain or unique
   *  index — full-text and spatial indexes have one structure each. */
  indexType: string | null;
  columns: MysqlIndexColumnSpec[];
  comment: string;
}

export interface MysqlTableStructure {
  /** In table order, which is the order a `SELECT *` returns them in. */
  columns: MysqlStructureColumn[];
  /** The primary key first, then the rest as the server listed them. */
  indexes: MysqlTableIndex[];
}

/** How a statement's result is to be read: a result set, a count of rows changed, plain success,
 *  or the reason it failed. */
export type MysqlStatementKind = "rows" | "affected" | "ok" | "error";

/** What one statement of the Query tab's script produced. */
export interface MysqlStatementResult {
  /** The statement this came from, as the user wrote it. */
  statement: string;
  /** The keyword it opens with, upper-cased. */
  verb: string;
  kind: MysqlStatementKind;
  columns: string[];
  /** Positional rather than keyed by column name: an arbitrary SELECT may name the same column
   *  twice, and only a positional row keeps the two apart. */
  rows: unknown[][];
  /** Set when the result set was longer than the client reads in one go. */
  truncated: boolean;
  rowsAffected: number;
  lastInsertId: number | null;
  durationMs: number;
  /** Set when the statement failed, in which case nothing after it ran. */
  error: string | null;
}

export interface MongoCollectionPage {
  documents: Record<string, unknown>[];
  total: number;
}
