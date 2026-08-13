/**
 * The handful of lexical rules that differ between the SQL engines — everything a reader of SQL
 * text has to know before it can tell code from a string, a comment or a name.
 *
 * Both the statement splitter and the tokenizer work from this rather than from the engine's name,
 * so a rule is stated once and the code that depends on it stays shared. It is deliberately about
 * *lexing* only: which words mean what is the dialect's business, not this file's.
 *
 * Each field mirrors the same decision in the Rust splitter it is a port of — `mysql_script.rs`
 * and `postgres_script.rs` — and the two must agree, since a statement the editor highlights has
 * to be the one the server ends up running.
 */
export interface SqlSyntax {
  /** `#` opens a comment to the end of the line. MySQL only; in PostgreSQL it is an operator. */
  hashComments: boolean;

  /** Whether `--` needs whitespace after it to open a comment. MySQL insists, so `5--3` there is
   *  arithmetic; PostgreSQL treats any `--` as a comment. */
  dashCommentNeedsSpace: boolean;

  /** Block comments nest, so `/* a /* b *␘/ c *␘/` is one comment. PostgreSQL only — stopping at
   *  the first close on MySQL is right, and nesting there would swallow real code. */
  nestedBlockComments: boolean;

  /** The engine's own identifier quote beside the standard `"`, or null when it has none.
   *  MySQL's backtick; PostgreSQL quotes identifiers only the standard way. */
  identifierQuote: string | null;

  /**
   * A double-quoted run is a **name**, not a string.
   *
   * True on PostgreSQL, where `"select"` is a column called `select`; false on MySQL in its default
   * mode, where `"x"` is the string `x`. Nothing else in the tokenizer decides as much: read the
   * wrong way round, every quoted column name becomes a string literal — or every string becomes a
   * name the schema check then complains it has never heard of.
   */
  doubleQuoteIsIdentifier: boolean;

  /** A backslash escapes the next character inside a string literal. True on MySQL; on PostgreSQL
   *  a backslash in an ordinary string is just a backslash. */
  backslashEscapes: boolean;

  /** `$tag$ ... $tag$` holds text that may contain anything, semicolons included — which is how a
   *  function body is written. PostgreSQL only. */
  dollarQuoting: boolean;
}

export const MYSQL_SYNTAX: SqlSyntax = {
  hashComments: true,
  dashCommentNeedsSpace: true,
  nestedBlockComments: false,
  identifierQuote: "`",
  doubleQuoteIsIdentifier: false,
  backslashEscapes: true,
  dollarQuoting: false,
};

export const POSTGRES_SYNTAX: SqlSyntax = {
  hashComments: false,
  dashCommentNeedsSpace: false,
  nestedBlockComments: true,
  identifierQuote: null,
  doubleQuoteIsIdentifier: true,
  backslashEscapes: false,
  dollarQuoting: true,
};

/**
 * The tag of a dollar quote opening at `i`, or null when one does not.
 *
 * `$$` gives `""` and `$body$` gives `"body"`. A tag is an identifier and so cannot open with a
 * digit — which is what keeps the placeholders `$1, $2` out of this. Read as an opening quote, one
 * of those would never close and would swallow the rest of the script.
 */
export function dollarTag(sql: string, i: number): string | null {
  if (sql[i] !== "$") return null;
  let tag = "";
  for (let j = i + 1; j < sql.length; j += 1) {
    const c = sql[j];
    if (c === "$") return tag;
    if (!/[\p{L}\p{N}_]/u.test(c)) return null;
    if (tag === "" && /\p{N}/u.test(c)) return null;
    tag += c;
  }
  return null;
}
