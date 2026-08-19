# REST Client Module — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A request can carry credentials chosen in an Auth tab — a bearer token, basic credentials, or an API key sent as a header or a query parameter — and its body can be a form, a multipart upload with files picked off disk, or a single file sent as it stands.

**Architecture:** Two pure additions do the deciding. `buildRequest` folds `RestRequest.auth` into the wire's headers or query, and `authOverride` says when a hand-typed row already claims that name; `bodyKind.ts` turns one body kind into another so the picker can change kind without losing what carries across. The UI layer only shows them: a new `AuthPane`, a new `MultipartTable`, and a `BodyEditor` that finally edits all five body kinds. Rust is untouched — `WireBody` already carries `text`, `file` and `multipart`, and `rest_send` already sends all three.

**Tech Stack:** TypeScript (strict), React 19, CSS Modules, vitest, `@tauri-apps/plugin-dialog` (already a dependency, already used by the db module).

**Spec:** [docs/superpowers/specs/2026-08-18-rest-client-module-design.md](../specs/2026-08-18-rest-client-module-design.md) — §2 (the `Body` and `Auth` shapes), §5 (the parser's `-u`), §7 (testing), scoped by §8's phase table: *"Tab Auth, body form-urlencoded / multipart / binary"*.

**Earlier plans (the code this one builds on):** [phase 1](2026-08-18-rest-client-phase-1.md), [phase 2](2026-08-18-rest-client-phase-2.md)

## Global Constraints

- **Pure logic is tested; components are not.** The repo has no jsdom and no component tests, and this phase does not add either. Everything that can be got wrong — where auth lands, what wins when two things claim a header, what survives a change of body kind, how a path is shortened — is a pure function under `npm test`.
- **The module boundary holds.** No file outside `src/modules/rest/` learns an HTTP concept. Check with the two greps in [.agent/conventions/adding-a-module.md](../../../.agent/conventions/adding-a-module.md) before finishing.
- **Strings go in both dictionaries.** `src/modules/rest/i18n/en.ts` and `vi.ts`, groups flat, symbols written as escapes (`—`, `…`) while Vietnamese letters stay literal — match what is already in `vi.ts`. No literal English in JSX. See [.agent/conventions/i18n.md](../../../.agent/conventions/i18n.md).
- **Components live in their own folder** with `index.ts`, per [.agent/conventions/component-structure.md](../../../.agent/conventions/component-structure.md). New here: `AuthPane`, `MultipartTable` — both under `src/modules/rest/components/`.
- **No interpolation, no environments, no history, no Settings pane.** Those are Phases 4 and 5. `{{var}}` still travels as text, `PHASE_ONE_SETTINGS` is still where the three send settings come from.
- **No Rust.** `src-tauri/` is not touched. `WireRequest`, `WireBody` and `RestResponse` do not change.
- **No new dependency.** `@tauri-apps/plugin-dialog` is already in `package.json` and already permitted — [`DbTab.tsx:3`](../../../src/modules/db/DbTab.tsx#L3) uses it.
- **Commits happen only when the user asks for one.** The user's standing instruction is that nothing is committed unprompted and one request authorises one commit. Each task's commit step gives the message to use *when* a commit is asked for; do not run it on your own initiative.
- Commit messages take a prefix and a scope: `feat(rest): …`, `refactor(rest): …`. No `Co-Authored-By` trailer.
- Verify with `npm test` and `npm run build` (which is `tsc && vite build`, so it is the typecheck too).

---

## Scope: Phase 3 only

Five decisions, settled here so no task has to re-argue them.

### 1. The Auth tab goes last: `Params · Body · Headers · Auth`

Phases 1 and 2 shipped in **0.0.13**, released 2026-08-19, so the three tabs already there are tabs someone has learnt. Auth is appended rather than slotted in beside Params: moving Body and Headers along by one would be a change every existing user notices and nobody asked for, and it buys nothing a fourth tab does not already give. The spec's own component list in §1 reads `UrlBar, KeyValueTable, BodyEditor, AuthPane`, in that order.

### 2. A hand-typed row beats the Auth tab

`buildRequest` already lets a `Content-Type` typed into the Headers table beat the one the body implies. Auth follows the same rule: if a ticked `Authorization` header exists, a bearer token chosen in the Auth tab is not sent; if a ticked param named `api_key` exists, an API key of that name in the query is not sent.

The rule is the same one, for the same reason — what is written out in a table is the one part of a request its author can see. The difference is that Auth can be left disagreeing with a table for a long time, so it does not stay silent: `authOverride` names the row that won, and the pane says so in a line under the fields.

### 3. Auth values sit in `rest-requests.json`, in the clear

The same as every other field of a request. The keyring is for **environment** variables marked secret, which is Phase 4 — and once it lands, the way to keep a token off disk is to put `{{token}}` in the Auth field and the value in the environment. Nothing in this phase writes to `secrets.rs`, and nothing in it pretends the file is protected.

### 4. `-u` is lifted out of the Headers table and into `auth`

Phase 2 put `curl -u ann:secret` into an `Authorization` header on purpose: *"nothing reads `auth` until the Auth tab arrives in Phase 3, and a credential that silently goes nowhere is worse than one written out where its owner can see it."* This is that phase. The paste now sets `auth: { kind: "basic", … }`, the Auth tab shows the username and password as themselves, and `buildRequest` puts the header back on the wire.

The round trip still holds, because it has always been compared at the wire: `toCurl` builds from the `WireRequest`, so basic credentials come back out as `-H 'Authorization: Basic …'` and pasting that gives a request that sends the same bytes.

The Phase 2 guard stays: a command that gives **both** `-H 'Authorization: …'` and `-u` keeps the header and sets no auth, so what the parser produces and what §2's rule sends never disagree.

### 5. An unfinished file row sends nothing rather than an error

A multipart row switched to File before a file is chosen holds `file: ""`, and a `binary` body starts as `filePath: ""`. Neither is sent: the multipart row is dropped like an unticked one, and a binary body with no file goes on the wire as `none`.

The alternative is handing Rust an empty path and getting `error.restFileUnreadable` with nothing named in it. The row is visibly unfinished in the table — its button still reads *Choose file…* — which is a better place to notice than a banner.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/modules/rest/buildRequest.ts` | `authSlot` (private), `authOverride` (exported), and the fold into headers or query. Gains the `base64` helper moved out of `parsePaste.ts`. |
| `src/modules/rest/buildRequest.test.ts` | Auth on the wire, and the override rule. |
| `src/modules/rest/bodyKind.ts` | **New.** `BodyChoice`, `BODY_CHOICES`, `bodyChoice`, `convertBody`. Pure. |
| `src/modules/rest/bodyKind.test.ts` | **New.** What survives each change of kind. |
| `src/modules/rest/format.ts` | `fileName` — the last segment of a path, in either slash. |
| `src/modules/rest/format.test.ts` | Tests for it. |
| `src/modules/rest/parsePaste.ts` | `-u` becomes `auth`; `ParsedRequest` gains `auth`; `base64` leaves. |
| `src/modules/rest/parsePaste.test.ts` | The three `-u` tests rewritten against `auth`, plus two auth round trips. |
| `src/modules/rest/api.ts` | `pickFile()` — the one place this module opens a native dialog. |
| `src/modules/rest/draftFocus.ts` | **New.** `useDraftFocus`, the "typing into the foot makes a row and keeps the keyboard" hook, lifted out of `KeyValueTable` so both tables share it. |
| `src/modules/rest/components/AuthPane/` | **New folder.** `AuthPane.tsx`, `AuthPane.module.css`, `index.ts`. |
| `src/modules/rest/components/MultipartTable/` | **New folder.** `MultipartTable.tsx`, `MultipartTable.module.css`, `index.ts`. |
| `src/modules/rest/components/KeyValueTable/KeyValueTable.tsx` | Uses `useDraftFocus` instead of its own copy. No behaviour change. |
| `src/modules/rest/components/BodyEditor/BodyEditor.tsx` | Every kind is now choosable and editable: `convertBody` on the picker, `KeyValueTable` for a form, `MultipartTable` for multipart, a file picker for binary. The read-only view goes. |
| `src/modules/rest/components/BodyEditor/BodyEditor.module.css` | Styles for the file row; the read-only styles go. |
| `src/modules/rest/RestTab.tsx` | A fourth request tab, and `auth` wired through `edit`. |
| `src/modules/rest/i18n/en.ts`, `vi.ts` | The Auth strings and the file strings; `bodyNotEditable` goes. |
| `CHANGELOG.md` | Two lines under `## [Unreleased]` → `### Added`. |

---

### Task 1: Auth on the wire

Nothing reads `RestRequest.auth` today. This task makes it the only thing that does — before any pane exists to set it — so the rule about what wins is settled in a pure function with tests rather than in a component.

**Files:**
- Modify: `src/modules/rest/buildRequest.ts`
- Test: `src/modules/rest/buildRequest.test.ts`

**Interfaces:**
- Consumes: `Auth`, `KeyValue`, `RestRequest` from `./types`; `live` and `urlWithParams`, already in the file.
- Produces:
  - `export function authOverride(auth: Auth, headers: KeyValue[], params: KeyValue[]): string | null` — the name a ticked row already claims, or null. Task 4's pane shows it.
  - `buildRequest`'s signature does not change.

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/rest/buildRequest.test.ts`, and add `authOverride` to the import at the head of that file (`import { PHASE_ONE_SETTINGS, authOverride, buildRequest } from "./buildRequest";`):

```ts
describe("buildRequest: auth", () => {
  it("sends a bearer token as an Authorization header", () => {
    expect(header(build({ auth: { kind: "bearer", token: "t0k" } }), "authorization")).toBe(
      "Bearer t0k",
    );
  });

  it("sends basic credentials base64-encoded", () => {
    const wire = build({ auth: { kind: "basic", username: "ann", password: "s3cret" } });
    expect(header(wire, "authorization")).toBe("Basic YW5uOnMzY3JldA==");
  });

  // btoa alone throws on anything outside Latin-1, and a password with an accent is a real one.
  it("encodes a non-Latin-1 password as UTF-8 bytes", () => {
    const wire = build({ auth: { kind: "basic", username: "ann", password: "pässwörd" } });
    expect(header(wire, "authorization")).toBe("Basic YW5uOnDDpHNzd8O2cmQ=");
  });

  it("sends an API key as the header it names", () => {
    const wire = build({
      auth: { kind: "apiKey", name: "X-Api-Key", value: "abc", in: "header" },
    });
    expect(header(wire, "x-api-key")).toBe("abc");
  });

  it("sends an API key as a query parameter, after the ones in the table", () => {
    const wire = build({
      params: [row({ id: "a", key: "page", value: "2" })],
      auth: { kind: "apiKey", name: "api_key", value: "a b", in: "query" },
    });
    expect(wire.url).toBe("https://x.test/a?page=2&api_key=a%20b");
  });

  it("sends nothing for an API key with no name", () => {
    const wire = build({ auth: { kind: "apiKey", name: "", value: "abc", in: "header" } });
    expect(wire.headers).toEqual([]);
    expect(wire.url).toBe("https://x.test/a");
  });

  it("leaves an Authorization header typed by hand alone", () => {
    const wire = build({
      headers: [row({ id: "a", key: "Authorization", value: "Bearer typed" })],
      auth: { kind: "bearer", token: "chosen" },
    });
    expect(wire.headers).toEqual([["Authorization", "Bearer typed"]]);
  });

  it("leaves a query parameter of the same name alone", () => {
    const wire = build({
      params: [row({ id: "a", key: "api_key", value: "typed" })],
      auth: { kind: "apiKey", name: "api_key", value: "chosen", in: "query" },
    });
    expect(wire.url).toBe("https://x.test/a?api_key=typed");
  });

  // An unticked row is one that was parked. It is not in the request, so it claims nothing.
  it("sends the chosen auth when the row claiming its name is unticked", () => {
    const wire = build({
      headers: [row({ id: "a", enabled: false, key: "Authorization", value: "Bearer typed" })],
      auth: { kind: "bearer", token: "chosen" },
    });
    expect(header(wire, "authorization")).toBe("Bearer chosen");
  });
});

describe("authOverride", () => {
  it("is null when there is no auth to override", () => {
    expect(authOverride({ kind: "none" }, [], [])).toBeNull();
  });

  it("names the header that won", () => {
    const headers = [row({ id: "a", key: "authorization", value: "Bearer typed" })];
    expect(authOverride({ kind: "bearer", token: "t" }, headers, [])).toBe("Authorization");
  });

  it("names the parameter that won", () => {
    const params = [row({ id: "a", key: "api_key", value: "typed" })];
    const auth = { kind: "apiKey", name: "api_key", value: "v", in: "query" } as const;
    expect(authOverride(auth, [], params)).toBe("api_key");
  });

  // Header names are case-insensitive; query keys are not.
  it("does not treat a parameter of another case as the same key", () => {
    const params = [row({ id: "a", key: "API_KEY", value: "typed" })];
    const auth = { kind: "apiKey", name: "api_key", value: "v", in: "query" } as const;
    expect(authOverride(auth, [], params)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/modules/rest/buildRequest.test.ts`
Expected: FAIL — `authOverride` is not exported, and no auth header is on the wire.

- [ ] **Step 3: Write the implementation**

In `src/modules/rest/buildRequest.ts`, add `Auth` to the type import from `./types`, then add below `live` (around line 52):

```ts
/** Base64 of a UTF-8 string. `btoa` alone throws on anything outside Latin-1, and a password with
 *  an accent in it is a real password. */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let latin1 = "";
  for (const byte of bytes) latin1 += String.fromCharCode(byte);
  return btoa(latin1);
}

/** The one place the chosen auth would put itself, or null when it would put nothing: no auth at
 *  all, or an API key with no name to send it under. */
function authSlot(auth: Auth): { in: "header" | "query"; name: string; value: string } | null {
  switch (auth.kind) {
    case "none":
      return null;
    case "bearer":
      return { in: "header", name: "Authorization", value: `Bearer ${auth.token}` };
    case "basic":
      return {
        in: "header",
        name: "Authorization",
        value: `Basic ${base64(`${auth.username}:${auth.password}`)}`,
      };
    case "apiKey":
      return auth.name === "" ? null : { in: auth.in, name: auth.name, value: auth.value };
  }
}

/**
 * The name of the ticked row that already claims where this auth would go, or null when none does.
 *
 * A header or a parameter written out in a table is the one part of a request its author can see,
 * so it wins — the same rule the body's `Content-Type` follows. The difference is that the Auth tab
 * can sit disagreeing with a table for a long time, which is why this is exported: the pane says
 * whose value is really being sent instead of leaving the two to differ in silence.
 */
export function authOverride(auth: Auth, headers: KeyValue[], params: KeyValue[]): string | null {
  const slot = authSlot(auth);
  if (slot === null) return null;
  // Header names are case-insensitive and query keys are not, so they are not compared the same way.
  const claimed = live(slot.in === "header" ? headers : params).some((row) =>
    slot.in === "header" ? row.key.toLowerCase() === slot.name.toLowerCase() : row.key === slot.name,
  );
  return claimed ? slot.name : null;
}
```

Then, inside `buildRequest`, after the two `Content-Type` lines and before the `return`:

```ts
  /* Auth goes on last, and only where nothing was typed by hand. The synthetic parameter row is
     never seen by the Params table — it exists for the length of this fold and no longer. */
  const carried =
    authOverride(request.auth, request.headers, request.params) === null
      ? authSlot(request.auth)
      : null;
  if (carried?.in === "header") headers.push([carried.name, carried.value]);
  const params =
    carried?.in === "query"
      ? [...request.params, { id: "auth", enabled: true, key: carried.name, value: carried.value }]
      : request.params;
```

and change the `url` line of the returned object to use it:

```ts
    url: urlWithParams(request.url, params),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/rest/buildRequest.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 6: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/buildRequest.ts src/modules/rest/buildRequest.test.ts
git commit -m "feat(rest): send the auth chosen on a request"
```

---

### Task 2: A pasted `-u` becomes basic auth

**Files:**
- Modify: `src/modules/rest/parsePaste.ts`
- Test: `src/modules/rest/parsePaste.test.ts`

**Interfaces:**
- Consumes: Task 1's fold — a `basic` auth reaches the wire as `Authorization: Basic …`, which is what keeps the round trip true.
- Produces: `ParsedRequest` gains `auth: Auth`. `requestsStore.pasteRequest` and `pasteOverBlank` spread `parsed` over a whole request, so nothing there needs an edit.

- [ ] **Step 1: Rewrite the three `-u` tests**

In `src/modules/rest/parsePaste.test.ts`, replace the three tests at lines 253–270 with:

```ts
  it("turns -u into basic auth, which is what the Auth tab is for", () => {
    const parsed = parseCurl("curl https://x -u 'user:pass'", ids());
    expect(parsed?.auth).toEqual({ kind: "basic", username: "user", password: "pass" });
    expect(parsed?.headers).toEqual([]);
  });

  // curl would prompt for the password. There is nobody to prompt, and an empty one is what the
  // command as written asks for.
  it("reads a -u with no password as an empty password", () => {
    const parsed = parseCurl("curl https://x -u user", ids());
    expect(parsed?.auth).toEqual({ kind: "basic", username: "user", password: "" });
  });

  // A colon in a password is legal and common; only the first one separates.
  it("splits -u on the first colon only", () => {
    const parsed = parseCurl("curl https://x -u 'user:a:b'", ids());
    expect(parsed?.auth).toEqual({ kind: "basic", username: "user", password: "a:b" });
  });

  it("leaves an Authorization header that was already given alone", () => {
    const parsed = parseCurl("curl https://x -H 'Authorization: Bearer t' -u 'user:pass'", ids());
    expect(parsed?.headers).toHaveLength(1);
    expect(parsed?.headers[0].value).toBe("Bearer t");
    expect(parsed?.auth).toEqual({ kind: "none" });
  });
```

Then add two round trips inside the existing `describe("the round trip", …)` block:

```ts
  it("basic credentials, which come back out as the header they are sent as", () => {
    roundTrip(
      request({
        url: "https://x/private",
        auth: { kind: "basic", username: "ann", password: "s3cret" },
      }),
    );
  });

  it("an API key in the query, which comes back out as a parameter", () => {
    roundTrip(
      request({
        url: "https://x/items",
        auth: { kind: "apiKey", name: "api_key", value: "abc", in: "query" },
      }),
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/modules/rest/parsePaste.test.ts`
Expected: FAIL — `parsed.auth` is `undefined`, and `-u` still produces a header.

- [ ] **Step 3: Write the implementation**

In `src/modules/rest/parsePaste.ts`:

1. Delete the private `base64` function — it lives in `buildRequest.ts` now and nothing here calls it.
2. Add `Auth` to the type import from `./types`.
3. Add the field to `ParsedRequest`:

```ts
  /** From `-u`. A command that also gives an `Authorization` header keeps the header and sets no
   *  auth, so what the Auth tab shows and what goes on the wire never disagree. */
  auth: Auth;
```

4. Replace the `if (user !== null && headerValue(headers, "authorization") === null) { … }` block near the end of `parseCurl` with:

```ts
  /* `-u` becomes basic auth rather than a header, now that there is a tab to show it in. An
     Authorization header given as well wins — `buildRequest` would drop the auth anyway, and a tab
     showing credentials that are not the ones being sent is worse than no tab at all. */
  const colon = user === null ? -1 : user.indexOf(":");
  const auth: Auth =
    user === null || headerValue(headers, "authorization") !== null
      ? { kind: "none" }
      : {
          kind: "basic",
          username: colon === -1 ? user : user.slice(0, colon),
          password: colon === -1 ? "" : user.slice(colon + 1),
        };
```

5. Add `auth` to the object `parseCurl` returns.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. The round trips are the proof the wire did not move: `-u` in, `-H 'Authorization: Basic …'` out, the same bytes either way.

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: no errors — `requestsStore` spreads `ParsedRequest` over a `RestRequest`, so the new field lands there without an edit.

- [ ] **Step 6: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/parsePaste.ts src/modules/rest/parsePaste.test.ts
git commit -m "feat(rest): read a pasted -u into the request's auth"
```

---

### Task 3: Changing the kind of a body, and naming a file

The body picker currently offers five choices and can only produce two of them. Before it can offer all seven, something has to say what happens to what is already in the body when the kind changes — and that is logic, not JSX. `fileName` comes along in the same task because both new editors show a chosen path and neither has room for the whole of one.

**Files:**
- Create: `src/modules/rest/bodyKind.ts`
- Create: `src/modules/rest/bodyKind.test.ts`
- Modify: `src/modules/rest/format.ts`
- Test: `src/modules/rest/format.test.ts`

**Interfaces:**
- Consumes: `Body`, `RawLanguage`, `RAW_LANGUAGES`, `rawLanguage` from `./types`.
- Produces, for Tasks 5–7:
  - `export type BodyChoice = "none" | RawLanguage | "form" | "multipart" | "binary"`
  - `export const BODY_CHOICES: BodyChoice[]`
  - `export function bodyChoice(body: Body): BodyChoice`
  - `export function convertBody(body: Body, choice: BodyChoice): Body`
  - `export function fileName(path: string): string` (from `./format`)

- [ ] **Step 1: Write the failing tests**

Create `src/modules/rest/bodyKind.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BODY_CHOICES, bodyChoice, convertBody } from "./bodyKind";
import type { Body } from "./types";

const raw: Body = { kind: "raw", language: "json", text: '{"a":1}' };
const form: Body = {
  kind: "form",
  fields: [{ id: "f1", enabled: true, key: "user", value: "ann" }],
};
const multipart: Body = {
  kind: "multipart",
  fields: [
    { id: "f1", enabled: true, key: "user", value: "ann" },
    { id: "f2", enabled: false, key: "avatar", value: "", file: "/tmp/a.png" },
  ],
};

describe("bodyChoice", () => {
  it("reads a text body as the notation it is written in", () => {
    expect(bodyChoice(raw)).toBe("json");
  });

  it("reads every other body as its kind", () => {
    expect(bodyChoice({ kind: "none" })).toBe("none");
    expect(bodyChoice(multipart)).toBe("multipart");
    expect(bodyChoice({ kind: "binary", filePath: "/tmp/a.bin" })).toBe("binary");
  });

  // `rest-requests.json` may have been written when `html` was an option.
  it("reads a language this version does not know as plain text", () => {
    const stale = { kind: "raw", language: "html", text: "<p>" } as unknown as Body;
    expect(bodyChoice(stale)).toBe("text");
  });
});

describe("convertBody", () => {
  it("offers every kind the editor can make", () => {
    expect(BODY_CHOICES).toEqual([
      "none",
      "json",
      "xml",
      "yaml",
      "text",
      "form",
      "multipart",
      "binary",
    ]);
  });

  it("keeps the text when only the notation changes", () => {
    expect(convertBody(raw, "xml")).toEqual({ kind: "raw", language: "xml", text: '{"a":1}' });
  });

  it("drops the text on the way to None, and comes back empty", () => {
    expect(convertBody(raw, "none")).toEqual({ kind: "none" });
    expect(convertBody({ kind: "none" }, "json")).toEqual({
      kind: "raw",
      language: "json",
      text: "",
    });
  });

  it("carries a form's rows into a multipart body, ticks and all", () => {
    expect(convertBody(form, "multipart")).toEqual({
      kind: "multipart",
      fields: [{ id: "f1", enabled: true, key: "user", value: "ann" }],
    });
  });

  // A form has nowhere to put a file, and losing the row as well as the file would lose the name
  // that was typed. The row stays; only the file goes.
  it("keeps a multipart file row as a plain form row", () => {
    expect(convertBody(multipart, "form")).toEqual({
      kind: "form",
      fields: [
        { id: "f1", enabled: true, key: "user", value: "ann" },
        { id: "f2", enabled: false, key: "avatar", value: "" },
      ],
    });
  });

  it("starts a form empty when there were no rows to carry", () => {
    expect(convertBody(raw, "form")).toEqual({ kind: "form", fields: [] });
  });

  it("keeps a chosen file only while the body stays binary", () => {
    const binary: Body = { kind: "binary", filePath: "/tmp/a.bin" };
    expect(convertBody(binary, "binary")).toEqual(binary);
    expect(convertBody(form, "binary")).toEqual({ kind: "binary", filePath: "" });
  });
});
```

Append to `src/modules/rest/format.test.ts`:

```ts
describe("fileName", () => {
  it("takes the last segment of a POSIX path", () => {
    expect(fileName("/home/ann/photos/a.png")).toBe("a.png");
  });

  it("takes the last segment of a Windows path", () => {
    expect(fileName("C:\\Users\\ann\\a.png")).toBe("a.png");
  });

  it("ignores a trailing separator", () => {
    expect(fileName("/home/ann/photos/")).toBe("photos");
  });

  it("gives back a bare name unchanged", () => {
    expect(fileName("a.png")).toBe("a.png");
  });

  it("gives back an empty path as it is", () => {
    expect(fileName("")).toBe("");
  });
});
```

Add `fileName` to that file's import from `./format`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/modules/rest/bodyKind.test.ts src/modules/rest/format.test.ts`
Expected: FAIL — `./bodyKind` does not resolve, and `fileName` is not exported.

- [ ] **Step 3: Write the implementations**

Create `src/modules/rest/bodyKind.ts`:

```ts
import { RAW_LANGUAGES, rawLanguage } from "./types";
import type { Body, KeyValue, MultipartField, RawLanguage } from "./types";

/**
 * What the body picker is set to, and what changing it means.
 *
 * One picker, not two: a body is either absent, or a string in some notation, or one of the three
 * shapes that are not a string at all. Asking "which kind?" and then "which language?" made the
 * user answer a question whose only real answer was the second one.
 *
 * Pure, and tested, because "what happens to what I typed when I change this" is the part of a
 * picker people find out about by losing something.
 */

export type BodyChoice = "none" | RawLanguage | "form" | "multipart" | "binary";

/** In the order the picker offers them. */
export const BODY_CHOICES: BodyChoice[] = [
  "none",
  ...RAW_LANGUAGES,
  "form",
  "multipart",
  "binary",
];

/** Which choice a body already is. A text body is its notation; everything else is its kind. */
export function bodyChoice(body: Body): BodyChoice {
  return body.kind === "raw" ? rawLanguage(body.language) : body.kind;
}

/** The rows a body has to carry into a table, which is none unless it is already a table. */
function rows(body: Body): MultipartField[] {
  return body.kind === "form" || body.kind === "multipart" ? body.fields : [];
}

/** A row with its file taken off — a form has nowhere to send one. The row itself stays, because
 *  the name typed into it is worth as much as the file was. */
function withoutFile(field: MultipartField): KeyValue {
  return { id: field.id, enabled: field.enabled, key: field.key, value: field.value };
}

/**
 * The body the picker's new setting means, keeping whatever carries across.
 *
 * A change of notation keeps the text: it is the same body, described differently. A form and a
 * multipart body keep each other's rows, since a form field is a part without a file. Nothing else
 * carries — a token is not a filename — so the rest start empty.
 */
export function convertBody(body: Body, choice: BodyChoice): Body {
  switch (choice) {
    case "none":
      return { kind: "none" };
    case "form":
      return { kind: "form", fields: rows(body).map(withoutFile) };
    case "multipart":
      return { kind: "multipart", fields: rows(body) };
    case "binary":
      return { kind: "binary", filePath: body.kind === "binary" ? body.filePath : "" };
    default:
      return { kind: "raw", language: choice, text: body.kind === "raw" ? body.text : "" };
  }
}
```

Append to `src/modules/rest/format.ts`:

```ts
/** The last segment of a path, in either slash. What a row shows for a chosen file: no column is
 *  ever wide enough for the whole path, which is the row's hover text instead. */
export function fileName(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/rest/bodyKind.test.ts src/modules/rest/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: no errors. Nothing imports `bodyKind.ts` yet; that is Task 5.

- [ ] **Step 6: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/bodyKind.ts src/modules/rest/bodyKind.test.ts src/modules/rest/format.ts src/modules/rest/format.test.ts
git commit -m "feat(rest): decide what a change of body kind keeps"
```

---

### Task 4: The Auth tab

**Files:**
- Create: `src/modules/rest/components/AuthPane/AuthPane.tsx`
- Create: `src/modules/rest/components/AuthPane/AuthPane.module.css`
- Create: `src/modules/rest/components/AuthPane/index.ts`
- Modify: `src/modules/rest/RestTab.tsx`
- Modify: `src/modules/rest/i18n/en.ts`, `src/modules/rest/i18n/vi.ts`

**Interfaces:**
- Consumes: `authOverride` from `../../buildRequest` (Task 1); `Auth`, `KeyValue` from `../../types`.
- Produces: `AuthPane` with props `{ auth: Auth; headers: KeyValue[]; params: KeyValue[]; onChange: (auth: Auth) => void }`.

- [ ] **Step 1: Add the strings to both dictionaries**

In `src/modules/rest/i18n/en.ts`, inside the `rest` group after `bodyPlaceholder`:

```ts
    authTab: "Auth",
    authKind: "Auth type",
    authNone: "No auth",
    authBearer: "Bearer token",
    authBasic: "Basic",
    authApiKey: "API key",
    authNoneHint: "Sent with no credentials.",
    authToken: "Token",
    authUsername: "Username",
    authPassword: "Password",
    authKeyName: "Key",
    authKeyValue: "Value",
    authKeyIn: "Send in",
    authInHeader: "Header",
    authInQuery: "Query",
    authOverridden:
      "\u201c{{name}}\u201d is set by hand in this request, and that is what gets sent.",
    showValue: "Show",
    hideValue: "Hide",
```

The same keys in `src/modules/rest/i18n/vi.ts`, in the same place and the same order:

```ts
    authTab: "Auth",
    authKind: "Kiểu auth",
    authNone: "Không dùng",
    authBearer: "Bearer token",
    authBasic: "Basic",
    authApiKey: "API key",
    authNoneHint: "Gửi đi không kèm thông tin đăng nhập.",
    authToken: "Token",
    authUsername: "Tên đăng nhập",
    authPassword: "Mật khẩu",
    authKeyName: "Tên khoá",
    authKeyValue: "Giá trị",
    authKeyIn: "Gửi ở",
    authInHeader: "Header",
    authInQuery: "Query",
    authOverridden: "\u201c{{name}}\u201d đã được đặt tay trong request, và đó mới là thứ được gửi.",
    showValue: "Hiện",
    hideValue: "Ẩn",
```

- [ ] **Step 2: Write the component**

Create `src/modules/rest/components/AuthPane/AuthPane.tsx`:

```tsx
import { useState } from "react";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { EyeIcon, EyeOffIcon } from "../../../../icons";
import { useTranslation, type TranslationKey } from "../../../../i18n";
import { authOverride } from "../../buildRequest";
import type { Auth, KeyValue } from "../../types";
import styles from "./AuthPane.module.css";

interface Props {
  auth: Auth;
  /** Both tables, only to say when one of them already claims the name this auth would use. */
  headers: KeyValue[];
  params: KeyValue[];
  onChange: (auth: Auth) => void;
}

type Kind = Auth["kind"];

const KINDS: Kind[] = ["none", "bearer", "basic", "apiKey"];

const LABELS: Record<Kind, TranslationKey> = {
  none: "rest.authNone",
  bearer: "rest.authBearer",
  basic: "rest.authBasic",
  apiKey: "rest.authApiKey",
};

/** What each kind starts as. Nothing is carried between kinds: a token is not a username, and
 *  keeping one in the other's field would only make it look as though it were being sent. */
function emptyAuth(kind: Kind): Auth {
  switch (kind) {
    case "none":
      return { kind: "none" };
    case "bearer":
      return { kind: "bearer", token: "" };
    case "basic":
      return { kind: "basic", username: "", password: "" };
    case "apiKey":
      return { kind: "apiKey", name: "", value: "", in: "header" };
  }
}

/** A field whose value is dots until its owner asks to see it. Shoulders read screens; the eye is
 *  there for the moment a token has to be checked character by character. */
function Secret({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.secret}>
      <Input
        className={styles.control}
        size="small"
        type={shown ? "text" : "password"}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className={styles.reveal}
        aria-label={shown ? t("rest.hideValue") : t("rest.showValue")}
        title={shown ? t("rest.hideValue") : t("rest.showValue")}
        onClick={() => setShown(!shown)}
      >
        {shown ? <EyeOffIcon size="0.9em" /> : <EyeIcon size="0.9em" />}
      </button>
    </div>
  );
}

/**
 * The Auth tab.
 *
 * What is chosen here is folded into the request by `buildRequest`, and only where nothing was
 * typed by hand: a ticked `Authorization` header, or a parameter of the same name as an API key,
 * wins. That is the same rule the body's content type follows — what is written out in a table is
 * the one part of a request its author can see — and when it applies, the line at the foot says so
 * rather than leaving the two to disagree in silence.
 *
 * These values live in `rest-requests.json` like every other field. The keyring is for environment
 * variables marked secret, which arrive in Phase 4; from then on a token stays off disk by being
 * `{{token}}` here and a value there.
 */
function AuthPane({ auth, headers, params, onChange }: Props) {
  const { t } = useTranslation();
  const overridden = authOverride(auth, headers, params);

  return (
    <div className={styles.pane}>
      <div className={styles.row}>
        <span className={styles.label}>{t("rest.authKind")}</span>
        <Select<Kind>
          className={styles.kind}
          size="small"
          value={auth.kind}
          ariaLabel={t("rest.authKind")}
          options={KINDS.map((kind) => ({ value: kind, label: t(LABELS[kind]) }))}
          onChange={(kind) => onChange(emptyAuth(kind))}
        />
      </div>

      {auth.kind === "none" && <p className={`${styles.hint} muted`}>{t("rest.authNoneHint")}</p>}

      {auth.kind === "bearer" && (
        <div className={styles.row}>
          <span className={styles.label}>{t("rest.authToken")}</span>
          <Secret
            value={auth.token}
            label={t("rest.authToken")}
            onChange={(token) => onChange({ ...auth, token })}
          />
        </div>
      )}

      {auth.kind === "basic" && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>{t("rest.authUsername")}</span>
            <Input
              className={styles.control}
              size="small"
              value={auth.username}
              aria-label={t("rest.authUsername")}
              onChange={(e) => onChange({ ...auth, username: e.target.value })}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t("rest.authPassword")}</span>
            <Secret
              value={auth.password}
              label={t("rest.authPassword")}
              onChange={(password) => onChange({ ...auth, password })}
            />
          </div>
        </>
      )}

      {auth.kind === "apiKey" && (
        <>
          <div className={styles.row}>
            <span className={styles.label}>{t("rest.authKeyName")}</span>
            <Input
              className={styles.control}
              size="small"
              value={auth.name}
              aria-label={t("rest.authKeyName")}
              onChange={(e) => onChange({ ...auth, name: e.target.value })}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t("rest.authKeyValue")}</span>
            <Secret
              value={auth.value}
              label={t("rest.authKeyValue")}
              onChange={(value) => onChange({ ...auth, value })}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t("rest.authKeyIn")}</span>
            <Select<"header" | "query">
              className={styles.kind}
              size="small"
              value={auth.in}
              ariaLabel={t("rest.authKeyIn")}
              options={[
                { value: "header", label: t("rest.authInHeader") },
                { value: "query", label: t("rest.authInQuery") },
              ]}
              onChange={(where) => onChange({ ...auth, in: where })}
            />
          </div>
        </>
      )}

      {overridden !== null && (
        <p className={`${styles.hint} muted`}>{t("rest.authOverridden", { name: overridden })}</p>
      )}
    </div>
  );
}

export default AuthPane;
```

Create `src/modules/rest/components/AuthPane/AuthPane.module.css`:

```css
.pane {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.6rem 0.5rem;
  font-size: 0.9em;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.label {
  flex: 0 0 7rem;
  opacity: 0.7;
}

.kind {
  flex: 0 0 12rem;
}

.control {
  flex: 1;
  min-width: 0;
}

.secret {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
}

.reveal {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
}

.reveal:hover {
  opacity: 1;
}

.hint {
  margin: 0;
}
```

Create `src/modules/rest/components/AuthPane/index.ts`:

```ts
export { default } from "./AuthPane";
```

- [ ] **Step 3: Wire it into the request pane**

In `src/modules/rest/RestTab.tsx`:

1. `import AuthPane from "./components/AuthPane";` beside the other component imports.
2. Widen the tab key at line 44:

```ts
type RequestTabKey = "params" | "body" | "headers" | "auth";
```

3. Add the tab to `paneTabs`, last:

```ts
    { key: "auth", label: t("rest.authTab") },
```

4. Render it beside the other three:

```tsx
                {requestTab === "auth" && (
                  <AuthPane
                    auth={activeRequest.auth}
                    headers={activeRequest.headers}
                    params={activeRequest.params}
                    onChange={(auth) => edit({ auth })}
                  />
                )}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: no errors. A missing key in `vi.ts` is a type error there, so this is also the check that both dictionaries were edited.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS — nothing here is tested, but nothing here should have moved anything that is.

- [ ] **Step 6: Check it by hand**

Run: `npm run dev:app`, open a REST tab, and:
- Pick Bearer, type a token, send to `https://httpbin.org/bearer`, and read `"token"` back in the response.
- Pick Basic with `user` / `pass` and send to `https://httpbin.org/basic-auth/user/pass` — a `200`, and `authenticated: true` in the body.
- Pick API key, name `api_key`, Send in **Query**, and send to `https://httpbin.org/get`: the key is in `args` in the response, and the status bar's URL shows it.
- Type an `Authorization` header by hand while Bearer is chosen: the line at the foot of the Auth tab names it, and the response shows the typed value.

- [ ] **Step 7: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/components/AuthPane src/modules/rest/RestTab.tsx src/modules/rest/i18n
git commit -m "feat(rest): add the Auth tab to the request pane"
```

---

### Task 5: A form body that can be edited

The three kinds with no editor arrive by paste and are shown read-only. This task gives the first of them one, and moves the picker onto `convertBody` so what a change of kind keeps is decided in one tested place rather than in the handler. Multipart and binary stay read-only until Tasks 6 and 7.

**Files:**
- Modify: `src/modules/rest/components/BodyEditor/BodyEditor.tsx`

**Interfaces:**
- Consumes: `BODY_CHOICES`, `bodyChoice`, `convertBody`, `BodyChoice` from `../../bodyKind` (Task 3); `KeyValueTable` from `../KeyValueTable`.
- Produces: nothing new. `BodyEditor`'s props are unchanged.

- [ ] **Step 1: Replace the picker's private types with the shared ones**

In `src/modules/rest/components/BodyEditor/BodyEditor.tsx`:

1. Delete the local `type Choice = …` and use the shared one:

```tsx
import { BODY_CHOICES, bodyChoice, convertBody, type BodyChoice } from "../../bodyKind";
import KeyValueTable from "../KeyValueTable";
```

2. Retype `LABELS` as `Record<BodyChoice, TranslationKey>` — the entries do not change.

   Drop `RAW_LANGUAGES` and `rawLanguage` from the `../../types` import at the same time: the list is written out in `EDITABLE` below and `bodyChoice` does what `rawLanguage` was doing here. `noUnusedLocals` is on, so a leftover import is a build error rather than a stray line.
3. Replace the `EDITABLE` list and its comment with:

```tsx
/** The kinds this pane can make and change. It grows once per phase-3 task; when it holds all of
 *  `BODY_CHOICES`, both it and the read-only view below go. */
const EDITABLE: BodyChoice[] = ["none", "json", "xml", "yaml", "text", "form"];
```

4. Replace `readOnlyFields`'s first line so a form no longer takes that path:

```tsx
function readOnlyFields(body: Body): MultipartField[] | null {
  if (body.kind === "multipart") return body.fields;
  if (body.kind === "binary") {
    return [{ id: "file", enabled: true, key: "", value: "", file: body.filePath }];
  }
  return null;
}
```

5. Replace `choice` and `pick` with:

```tsx
  const choice = bodyChoice(body);
  …
  /** Changing the picker is a change of body, and `convertBody` says what survives it: text keeps
   *  its text, a form and a multipart body keep each other's rows, and nothing else carries. */
  function pick(next: BodyChoice) {
    onChange(convertBody(body, next));
  }
```

6. Build the options from `BODY_CHOICES` rather than from `EDITABLE`:

```tsx
  const options = BODY_CHOICES.map((value) => ({
    value,
    label: t(LABELS[value]),
    /* A kind with no editor yet is listed so the picker is not silently wrong about what is being
       sent, and cannot be chosen — there would be nothing to put in it. */
    disabled: !EDITABLE.includes(value),
  }));
```

7. Render the form table, between the `raw` branch and the read-only one:

```tsx
      ) : body.kind === "form" ? (
        <KeyValueTable
          rows={body.fields}
          onChange={(fields) => onChange({ kind: "form", fields })}
        />
      ) : shown === null ? (
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: no errors. If `Choice` is still referenced anywhere in the file, this is what says so.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS — `buildRequest` already encodes a form body, and its tests already cover that.

- [ ] **Step 4: Check it by hand**

Run: `npm run dev:app`:
- Pick **Form**, add `user` / `ann`, send to `https://httpbin.org/post`: the response's `form` object holds it and its `Content-Type` is `application/x-www-form-urlencoded`.
- Untick a row: it stays in the table and leaves the request.
- Switch Form → JSON → Form: the rows come back empty, which is what leaving a table for a text body means; switch Form → Multipart and the rows are still there.

- [ ] **Step 5: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/components/BodyEditor/BodyEditor.tsx
git commit -m "feat(rest): edit a form body in the Body tab"
```

---

### Task 6: The multipart table

A multipart part is a key/value row that may carry a file instead of a value, so the table is the Params table with one more column — and the hook that makes typing into the foot of a table add a row is lifted out of `KeyValueTable` rather than copied into the new one.

**Files:**
- Create: `src/modules/rest/draftFocus.ts`
- Modify: `src/modules/rest/components/KeyValueTable/KeyValueTable.tsx`
- Create: `src/modules/rest/components/MultipartTable/MultipartTable.tsx`
- Create: `src/modules/rest/components/MultipartTable/MultipartTable.module.css`
- Create: `src/modules/rest/components/MultipartTable/index.ts`
- Modify: `src/modules/rest/api.ts`
- Modify: `src/modules/rest/buildRequest.ts`
- Test: `src/modules/rest/buildRequest.test.ts`
- Modify: `src/modules/rest/components/BodyEditor/BodyEditor.tsx`
- Modify: `src/modules/rest/i18n/en.ts`, `src/modules/rest/i18n/vi.ts`

**Interfaces:**
- Consumes: `fileName` from `../../format` (Task 3); `MultipartField` from `../../types`.
- Produces:
  - `export function useDraftFocus(): { bind: (slot: string) => (el: HTMLInputElement | null) => void; owe: (slot: string) => void }` in `./draftFocus`
  - `export function pickFile(): Promise<string | null>` in `./api`
  - `MultipartTable` with props `{ rows: MultipartField[]; onChange: (rows: MultipartField[]) => void }`

- [ ] **Step 1: Write the failing test for the wire rule**

A row that says it is a file and names none has nothing to send. Append to the `describe("buildRequest: bodies", …)` block in `src/modules/rest/buildRequest.test.ts` (it starts at line 63):

```ts
  it("leaves out a multipart row that says file and names none", () => {
    const body: Body = {
      kind: "multipart",
      fields: [
        { id: "f1", enabled: true, key: "name", value: "Ann" },
        { id: "f2", enabled: true, key: "avatar", value: "", file: "" },
      ],
    };
    const wire = build({ body });
    expect(wire.body).toEqual({
      kind: "multipart",
      parts: [{ name: "name", value: "Ann", path: null }],
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/rest/buildRequest.test.ts`
Expected: FAIL — the empty path is currently sent, and Rust would answer `error.restFileUnreadable` with nothing named in it.

- [ ] **Step 3: Make the wire drop it**

In `src/modules/rest/buildRequest.ts`, in `wireBody`'s `multipart` branch:

```ts
    case "multipart": {
      /* A row switched to File before a file was picked holds an empty path. It is dropped like an
         unticked one: handing Rust an empty path buys an error naming nothing, and the row is
         visibly unfinished in the table, which is a better place to notice. */
      const parts: WirePart[] = live(body.fields)
        .filter((field) => field.file !== "")
        .map((field) => ({
          name: field.key,
          value: field.file === undefined ? field.value : null,
          path: field.file ?? null,
        }));
      // No content type: the boundary is reqwest's to generate and to announce.
      return { body: { kind: "multipart", parts }, contentType: null };
    }
```

Run: `npx vitest run src/modules/rest/buildRequest.test.ts` → PASS.

- [ ] **Step 4: Add the strings to both dictionaries**

`src/modules/rest/i18n/en.ts`, in the `rest` group after `bodyPlaceholder`:

```ts
    partKind: "Part type",
    partText: "Text",
    partFile: "File",
    chooseFile: "Choose file…",
    noFile: "No file chosen",
```

`src/modules/rest/i18n/vi.ts`, same place:

```ts
    partKind: "Kiểu phần",
    partText: "Văn bản",
    partFile: "Tệp",
    chooseFile: "Chọn tệp…",
    noFile: "Chưa chọn tệp",
```

- [ ] **Step 5: Add the file picker to `api.ts`**

In `src/modules/rest/api.ts`, widen the file's doc comment from "the only file in this module that calls `invoke`" to "the only file in this module that talks to the native side", add the import and the function:

```ts
import { open } from "@tauri-apps/plugin-dialog";
```

```ts
/** The file picker, for a multipart part and for a binary body. Null when the dialog was dismissed,
 *  which every caller reads as "keep whatever the row already had". */
export async function pickFile(): Promise<string | null> {
  const path = await open({ multiple: false, directory: false });
  return typeof path === "string" ? path : null;
}
```

- [ ] **Step 6: Lift the draft-row focus out of `KeyValueTable`**

Create `src/modules/rest/draftFocus.ts`:

```ts
import { useEffect, useRef } from "react";

/**
 * The keyboard, kept on the row that typing into the foot of a table just made.
 *
 * Both request tables have an empty row at the foot that is not in the data: typing into it is what
 * adds a row. The box that was typed into is not the box that row is then edited in — the draft is
 * always empty and always at the bottom — so left alone, the caret stays on the draft and the
 * second character starts a *second* row. `owe` names the box the new row will have, and the effect
 * hands it the keyboard the moment it exists.
 *
 * A slot is any string the caller can rebuild for the new row; both tables use `${id}:${column}`.
 */
export function useDraftFocus() {
  const boxes = useRef(new Map<string, HTMLInputElement>());
  const owed = useRef<string | null>(null);

  useEffect(() => {
    const slot = owed.current;
    if (slot === null) return;
    owed.current = null;
    const box = boxes.current.get(slot);
    if (box === undefined) return;
    box.focus();
    // The caret goes after the character that made the row, not before it.
    box.setSelectionRange(box.value.length, box.value.length);
  });

  const bind = (slot: string) => (el: HTMLInputElement | null) => {
    if (el === null) boxes.current.delete(slot);
    else boxes.current.set(slot, el);
  };

  const owe = (slot: string) => {
    owed.current = slot;
  };

  return { bind, owe };
}
```

In `src/modules/rest/components/KeyValueTable/KeyValueTable.tsx`, delete `boxes`, `owed`, `bind` and the `useEffect` that reads them, and use the hook instead — the `useEffect`/`useRef` imports go with them:

```tsx
import { useDraftFocus } from "../../draftFocus";
…
  const { bind, owe } = useDraftFocus();
…
  function append(column: "key" | "value", text: string) {
    const id = crypto.randomUUID();
    owe(`${id}:${column}`);
    onChange([...rows, { id, enabled: true, key: "", value: "", [column]: text }]);
  }
```

Nothing else in that file changes; the comment block explaining the dance now lives in the hook.

- [ ] **Step 7: Write the table**

Create `src/modules/rest/components/MultipartTable/MultipartTable.tsx`:

```tsx
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { CloseIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { pickFile } from "../../api";
import { useDraftFocus } from "../../draftFocus";
import { fileName } from "../../format";
import type { MultipartField } from "../../types";
import styles from "./MultipartTable.module.css";

interface Props {
  rows: MultipartField[];
  onChange: (rows: MultipartField[]) => void;
}

/** What a row is sending. `file` is the presence of the field, not its contents: a row with
 *  `file: ""` is one whose file has not been picked yet. */
type PartKind = "text" | "file";

/**
 * The multipart body's table: the Params table with one more column.
 *
 * A part is either text or a file, and the column that says which is what makes the value cell an
 * input or a picker. Everything else — the empty row at the foot that adds a row when typed into,
 * the tick that parks a row without losing it — works as it does in the other table.
 */
function MultipartTable({ rows, onChange }: Props) {
  const { t } = useTranslation();
  const { bind, owe } = useDraftFocus();

  function update(id: string, patch: Partial<MultipartField>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function append(column: "key" | "value", text: string) {
    const id = crypto.randomUUID();
    owe(`${id}:${column}`);
    onChange([...rows, { id, enabled: true, key: "", value: "", [column]: text }]);
  }

  /** The picker, and nothing at all when it is dismissed — the row keeps the file it had. */
  async function choose(id: string) {
    const path = await pickFile();
    if (path !== null) update(id, { file: path });
  }

  const kindOptions = [
    { value: "text" as const, label: t("rest.partText") },
    { value: "file" as const, label: t("rest.partFile") },
  ];

  return (
    <div className={styles.table}>
      <div className={`${styles.row} ${styles.head}`}>
        <span />
        <span>{t("rest.keyColumn")}</span>
        <span>{t("rest.partKind")}</span>
        <span>{t("rest.valueColumn")}</span>
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.id} className={styles.row}>
          <input
            type="checkbox"
            checked={row.enabled}
            aria-label={t("rest.rowEnabled")}
            title={t("rest.rowEnabled")}
            onChange={(e) => update(row.id, { enabled: e.target.checked })}
          />
          <Input
            ref={bind(`${row.id}:key`)}
            size="small"
            value={row.key}
            aria-label={t("rest.keyColumn")}
            onChange={(e) => update(row.id, { key: e.target.value })}
          />
          <Select<PartKind>
            size="small"
            value={row.file === undefined ? "text" : "file"}
            ariaLabel={t("rest.partKind")}
            options={kindOptions}
            /* Leaving File drops the path and leaves the text that was typed before it; arriving
               sets an empty path, which is a row saying "a file, not chosen yet". */
            onChange={(kind) => update(row.id, { file: kind === "file" ? "" : undefined })}
          />
          {row.file === undefined ? (
            <Input
              ref={bind(`${row.id}:value`)}
              size="small"
              value={row.value}
              aria-label={t("rest.valueColumn")}
              onChange={(e) => update(row.id, { value: e.target.value })}
            />
          ) : (
            <div className={styles.file}>
              <Button size="small" onClick={() => void choose(row.id)}>
                {t("rest.chooseFile")}
              </Button>
              {row.file === "" ? (
                <span className={`${styles.path} muted`}>{t("rest.noFile")}</span>
              ) : (
                <span className={styles.path} title={row.file}>
                  {fileName(row.file)}
                </span>
              )}
            </div>
          )}
          <button
            type="button"
            className={styles.remove}
            aria-label={t("rest.removeRow")}
            title={t("rest.removeRow")}
            onClick={() => onChange(rows.filter((kept) => kept.id !== row.id))}
          >
            <CloseIcon size="0.9em" />
          </button>
        </div>
      ))}
      <div className={`${styles.row} ${styles.draft}`}>
        <span />
        <Input
          size="small"
          value=""
          placeholder={t("rest.addRow")}
          aria-label={t("rest.addRow")}
          onChange={(e) => append("key", e.target.value)}
        />
        <span />
        <Input
          size="small"
          value=""
          aria-label={t("rest.valueColumn")}
          onChange={(e) => append("value", e.target.value)}
        />
        <span />
      </div>
    </div>
  );
}

export default MultipartTable;
```

Create `src/modules/rest/components/MultipartTable/MultipartTable.module.css`:

```css
.table {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem;
  overflow-y: auto;
}

.row {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr) 5.5rem minmax(0, 2fr) 1.75rem;
  gap: 0.35rem;
  align-items: center;
}

.head {
  font-size: 0.8em;
  opacity: 0.7;
}

/* The picker and the name of what it picked, which is elided rather than allowed to widen a
   column — the whole path is the hover text. */
.file {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9em;
}

.remove {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.5;
  cursor: pointer;
  display: flex;
  justify-content: center;
}

.remove:hover {
  opacity: 1;
  color: var(--danger, #e5484d);
}

/* The trailing row is not a row yet — typing in it is what makes one. */
.draft {
  opacity: 0.75;
}

.draft:focus-within {
  opacity: 1;
}
```

Create `src/modules/rest/components/MultipartTable/index.ts`:

```ts
export { default } from "./MultipartTable";
```

- [ ] **Step 8: Let the picker reach it**

In `src/modules/rest/components/BodyEditor/BodyEditor.tsx`:

```tsx
import MultipartTable from "../MultipartTable";
…
const EDITABLE: BodyChoice[] = ["none", "json", "xml", "yaml", "text", "form", "multipart"];
```

and render it beside the form table:

```tsx
      ) : body.kind === "multipart" ? (
        <MultipartTable
          rows={body.fields}
          onChange={(fields) => onChange({ kind: "multipart", fields })}
        />
      ) : shown === null ? (
```

`readOnlyFields` loses its `multipart` line, keeping only the `binary` one.

- [ ] **Step 9: Typecheck and test**

Run: `npm run build && npm test`
Expected: no errors, all tests pass.

- [ ] **Step 10: Check it by hand**

Run: `npm run dev:app`:
- Pick **Multipart**, add `name` / `Ann`, add a second row, switch it to **File**, choose an image, and send to `https://httpbin.org/post`: `form.name` is `Ann` and `files` holds the image.
- Type into the foot of the table: a row appears and the keyboard stays in it, character after character.
- Switch a row to File and send without choosing one: it is left out, and the rest of the request goes.
- Right-click the request in the sidebar → **Copy as cURL**: the command has `-F 'name=Ann'` and `-F 'avatar=@…'` in it.

- [ ] **Step 11: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/draftFocus.ts src/modules/rest/components/MultipartTable src/modules/rest/components/KeyValueTable src/modules/rest/components/BodyEditor src/modules/rest/api.ts src/modules/rest/buildRequest.ts src/modules/rest/buildRequest.test.ts src/modules/rest/i18n
git commit -m "feat(rest): build a multipart body with files in the Body tab"
```

---

### Task 7: A file sent as it stands

The last kind, and with it the last of the read-only view.

**Files:**
- Modify: `src/modules/rest/buildRequest.ts`
- Test: `src/modules/rest/buildRequest.test.ts`
- Modify: `src/modules/rest/components/BodyEditor/BodyEditor.tsx`
- Modify: `src/modules/rest/components/BodyEditor/BodyEditor.module.css`
- Modify: `src/modules/rest/i18n/en.ts`, `src/modules/rest/i18n/vi.ts`

**Interfaces:**
- Consumes: `pickFile` from `../../api` and `fileName` from `../../format` (Task 6 and Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to the `describe("buildRequest: bodies", …)` block in `src/modules/rest/buildRequest.test.ts`:

```ts
  it("sends a binary body as the file it names", () => {
    const wire = build({ body: { kind: "binary", filePath: "/tmp/a.bin" } });
    expect(wire.body).toEqual({ kind: "file", path: "/tmp/a.bin" });
  });

  // The body picker sits on File from the moment it is chosen, which is before there is a file.
  it("sends no body at all for a binary body with no file", () => {
    const wire = build({ body: { kind: "binary", filePath: "" } });
    expect(wire.body).toEqual({ kind: "none" });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/rest/buildRequest.test.ts`
Expected: FAIL on the second — an empty path currently goes to Rust as a file to open.

- [ ] **Step 3: Make the wire drop it**

In `wireBody`'s `binary` branch:

```ts
    case "binary":
      /* No default content type — a file's type is the user's to declare, and guessing it from an
         extension would be wrong at exactly the moment it mattered. An empty path is the picker
         sitting on File before a file was chosen, and sends nothing rather than an error. */
      return body.filePath === ""
        ? { body: { kind: "none" }, contentType: null }
        : { body: { kind: "file", path: body.filePath }, contentType: null };
```

Run: `npx vitest run src/modules/rest/buildRequest.test.ts` → PASS.

- [ ] **Step 4: Add the strings to both dictionaries**

`en.ts`:

```ts
    clearFile: "Remove the file",
    binaryBodyHint:
      "Sent exactly as it is on disk, with no Content-Type of its own — add one in Headers if the server needs it.",
```

`vi.ts`:

```ts
    clearFile: "Bỏ tệp",
    binaryBodyHint:
      "Gửi đúng như tệp trên đĩa, không kèm Content-Type nào — thêm ở Headers nếu máy chủ cần.",
```

And delete `bodyNotEditable` from both: every kind has an editor now, and a string nothing renders is a string that will be wrong the next time someone reads it.

- [ ] **Step 5: Finish the Body tab**

In `src/modules/rest/components/BodyEditor/BodyEditor.tsx`:

1. Delete `readOnlyFields` and the `MultipartField` import it needed.
2. Delete `EDITABLE`, and build the options with no `disabled` — every choice is choosable now:

```tsx
  const options = BODY_CHOICES.map((value) => ({ value, label: t(LABELS[value]) }));
```

3. Delete the `shown` line and the read-only branch, and end the chain with the file editor:

```tsx
      ) : body.kind === "binary" ? (
        <div className={styles.file}>
          <div className={styles.fileRow}>
            <Button size="small" onClick={() => void chooseFile()}>
              {t("rest.chooseFile")}
            </Button>
            {body.filePath === "" ? (
              <span className="muted">{t("rest.noFile")}</span>
            ) : (
              <>
                <span className={styles.fileName} title={body.filePath}>
                  {fileName(body.filePath)}
                </span>
                <button
                  type="button"
                  className={styles.clear}
                  aria-label={t("rest.clearFile")}
                  title={t("rest.clearFile")}
                  onClick={() => onChange({ kind: "binary", filePath: "" })}
                >
                  <CloseIcon size="0.9em" />
                </button>
              </>
            )}
          </div>
          <p className="muted">{t("rest.binaryBodyHint")}</p>
        </div>
      ) : (
        <p className={`${styles.empty} muted`}>{t("rest.bodyNone")}</p>
      )}
```

4. Add the picker, above the `return`:

```tsx
  /** Dismissing the dialog keeps the file that was already chosen. */
  async function chooseFile() {
    const path = await pickFile();
    if (path !== null) onChange({ kind: "binary", filePath: path });
  }
```

5. Imports: add `CloseIcon` beside `FormatIcon`, `pickFile` from `../../api`, and `fileName` beside `prettyJson` from `../../format`.

In `BodyEditor.module.css`, delete `.readOnly`, `.fields`, `.field`, `.fieldKey`, `.fieldValue`, and add:

```css
/* One file, and what it is called. The whole path is the hover text; the row shows the name. */
.file {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem;
  font-size: 0.9em;
}

.fileRow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.fileName {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: "Fira Code", monospace;
}

.clear {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.5;
  cursor: pointer;
  display: flex;
}

.clear:hover {
  opacity: 1;
  color: var(--danger, #e5484d);
}
```

- [ ] **Step 6: Typecheck and test**

Run: `npm run build && npm test`
Expected: no errors, all tests pass. `tsc` is also what proves `bodyNotEditable` had no readers left.

- [ ] **Step 7: Check it by hand**

Run: `npm run dev:app`:
- Pick **File**, choose one, send `POST` to `https://httpbin.org/post`: the response's `data` holds the file's bytes.
- Send with File chosen but no file picked: the request goes with no body, and no error banner.
- Add `Content-Type: image/png` in Headers and send again: `httpbin` echoes it back.
- Switch File → JSON → File: the path is gone, which is what leaving the kind means.

- [ ] **Step 8: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/components/BodyEditor src/modules/rest/buildRequest.ts src/modules/rest/buildRequest.test.ts src/modules/rest/i18n
git commit -m "feat(rest): send a file as the whole request body"
```

---

### Task 8: The changelog, and the checks the tests cannot make

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the entries**

Under `## [Unreleased]` in `CHANGELOG.md`, adding the heading with its first entry (never in advance):

```markdown
## [Unreleased]

### Added

- REST requests carry credentials: a bearer token, basic auth, or an API key sent as a header or a query parameter.
- REST bodies can now be a form, a multipart upload with files from disk, or a single file sent as it is.
```

Per [.agent/conventions/changelog.md](../../../.agent/conventions/changelog.md): one short line each, `Added` because neither existed, and the first line is the headline the update panel shows.

- [ ] **Step 2: Run everything**

```bash
npm test
npm run build
```
Expected: all tests pass, no type errors.

- [ ] **Step 3: Check the module boundary**

In PowerShell, from the repo root:

```powershell
Get-ChildItem -Recurse src/components,src/core,src/icons -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: nothing.

```powershell
Get-ChildItem -Recurse src/shell,src/i18n -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: only `src/shell/registry.ts` and `src/i18n/dicts.ts`.

- [ ] **Step 4: Walk the whole phase in the app**

`npm run dev:app`, one REST tab, `https://httpbin.org` throughout:

1. Bearer against `/bearer`; Basic against `/basic-auth/user/pass`; API key in header and in query against `/get`.
2. A hand-typed `Authorization` header while Bearer is chosen — the Auth tab says which one is being sent, and the response agrees with it.
3. Form, multipart with a file, and a single file, each `POST`ed to `/post`.
4. Paste `curl -u ann:secret https://httpbin.org/basic-auth/ann/secret` into the URL box: the Auth tab shows Basic with those two values, the Headers table has no `Authorization` row, and sending gives a `200`.
5. **Copy as cURL** on a request with auth and a multipart body; paste it back into a new tab; send both and compare the responses.
6. Close the tab and reopen the request from the sidebar: auth and body are exactly as they were left — there is no draft state and nothing to save.
7. Restart the app and open it again: the same, from `rest-requests.json`.

- [ ] **Step 5: Commit (only if a commit was asked for)**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note the REST auth tab and the new body kinds"
```

---

## What this phase deliberately leaves

- **No per-request send settings.** Timeout, redirects and certificates stay hardcoded in `PHASE_ONE_SETTINGS` until Phase 5's Settings pane.
- **No interpolation.** `{{token}}` in an auth field is sent as those nine characters. Phase 4 puts `interpolate` in front of `buildRequest`, and auth fields are on its list of what gets resolved.
- **No `;type=` on a multipart part.** The parser already drops it (`parsePaste.ts`'s `formField`), and the table has nowhere to put it. A part's content type is reqwest's guess from the filename.
- **No digest, OAuth or AWS signing.** §2's `Auth` union has four members and this phase implements all four.
