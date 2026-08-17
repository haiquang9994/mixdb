/**
 * Rows of the grid as text somebody can paste somewhere else: the SQL that would put them back
 * into a table, and the tab-separated form a spreadsheet reads.
 *
 * Kept out of the component and free of React so the escaping — the part that is easy to get
 * quietly wrong and impossible to see wrong on screen — can be tested on its own.
 */

/** A name as it goes into a statement: backticks, with any backtick inside doubled. That is MySQL's
 *  own way of writing a name that holds one, and a table or column can hold one. */
export function quoteIdentifier(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

/**
 * The characters that cannot stand for themselves inside a quoted string, and what MySQL reads in
 * their place. `\Z` is Ctrl+Z, which Windows takes as end-of-file when a script is piped into a
 * client — so a value holding one would cut the script short there.
 *
 * These are MySQL's default escapes. A server running under `NO_BACKSLASH_ESCAPES` reads a
 * backslash as an ordinary character and would take such a value back in changed; that mode is one
 * this app never sets, and the statements here are written to be pasted into MixDB's own Query tab
 * or a `mysql` client, where the default is what applies.
 */
const ESCAPED: Record<string, string> = {
  "\\": "\\\\",
  "'": "\\'",
  "\n": "\\n",
  "\r": "\\r",
  "\0": "\\0",
  "\x1a": "\\Z",
};

function quoteString(text: string): string {
  return `'${text.replace(/[\\'\n\r\0\x1a]/g, (ch) => ESCAPED[ch])}'`;
}

/**
 * One cell as the literal that would write it back into the column it came from.
 *
 * Numbers and booleans go in bare — quoted they would still land in a numeric column, but the
 * statement is meant to be read as well as run. Anything the driver handed over as an object came
 * out of a JSON column, so it goes back as its JSON text. A number that is not finite has no literal
 * at all in SQL and becomes NULL rather than the word `NaN`, which would be read as a column name.
 */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") return quoteString(JSON.stringify(value));
  return quoteString(String(value));
}

/**
 * One cell of a binary column as the literal that would write the same bytes back.
 *
 * A binary column arrives base64-encoded — bytes have no other way through JSON — so what sits in
 * the row is an encoding of the value rather than the value. Quoted as it stands it would insert
 * the encoding itself: a `BINARY(16)` UUID would go back in as the first sixteen ASCII characters
 * of its own base64, wrong in a way nothing on screen or in the statement says. `FROM_BASE64` is
 * what undoes the encoding, on the server, where the bytes are wanted.
 *
 * Anything that is not a string never went through that encoding and is written as it always was.
 */
function binaryLiteral(value: unknown): string {
  if (typeof value !== "string") return sqlLiteral(value);
  return `FROM_BASE64(${quoteString(value)})`;
}

/**
 * How many rows one statement carries before the next one begins.
 *
 * A batched insert is one round trip and one pass over the index, which is the whole reason the
 * rows go into a single `VALUES` rather than a statement each. Past a few hundred rows that
 * stops being the trade it was: the statement is a single transaction the server holds open, one
 * bad row rolls the whole batch back, and what comes back on failure names a row number in a list
 * nobody wants to count through. A hundred is small enough to read and re-run, large enough that
 * the round trips are no longer what the copy costs.
 */
const ROWS_PER_STATEMENT = 100;

/**
 * How long one statement is allowed to get, whatever the row count says.
 *
 * A row can be a megabyte of JSON or a blob written out as text, and a hundred of those is a
 * statement the server hangs up on: `max_allowed_packet` is 4MB on MySQL 5.7 and 64MB on 8, and
 * what a refusal reads as is "MySQL server has gone away" rather than anything about size. Half a
 * megabyte clears the lower of the two several times over.
 */
const MAX_STATEMENT_LENGTH = 512 * 1024;

/**
 * The `INSERT` statements that would put `rows` into `table`: one statement holding every row, one
 * row per line, split into further statements only where the batch grows past what is comfortable
 * to run — {@link ROWS_PER_STATEMENT} rows, or {@link MAX_STATEMENT_LENGTH} of text.
 *
 * A line per row rather than one long line: what is copied here is nearly always read before it is
 * run, and a row picked out of forty is then a line to delete rather than a bracket to find.
 *
 * `omit` leaves a column out of both the name list and the values. That is how the second of the
 * two copies works: without the AUTO_INCREMENT column the server numbers each row itself, so the
 * statement inserts new rows rather than colliding with the ones they were copied from.
 *
 * `binary` names the columns whose values reached here base64-encoded, and which therefore go back
 * through {@link binaryLiteral} rather than being quoted as the text they look like.
 */
export function insertStatements(
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  omit: string | null = null,
  binary: ReadonlySet<string> = new Set(),
): string {
  const used = omit === null ? columns : columns.filter((c) => c !== omit);
  const head = `INSERT INTO ${quoteIdentifier(table)} (${used.map(quoteIdentifier).join(", ")}) VALUES`;
  const statements: string[] = [];
  let batch: string[] = [];
  let length = head.length;

  function flush() {
    if (batch.length === 0) return;
    statements.push(`${head}\n${batch.join(",\n")};`);
    batch = [];
    length = head.length;
  }

  for (const row of rows) {
    const literals = used.map((c) => (binary.has(c) ? binaryLiteral(row[c]) : sqlLiteral(row[c])));
    const values = `  (${literals.join(", ")})`;
    // The row that would take the statement past either limit opens the next one instead — but
    // never on its own account: a single row longer than the cap still has to go somewhere, and
    // splitting before an empty batch would only produce a statement with no rows in it.
    const full = batch.length >= ROWS_PER_STATEMENT || length + values.length > MAX_STATEMENT_LENGTH;
    if (batch.length > 0 && full) flush();
    batch.push(values);
    // The comma and the newline this row costs once another follows it.
    length += values.length + 2;
  }
  flush();
  // A blank line between them, so where one statement ends and the next begins is visible without
  // reading to the semicolon.
  return statements.join("\n\n");
}

/**
 * What separates one cell from the next in each of the two table formats: a tab for what goes
 * straight into a spreadsheet's cells, a comma for what is saved as a `.csv`.
 *
 * Both are the same shape of text — the difference is only where they are going. Pasting into an
 * open spreadsheet, tabs land in cells without a word about delimiters; a CSV file is read back by
 * everything, but which character a spreadsheet takes as the separator when *opening* one depends
 * on where the machine thinks it is, which is why a paste is not sent as CSV.
 */
const TAB_SEPARATOR = "\t";
const COMMA_SEPARATOR = ",";

/** CRLF rather than a bare newline: it is what Excel writes itself, what RFC 4180 asks for, and
 *  what every other spreadsheet reads. */
const ROW_SEPARATOR = "\r\n";

/**
 * One cell of either format.
 *
 * NULL becomes an empty cell — neither format has another way of saying "nothing here", and the
 * word NULL in it would be text somebody has to clear out of a hundred cells by hand.
 *
 * A value holding the separator, a line break or a quote would otherwise break itself into columns
 * or rows of its own. Wrapped in quotes, with its own quotes doubled, it arrives as the single cell
 * it is — the escaping both formats share.
 */
function delimitedCell(value: unknown, separator: string): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const risky = text.includes(separator) || /["\r\n]/.test(text);
  return risky ? `"${text.replace(/"/g, '""')}"` : text;
}

/** `rows` as a table of text, the column names along the top — without them a copy of six columns
 *  out of forty is six columns of unlabelled numbers. */
function delimitedText(
  columns: string[],
  rows: Record<string, unknown>[],
  separator: string,
): string {
  const lines = [columns.map((c) => delimitedCell(c, separator)).join(separator)];
  for (const row of rows) {
    lines.push(columns.map((c) => delimitedCell(row[c], separator)).join(separator));
  }
  return lines.join(ROW_SEPARATOR);
}

/** `rows` as the tab-separated text a spreadsheet pastes into cells. */
export function spreadsheetText(columns: string[], rows: Record<string, unknown>[]): string {
  return delimitedText(columns, rows, TAB_SEPARATOR);
}

/** `rows` as CSV, for saving to a file rather than pasting into an open sheet. */
export function csvText(columns: string[], rows: Record<string, unknown>[]): string {
  return delimitedText(columns, rows, COMMA_SEPARATOR);
}
