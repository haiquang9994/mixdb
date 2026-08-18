/**
 * What a paste into the URL box turns out to be, and the command a request turns back into.
 *
 * All pure: the ids of the rows it makes come from a `nextId` the caller supplies, and nothing in
 * here reads a clock or a clipboard. That is the point — a cURL command is the most error-prone
 * input this app takes, and this is the one file where it can be got wrong under `npm test`.
 */

/** The characters a backslash escapes inside double quotes. Everywhere else in a double-quoted
 *  string a backslash is a literal backslash, which is what makes `"C:\path"` survive. */
const DOUBLE_QUOTE_ESCAPES = ['"', "\\", "$", "`"];

/** A command broken across lines, joined back into one. `\` is how a POSIX shell continues a line
 *  and `^` is how `cmd.exe` does; a command copied out of a terminal has one or the other. */
function joinContinuations(text: string): string {
  return text.replace(/[\\^]\r?\n/g, " ");
}

/**
 * A command line cut into arguments, the way a shell would cut it.
 *
 * Single quotes take everything literally, double quotes take everything but the four characters
 * above, and a bare backslash escapes the character after it. An unterminated quote is not an
 * error: the text was pasted by a human and half of it is still worth reading.
 */
export function splitArgs(text: string): string[] {
  const source = joinContinuations(text);
  const args: string[] = [];
  let arg = "";
  /** Whether anything has been put into `arg` — including a quote that opened and closed with
   *  nothing between, which is a real empty argument and not the gap between two others. */
  let started = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (quote === "'") {
      if (char === "'") quote = null;
      else arg += char;
      continue;
    }

    if (quote === '"') {
      if (char === "\\" && DOUBLE_QUOTE_ESCAPES.includes(source[i + 1] ?? "")) arg += source[++i];
      else if (char === '"') quote = null;
      else arg += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (char === "\\" && i + 1 < source.length) {
      arg += source[++i];
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        args.push(arg);
        arg = "";
        started = false;
      }
      continue;
    }
    arg += char;
    started = true;
  }

  if (started) args.push(arg);
  return args;
}
