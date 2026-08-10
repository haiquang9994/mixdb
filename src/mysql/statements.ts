/**
 * Carving the Query tab's script into the statements it is made of.
 *
 * This is a port of `split_statements` in `src-tauri/src/db/mysql_script.rs`, which is what
 * actually runs a script. The backend splits so it can send one statement at a time; the editor
 * splits so it can say which statement the caret is in, run that one alone, and draw it. The two
 * must agree — a statement the editor highlights and sends has to be the same one the server ends
 * up running — **so a change to either splitter belongs in the same commit as the other**, and in
 * both sets of tests: [statements.test.ts](./statements.test.ts) here, `mod tests` there, case for
 * case.
 *
 * The only thing this one adds is where each statement sits in the text.
 */

/** One statement, and the range of the script it came from. */
export interface SqlStatement {
  /** The statement as written, trimmed. Carries its comments — a `/*!50000 ... *\/` is part of it. */
  text: string;
  /** The keyword it opens with, upper-cased. */
  verb: string;
  /** Where the trimmed text starts in the script. */
  from: number;
  /** Where it ends. The terminating semicolon is not included. */
  to: number;
}

/** Whether the character can be part of the opening keyword. Mirrors Rust's `is_alphanumeric`
 *  closely enough for a keyword: what follows it is only ever compared against ASCII verbs. */
function isWordChar(c: string): boolean {
  return /[\p{L}\p{N}_]/u.test(c);
}

/**
 * Splits a script into its statements.
 *
 * Only a semicolon outside a string, a quoted identifier and a comment separates two. The
 * client-side `DELIMITER` directive is not supported here any more than it is in the backend: a
 * routine body whose `BEGIN ... END` holds semicolons of its own reads as several statements.
 */
export function splitStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let chunkStart = 0;
  let verb = "";
  // Set once the opening word has ended, so the words after it can't overwrite it.
  let verbDone = false;
  let i = 0;

  function push(end: number) {
    const start = chunkStart;
    // The next chunk opens after the semicolon this one ended on.
    chunkStart = end + 1;
    const opening = verb;
    verb = "";
    verbDone = false;
    // No opening keyword means there was no statement here — only whitespace, or a comment
    // sitting between two semicolons.
    if (opening === "") return;
    const raw = sql.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    statements.push({
      text: trimmed,
      verb: opening,
      from: start + leading,
      to: start + leading + trimmed.length,
    });
  }

  while (i < sql.length) {
    const c = sql[i];

    // `--` opens a comment only when whitespace (or the end of the text) follows it: `5--3` is
    // arithmetic, not a comment.
    if (c === "-" && sql[i + 1] === "-" && (i + 2 >= sql.length || " \t\n\r".includes(sql[i + 2]))) {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (c === "#") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length) {
        if (sql[i] === "*" && sql[i + 1] === "/") {
          i += 2;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (c === "'" || c === '"' || c === "`") {
      i += 1;
      while (i < sql.length) {
        const ch = sql[i];
        i += 1;
        // A backslash escapes the next character inside a string literal. Inside a backtick-quoted
        // identifier it does not — there, doubling is the only escape.
        if (ch === "\\" && c !== "`") {
          i += 1;
          continue;
        }
        if (ch === c) {
          // Two of the quote in a row are an escaped quote, not the end of the literal.
          if (sql[i] === c) {
            i += 1;
            continue;
          }
          break;
        }
      }
      continue;
    }

    if (c === ";") {
      push(i);
      i += 1;
      continue;
    }

    // Plain code: the first word of it is the statement's keyword.
    if (!verbDone) {
      if (isWordChar(c)) verb += c.toUpperCase();
      else if (verb !== "") verbDone = true;
    }
    i += 1;
  }

  push(sql.length);
  return statements;
}

/**
 * The statement the caret is working on, or null when the script holds none.
 *
 * Inside a statement it is that statement. Past the end of one — the caret left sitting after the
 * semicolon it just typed — it is still that statement, until a blank line separates the two: past
 * one of those, the caret has moved on to whatever comes next.
 */
export function statementAt(
  sql: string,
  statements: SqlStatement[],
  pos: number
): SqlStatement | null {
  if (statements.length === 0) return null;

  let previous: SqlStatement | null = null;
  let next: SqlStatement | null = null;
  for (const statement of statements) {
    if (pos >= statement.from && pos <= statement.to) return statement;
    if (statement.to < pos) previous = statement;
    else if (next === null) next = statement;
  }

  if (previous === null) return next;
  if (next === null) return previous;
  // A blank line is what says the caret has left the statement above it. Anything less — a
  // newline, the space after a semicolon — and it is still that statement's line of work.
  return /\n\s*\n/.test(sql.slice(previous.to, pos)) ? next : previous;
}

/** The verbs that change what completion knows: after one of these the schema outline is stale. */
const DDL_VERBS = new Set(["CREATE", "ALTER", "DROP", "RENAME", "TRUNCATE"]);

/** Whether running this script could have changed the shape of the database. */
export function changesSchema(statements: SqlStatement[]): boolean {
  return statements.some((statement) => DDL_VERBS.has(statement.verb));
}
