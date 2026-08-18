# REST Client Module — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a cURL command into a REST request's URL box and get the whole request; copy any request back out as a cURL command; keep what pasting leaves behind in a Recent group that holds ten and evicts the one least recently sent.

**Architecture:** Two pure modules do the work — `parsePaste.ts` (a shell tokenizer, a cURL walker, and `toCurl` as its inverse) and four new reducers in `requests.ts` for the Recent group. The UI layer only carries results across: `UrlBar` reads `clipboardData` and hands the text up, `RestTab` decides whether the paste fills the tab on screen or opens a new one, and `RequestList` gains Copy as cURL, a pin and a no-question delete for Recent. Rust is untouched in this phase.

**Tech Stack:** TypeScript (strict), React 19, CSS Modules, vitest. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-08-18-rest-client-module-design.md](../specs/2026-08-18-rest-client-module-design.md) — §5 (sidebar, paste, tab strip) and §7 (testing), scoped by §8's phase table.

**Phase 1 plan (the code this one builds on):** [2026-08-18-rest-client-phase-1.md](2026-08-18-rest-client-phase-1.md)

## Global Constraints

- **Pure logic is tested; components are not.** The repo has no jsdom and no component tests, and this phase does not add either. Everything that can be got wrong — tokenizing, flag walking, body inference, `toCurl`, the Recent reducers — is a pure function in `npm test`.
- **The module boundary holds.** No file outside `src/modules/rest/` learns an HTTP concept. Check with the two greps in [.agent/conventions/adding-a-module.md](../../../.agent/conventions/adding-a-module.md) before finishing.
- **Strings go in both dictionaries.** `src/modules/rest/i18n/en.ts` and `vi.ts`, groups flat, non-ASCII written as escapes, no literal English in JSX. See [.agent/conventions/i18n.md](../../../.agent/conventions/i18n.md).
- **Components live in their own folder** with `index.ts`, per [.agent/conventions/component-structure.md](../../../.agent/conventions/component-structure.md). This phase adds no new component folder; it edits three existing ones.
- **No interpolation, no environments, no history, no Settings pane.** Those are Phases 4 and 5. `{{var}}` travels as text, exactly as it does today.
- **No Rust.** `src-tauri/` is not touched. `WireRequest` and `RestResponse` do not change.
- **Commits happen only when the user asks for one.** The user's standing instruction is that nothing is committed unprompted and one request authorises one commit. Each task's commit step gives the message to use *when* a commit is asked for; do not run it on your own initiative.
- Commit messages take a prefix and a scope: `feat(rest): …`, `refactor(rest): …`. No `Co-Authored-By` trailer.
- Verify with `npm test` and `npm run build` (which is `tsc && vite build`, so it is the typecheck too).

---

## Scope: Phase 2 only

The spec's §8 gives Phase 2 three things: **paste cURL/URL**, **Copy as cURL**, and **the Recent rules**. This plan covers those and stops.

Three decisions inside that scope, each a place where the spec's letter and this codebase's Phase 1 disagree slightly. They are settled here so no task has to re-argue them:

### 1. A pasted plain URL is left to the webview

The spec lists three paste branches: cURL, plain URL, and no match. In Phase 1 the URL box and the Params table were already made two views of one thing — [`RestTab.tsx:162-169`](../../../src/modules/rest/RestTab.tsx#L162-L169) runs `paramsFromUrl` on every change to the box. So a pasted URL **already** becomes Params rows without anything claiming the paste, and a URL branch that called `preventDefault()` would only add ways to be wrong: pasting a host into the middle of a URL being edited, or over a selected fragment of one, would stop replacing text and start opening tabs.

So `parsePaste` claims **cURL commands only**. A URL, a word, or a paragraph falls through to the webview and lands in the box as text, where the existing sync turns its query into rows. The user-visible result for a whole pasted URL is identical to the spec's; the difference is that editing a URL by pasting into it still works.

### 2. `-u user:pass` becomes an `Authorization` header, not an `Auth` value

`RestRequest.auth` exists in the types, but nothing reads it: `buildRequest` has no auth branch and the Auth tab is Phase 3. A paste that set `auth: { kind: "basic", … }` would produce a request whose credentials silently go nowhere. A header is sent today and can be seen in the Headers table, so that is where `-u` lands. Phase 3 may lift it into the Auth tab.

### 3. `-F` produces a multipart body, and the Body tab learns to show a body it cannot edit

The spec puts `-F/--form` in the paste parser (Phase 2) and the multipart editor in Phase 3. `buildRequest` already puts a multipart body on the wire, so a pasted `-F` command sends correctly — but [`BodyEditor.tsx:40`](../../../src/modules/rest/components/BodyEditor/BodyEditor.tsx#L40) shows any non-`raw` body as **None**, so the body would be invisible and the next touch of the picker would destroy it.

Task 7 therefore gives the Body tab a read-only view of a body it has no editor for. That is not the Phase 3 editor — it is the guard that makes Phase 2's parser safe, and it covers a `rest-requests.json` holding a form or binary body as well.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/modules/rest/parsePaste.ts` | **New.** `splitArgs`, `parseCurl`, `parsePaste`, `toCurl`, and the `ParsedRequest` shape they trade in. All pure. |
| `src/modules/rest/parsePaste.test.ts` | **New.** Tokenizer, flag walk, body inference, dispatcher, and the round trip. |
| `src/modules/rest/syncUrlParams.ts` | Its private `decode` becomes the exported `decodeComponent`, so the form-body parser decodes the same way the Params table does. |
| `src/modules/rest/syncUrlParams.test.ts` | One test for the newly exported name. |
| `src/modules/rest/requests.ts` | Four reducers for the Recent group: `findRecentTarget`, `addRecent`, `bumpRecent`, `pinToSaved`. |
| `src/modules/rest/requests.test.ts` | Tests for those four. |
| `src/modules/rest/requestsStore.ts` | `pasteRequest` and `pinRequest` — the impure half: ids, the clock, publish, persist. |
| `src/modules/rest/RestTab.tsx` | `pasteInto(text)`: fill the tab on screen when it is blank, else open a new one. |
| `src/modules/rest/components/UrlBar/UrlBar.tsx` | Reads `clipboardData` on paste and calls up; calls `preventDefault()` only when the paste was claimed. |
| `src/modules/rest/components/BodyEditor/BodyEditor.tsx` | Read-only view of a form, multipart or binary body. |
| `src/modules/rest/components/BodyEditor/BodyEditor.module.css` | Styles for that view. |
| `src/modules/rest/components/RequestList/RequestList.tsx` | Copy as cURL, the pin on a Recent row, and Recent's delete that asks nothing. |
| `src/modules/rest/components/RequestList/RequestList.module.css` | The row wrapper the pin needs, since a button cannot nest in a button. |
| `src/modules/rest/i18n/en.ts`, `vi.ts` | Seven new strings. |
| `CHANGELOG.md` | Two lines under `## [Unreleased]` → `### Added`. |

---

### Task 1: The shell tokenizer

A cURL command is a shell line. Before anything can read its flags, it has to be cut into arguments the way a shell would: quotes hold whitespace together, backslashes escape, and a command copied out of a terminal or a browser is broken across lines with `\` (POSIX) or `^` (cmd.exe).

**Files:**
- Create: `src/modules/rest/parsePaste.ts`
- Test: `src/modules/rest/parsePaste.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `splitArgs(text: string): string[]`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/rest/parsePaste.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitArgs } from "./parsePaste";

describe("splitArgs", () => {
  it("cuts a command on whitespace", () => {
    expect(splitArgs("curl -X POST https://example.com")).toEqual([
      "curl",
      "-X",
      "POST",
      "https://example.com",
    ]);
  });

  it("keeps a single-quoted argument whole", () => {
    expect(splitArgs("curl -H 'Accept: application/json' https://x")).toEqual([
      "curl",
      "-H",
      "Accept: application/json",
      "https://x",
    ]);
  });

  it("takes a backslash inside single quotes literally", () => {
    expect(splitArgs(String.raw`curl -d 'a\b'`)).toEqual(["curl", "-d", String.raw`a\b`]);
  });

  it("unescapes a quote inside double quotes", () => {
    expect(splitArgs(String.raw`curl -d "{\"a\":1}"`)).toEqual(["curl", "-d", '{"a":1}']);
  });

  it("joins the lines of a command broken with backslashes", () => {
    expect(splitArgs("curl \\\n  -X POST \\\n  https://x")).toEqual([
      "curl",
      "-X",
      "POST",
      "https://x",
    ]);
  });

  it("joins the lines of a command broken the way cmd.exe breaks them", () => {
    expect(splitArgs("curl ^\n  -X POST ^\n  https://x")).toEqual([
      "curl",
      "-X",
      "POST",
      "https://x",
    ]);
  });

  it("keeps an argument quoted down to nothing", () => {
    expect(splitArgs("curl -d '' https://x")).toEqual(["curl", "-d", "", "https://x"]);
  });

  it("glues the quoted and unquoted halves of one word together", () => {
    expect(splitArgs("curl 'https://x'/path")).toEqual(["curl", "https://x/path"]);
  });

  // Someone pasted half a command, or a command whose quoting was already broken. Half an argument
  // is a better answer than none.
  it("takes an unclosed quote as the rest of the text", () => {
    expect(splitArgs("curl -d 'oops")).toEqual(["curl", "-d", "oops"]);
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npm test -- parsePaste`
Expected: FAIL — `Failed to resolve import "./parsePaste"`.

- [ ] **Step 3: Write the tokenizer**

Create `src/modules/rest/parsePaste.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npm test -- parsePaste`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit** (only when the user asks — see Global Constraints)

```bash
git add src/modules/rest/parsePaste.ts src/modules/rest/parsePaste.test.ts
git commit -m "feat(rest): cut a pasted cURL command into shell arguments"
```

---

### Task 2: The cURL walk — method, URL and headers

The flags that say *where* and *how*. Bodies, `-G` and `-u` are Task 3; this task lands the walk they slot into.

**Files:**
- Modify: `src/modules/rest/parsePaste.ts`
- Test: `src/modules/rest/parsePaste.test.ts`

**Interfaces:**
- Consumes: `splitArgs` (Task 1); `paramsFromUrl(url, existing, nextId)` from `./syncUrlParams`; `METHODS`, `Method`, `KeyValue`, `Body` from `./types`.
- Produces:
  - `interface ParsedRequest { method: Method; url: string; params: KeyValue[]; headers: KeyValue[]; body: Body }`
  - `parseCurl(text: string, nextId: () => string): ParsedRequest | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/rest/parsePaste.test.ts`, and add `parseCurl` to the import at the top of the file:

```ts
/** Ids in the order they were asked for, so a test can name the rows it expects. */
function ids(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe("parseCurl", () => {
  it("reads the plainest command there is", () => {
    const parsed = parseCurl("curl https://example.com/items", ids());
    expect(parsed).toEqual({
      method: "GET",
      url: "https://example.com/items",
      params: [],
      headers: [],
      body: { kind: "none" },
    });
  });

  it("is not a cURL command at all", () => {
    expect(parseCurl("wget https://example.com", ids())).toBeNull();
  });

  it("takes the method from -X, however it was written", () => {
    expect(parseCurl("curl -X post https://x", ids())?.method).toBe("POST");
    expect(parseCurl("curl -XPUT https://x", ids())?.method).toBe("PUT");
    expect(parseCurl("curl --request=PATCH https://x", ids())?.method).toBe("PATCH");
  });

  // The wire types name seven methods. A verb outside them is not one this client can send, so it
  // is left out rather than smuggled through as a string.
  it("ignores a verb this client has no name for", () => {
    expect(parseCurl("curl -X PROPFIND https://x", ids())?.method).toBe("GET");
  });

  it("reads headers into ticked rows, trimmed", () => {
    const parsed = parseCurl(
      "curl -H 'Accept: application/json' -H 'X-Token:abc' https://x",
      ids(),
    );
    expect(parsed?.headers).toEqual([
      { id: "id-1", enabled: true, key: "Accept", value: "application/json" },
      { id: "id-2", enabled: true, key: "X-Token", value: "abc" },
    ]);
  });

  it("keeps a header whose value has colons in it", () => {
    const parsed = parseCurl("curl -H 'X-When: 10:30:00' https://x", ids());
    expect(parsed?.headers[0].value).toBe("10:30:00");
  });

  it("passes over a header with no colon in it", () => {
    expect(parseCurl("curl -H 'Accept' https://x", ids())?.headers).toEqual([]);
  });

  it("takes the URL from --url", () => {
    expect(parseCurl("curl --url https://example.com/a https://decoy.example", ids())?.url).toBe(
      "https://example.com/a",
    );
  });

  it("prefers the argument that has a scheme", () => {
    expect(parseCurl("curl -o out.json https://example.com/a", ids())?.url).toBe(
      "https://example.com/a",
    );
  });

  it("takes a URL written without a scheme", () => {
    expect(parseCurl("curl example.com/items", ids())?.url).toBe("example.com/items");
    expect(parseCurl("curl localhost:3000/items", ids())?.url).toBe("localhost:3000/items");
  });

  it("ignores the flags that are this app's settings rather than this request's", () => {
    const parsed = parseCurl("curl -L -k --compressed https://x", ids());
    expect(parsed?.url).toBe("https://x");
    expect(parsed?.headers).toEqual([]);
  });

  it("splits the query into Params and leaves the box holding the whole URL", () => {
    const parsed = parseCurl("curl 'https://x/items?page=2&q=hello%20world'", ids());
    expect(parsed?.url).toBe("https://x/items?page=2&q=hello%20world");
    expect(parsed?.params).toEqual([
      { id: "id-1", enabled: true, key: "page", value: "2" },
      { id: "id-2", enabled: true, key: "q", value: "hello world" },
    ]);
  });

  // Phase 4 gives `{{var}}` a meaning. Until then it is text, and text is what must survive.
  it("leaves a variable in the URL exactly as it was written", () => {
    expect(parseCurl("curl '{{baseUrl}}/items' ", ids())?.url).toBe("{{baseUrl}}/items");
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npm test -- parsePaste`
Expected: FAIL — `parseCurl is not a function`.

- [ ] **Step 3: Write the walk**

Add to `src/modules/rest/parsePaste.ts` — the imports at the top of the file, then the code below the tokenizer:

```ts
import { paramsFromUrl } from "./syncUrlParams";
import { METHODS } from "./types";
import type { Body, KeyValue, Method } from "./types";
```

```ts
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
      default:
        if (SKIPPED_WITH_VALUE.has(arg)) {
          i++;
          break;
        }
        if (!arg.startsWith("-")) bare.push(arg);
        break;
    }
  }

  const url = flagUrl !== "" ? flagUrl : (bare.find((arg) => SCHEME.test(arg)) ?? bare.find(looksLikeUrl) ?? "");

  return {
    method: method ?? "GET",
    url,
    params: paramsFromUrl(url, [], nextId),
    headers,
    body: { kind: "none" },
  };
}
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npm test -- parsePaste`
Expected: PASS. `npx tsc --noEmit` also clean.

- [ ] **Step 5: Commit** (only when the user asks)

```bash
git add src/modules/rest/parsePaste.ts src/modules/rest/parsePaste.test.ts
git commit -m "feat(rest): read the method, URL and headers of a pasted cURL command"
```

---

### Task 3: The cURL walk — bodies, `-G` and `-u`

Where curl and the people pasting curl disagree, and where the parser earns its tests.

**Files:**
- Modify: `src/modules/rest/parsePaste.ts`
- Modify: `src/modules/rest/syncUrlParams.ts` (export the decoder the Params table already uses)
- Test: `src/modules/rest/parsePaste.test.ts`, `src/modules/rest/syncUrlParams.test.ts`

**Interfaces:**
- Consumes: `parseCurl`'s walk (Task 2); `MultipartField`, `RawLanguage` from `./types`.
- Produces: `decodeComponent(text: string): string` exported from `./syncUrlParams`. `parseCurl` now fills `body`, folds `-G` data into the query, and turns `-u` into an `Authorization` header. No new exported name in `parsePaste.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/rest/parsePaste.test.ts`:

```ts
describe("parseCurl bodies", () => {
  // curl's own rule is that `-d` means form-urlencoded. Nobody pasting a JSON object means that,
  // so a value that parses as JSON is read as JSON.
  it("reads a JSON value as a JSON body, and makes the request a POST", () => {
    const parsed = parseCurl(`curl https://x -d '{"name":"a"}'`, ids());
    expect(parsed?.method).toBe("POST");
    expect(parsed?.body).toEqual({ kind: "raw", language: "json", text: '{"name":"a"}' });
  });

  it("reads pairs as a form, decoded the way the Params table decodes", () => {
    const parsed = parseCurl("curl https://x -d 'q=hello%20world&page=2'", ids());
    expect(parsed?.body).toEqual({
      kind: "form",
      fields: [
        { id: "id-1", enabled: true, key: "q", value: "hello world" },
        { id: "id-2", enabled: true, key: "page", value: "2" },
      ],
    });
  });

  it("joins repeated data flags with an ampersand, as curl does", () => {
    const parsed = parseCurl("curl https://x -d 'a=1' --data-raw 'b=2'", ids());
    expect(parsed?.body).toEqual({
      kind: "form",
      fields: [
        { id: "id-1", enabled: true, key: "a", value: "1" },
        { id: "id-2", enabled: true, key: "b", value: "2" },
      ],
    });
  });

  it("falls back to plain text for a value that is neither", () => {
    expect(parseCurl("curl https://x -d 'hello'", ids())?.body).toEqual({
      kind: "raw",
      language: "text",
      text: "hello",
    });
  });

  it("believes a declared content type over what the body looks like", () => {
    expect(parseCurl(`curl https://x -H 'Content-Type: text/plain' -d '{"a":1}'`, ids())?.body).toEqual(
      { kind: "raw", language: "text", text: '{"a":1}' },
    );
    expect(parseCurl("curl https://x -H 'Content-Type: application/xml' -d '<a/>'", ids())?.body).toEqual(
      { kind: "raw", language: "xml", text: "<a/>" },
    );
    expect(
      parseCurl("curl https://x -H 'Content-Type: application/vnd.api+json' -d '[1]'", ids())?.body,
    ).toEqual({ kind: "raw", language: "json", text: "[1]" });
  });

  it("reads a declared form as a form even when the value is not pairs", () => {
    const parsed = parseCurl(
      "curl https://x -H 'Content-Type: application/x-www-form-urlencoded' -d 'a=1&b=2'",
      ids(),
    );
    expect(parsed?.body.kind).toBe("form");
  });

  it("keeps an explicit method even where a body would have implied another", () => {
    expect(parseCurl("curl -X GET https://x -d 'a=1'", ids())?.method).toBe("GET");
  });

  it("reads -F into multipart fields, with a file's path and without curl's type hint", () => {
    const parsed = parseCurl(
      "curl https://x -F 'name=Ann' -F 'avatar=@/tmp/a.png;type=image/png'",
      ids(),
    );
    expect(parsed?.method).toBe("POST");
    expect(parsed?.body).toEqual({
      kind: "multipart",
      fields: [
        { id: "id-1", enabled: true, key: "name", value: "Ann" },
        { id: "id-2", enabled: true, key: "avatar", value: "", file: "/tmp/a.png" },
      ],
    });
  });

  it("puts -G data in the query and leaves no body behind", () => {
    const parsed = parseCurl("curl -G https://x/items -d 'page=2&q=a'", ids());
    expect(parsed?.method).toBe("GET");
    expect(parsed?.url).toBe("https://x/items?page=2&q=a");
    expect(parsed?.body).toEqual({ kind: "none" });
    expect(parsed?.params.map((row) => row.key)).toEqual(["page", "q"]);
  });

  it("adds -G data to a query that was already there", () => {
    expect(parseCurl("curl -G 'https://x?a=1' -d 'b=2'", ids())?.url).toBe("https://x?a=1&b=2");
  });

  it("turns -u into an Authorization header, since nothing else would send it", () => {
    const parsed = parseCurl("curl https://x -u 'user:pass'", ids());
    expect(parsed?.headers).toEqual([
      { id: "id-1", enabled: true, key: "Authorization", value: "Basic dXNlcjpwYXNz" },
    ]);
  });

  // curl would prompt for the password. There is nobody to prompt, and an empty one is what the
  // command as written asks for.
  it("reads a -u with no password as an empty password", () => {
    expect(parseCurl("curl https://x -u user", ids())?.headers[0].value).toBe("Basic dXNlcjo=");
  });

  it("leaves an Authorization header that was already given alone", () => {
    const parsed = parseCurl("curl https://x -H 'Authorization: Bearer t' -u 'user:pass'", ids());
    expect(parsed?.headers).toHaveLength(1);
    expect(parsed?.headers[0].value).toBe("Bearer t");
  });
});
```

And append to `src/modules/rest/syncUrlParams.test.ts` (adding `decodeComponent` to its import):

```ts
describe("decodeComponent", () => {
  it("decodes an escape and reads a plus as a space", () => {
    expect(decodeComponent("hello%20world")).toBe("hello world");
    expect(decodeComponent("hello+world")).toBe("hello world");
  });

  it("hands back a half-typed escape rather than throwing", () => {
    expect(decodeComponent("100%")).toBe("100%");
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npm test -- parsePaste syncUrlParams`
Expected: FAIL — `decodeComponent` is not exported, and every body assertion sees `{ kind: "none" }`.

- [ ] **Step 3: Export the decoder**

In `src/modules/rest/syncUrlParams.ts`, rename the private `decode` to an exported `decodeComponent` and update its two call sites in `paramsFromUrl`:

```ts
/** Decoded, with `+` read as a space the way a query string means it. A stray `%` is what someone
 *  is halfway through typing, not a reason to throw. Exported because a pasted form body is
 *  decoded by the same rule, in `parsePaste`. */
export function decodeComponent(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}
```

```ts
      const eq = part.indexOf("=");
      if (eq === -1) return { key: decodeComponent(part), value: "" };
      return {
        key: decodeComponent(part.slice(0, eq)),
        value: decodeComponent(part.slice(eq + 1)),
      };
```

- [ ] **Step 4: Write the body half of the walk**

In `src/modules/rest/parsePaste.ts`, extend the imports and add the helpers, then wire them into `parseCurl`:

```ts
import { decodeComponent, paramsFromUrl } from "./syncUrlParams";
import { METHODS } from "./types";
import type { Body, KeyValue, Method, MultipartField, RawLanguage } from "./types";
```

```ts
/** Every spelling of "here is the body". `--data-urlencode` is deliberately not among them: it
 *  encodes its argument by a rule of its own, and a body encoded twice is worse than one left as
 *  the text it was pasted as. */
const DATA_FLAGS = ["-d", "--data", "--data-raw", "--data-binary", "--data-ascii"];

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
```

Then, inside `parseCurl`: declare the three new accumulators beside the existing ones, add the cases to the switch, and replace the `return` block.

```ts
  const data: string[] = [];
  const form: MultipartField[] = [];
  let user: string | null = null;
  let asQuery = false;
```

```ts
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
```

```ts
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
```

- [ ] **Step 5: Run the tests to watch them pass**

Run: `npm test -- parsePaste syncUrlParams`
Expected: PASS. Then `npm test` — nothing else may break, `syncUrlParams` least of all.

- [ ] **Step 6: Commit** (only when the user asks)

```bash
git add src/modules/rest/parsePaste.ts src/modules/rest/parsePaste.test.ts src/modules/rest/syncUrlParams.ts src/modules/rest/syncUrlParams.test.ts
git commit -m "feat(rest): read the body, -G and -u of a pasted cURL command"
```

---

### Task 4: `parsePaste` — which pastes are claimed

**Files:**
- Modify: `src/modules/rest/parsePaste.ts`
- Test: `src/modules/rest/parsePaste.test.ts`

**Interfaces:**
- Consumes: `parseCurl` (Tasks 2–3).
- Produces: `parsePaste(text: string, nextId: () => string): ParsedRequest | null` — null means *not ours*, and the caller must let the webview paste the text.

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/rest/parsePaste.test.ts` (adding `parsePaste` to the import):

```ts
describe("parsePaste", () => {
  it("claims a cURL command", () => {
    expect(parsePaste("curl https://x", ids())?.url).toBe("https://x");
  });

  it("claims one copied with the prompt in front of it", () => {
    expect(parsePaste("$ curl https://x", ids())?.url).toBe("https://x");
  });

  it("claims the Windows spelling", () => {
    expect(parsePaste("curl.exe https://x", ids())?.url).toBe("https://x");
  });

  it("claims one indented or broken across lines", () => {
    expect(parsePaste("  curl \\\n  -X POST \\\n  https://x", ids())?.method).toBe("POST");
  });

  /* A URL is a field's value, not a whole request: the box and the Params table are already two
     views of one thing, so a plain paste lands in the box and comes out as rows by itself. Claiming
     it would break pasting a host into the middle of a URL being edited, and would gain nothing. */
  it("leaves a plain URL to the webview", () => {
    expect(parsePaste("https://example.com/items?a=1", ids())).toBeNull();
  });

  it("leaves anything else alone", () => {
    expect(parsePaste("", ids())).toBeNull();
    expect(parsePaste("   ", ids())).toBeNull();
    expect(parsePaste("select * from users", ids())).toBeNull();
    expect(parsePaste("curling is a sport", ids())).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npm test -- parsePaste`
Expected: FAIL — `parsePaste is not a function`.

- [ ] **Step 3: Write the dispatcher**

Add to `src/modules/rest/parsePaste.ts`:

```ts
/**
 * A paste read as a request, or null when it is just text.
 *
 * Only a cURL command is claimed. A pasted URL is left to the webview on purpose — see the note on
 * `parseCurl`'s siblings above — and so is everything that is neither.
 */
export function parsePaste(text: string, nextId: () => string): ParsedRequest | null {
  const trimmed = text.trim();
  if (!/^(\$\s+)?curl(\.exe)?(\s|$)/i.test(trimmed)) return null;
  return parseCurl(trimmed.replace(/^\$\s+/, ""), nextId);
}
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npm test -- parsePaste`
Expected: PASS.

- [ ] **Step 5: Commit** (only when the user asks)

```bash
git add src/modules/rest/parsePaste.ts src/modules/rest/parsePaste.test.ts
git commit -m "feat(rest): decide which pastes are a request and which are text"
```

---

### Task 5: `toCurl`, and the round trip

**Files:**
- Modify: `src/modules/rest/parsePaste.ts`
- Test: `src/modules/rest/parsePaste.test.ts`

**Interfaces:**
- Consumes: `buildRequest(request, requestId, settings)` and `PHASE_ONE_SETTINGS` from `./buildRequest`; `RestRequest`, `WireRequest` from `./types`.
- Produces: `toCurl(request: RestRequest): string`

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/rest/parsePaste.test.ts` (adding `toCurl` to the import, plus `import { PHASE_ONE_SETTINGS, buildRequest } from "./buildRequest";`, `import { newRequest } from "./requests";` and `import type { RestRequest } from "./types";`):

```ts
function request(over: Partial<RestRequest> = {}): RestRequest {
  return { ...newRequest("r", 1000), ...over };
}

/** What would go on the wire, minus the send id, which is minted fresh every time. */
function wire(source: RestRequest) {
  const { request_id: _ignored, ...rest } = buildRequest(source, "send", PHASE_ONE_SETTINGS);
  return rest;
}

describe("toCurl", () => {
  it("writes the plainest request as the plainest command", () => {
    expect(toCurl(request({ url: "https://x/items" }))).toBe("curl 'https://x/items'");
  });

  // -X is left out only where curl would have chosen the same verb anyway. A GET with a body must
  // still say so, or reading the command back would make it a POST.
  it("names the method whenever curl would guess another", () => {
    expect(toCurl(request({ method: "DELETE", url: "https://x/1" }))).toBe(
      "curl -X DELETE 'https://x/1'",
    );
    const withBody = request({
      url: "https://x",
      body: { kind: "raw", language: "text", text: "hi" },
    });
    expect(toCurl(withBody).startsWith("curl -X GET ")).toBe(true);
  });

  it("folds the parameters into the URL, as sending does", () => {
    const source = request({
      url: "https://x/items",
      params: [
        { id: "p1", enabled: true, key: "page", value: "2" },
        { id: "p2", enabled: false, key: "draft", value: "1" },
      ],
    });
    expect(toCurl(source)).toBe("curl 'https://x/items?page=2'");
  });

  it("writes the content type sending would have added", () => {
    const source = request({
      method: "POST",
      url: "https://x",
      body: { kind: "raw", language: "json", text: '{"a":1}' },
    });
    expect(toCurl(source)).toBe(
      "curl -X POST 'https://x' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"a\":1}'",
    );
  });

  it("survives a quote in the body", () => {
    const source = request({
      method: "POST",
      url: "https://x",
      body: { kind: "raw", language: "text", text: "it's" },
    });
    expect(toCurl(source)).toContain(`--data-raw 'it'\\''s'`);
  });

  it("writes multipart parts as -F, files and all", () => {
    const source = request({
      method: "POST",
      url: "https://x",
      body: {
        kind: "multipart",
        fields: [
          { id: "f1", enabled: true, key: "name", value: "Ann" },
          { id: "f2", enabled: true, key: "avatar", value: "", file: "/tmp/a.png" },
        ],
      },
    });
    expect(toCurl(source)).toContain("-F 'name=Ann'");
    expect(toCurl(source)).toContain("-F 'avatar=@/tmp/a.png'");
  });
});

describe("the round trip", () => {
  /** Copied out and pasted back sends the same thing. Not the same object — the row ids are new and
   *  a content type that was added on the way out is written down in the command — but the same
   *  method, URL, headers and body, which is what "the same request" means. */
  function roundTrip(source: RestRequest) {
    const back = parsePaste(toCurl(source), ids());
    expect(back).not.toBeNull();
    expect(wire({ ...newRequest("back", 2000), ...back! })).toEqual(wire(source));
  }

  it("a GET with parameters", () => {
    roundTrip(
      request({
        url: "https://x/items?page=2",
        params: [{ id: "p1", enabled: true, key: "page", value: "2" }],
      }),
    );
  });

  it("a POST with headers and a JSON body", () => {
    roundTrip(
      request({
        method: "POST",
        url: "https://x/items",
        headers: [{ id: "h1", enabled: true, key: "X-Token", value: "abc" }],
        body: { kind: "raw", language: "json", text: '{"name":"Ann"}' },
      }),
    );
  });

  it("a form body", () => {
    roundTrip(
      request({
        method: "POST",
        url: "https://x/login",
        body: {
          kind: "form",
          fields: [
            { id: "f1", enabled: true, key: "user", value: "ann" },
            { id: "f2", enabled: true, key: "pass", value: "hunter 2" },
          ],
        },
      }),
    );
  });

  it("a multipart body with a file in it", () => {
    roundTrip(
      request({
        method: "POST",
        url: "https://x/upload",
        body: {
          kind: "multipart",
          fields: [
            { id: "f1", enabled: true, key: "name", value: "Ann" },
            { id: "f2", enabled: true, key: "avatar", value: "", file: "/tmp/a.png" },
          ],
        },
      }),
    );
  });

  it("a URL with a variable still in it", () => {
    roundTrip(request({ url: "{{baseUrl}}/items" }));
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npm test -- parsePaste`
Expected: FAIL — `toCurl is not a function`.

- [ ] **Step 3: Write `toCurl`**

Add to `src/modules/rest/parsePaste.ts`, with `import { PHASE_ONE_SETTINGS, buildRequest } from "./buildRequest";` and `RestRequest`, `WireRequest` added to the type imports:

```ts
/** A single-quoted argument. Single quotes take everything literally, so the only character that
 *  needs care is the quote itself: close, escape one, reopen — the `'\''` every shell script has
 *  in it somewhere. */
function quote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The command that would send this request.
 *
 * Written from the `WireRequest` rather than from the request pane, so what it says is what the app
 * would actually send: the URL with its parameters already folded in, and the content type whether
 * it was typed by hand or added on the way out.
 *
 * The three send settings are deliberately absent, which is also why the parser passes over `-L`,
 * `-k` and `--compressed`: those say how a client behaves, and in this app that is one global
 * setting rather than a property of any one request. Which `SendSettings` is passed below therefore
 * cannot change a character of the output.
 *
 * Broken across lines the way a command is written out for someone to read. `splitArgs` joins those
 * lines back up, so a command copied out of here pastes back in.
 */
export function toCurl(request: RestRequest): string {
  const wire: WireRequest = buildRequest(request, "curl", PHASE_ONE_SETTINGS);
  const head = ["curl"];
  // Named unless curl would have guessed the same verb from the body — see the test above.
  if (!(wire.method === "GET" && wire.body.kind === "none")) head.push("-X", wire.method);
  head.push(quote(wire.url));

  const lines = [head.join(" ")];
  for (const [key, value] of wire.headers) lines.push(`-H ${quote(`${key}: ${value}`)}`);
  switch (wire.body.kind) {
    case "text":
      lines.push(`--data-raw ${quote(wire.body.text)}`);
      break;
    case "file":
      lines.push(`--data-binary ${quote(`@${wire.body.path}`)}`);
      break;
    case "multipart":
      for (const part of wire.body.parts) {
        const field = part.path !== null ? `${part.name}=@${part.path}` : `${part.name}=${part.value ?? ""}`;
        lines.push(`-F ${quote(field)}`);
      }
      break;
    case "none":
      break;
  }
  return lines.join(" \\\n  ");
}
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npm test -- parsePaste`
Expected: PASS, including all five round trips.

- [ ] **Step 5: Commit** (only when the user asks)

```bash
git add src/modules/rest/parsePaste.ts src/modules/rest/parsePaste.test.ts
git commit -m "feat(rest): write a request back out as a cURL command"
```

---

### Task 6: The Recent rules

**Files:**
- Modify: `src/modules/rest/requests.ts`
- Test: `src/modules/rest/requests.test.ts`

**Interfaces:**
- Consumes: `RECENT_LIMIT`, `RequestLists`, `RestRequest`, `Method`.
- Produces:
  - `findRecentTarget(lists: RequestLists, method: Method, url: string): RestRequest | undefined`
  - `addRecent(lists: RequestLists, request: RestRequest): RequestLists`
  - `bumpRecent(lists: RequestLists, id: string, now: number): RequestLists`
  - `pinToSaved(lists: RequestLists, id: string): RequestLists`

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/rest/requests.test.ts`, adding the four names and `RECENT_LIMIT` to its import:

```ts
/** A pasted request aimed somewhere, used `at`. */
function pasted(id: string, url: string, at: number): RestRequest {
  return { ...newRequest(id, at), url, origin: "paste", lastUsedAt: at };
}

describe("addRecent", () => {
  it("puts the paste at the head of Recent", () => {
    const after = addRecent(lists({ recent: [pasted("a", "https://a", 1)] }), pasted("b", "https://b", 2));
    expect(after.recent.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("leaves Saved alone", () => {
    const saved = [newRequest("s", 1)];
    expect(addRecent(lists({ saved }), pasted("b", "https://b", 2)).saved).toBe(saved);
  });

  it("holds ten", () => {
    let current = lists();
    for (let n = 0; n < RECENT_LIMIT + 3; n++) {
      current = addRecent(current, pasted(`r${n}`, `https://${n}`, n + 1));
    }
    expect(current.recent).toHaveLength(RECENT_LIMIT);
  });

  /* What falls off is the one least recently *sent*, not the one added first: a request still used
     every day has no business being pushed out by ten pastes. */
  it("drops the one least recently used, not the oldest", () => {
    const old = [...Array(RECENT_LIMIT).keys()].map((n) => pasted(`r${n}`, `https://${n}`, 100 + n));
    // The very first one has been sent since; the second has not.
    const recent = old.map((r) => (r.id === "r0" ? { ...r, lastUsedAt: 9000 } : r));
    const after = addRecent(lists({ recent }), pasted("new", "https://new", 9001));
    expect(after.recent.map((r) => r.id)).toContain("r0");
    expect(after.recent.map((r) => r.id)).not.toContain("r1");
  });

  it("drops the older paste when two were used at the same moment", () => {
    const recent = [...Array(RECENT_LIMIT).keys()].map((n) => pasted(`r${n}`, `https://${n}`, 100));
    const after = addRecent(lists({ recent }), pasted("new", "https://new", 200));
    // Same `lastUsedAt` all round, so the one furthest down the list — the oldest paste — goes.
    expect(after.recent.map((r) => r.id)).not.toContain(`r${RECENT_LIMIT - 1}`);
    expect(after.recent.map((r) => r.id)).toContain("r0");
  });
});

describe("findRecentTarget", () => {
  it("matches on method and URL together", () => {
    const recent = [pasted("a", "https://a/items", 1)];
    expect(findRecentTarget(lists({ recent }), "GET", "https://a/items")?.id).toBe("a");
    expect(findRecentTarget(lists({ recent }), "POST", "https://a/items")).toBeUndefined();
    expect(findRecentTarget(lists({ recent }), "GET", "https://a/other")).toBeUndefined();
  });

  /* Saved is not searched. A request someone chose to keep is theirs, and a paste has no business
     stamping or reordering it. */
  it("does not look in Saved", () => {
    const saved = [{ ...newRequest("s", 1), url: "https://a/items" }];
    expect(findRecentTarget(lists({ saved }), "GET", "https://a/items")).toBeUndefined();
  });
});

describe("bumpRecent", () => {
  it("moves it to the head and stamps it as used", () => {
    const recent = [pasted("a", "https://a", 1), pasted("b", "https://b", 2)];
    const after = bumpRecent(lists({ recent }), "b", 500);
    expect(after.recent.map((r) => r.id)).toEqual(["b", "a"]);
    expect(after.recent[0].lastUsedAt).toBe(500);
  });

  it("changes nothing for an id that is not in Recent", () => {
    const before = lists({ saved: [newRequest("s", 1)] });
    expect(bumpRecent(before, "s", 500)).toBe(before);
  });
});

describe("pinToSaved", () => {
  it("moves it out of Recent and on to the top of Saved", () => {
    const recent = [pasted("a", "https://a", 1)];
    const after = pinToSaved(lists({ saved: [newRequest("s", 1)], recent }), "a");
    expect(after.recent).toEqual([]);
    expect(after.saved.map((r) => r.id)).toEqual(["a", "s"]);
  });

  it("makes it a request someone meant to have", () => {
    const after = pinToSaved(lists({ recent: [pasted("a", "https://a", 1)] }), "a");
    expect(after.saved[0].origin).toBe("manual");
  });

  it("keeps everything else about it, half-finished edits included", () => {
    const edited = { ...pasted("a", "https://a", 1), name: "Half typed" };
    expect(pinToSaved(lists({ recent: [edited] }), "a").saved[0].name).toBe("Half typed");
  });

  it("changes nothing for an id that is not in Recent", () => {
    const before = lists({ saved: [newRequest("s", 1)] });
    expect(pinToSaved(before, "s")).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npm test -- requests`
Expected: FAIL — none of the four is exported.

- [ ] **Step 3: Write the reducers**

Add to `src/modules/rest/requests.ts`, with `Method` added to its type import:

```ts
/**
 * The Recent entry aimed at the same place, if there is one.
 *
 * Same method and same URL is what "the same command" means here: pasting one line twice should
 * leave one row, not two. Saved is not searched — a request someone kept is theirs, and reordering
 * or restamping it because a paste happened to match would be a surprise.
 */
export function findRecentTarget(
  lists: RequestLists,
  method: Method,
  url: string,
): RestRequest | undefined {
  return lists.recent.find((request) => request.method === method && request.url === url);
}

/**
 * Recent with the paste at its head and no more than {@link RECENT_LIMIT} rows in it.
 *
 * Recent is ordered newest paste first, and evicts by `lastUsedAt` — two different orders on
 * purpose. What falls off is the row least recently **sent**, so a request still used every day is
 * not pushed out by ten pastes; and `lastUsedAt` is stamped by sending, so opening a row to look at
 * it does not save it either.
 */
export function addRecent(lists: RequestLists, request: RestRequest): RequestLists {
  return { ...lists, recent: trimRecent([request, ...lists.recent]) };
}

function trimRecent(recent: RestRequest[]): RestRequest[] {
  if (recent.length <= RECENT_LIMIT) return recent;
  const byUse = recent.map((request, index) => ({ request, index }));
  // Least recently used first; a tie goes to whichever sits further down, which is the older paste.
  byUse.sort((a, b) => a.request.lastUsedAt - b.request.lastUsedAt || b.index - a.index);
  const dropped = new Set(
    byUse.slice(0, recent.length - RECENT_LIMIT).map((entry) => entry.request.id),
  );
  return recent.filter((request) => !dropped.has(request.id));
}

/** The same command pasted again: the row already there comes to the head of Recent and is stamped
 *  as used, instead of a second copy of it appearing. */
export function bumpRecent(lists: RequestLists, id: string, now: number): RequestLists {
  const found = lists.recent.find((request) => request.id === id);
  if (found === undefined) return lists;
  return {
    ...lists,
    recent: [{ ...found, lastUsedAt: now }, ...lists.recent.filter((request) => request.id !== id)],
  };
}

/**
 * Pinning: out of Recent and on to the top of Saved, where nothing evicts it.
 *
 * `origin` changes with it, because pinning is someone saying they meant to keep this — and it is
 * the **only** thing that moves a row between the groups. Editing a Recent request does not, which
 * is why a half-typed one can still be dropped when Recent fills up.
 */
export function pinToSaved(lists: RequestLists, id: string): RequestLists {
  const found = lists.recent.find((request) => request.id === id);
  if (found === undefined) return lists;
  return {
    saved: [{ ...found, origin: "manual" }, ...lists.saved],
    recent: lists.recent.filter((request) => request.id !== id),
  };
}
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `npm test -- requests`
Expected: PASS.

- [ ] **Step 5: Commit** (only when the user asks)

```bash
git add src/modules/rest/requests.ts src/modules/rest/requests.test.ts
git commit -m "feat(rest): keep pasted requests in a Recent group of ten"
```

---

### Task 7: A Body tab that can show what it cannot edit

Pasting `-F` makes a multipart body, and Phase 1's Body tab shows any non-`raw` body as **None** — invisible, and destroyed by the next touch of the picker. This closes that before Task 8 can create one.

**Files:**
- Modify: `src/modules/rest/components/BodyEditor/BodyEditor.tsx`
- Modify: `src/modules/rest/components/BodyEditor/BodyEditor.module.css`
- Modify: `src/modules/rest/i18n/en.ts`, `src/modules/rest/i18n/vi.ts`

**Interfaces:**
- Consumes: `Body`, `MultipartField`, `RawLanguage`, `RAW_LANGUAGES`, `rawLanguage`.
- Produces: no new exports. `BodyEditor`'s `Props` are unchanged, so `RestTab` needs no edit.

- [ ] **Step 1: Add the strings**

In `src/modules/rest/i18n/en.ts`, in the `rest` group beside the other body keys:

```ts
    bodyForm: "Form",
    bodyMultipart: "Multipart form",
    bodyBinary: "File",
    bodyNotEditable: "Sent as it stands \u2014 there is no editor for this kind of body yet.",
```

In `src/modules/rest/i18n/vi.ts`, in the same place:

```ts
    bodyForm: "Form",
    bodyMultipart: "Multipart",
    bodyBinary: "T\u1EC7p",
    bodyNotEditable: "G\u1EEDi \u0111\u00fang nh\u01b0 \u0111ang c\u00f3 \u2014 ki\u1EC3u body n\u00e0y ch\u01b0a c\u00f3 ch\u1ED7 s\u1EEDa.",
```

- [ ] **Step 2: Show the body that has no editor**

Replace the `Choice` type, `LABELS`, `choice`, `options` and the render tail of `src/modules/rest/components/BodyEditor/BodyEditor.tsx` with:

```ts
/** What the one picker is set to: no body, the notation the text is written in, or one of the three
 *  kinds this pane can so far only show. */
type Choice = "none" | RawLanguage | "form" | "multipart" | "binary";

const LABELS: Record<Choice, TranslationKey> = {
  none: "rest.bodyNone",
  json: "rest.langJson",
  xml: "rest.langXml",
  yaml: "rest.langYaml",
  text: "rest.langText",
  form: "rest.bodyForm",
  multipart: "rest.bodyMultipart",
  binary: "rest.bodyBinary",
};

/** The kinds this pane can make and change. The other three arrive by paste or from a file written
 *  by a later version, and are shown rather than edited until Phase 3 gives them a table. */
const EDITABLE: Choice[] = ["none", ...RAW_LANGUAGES];

/**
 * The rows to show for a body this pane cannot edit, or null when it can.
 *
 * Read as multipart fields throughout, since a plain form field is simply one without a file, and a
 * binary body is one file with no name of its own.
 */
function readOnlyFields(body: Body): MultipartField[] | null {
  if (body.kind === "form" || body.kind === "multipart") return body.fields;
  if (body.kind === "binary") {
    return [{ id: "file", enabled: true, key: "", value: "", file: body.filePath }];
  }
  return null;
}
```

Inside the component, `choice`, `options` and the tail become:

```ts
  const choice: Choice = body.kind === "raw" ? rawLanguage(body.language) : body.kind;
  const shown = readOnlyFields(body);
  const options = (EDITABLE.includes(choice) ? EDITABLE : [...EDITABLE, choice]).map((value) => ({
    value,
    label: t(LABELS[value]),
    /* The kind a pasted body turned out to be is listed so the picker is not silently wrong about
       what is being sent, and cannot be chosen — there would be nothing to put in it. */
    disabled: !EDITABLE.includes(value),
  }));
```

```tsx
      {body.kind === "raw" ? (
        <textarea
          className={styles.text}
          value={body.text}
          placeholder={t("rest.bodyPlaceholder")}
          aria-label={t("rest.bodyTab")}
          spellCheck={false}
          onChange={(e) => onChange({ ...body, text: e.target.value })}
        />
      ) : shown === null ? (
        <p className={`${styles.empty} muted`}>{t("rest.bodyNone")}</p>
      ) : (
        <div className={styles.readOnly}>
          <p className="muted">{t("rest.bodyNotEditable")}</p>
          <dl className={styles.fields}>
            {shown.map((field) => (
              <div key={field.id} className={styles.field}>
                <dt className={styles.fieldKey}>{field.key}</dt>
                <dd className={styles.fieldValue}>{field.file ?? field.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
```

Add `Body` and `MultipartField` to the type import at the top of the file:

```ts
import type { Body, MultipartField, RawLanguage } from "../../types";
```

- [ ] **Step 3: Style it**

Append to `src/modules/rest/components/BodyEditor/BodyEditor.module.css`:

```css
/* A body that arrived by paste and has no editor yet: what is in it, plainly, and nothing that
   looks like a field waiting to be typed in. */
.readOnly {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: 0.9em;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0;
}

.field {
  display: flex;
  gap: 0.5rem;
  min-width: 0;
}

.fieldKey {
  flex: 0 0 30%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.7;
}

.fieldValue {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-family: "Fira Code", monospace;
}
```

- [ ] **Step 4: Typecheck and test**

Run: `npm run build`
Expected: clean — in particular no error about `LABELS` missing a `Choice`.
Run: `npm test`
Expected: PASS, unchanged from Task 6.

- [ ] **Step 5: Commit** (only when the user asks)

```bash
git add src/modules/rest/components/BodyEditor src/modules/rest/i18n
git commit -m "feat(rest): show a body the Body tab cannot edit yet instead of hiding it"
```

---

### Task 8: Pasting into the workspace

**Files:**
- Modify: `src/modules/rest/requestsStore.ts`
- Modify: `src/modules/rest/RestTab.tsx`
- Modify: `src/modules/rest/components/UrlBar/UrlBar.tsx`

**Interfaces:**
- Consumes: `parsePaste`, `ParsedRequest` (Task 4); `findRecentTarget`, `addRecent`, `bumpRecent` (Task 6); `isBlank`, `newRequest`, `findRequest` (Phase 1).
- Produces:
  - `pasteRequest(parsed: ParsedRequest): RestRequest` in `requestsStore.ts` — the row to open a tab on, whether it was made or found.
  - `UrlBar`'s new prop `onPasteText: (text: string) => boolean` — true means the paste was taken and the box should not receive the text.

- [ ] **Step 1: Add the store's paste path**

Add to `src/modules/rest/requestsStore.ts`, with `addRecent`, `bumpRecent`, `findRecentTarget` and `findRequest` added to its import from `./requests` and `import type { ParsedRequest } from "./parsePaste";`:

```ts
/**
 * A pasted command, as a row in Recent — or the row that was already there.
 *
 * The same command pasted twice is one request: the row already aimed at that method and URL comes
 * to the head of the group and is stamped as used, rather than a second copy of it appearing. The
 * request to open a tab on is returned either way, so the caller does not need to know which
 * happened.
 */
export function pasteRequest(parsed: ParsedRequest): RestRequest {
  const now = Date.now();
  const existing = findRecentTarget(snapshot, parsed.method, parsed.url);
  const lists = existing
    ? bumpRecent(snapshot, existing.id, now)
    : addRecent(snapshot, {
        ...newRequest(crypto.randomUUID(), now),
        ...parsed,
        origin: "paste",
      });
  publish(lists);
  persistRequests(lists);
  // After a bump the row is a new object with a new stamp on it; the pre-bump one is stale.
  const id = existing?.id;
  return id === undefined ? lists.recent[0] : (findRequest(lists, id) ?? lists.recent[0]);
}

/** Pinning a Recent request: it moves to Saved and stops being something that can be evicted. */
export function pinRequest(id: string): void {
  const lists = pinToSaved(snapshot, id);
  publish(lists);
  persistRequests(lists);
}
```

`pinToSaved` also goes in that import list.

- [ ] **Step 2: Let the URL box hand a paste up**

In `src/modules/rest/components/UrlBar/UrlBar.tsx`, add the prop and the handler. Nothing about HTTP or cURL enters this file — it reads the clipboard and reports whether the text was wanted:

```ts
  /** Handed the pasted text; returns whether it was taken as a request, in which case the box does
   *  not also receive it. Anything else — a URL, a fragment of one, prose — pastes as text. */
  onPasteText: (text: string) => boolean;
```

```tsx
        onPaste={(e) => {
          if (onPasteText(e.clipboardData.getData("text"))) e.preventDefault();
        }}
```

- [ ] **Step 3: Decide where a paste lands**

In `src/modules/rest/RestTab.tsx`, add the import of `parsePaste`, add `pasteRequest` to the `requestsStore` import, and add the function beside `editUrl`:

```ts
  /**
   * A paste in the URL box that turned out to be a cURL command.
   *
   * A tab nobody has put anything into is filled where it stands — it is what someone pressed New
   * to get, and swallowing a request they were part-way through composing would be a real loss. A
   * tab with anything in it gets a new tab beside it instead, which destroys nothing and so needs
   * no undo. Returns whether the paste was taken, which is what stops the box also receiving it.
   */
  function pasteInto(text: string): boolean {
    const parsed = parsePaste(text, () => crypto.randomUUID());
    if (parsed === null) return false;
    /* Filled in place keeps the request where it is, Saved included: pressing New and pasting into
       what it opened is not the same gesture as pasting over work, and a row someone asked for
       should not become one that ten more pastes can evict. */
    if (activeRequest !== undefined && isBlank(activeRequest)) {
      saveRequest({ ...activeRequest, ...parsed });
      return true;
    }
    open(pasteRequest(parsed).id);
    return true;
  }
```

And pass it to the bar:

```tsx
                onUrlChange={editUrl}
                onPasteText={pasteInto}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: clean.
Run: `npm test`
Expected: PASS, unchanged.

- [ ] **Step 5: Try it in the app**

Run: `npm run dev:app`, open a REST tab, press **New request**, and paste:

```bash
curl -X POST 'https://httpbin.org/post' -H 'Content-Type: application/json' -d '{"a":1}'
```

Expected: the tab fills in — POST, the URL, the header row, the JSON body — and the row stays under **Saved**. Send it and check the response pane. Then paste the same command again with that tab still open: a new tab opens and a row appears under **RECENT (1/10)**. Paste it a third time: still `1/10`, and the row comes to the top.

- [ ] **Step 6: Commit** (only when the user asks)

```bash
git add src/modules/rest/requestsStore.ts src/modules/rest/RestTab.tsx src/modules/rest/components/UrlBar
git commit -m "feat(rest): paste a cURL command into the request being composed"
```

---

### Task 9: Copy as cURL, pinning, and Recent's delete

**Files:**
- Modify: `src/modules/rest/components/RequestList/RequestList.tsx`
- Modify: `src/modules/rest/components/RequestList/RequestList.module.css`
- Modify: `src/modules/rest/RestTab.tsx`
- Modify: `src/modules/rest/i18n/en.ts`, `src/modules/rest/i18n/vi.ts`

**Interfaces:**
- Consumes: `toCurl` (Task 5), `pinRequest` (Task 8), `copyText` from `src/core/clipboard`, `PinIcon` from `src/icons`.
- Produces: `RequestList`'s new prop `onPin: (id: string) => void`.

- [ ] **Step 1: Add the strings**

In `src/modules/rest/i18n/en.ts`, in the sidebar-menu part of the `rest` group:

```ts
    copyAsCurl: "Copy as cURL",
    pin: "Pin",
    pinHint: "Keep this request in Saved",
```

In `src/modules/rest/i18n/vi.ts`, in the same place:

```ts
    copyAsCurl: "Sao ch\u00e9p d\u1EA1ng cURL",
    pin: "Ghim",
    pinHint: "Gi\u1EEF request n\u00e0y trong Saved",
```

- [ ] **Step 2: Give the rows a wrapper, a pin, and Recent's own delete**

In `src/modules/rest/components/RequestList/RequestList.tsx`:

Add to the imports:

```ts
import { copyText } from "../../../../core/clipboard";
import { ChevronDownIcon, ChevronRightIcon, PinIcon, PlusIcon } from "../../../../icons";
import { toCurl } from "../../parsePaste";
```

Add the prop and widen the menu state:

```ts
  /** Recent only: keep this request for good. */
  onPin: (id: string) => void;
```

```ts
type Group = "saved" | "recent";

interface MenuState {
  request: RestRequest;
  group: Group;
  x: number;
  y: number;
}
```

Replace `rows` and `group` with versions that know which group they are drawing:

```tsx
  /** Deleting from Recent asks nothing: it is a list that empties itself anyway, and the row came
   *  from a paste rather than from a decision. Saved is asked about, as before. */
  function remove(request: RestRequest, group: Group) {
    if (group === "recent") onDelete(request.id);
    else setDeleting(request);
  }

  function rows(list: RestRequest[], emptyMessage: string, group: Group) {
    const shown = list.filter(match);
    if (shown.length === 0) return <p className={`${styles.empty} muted`}>{emptyMessage}</p>;
    return shown.map((request) => (
      /* The row is a button, and a button cannot hold another — so the pin sits beside it in a
         wrapper that carries the hover instead. */
      <div key={request.id} className={styles.rowWrap}>
        <button
          type="button"
          className={`${styles.row}${request.id === activeId ? ` ${styles.rowActive}` : ""}`}
          onClick={() => onOpen(request.id)}
          /* Delete on the row the keyboard is on. Backspace too: it is what the finger reaches for
             on a laptop, and this row is not a text field where it would mean anything else. */
          onKeyDown={(e) => {
            if (e.key !== "Delete" && e.key !== "Backspace") return;
            e.preventDefault();
            remove(request, group);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ request, group, x: e.clientX, y: e.clientY });
          }}
        >
          <span className={`${styles.method} rest-method rest-method-${request.method}`}>
            {request.method}
          </span>
          <span className={styles.name}>{label(request)}</span>
        </button>
        {group === "recent" && (
          <button
            type="button"
            className={styles.pin}
            aria-label={t("rest.pin")}
            title={t("rest.pinHint")}
            onClick={() => onPin(request.id)}
          >
            <PinIcon size="0.9em" />
          </button>
        )}
      </div>
    ));
  }

  function group(key: Group, heading: string, list: RestRequest[], empty: string) {
    const open = openGroups[key];
    return (
      <>
        <button
          type="button"
          className={styles.groupHead}
          onClick={() => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }))}
          aria-expanded={open}
        >
          {open ? <ChevronDownIcon size="0.9em" /> : <ChevronRightIcon size="0.9em" />}
          {heading}
        </button>
        {open && rows(list, empty, key)}
      </>
    );
  }
```

The two `group(...)` calls in the returned JSX need no change — they already pass the key first.

Then the menu: a pin at the top for a Recent row, Copy as cURL after Duplicate, and a Delete that goes through `remove`:

```tsx
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.group === "recent" && (
            <button
              type="button"
              onClick={() => {
                onPin(menu.request.id);
                setMenu(null);
              }}
            >
              {t("rest.pin")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setRenaming(menu.request);
              setMenu(null);
            }}
          >
            {t("rest.rename")}
          </button>
          <button
            type="button"
            onClick={() => {
              onDuplicate(menu.request);
              setMenu(null);
            }}
          >
            {t("rest.duplicate")}
          </button>
          <button
            type="button"
            onClick={() => {
              // A refusal is reported by `copyText`; the sidebar has no banner to put it on, so it
              // is swallowed rather than left as an unhandled rejection — as the tree's copy is.
              void copyText(toCurl(menu.request)).catch(() => {});
              setMenu(null);
            }}
          >
            {t("rest.copyAsCurl")}
          </button>
          <button
            type="button"
            className="context-menu-delete"
            onClick={() => {
              remove(menu.request, menu.group);
              setMenu(null);
            }}
          >
            {t("rest.delete")}
          </button>
        </ContextMenu>
```

- [ ] **Step 3: Style the wrapper and the pin**

In `src/modules/rest/components/RequestList/RequestList.module.css`, replace the `.row:hover` rule and add the two new ones:

```css
/* The row and what acts on it, side by side. The hover lives here rather than on the row, so the
   strip the pin sits in lights up with it instead of looking like a gap. */
.rowWrap {
  display: flex;
  align-items: center;
}

.rowWrap:hover {
  background: var(--surface-hover, rgba(127, 127, 127, 0.12));
}

.row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem;
  background: none;
  border: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

/* Out of the way until the pointer or the keyboard is on the row: the list is read far more often
   than it is pinned. */
.pin {
  flex: none;
  display: flex;
  align-items: center;
  padding: 0.25rem 0.4rem;
  background: none;
  border: none;
  color: inherit;
  opacity: 0;
  cursor: pointer;
}

.rowWrap:hover .pin {
  opacity: 0.7;
}

.pin:focus-visible,
.pin:hover {
  opacity: 1;
}
```

- [ ] **Step 4: Wire the pin through the workspace**

In `src/modules/rest/RestTab.tsx`, add `pinRequest` to the `requestsStore` import and pass it down:

```tsx
          onDuplicate={duplicate}
          onPin={pinRequest}
          onDelete={deleteRequest}
```

- [ ] **Step 5: Typecheck and test**

Run: `npm run build`
Expected: clean.
Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Try it in the app**

Run: `npm run dev:app`. With a pasted row in Recent:

- Right-click a Saved row → **Copy as cURL** → paste into a terminal and run it; paste it back into MixDB and check the request matches.
- Hover a Recent row → the pin appears → press it: the row moves to **Saved**, keeps its method, URL and body, and the counter drops.
- Right-click a Recent row → **Delete**: it goes with no dialog. Right-click a Saved row → **Delete**: the dialog still appears.
- Put the keyboard on a Recent row and press Backspace: gone, no dialog.

- [ ] **Step 7: Commit** (only when the user asks)

```bash
git add src/modules/rest/components/RequestList src/modules/rest/RestTab.tsx src/modules/rest/i18n
git commit -m "feat(rest): copy a request as cURL, pin a pasted one, drop it without asking"
```

---

### Task 10: The changelog, and checking the phase over

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the entries**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, after the existing REST line (which is the release's headline and stays first):

```markdown
- Pasting a cURL command into a REST request fills it in — method, URL, headers and body — and right-clicking a request copies it back out as one.
- Pasted REST requests collect in the sidebar's Recent group, which holds ten and can pin one to Saved.
```

Both are `Added`: nothing here repairs a released version, so nothing goes under `Fixed` — including the read-only body view from Task 7, which is part of the unreleased REST work and belongs to the line above.

- [ ] **Step 2: Run everything**

```bash
npm test
npm run build
```
Expected: all tests pass; the build is clean.

- [ ] **Step 3: Check the module boundary**

```powershell
Get-ChildItem -Recurse src/components,src/core,src/icons -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: nothing.

```powershell
Get-ChildItem -Recurse src/shell,src/i18n -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: only `src/shell/registry.ts` and `src/i18n/dicts.ts`.

- [ ] **Step 4: The by-hand list**

No test in this repo can say any of these. Run `npm run dev:app` and walk them:

- [ ] Paste a cURL command copied out of a browser's network panel — the long kind, with a dozen `-H` flags and `--compressed` in it. The headers arrive; the flag is passed over.
- [ ] Paste a Windows-flavoured command, the one broken with `^` and quoted with `"`.
- [ ] Paste into a blank tab: filled in place, still under Saved.
- [ ] Paste into a tab that has been sent: a new tab, a row in Recent.
- [ ] Paste the same command twice: one Recent row, moved to the top, counter still `1/10`.
- [ ] Fill Recent past ten, having sent one of the older rows in between: the sent one survives and an unused one goes.
- [ ] Paste a `-F` command with a real file path; the Body tab lists the fields read-only and the picker names the kind. Send it to `https://httpbin.org/post` and check the parts arrive.
- [ ] Paste `-u user:pass`; the Headers table shows the `Authorization` row, and `https://httpbin.org/basic-auth/user/pass` answers 200.
- [ ] Paste something that is not a command — a sentence, a URL, half a URL over a selection in the box. Each pastes as text, and the query of a whole pasted URL still becomes Params rows.
- [ ] Copy a request as cURL, run it in a terminal, and paste it back: the same request.
- [ ] Pin a Recent row, then restart the app: it is still in Saved, and Recent is still what was left.

- [ ] **Step 5: Commit** (only when the user asks)

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note pasting and copying cURL in the REST client"
```

---

## Self-Review

**Spec coverage (§5 and §8's Phase 2 row):**

| Spec requirement | Where |
| --- | --- |
| cURL branch: line joining, shell quoting | Task 1 |
| `-X/--request`, `-H/--header`, `--url` | Task 2 |
| `-d/--data/--data-raw/--data-binary`, `-F/--form`, `-u/--user`, `-G` | Task 3 |
| `-L`, `-k`, `--compressed` ignored as global settings | Task 2 (`default` branch), and `toCurl` does not emit them (Task 5) |
| `-d` JSON vs form-urlencoded rule | Task 3, `dataBody` |
| URL branch: query into Params | Decision 1 above — Phase 1's URL↔Params sync already does it; Task 4 documents and tests that the paste is not claimed |
| No match: paste as text | Task 4 |
| Paste target: blank tab in place, else a new tab | Task 8, `pasteInto` |
| Duplicate paste bumps rather than doubles | Task 6 (`findRecentTarget`, `bumpRecent`), Task 8 (`pasteRequest`) |
| `RECENT (n/10)`, evicting the least recently *sent* | Task 6, `addRecent`/`trimRecent`. The counter was drawn in Phase 1 |
| Pin moves to Saved and flips `origin` | Task 6 (`pinToSaved`), Task 9 (the button and the menu entry) |
| Recent's delete asks nothing; Saved's asks | Task 9, `remove` |
| Copy as cURL in the row menu | Task 9 |
| `toCurl` is the parser's inverse, tested together | Task 5 |
| Editing a Recent request does not promote it | Already true — `updateRequest` keeps a request in its group, tested in Phase 1. `pinToSaved` is the only mover |
| `lastUsedAt` stamped on send, not on open | Already true — `RestTab.send`. Task 6's eviction test is what makes it matter |

Out of scope by §8 and untouched: interpolation and environments (Phase 4), the Auth tab and the form/multipart/binary **editors** (Phase 3), history and the Settings pane (Phase 5), and all of `src-tauri/`.

**Placeholders:** none — every step carries the code or the command it needs.

**Type consistency:** `ParsedRequest` is produced in Task 2 and consumed unchanged in Tasks 3, 4, 5 and 8. `nextId: () => string` is the same shape `paramsFromUrl` already takes. `findRecentTarget`/`addRecent`/`bumpRecent`/`pinToSaved` are named identically in Task 6's implementation, Task 6's tests and Task 8's store. `onPasteText` (UrlBar) and `onPin` (RequestList) are the only new props, each added in the task that passes it.
