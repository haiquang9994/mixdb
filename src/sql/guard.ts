/**
 * The three things the Query tab checks before it sends a script anywhere.
 *
 * None of them is about whether the SQL is *correct* — that is `lint.ts` and the server. These are
 * about whether it does more than the person typing it meant: a `DELETE` that names no rows takes
 * every one of them, a `SELECT` with no `LIMIT` can name more rows than there is memory for, and a
 * connection someone marked read-only should not be the one a `DROP` goes down.
 *
 * All three read the statement's tokens rather than matching text with a regular expression: a
 * `WHERE` inside a string or a comment is not a `WHERE`, and that is exactly the case that would
 * make a regular expression wave a dangerous statement through.
 */

import { tokenize, type Token } from "./lint";
import type { SqlDialect } from "./dialect";
import type { SqlStatement } from "../sql/statements";

/** One name-or-keyword of a statement that is code rather than comment, string or bracketed
 *  subquery. */
interface TopWord {
  /**
   * Upper-cased, for comparing against the keyword sets below — and **empty for a backtick-quoted
   * identifier**, which is a name and must never match one of them. The quoting is how MySQL is
   * told that `` `where` `` is a column rather than a clause, and reading it as the clause is how a
   * gate would talk itself out of asking about the statement.
   */
  word: string;
  token: Token;
}

/** The tokens that are actually code, with the brackets counted so a clause can be recognised as
 *  belonging to the statement itself rather than to a subquery inside it. */
function topLevelWords(statement: SqlStatement, dialect: SqlDialect): TopWord[] {
  const words: TopWord[] = [];
  const code = tokenize(statement.text, dialect.syntax, statement.from).filter((t) => t.kind !== "comment");
  let depth = 0;
  for (const token of code) {
    if (token.raw === "(") depth += 1;
    else if (token.raw === ")") depth -= 1;
    // Quoted identifiers are kept rather than skipped: a script that backticks every name — which
    // is what every tool that generates SQL does — would otherwise leave the dialog unable to say
    // which table a `DROP` was about.
    else if (depth === 0 && (token.kind === "word" || token.kind === "quoted")) {
      words.push({ word: token.kind === "word" ? token.value.toUpperCase() : "", token });
    }
  }
  return words;
}

/**
 * The verbs that make a `WITH` more than a read.
 *
 * MySQL 8 lets a common table expression lead into an `UPDATE`, a `DELETE`, an `INSERT` or a
 * `REPLACE`, so a statement whose first word is `WITH` may still be a write — the one blind spot
 * shared by all three checks in this file. Every one of these words is reserved, so an unquoted one
 * at the top level of a statement is the statement's own verb and never a column someone named.
 */
const WRITING_WORDS = new Set(["UPDATE", "DELETE", "INSERT", "REPLACE"]);

/** A statement that takes more than a sentence about it would suggest. */
export interface UnguardedWrite {
  /** What it does to what it names: `rows` for a statement that rewrites every row of a table,
   *  `drop` for one that removes the thing itself. The two are asked about in different words —
   *  rows come back from a backup, a dropped table's grants and triggers do not. */
  kind: "rows" | "drop";
  /** `UPDATE`, `DELETE`, `TRUNCATE`, or a `DROP`/`ALTER` with the object it names — `DROP TABLE`
   *  rather than `DROP`, since which of them it is is the difference between losing a table and
   *  losing the server. */
  verb: string;
  /** The table it is aimed at, as written. Empty when the statement's shape defeated the reader —
   *  which is not a reason to wave it through, only a reason to name it less precisely. */
  table: string;
}

/** The kinds of thing a `DROP` or an `ALTER` names. */
const OBJECTS = new Set([
  "TABLE", "TABLES", "DATABASE", "SCHEMA", "VIEW", "INDEX", "TRIGGER", "EVENT",
  "FUNCTION", "PROCEDURE", "USER", "ROLE", "TABLESPACE", "SERVER", "LOGFILE",
]);

/** Words that may sit between the verb, the object and the name, and say nothing about either. */
const FILLER = new Set(["TEMPORARY", "IF", "EXISTS", "ONLINE", "OFFLINE", "IGNORE"]);

/** What a `DROP` or an `ALTER` is aimed at: the object kind it names, and the name itself. `at` is
 *  where the verb sits, which is not always the front — see {@link actualVerb}. */
function dropTarget(verb: string, words: readonly TopWord[], at: number): UnguardedWrite {
  let i = at + 1;
  while (i < words.length && FILLER.has(words[i].word)) i += 1;
  const object = words[i] && OBJECTS.has(words[i].word) ? words[i].word : "";
  if (object !== "") i += 1;
  while (i < words.length && FILLER.has(words[i].word)) i += 1;
  return {
    kind: "drop",
    verb: object === "" ? verb : `${verb} ${object}`,
    table: words[i]?.token.value ?? "",
  };
}

/** The verbs this file has an opinion about, whether they open the statement or follow a CTE. */
const GUARDED = new Set(["UPDATE", "DELETE", "TRUNCATE", "DROP", "ALTER"]);

/**
 * What the statement actually does, and where in its words that starts.
 *
 * Almost always the opening keyword, at the front. The exception is `WITH`: a common table
 * expression says nothing about what it leads into, and `WITH ids AS (...) DELETE FROM users` is a
 * `DELETE` however it begins. A CTE's own body is bracketed, so a writing word at the *top* level
 * is the thing the statement leads into rather than anything inside the expression.
 *
 * `verb` is the empty string for a statement none of the checks care about.
 */
function actualVerb(statement: SqlStatement, words: readonly TopWord[]): { verb: string; at: number } {
  if (statement.verb !== "WITH") return { verb: statement.verb, at: 0 };
  const at = words.findIndex(({ word }) => GUARDED.has(word));
  return at < 0 ? { verb: "", at: 0 } : { verb: words[at].word, at };
}

/**
 * The statements in the script that would empty a table, or remove one outright.
 *
 * `UPDATE` and `DELETE` count when they carry neither a `WHERE` nor a `LIMIT` of their own — a
 * `DELETE ... LIMIT 10` is bounded, whatever else is true of it. `TRUNCATE` always counts: saying
 * which rows is not something it can do.
 *
 * A `WHERE` inside a subquery does not save the outer statement, which is why only the top level
 * is looked at: `DELETE FROM t WHERE ...` is guarded, `DELETE FROM t` with a subquery somewhere in
 * its `FROM` is not.
 *
 * `DROP` always counts, and an `ALTER` counts when it drops something of its own — a column, a
 * partition, a key. Nothing about either says which rows, so the row test above cannot be asked of
 * them; the reason to ask before running one is simply that it is the more final of the two things
 * this file is here about. It would be a strange gate that stopped `DELETE FROM users` and waved
 * `DROP TABLE users` straight through.
 *
 * A statement opening with `WITH` is judged by what it leads into, not by that word — see
 * {@link actualVerb}. Everything after the verb is read from where the verb sits, so the `WHERE`
 * that bounds a common table expression is not mistaken for one bounding the `DELETE` it feeds.
 */
export function unguardedWrites(
  statements: readonly SqlStatement[],
  dialect: SqlDialect
): UnguardedWrite[] {
  const found: UnguardedWrite[] = [];
  for (const statement of statements) {
    // The cheap test first: the opening word settles it for everything but a `WITH`, and only that
    // one is worth tokenising a statement to look inside. A script is mostly `SELECT`s, and this
    // runs over the whole of it every time Run All is pressed.
    if (!GUARDED.has(statement.verb) && statement.verb !== "WITH") continue;
    const words = topLevelWords(statement, dialect);
    const { verb, at } = actualVerb(statement, words);
    if (!GUARDED.has(verb)) continue;
    // The statement proper: what the verb governs, and nothing in front of it.
    const clauses = words.slice(at + 1);

    if (verb === "DROP" || verb === "ALTER") {
      // An `ALTER` is only here for what it drops: adding a column or an index changes no data,
      // and asking about every one of those is how a question stops being read.
      if (verb === "ALTER" && !clauses.some(({ word }) => word === "DROP")) continue;
      found.push(dropTarget(verb, words, at));
      continue;
    }

    if (verb !== "TRUNCATE" && clauses.some(({ word }) => word === "WHERE" || word === "LIMIT")) {
      continue;
    }

    // The table is the word after `UPDATE` / after the `FROM` or `TABLE` that follows the verb.
    // Anything more careful than this belongs in a parser; getting the name wrong costs a vaguer
    // sentence in a dialog, and getting the *danger* wrong is what is being avoided here.
    const from = clauses.findIndex(({ word }) => word === "FROM" || word === "TABLE");
    const name = from >= 0 ? clauses[from + 1] : clauses[0];
    found.push({ kind: "rows", verb, table: name?.token.value ?? "" });
  }
  return found;
}

/**
 * How many rows a `SELECT` written without a `LIMIT` is sent with.
 *
 * Fixed rather than a preference. What the ceiling is there for is to stop an unbounded `SELECT`
 * against an uncounted table from naming more rows than there is memory for — and that is a
 * property of the wire, not a matter of taste. It is set to what the backend will decode of one
 * result set, so the ceiling never cuts a result the backend would have delivered whole: past this
 * the set comes back truncated either way, and the results say so.
 *
 * A `LIMIT` written by hand is always left alone, which is the answer for anyone who wants a
 * different number.
 */
export const AUTO_LIMIT = 10_000;

/**
 * The same `SELECT` with a `LIMIT` on the end, or null when it needs none.
 *
 * Only a statement that reads from somewhere and sets no ceiling of its own is touched: `SELECT 1`
 * gets nothing, and a `SELECT ... LIMIT 10` is already saying what it wants. The limit goes on a
 * line of its own because the statement may well end in a `-- comment`, and a `LIMIT` appended to
 * that line would be part of the comment rather than part of the statement.
 *
 * A `WITH` counts as a read, since a common table expression is most often written to be selected
 * from — but only until it turns out to lead into a write, where a `LIMIT` would not page a result
 * but cap how many rows the statement changes.
 */
export function withLimit(
  statement: SqlStatement,
  limit: number,
  dialect: SqlDialect
): string | null {
  if (statement.verb !== "SELECT" && statement.verb !== "WITH") return null;
  const words = topLevelWords(statement, dialect);
  if (statement.verb === "WITH" && words.some(({ word }) => WRITING_WORDS.has(word))) return null;
  if (!words.some(({ word }) => word === "FROM")) return null;
  if (words.some(({ word }) => word === "LIMIT")) return null;
  // `FETCH FIRST n ROWS ONLY` is the standard's spelling of the same ceiling, and what PostgreSQL
  // accepts alongside `OFFSET`. A statement that has one cannot also carry a `LIMIT`: appending one
  // is a syntax error rather than a narrower page.
  if (words.some(({ word }) => word === "FETCH")) return null;
  // `SELECT ... INTO OUTFILE` and `INTO @var` are not result sets to be paged through.
  if (words.some(({ word }) => word === "INTO")) return null;
  // A locking clause — `FOR UPDATE`, `FOR SHARE`, `LOCK IN SHARE MODE` — has to come *after* the
  // `LIMIT` in MySQL's grammar, so one appended here lands on the wrong side of it and the whole
  // statement stops parsing (1064, checked on 5.7.44 and on 8.4.8). A locking read is deliberate
  // and rarely unbounded, so it is left exactly as it was written rather than rewritten around.
  if (words.some(({ word }) => word === "FOR" || word === "LOCK")) return null;
  return `${statement.text}\nLIMIT ${limit}`;
}

/**
 * The whole script with a `LIMIT` put on every `SELECT` that wanted one.
 *
 * Rewritten from the end backwards so that each splice leaves the ranges of the statements before
 * it untouched — the statements were measured against the text as it was, and editing forwards
 * would move every one of them out from under its own coordinates.
 *
 * The editor's own text is never changed by this: what the user wrote is what stays on screen, and
 * this is only what gets sent. `added` is how many statements were touched, so the results can say
 * so rather than quietly showing a shorter answer than was asked for.
 */
export function withAutoLimits(
  sql: string,
  statements: readonly SqlStatement[],
  limit: number,
  dialect: SqlDialect
): { sql: string; added: number } {
  if (limit <= 0) return { sql, added: 0 };
  let out = sql;
  let added = 0;
  for (let i = statements.length - 1; i >= 0; i -= 1) {
    const limited = withLimit(statements[i], limit, dialect);
    if (limited === null) continue;
    out = out.slice(0, statements[i].from) + limited + out.slice(statements[i].to);
    added += 1;
  }
  return { sql: out, added };
}

/**
 * The statements that only read.
 *
 * Written as a list of what is allowed rather than of what is forbidden: MySQL grows statements
 * faster than this list would be updated, and the failure of an allow-list is a read refused,
 * while the failure of a deny-list is a write let through.
 */
const READ_VERBS = new Set([
  "SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "USE", "HELP", "CHECKSUM", "WITH",
]);

/** A statement a read-only connection must not send, and the word that gives it away. */
export interface BlockedWrite {
  statement: SqlStatement;
  /** What to name in the refusal: the opening keyword, the writing word found inside a `WITH`, or
   *  `INTO OUTFILE` for a `SELECT` whose result goes to a file rather than to the screen. Naming
   *  the statement's own verb there would say "the script holds a SELECT", which explains nothing. */
  verb: string;
}

/**
 * The statements in the script that a read-only connection must not send.
 *
 * Everything is judged by its opening word, which is what the splitter already has — with two
 * exceptions, both of them statements that open with a reading word and go on to write anyway. A
 * `WITH` may lead into an `UPDATE` or a `DELETE`, and is refused if any writing word appears in it
 * at all; that is stricter than it needs to be, and being too strict here costs a query the user
 * can run by turning the flag off. A `SELECT ... INTO OUTFILE` — or a `WITH` that leads
 * into one — reads no more than any other `SELECT` but leaves a file on the server's disk, which is
 * exactly the kind of mark on a machine this flag is set to prevent.
 */
export function writingStatements(
  statements: readonly SqlStatement[],
  dialect: SqlDialect
): BlockedWrite[] {
  const blocked: BlockedWrite[] = [];
  for (const statement of statements) {
    if (!READ_VERBS.has(statement.verb)) {
      blocked.push({ statement, verb: statement.verb });
      continue;
    }
    const words = topLevelWords(statement, dialect);

    if (statement.verb === "WITH") {
      const writing = words.find(({ word }) => WRITING_WORDS.has(word));
      if (writing) {
        blocked.push({ statement, verb: writing.word });
        continue;
      }
      // A `WITH` that leads into a plain `SELECT` still falls through to the file test below: it
      // is a `SELECT` in every way that matters here, and `INTO OUTFILE` writes a file whichever
      // word the statement happens to open with.
    }

    // `INTO @variable` is not this: it puts the answer in the session and leaves nothing behind.
    const into = words.findIndex(({ word }) => word === "INTO");
    const target = into >= 0 ? words[into + 1]?.word : undefined;
    if (target === "OUTFILE" || target === "DUMPFILE") {
      blocked.push({ statement, verb: `INTO ${target}` });
      continue;
    }
    // PostgreSQL has no `OUTFILE`, and no session variables to select into either: at the top level
    // of a statement its `INTO` is `SELECT ... INTO t`, which is `CREATE TABLE AS` in another
    // spelling. That leaves a table behind on the server, which is exactly what this flag is set to
    // prevent.
    if (into >= 0 && dialect.kind === "postgres") {
      blocked.push({ statement, verb: "SELECT INTO" });
    }
  }
  return blocked;
}
