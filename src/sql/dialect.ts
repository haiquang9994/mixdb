import type { SqlColumnMeta, SqlIndexKind } from "../types";
import type { SQLDialect } from "@codemirror/lang-sql";
import type { SqlSyntax } from "./syntax";

/** One type the column editor offers, and what the box beside it holds — the argument that goes
 *  inside the type's parentheses. */
export interface SqlTypeSpec {
  name: string;
  /** What to suggest for the argument: `null` for a type that takes none (the box is then closed),
   *  and `""` for one that accepts an argument no column really needs to give. */
  arg: string | null;
  /** Not valid without an argument: `varchar` has no length of its own to fall back on. */
  required?: boolean;
  /** The argument is a list of values rather than a number, so it is not checked as one. */
  list?: boolean;
  /** UNSIGNED means something here. Only read where the engine has it at all. */
  numeric?: boolean;
}

/**
 * What the Structure tab's two dialogs offer, which is where the engines differ most.
 *
 * Every field is a clause one engine has and the other does not, so each of them is the answer to
 * "should this control be here at all". Kept together in one shape rather than spread across
 * {@link SqlDialect}, because they are read in one place each and always together.
 */
export interface SqlEditing {
  /** The types a column may be declared as, each family in the order it is usually reached for. */
  columnTypes: readonly SqlTypeSpec[];
  /** `UNSIGNED` exists — MySQL only. */
  unsigned: boolean;
  /** A column can be put somewhere in particular (`FIRST`, `AFTER x`). PostgreSQL appends, always,
   *  and has no statement that moves a column. */
  columnPosition: boolean;
  /** `ON UPDATE CURRENT_TIMESTAMP` exists — MySQL only. The same effect on PostgreSQL is a
   *  trigger, which is not a property of the column. */
  onUpdateCurrentTimestamp: boolean;
  /** A database or a table carries a collation of its own. On PostgreSQL only a column does: a
   *  database's is a locale of the host rather than a name off a list, and a table has none. */
  objectCollation: boolean;
  /** The index kinds on offer, in the order they are shown. */
  indexKinds: readonly SqlIndexKind[];
  /** The access methods an index may be built with, upper-cased. */
  indexMethods: readonly string[];
  /** An index can cover just the first few characters of a column — MySQL only. */
  indexPrefix: boolean;
  /** What a primary key is always called, or null where it can be named. */
  primaryKeyName: string | null;
}

/**
 * What one SQL engine does differently, in the places the shared workspace has to know about it.
 *
 * Everything here is a question the UI asks about a server or a column and gets a different answer
 * to depending on the engine — never a call to one. Calls live on {@link SqlApi}. Both are handed
 * down together; see `src/sql/context.tsx`.
 *
 * It is deliberately small: a question only belongs here once two engines answer it differently.
 */
export interface SqlDialect {
  /** Which engine this is, for the few places that have to name it — a label, an icon, a wording. */
  kind: "mysql" | "postgres";

  /** How SQL text is read: which quotes, comments and escapes this engine has. What the statement
   *  splitter and the editor's tokenizer work from — see {@link SqlSyntax}. */
  syntax: SqlSyntax;

  /** The CodeMirror dialect the editor highlights and completes with. Also where
   *  {@link reserved} comes from, so the words the checker skips are exactly the words the editor
   *  paints as keywords. */
  cmDialect: SQLDialect;

  /** Every word this engine owns, lower-cased — see `reservedWords`. Held on the dialect rather
   *  than derived at each call: it is one set per engine, and building it is a string split over
   *  a few hundred words. */
  reserved: ReadonlySet<string>;

  /** What the column and index dialogs offer. */
  editing: SqlEditing;

  /** Whether the database belongs to the server rather than to the user. Its tables are read like
   *  any other's, but nothing in it may be created, renamed or dropped, nor anything done to it as
   *  a whole: the server rebuilds these from its own data directory, and dropping one breaks it. */
  isSystemDatabase(database: string): boolean;

  /** The column the server numbers itself. */
  isAutoIncrement(meta: SqlColumnMeta): boolean;

  /** A column the server computes from the others. */
  isGenerated(meta: SqlColumnMeta): boolean;

  /** A column the server fills in itself, and that an INSERT therefore must not name at all. */
  isServerAssigned(meta: SqlColumnMeta): boolean;

  /**
   * A column holding bytes rather than text.
   *
   * These are the columns the backend hands over base64-encoded, since bytes have no representation
   * of their own in JSON, and so the ones whose values cannot be written back out as the text they
   * arrive as.
   */
  isBinary(meta: SqlColumnMeta): boolean;
}
