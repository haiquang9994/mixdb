/**
 * What a paste into the URL box turns out to be, and the command a request turns back into.
 *
 * All pure: the ids of the rows it makes come from a `nextId` the caller supplies, and nothing in
 * here reads a clock or a clipboard. That is the point — a cURL command is the most error-prone
 * input this app takes, and this is the one file where it can be got wrong under `npm test`.
 */
import { decodeComponent, paramsFromUrl } from "./syncUrlParams";
import { METHODS } from "./types";
import type { Body, KeyValue, Method, MultipartField, RawLanguage } from "./types";

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

/** The part of a request a paste can know about. The rest of `RestRequest` — the id, the name, the
 *  timestamps, which group it belongs to — is the caller's, because only the caller knows whether
 *  this is a new row or the one already on screen. */
export interface ParsedRequest {
  method: Method;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: Body;
}

/** Short flags that take a value, which is written either after a space or glued straight on. */
const SHORT_WITH_VALUE = ["-X", "-H", "-d", "-F", "-u"];

/** Flags whose value this client has no use for, named only so the value is not mistaken for the
 *  URL: `curl -o out.json https://…` has two arguments that look like addresses and one that is. */
const SKIPPED_WITH_VALUE = new Set([
  "-o",
  "--output",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "-b",
  "--cookie",
  "-x",
  "--proxy",
  "--max-time",
  "--connect-timeout",
  "--retry",
]);

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * `-XPOST` and `--request=POST` written out as two arguments.
 *
 * Both spellings are what a real copied command looks like — browsers write the long one, people
 * write the short one — and normalising here leaves the walk below with a single shape to read.
 */
function normalise(args: string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    const short = SHORT_WITH_VALUE.find((flag) => arg.startsWith(flag) && arg.length > flag.length);
    if (short !== undefined) {
      out.push(short, arg.slice(short.length));
      continue;
    }
    const equals = arg.startsWith("--") ? arg.indexOf("=") : -1;
    if (equals !== -1) {
      out.push(arg.slice(0, equals), arg.slice(equals + 1));
      continue;
    }
    out.push(arg);
  }
  return out;
}

/** Whether a bare argument could be the address. A scheme is the sure sign; `example.com/x`,
 *  `localhost:3000` and `{{baseUrl}}/x` are what people write when they leave it out. */
function looksLikeUrl(arg: string): boolean {
  return (
    SCHEME.test(arg) ||
    arg.startsWith("{{") ||
    /^localhost([:/]|$)/i.test(arg) ||
    /^[\w-]+(\.[\w-]+)+([:/?]|$)/.test(arg)
  );
}

function headerValue(headers: KeyValue[], name: string): string | null {
  const found = headers.find((row) => row.key.toLowerCase() === name);
  return found?.value ?? null;
}

/** Base64 of a UTF-8 string. `btoa` alone throws on anything outside Latin-1, and a password with
 *  an accent in it is a real password. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let latin1 = "";
  for (const byte of bytes) latin1 += String.fromCharCode(byte);
  return btoa(latin1);
}

/** The notation a declared content type implies, or null when it names none this editor knows.
 *  Suffix matching rather than a list: `application/vnd.api+json` is JSON, and so is every other
 *  vendor type that ends that way. */
function languageOf(contentType: string): RawLanguage | null {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type.endsWith("json")) return "json";
  if (type.endsWith("xml")) return "xml";
  if (type.endsWith("yaml") || type.endsWith("yml")) return "yaml";
  if (type.startsWith("text/")) return "text";
  return null;
}

/** A `key=value&key=value` body as rows, decoded for the table the way the Params table decodes. */
function formFields(text: string, nextId: () => string): KeyValue[] {
  return text
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const eq = pair.indexOf("=");
      return {
        id: nextId(),
        enabled: true,
        key: eq === -1 ? decodeComponent(pair) : decodeComponent(pair.slice(0, eq)),
        value: eq === -1 ? "" : decodeComponent(pair.slice(eq + 1)),
      };
    });
}

/** One `-F` part. `name=@path` sends a file; the `;type=…` curl allows after the path is it telling
 *  the server what the file is, which the parts table has nowhere to put. */
function formField(raw: string, nextId: () => string): MultipartField {
  const eq = raw.indexOf("=");
  const key = eq === -1 ? raw : raw.slice(0, eq);
  const rest = eq === -1 ? "" : raw.slice(eq + 1);
  if (rest.startsWith("@")) {
    return { id: nextId(), enabled: true, key, value: "", file: rest.slice(1).split(";")[0] };
  }
  return { id: nextId(), enabled: true, key, value: rest };
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * What those data flags add up to.
 *
 * A declared `Content-Type` is believed first, because someone wrote it down. With none, an object
 * or an array that parses is JSON — curl's own rule says form-urlencoded, and curl's own rule is
 * not what anybody pasting `-d '{"…"}'` means. Failing both, pairs are a form and anything else is
 * text, which at least shows the user what they pasted.
 */
function dataBody(data: string[], contentType: string | null, nextId: () => string): Body {
  const text = data.join("&");
  const declared = contentType === null ? null : contentType.split(";")[0].trim().toLowerCase();
  if (declared === "application/x-www-form-urlencoded") {
    return { kind: "form", fields: formFields(text, nextId) };
  }
  const language = declared === null ? null : languageOf(declared);
  if (language !== null) return { kind: "raw", language, text };
  if (looksLikeJson(text)) return { kind: "raw", language: "json", text };
  if (text.includes("=")) return { kind: "form", fields: formFields(text, nextId) };
  return { kind: "raw", language: "text", text };
}

function appendQuery(url: string, query: string): string {
  if (query === "") return url;
  return url.includes("?") ? `${url}&${query}` : `${url}?${query}`;
}

/**
 * A cURL command read into the part of a request it describes, or null when it is not one.
 *
 * Flags this client has nothing to do with are passed over rather than refused — `-L`, `-k` and
 * `--compressed` say how a client behaves, which in this app is a global setting and not part of
 * any one request, and a command full of `--silent` and `--fail` is still a request.
 */
export function parseCurl(text: string, nextId: () => string): ParsedRequest | null {
  const args = normalise(splitArgs(text));
  // `curl.exe` is what Windows copies, and a `$` prompt often comes along for the ride.
  if (!/^(\$)?curl(\.exe)?$/i.test(args[0] ?? "")) return null;

  let method: Method | null = null;
  let flagUrl = "";
  const bare: string[] = [];
  const headers: KeyValue[] = [];
  const data: string[] = [];
  const form: MultipartField[] = [];
  let user: string | null = null;
  let asQuery = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "-X":
      case "--request": {
        const wanted = (args[++i] ?? "").toUpperCase();
        if ((METHODS as string[]).includes(wanted)) method = wanted as Method;
        break;
      }
      case "-H":
      case "--header": {
        const raw = args[++i] ?? "";
        const colon = raw.indexOf(":");
        // `-H 'Accept;'` is curl's way of unsetting a header it would have sent by itself. There is
        // nothing for the table to show for it.
        if (colon === -1) break;
        const key = raw.slice(0, colon).trim();
        if (key !== "") {
          headers.push({ id: nextId(), enabled: true, key, value: raw.slice(colon + 1).trim() });
        }
        break;
      }
      case "--url":
        flagUrl = args[++i] ?? "";
        break;
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
        data.push(args[++i] ?? "");
        break;
      case "-F":
      case "--form":
        form.push(formField(args[++i] ?? "", nextId));
        break;
      case "-u":
      case "--user":
        user = args[++i] ?? "";
        break;
      case "-G":
      case "--get":
        asQuery = true;
        break;
      default:
        if (SKIPPED_WITH_VALUE.has(arg)) {
          i++;
          break;
        }
        if (!arg.startsWith("-")) bare.push(arg);
        break;
    }
  }

  const bareUrl = bare.find((arg) => SCHEME.test(arg)) ?? bare.find(looksLikeUrl) ?? "";
  const address = flagUrl !== "" ? flagUrl : bareUrl;
  // -G: the data is the query, not the body.
  const url = asQuery ? appendQuery(address, data.join("&")) : address;

  /* A body already there says POST; -G says the opposite. An explicit -X beats both — curl honours
     it, and so does anyone reading the command. */
  const implied: Method = asQuery ? "GET" : data.length > 0 || form.length > 0 ? "POST" : "GET";

  const body: Body =
    form.length > 0
      ? { kind: "multipart", fields: form }
      : asQuery || data.length === 0
        ? { kind: "none" }
        : dataBody(data, headerValue(headers, "content-type"), nextId);

  /* Basic credentials become a header rather than an `auth` value: nothing reads `auth` until the
     Auth tab arrives in Phase 3, and a credential that silently goes nowhere is worse than one
     written out where its owner can see it. */
  if (user !== null && headerValue(headers, "authorization") === null) {
    headers.push({
      id: nextId(),
      enabled: true,
      key: "Authorization",
      value: `Basic ${base64(user.includes(":") ? user : `${user}:`)}`,
    });
  }

  return {
    method: method ?? implied,
    url,
    params: paramsFromUrl(url, [], nextId),
    headers,
    body,
  };
}

/**
 * A paste read as a request, or null when it is just text.
 *
 * Only a cURL command is claimed. A pasted URL is left to the webview on purpose: the URL box and
 * the Params table are already two views of one thing, so a whole pasted URL becomes rows the moment
 * the box changes — and claiming the paste would stop a host pasted over part of a URL from
 * replacing it, which is what pasting into a text box is for.
 */
export function parsePaste(text: string, nextId: () => string): ParsedRequest | null {
  const trimmed = text.trim();
  if (!/^(\$\s+)?curl(\.exe)?(\s|$)/i.test(trimmed)) return null;
  return parseCurl(trimmed.replace(/^\$\s+/, ""), nextId);
}
