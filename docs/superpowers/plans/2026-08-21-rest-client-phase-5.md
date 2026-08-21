# REST Client Module — Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every send is remembered — what went out, what came back, and how long it took — in a dialog opened from the sidebar or with `Ctrl/Cmd+H`; and the three settings the wire contract has carried since Phase 1 finally have somewhere to be set, in a Settings pane of the module's own.

**Architecture:** One new pure file decides what an entry is and what may go in it (`history.ts`), one store keeps the list on disk and in step across tabs (`historyStore.ts`), and one dialog reads it. The settings are not a fifth file: they are four more fields in `rest-workspace.json`, which is already the module's furniture, and `PHASE_ONE_SETTINGS` stops being a placeholder and becomes the default the file starts from. Rust is untouched.

**Tech Stack:** TypeScript (strict), React 19, CSS Modules, vitest, `@tauri-apps/plugin-store`.

**Spec:** [docs/superpowers/specs/2026-08-18-rest-client-module-design.md](../specs/2026-08-18-rest-client-module-design.md) — §2 (`Lịch sử`, the four files on disk), §5 (`Ctrl/Cmd+H`, the history button in the sidebar header), §6 (the Settings pane and its five controls), §7 (testing), scoped by §8's phase table: *"Lịch sử + pane Settings"*.

**Earlier plans (the code this one builds on):** [phase 1](2026-08-18-rest-client-phase-1.md), [phase 2](2026-08-18-rest-client-phase-2.md), [phase 3](2026-08-20-rest-client-phase-3.md), [phase 4](2026-08-20-rest-client-phase-4.md)

## Global Constraints

- **Pure logic is tested; components are not.** The repo has no jsdom and no component tests, and this phase does not add either. What can be got wrong — the cap, what is kept out of a stored URL, when a body is kept, what turning the switch off does — is a pure function under `npm test`.
- **The module boundary holds.** No file outside `src/modules/rest/` learns an HTTP concept. `src/shell/registry.ts` and `src/i18n/dicts.ts` already name the module and gain nothing new. Check with the two greps in [.agent/conventions/adding-a-module.md](../../../.agent/conventions/adding-a-module.md) before finishing.
- **Strings go in both dictionaries.** `src/modules/rest/i18n/en.ts` and `vi.ts`, groups flat, symbols written as escapes (`—`, `…`, `“`) while Vietnamese letters stay literal — match what is already in `vi.ts`. No literal English in JSX. See [.agent/conventions/i18n.md](../../../.agent/conventions/i18n.md).
- **Components live in their own folder** with `index.ts`, per [.agent/conventions/component-structure.md](../../../.agent/conventions/component-structure.md). New here: `HistoryDialog`, `RestSettings` — both under `src/modules/rest/components/`.
- **No Rust.** `src-tauri/` is not touched. `WireRequest`, `WireBody` and `RestResponse` do not change, and no command is added: the three settings have been on the wire since Phase 1 and only their source changes.
- **No new dependency, and no new `error.*` key** — nothing new comes back from Rust.
- **Commits happen only when the user asks for one.** Each task's commit step gives the message to use *when* a commit is asked for.
- Commit messages take a prefix and a scope: `feat(rest): …`, `refactor(rest): …`. No `Co-Authored-By` trailer.
- Verify with `npm test` and `npm run build` (which is `tsc && vite build`, so it is the typecheck too).

---

## Scope: Phase 5 only

Eight decisions, settled here so no task has to re-argue them.

### 1. The send path is the only writer

`send()` in `RestTab.tsx` records an entry when a response arrives and when one fails to. Nothing else writes history — not opening a tab, not pasting, not *Copy as cURL*. The history answers *what did I send and what came back*, and only one function in this module can answer that.

Unlike `queryHistory.ts`, **repeats are not collapsed.** The same query run twice is one question asked twice; the same request sent twice is two answers, and the second one differing from the first is usually the whole reason it was sent again.

### 2. A cancelled send is not recorded

Timeouts and connection failures are recorded — they are answers, and they are what the `error` field exists for. A cancel is not: nothing came back, nothing was learned, and an entry with neither a status nor an error would be a blank row nobody could read. The spec already treats cancelling as not-an-error in the response pane (§6); this is the same stance in the file.

### 3. The URL is stored resolved, except for secret variables — and the Auth tab never reaches it

What goes in `url` is `resolveRequest(request, historyVars(env))` folded through `urlWithParams`: every ordinary variable replaced, every variable marked secret left standing in its braces. A month later the entry says which host, which path and which page number; it does not say what the token was.

Two things are deliberately **not** in that string:

- **`sendState.sentUrl`.** That is the real URL, secrets and all, and writing it to disk would undo the whole of Phase 4's split.
- **The Auth tab's query key.** `buildRequest` folds an `apiKey` with `in: "query"` into the URL, and its value is a credential whether it came from a variable or was typed in by hand. The history is built from the request's own params only, so that fold never happens here.

### 4. A body is kept whole or not at all

`responseBody` holds `response.body_base64` when the real body is at most `BODY_MAX_BYTES` (256 KB), and `null` above it. Not the first 256 KB: half a JSON document is not a document, and the entry already carries `size`, which is the honest answer to how big it was.

The dialog tells the two silences apart without a new field — `size > BODY_MAX_BYTES` means it was too big, anything else means it was not kept.

### 5. Turning the switch off deletes what is already kept

*Keep response bodies* defaults on. Turning it off calls `dropHistoryBodies()`, which rewrites every entry with `responseBody: null` — it does not merely stop recording new ones. A privacy switch that leaves the old data on disk is a lie, and the spec (§2) says so in as many words.

Clearing the whole history is a separate button, and it is the only thing that removes entries.

### 6. The entry keeps the request's id, and "gone" is decided when it is read

`requestId` is written as the request's id and never rewritten. Deleting a request does not go back through `rest-history.json` — the dialog looks the id up in the request list and, when it is not there, says the request has been deleted instead of offering to open it. The field's type stays `string | null` because a file written by a later version may hold null, and reading one is free.

### 7. The three send settings live in `rest-workspace.json`, beside the furniture

The spec's §2 puts them there — *"`lastEnvId`, `sidebarWidth`, `splitRatio`, và các thiết lập ở mục 6"* — and that file is already loaded once, shared by every REST tab and written through a store. A second file for four values would be a second thing to load and a second thing to keep in step.

`PHASE_ONE_SETTINGS` is renamed `DEFAULT_SEND_SETTINGS` rather than deleted. It is still needed in two places: it seeds the workspace defaults, and `toCurl` builds a wire request to print, for which a timeout means nothing. Renaming it says what it now is; deleting it would push a made-up settings object into `parsePaste.ts`.

### 8. Two files for the history, not one

The spec's §1 lists `history.ts` alone. This plan splits it the way the module has split everything else: `history.ts` is pure and tested, `historyStore.ts` is the `Store` plumbing and the hook. That is the `requests.ts` / `requestsStore.ts` and `environments.ts` / `environmentsStore.ts` shape, and it is what keeps the cap, the masking rule and the body rule inside `npm test`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/modules/rest/history.ts` | **New.** `HistoryEntry`, `MAX_ENTRIES`, `BODY_MAX_BYTES`, `withEntry`, `withoutEntry`, `withoutBodies`, `keptBody`, `historyUrl`. Pure. |
| `src/modules/rest/history.test.ts` | **New.** The cap, forgetting one, dropping every body, when a body is kept, what a stored URL does and does not contain. |
| `src/modules/rest/historyStore.ts` | **New.** `rest-history.json`: read once, written through, shared by every REST tab. |
| `src/modules/rest/environments.ts` | `historyVars` — the map the history is written with: every ordinary variable, no secret one. |
| `src/modules/rest/environments.test.ts` | What `historyVars` leaves alone. |
| `src/modules/rest/workspace.ts` | Four more fields, `sendSettings`, `updateWorkspace`, `currentWorkspace`, `clampTimeoutSeconds`. |
| `src/modules/rest/workspace.test.ts` | **New.** `clampTimeoutSeconds` and `sendSettings`. |
| `src/modules/rest/buildRequest.ts` | `PHASE_ONE_SETTINGS` becomes `DEFAULT_SEND_SETTINGS`. |
| `src/modules/rest/RestTab.tsx` | Records each send, sends with the settings from the workspace, opens the dialog. |
| `src/modules/rest/shortcuts.ts` | `rest.history` — `Ctrl/Cmd+H`. |
| `src/modules/rest/components/HistoryDialog/` | **New folder.** The list, the filter, one entry expanded, and the way back to the request. |
| `src/modules/rest/components/RequestList/RequestList.tsx` | One button in the header, and the prop behind it. |
| `src/modules/rest/components/RestSettings/` | **New folder.** The module's pane in the app's Settings dialog. |
| `src/modules/rest/index.ts` | `settings:` on the `ModuleDefinition`. |
| `src/modules/rest/i18n/en.ts`, `vi.ts` | The history and settings strings. |
| `CHANGELOG.md` | One line under `## [Unreleased]` -> `### Added`. |

---

### Task 1: What an entry is, and what may go in it

Everything this phase could get wrong about privacy and about size, in one file with no React in it. Nothing is stored yet and nothing is drawn yet.

**Files:**
- Create: `src/modules/rest/history.ts`
- Test: `src/modules/rest/history.test.ts`
- Modify: `src/modules/rest/environments.ts`
- Test: `src/modules/rest/environments.test.ts`

**Interfaces:**
- Consumes: `resolveRequest` (`resolveRequest.ts`), `urlWithParams` (`syncUrlParams.ts`), `Method` / `RestRequest` (`types.ts`), `Environment` (`environments.ts`).
- Produces: `HistoryEntry`, `MAX_ENTRIES`, `BODY_MAX_BYTES`, `withEntry(list, entry)`, `withoutEntry(list, id)`, `withoutBodies(list)`, `keptBody(base64, size, keep)`, `historyUrl(request, vars)`, and `historyVars(env)`.

- [ ] **Step 1: Write the failing tests**

`src/modules/rest/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BODY_MAX_BYTES,
  MAX_ENTRIES,
  historyUrl,
  keptBody,
  withEntry,
  withoutBodies,
  withoutEntry,
  type HistoryEntry,
} from "./history";
import { historyVars } from "./environments";
import { newRequest } from "./requests";

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "e1",
    requestId: "r1",
    envName: "Dev",
    method: "GET",
    url: "https://example.com/",
    startedAt: 1,
    durationMs: 10,
    status: 200,
    statusText: "OK",
    size: 12,
    error: null,
    responseBody: null,
    ...over,
  };
}

describe("withEntry", () => {
  it("puts the newest at the front", () => {
    const list = withEntry([entry({ id: "old" })], entry({ id: "new" }));
    expect(list.map((e) => e.id)).toEqual(["new", "old"]);
  });

  it("keeps a repeat of the same request, because the answer may differ", () => {
    const list = withEntry([entry({ id: "a" })], entry({ id: "b" }));
    expect(list).toHaveLength(2);
  });

  it("caps the list", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES + 5; i++) list = withEntry(list, entry({ id: `e${i}` }));
    expect(list).toHaveLength(MAX_ENTRIES);
    expect(list[0].id).toBe(`e${MAX_ENTRIES + 4}`);
  });
});

describe("withoutEntry", () => {
  it("forgets one by id", () => {
    const list = withoutEntry([entry({ id: "a" }), entry({ id: "b" })], "a");
    expect(list.map((e) => e.id)).toEqual(["b"]);
  });
});

describe("withoutBodies", () => {
  it("drops every stored body", () => {
    const list = withoutBodies([entry({ responseBody: "e30=" }), entry({ id: "b" })]);
    expect(list.every((e) => e.responseBody === null)).toBe(true);
  });

  it("returns the same list when there was nothing to drop", () => {
    const list = [entry()];
    expect(withoutBodies(list)).toBe(list);
  });
});

describe("keptBody", () => {
  it("keeps a body within the ceiling", () => {
    expect(keptBody("e30=", 4, true)).toBe("e30=");
  });

  it("keeps nothing when the switch is off", () => {
    expect(keptBody("e30=", 4, false)).toBeNull();
  });

  it("keeps nothing above the ceiling", () => {
    expect(keptBody("e30=", BODY_MAX_BYTES + 1, true)).toBeNull();
  });
});

describe("historyUrl", () => {
  const request = {
    ...newRequest("r1", 0),
    url: "https://{{host}}/users",
    params: [
      { id: "p1", enabled: true, key: "page", value: "{{page}}" },
      { id: "p2", enabled: false, key: "debug", value: "1" },
    ],
    auth: { kind: "apiKey", name: "key", value: "literal-secret", in: "query" } as const,
  };

  it("resolves the ordinary variables", () => {
    expect(historyUrl(request, { host: "api.example.com", page: "2" })).toBe(
      "https://api.example.com/users?page=2",
    );
  });

  it("leaves a secret variable in its braces", () => {
    const env = {
      id: "1",
      name: "Dev",
      vars: [
        { name: "host", value: "api.example.com", secret: false },
        { name: "page", value: "2", secret: true },
      ],
    };
    expect(historyUrl(request, historyVars(env))).toContain("%7B%7Bpage%7D%7D");
  });

  it("never carries the Auth tab's query key", () => {
    expect(historyUrl(request, { host: "api.example.com", page: "2" })).not.toContain(
      "literal-secret",
    );
  });

  it("leaves everything in its braces with no environment", () => {
    expect(historyUrl(request, null)).toContain("{{host}}");
  });
});
```

Add to `src/modules/rest/environments.test.ts` — and add `historyVars` to what that file already imports from `./environments`:

```ts
describe("historyVars", () => {
  const env = {
    id: "1",
    name: "Dev",
    vars: [
      { name: "host", value: "api.example.com", secret: false },
      { name: "token", value: "s3cret", secret: true },
      { name: "", value: "ignored", secret: false },
    ],
  };

  it("holds the ordinary variables and no secret one", () => {
    expect(historyVars(env)).toEqual({ host: "api.example.com" });
  });

  it("is null with no environment, so nothing is resolved at all", () => {
    expect(historyVars(null)).toBeNull();
  });

  it("lets the first row of a name decide, exactly as varMap does", () => {
    const twice = {
      ...env,
      vars: [
        { name: "host", value: "first", secret: false },
        { name: "host", value: "second", secret: true },
      ],
    };
    expect(historyVars(twice)).toEqual({ host: "first" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/modules/rest/history.test.ts src/modules/rest/environments.test.ts`
Expected: FAIL — `./history` cannot be resolved, `historyVars` is not exported.

- [ ] **Step 3: Write the implementation**

`src/modules/rest/history.ts`:

```ts
import { resolveRequest } from "./resolveRequest";
import { urlWithParams } from "./syncUrlParams";
import type { Method, RestRequest } from "./types";

/**
 * What was sent, and what came back — the pure half of it.
 *
 * The file this shapes is read a week later by somebody asking why a call failed, which settles two
 * things about what may go in it. A **secret variable is left in its braces**: the entry says which
 * host and which path without saying what the token was. And a **body is kept whole or not at
 * all**, because half a JSON document answers nothing and `size` already says how big it really
 * was.
 */

export interface HistoryEntry {
  id: string;
  /** The request it was sent from. Never rewritten — a request deleted later is noticed when the
   *  entry is read, rather than by going back through the file. Null is tolerated on the way in,
   *  for a file written by a version that recorded a send with no request behind it. */
  requestId: string | null;
  /** The environment's name as it was then, so the entry still reads right after a rename. */
  envName: string;
  method: Method;
  /** Resolved, except for the variables marked secret. See {@link historyUrl}. */
  url: string;
  startedAt: number;
  durationMs: number;
  /** Null when no response arrived at all — a timeout, a refused connection, a rejected
   *  certificate. Those are answers, and they are what `error` is for. */
  status: number | null;
  statusText: string;
  /** The body's real length, including anything the 16 MB ceiling cut. */
  size: number;
  /** Already translated, the same way the response pane's banner is. */
  error: string | null;
  /** Base64, at most {@link BODY_MAX_BYTES}, and null whenever the switch is off. */
  responseBody: string | null;
}

/** How many sends are kept. A day's work several times over, and small enough that the file stays
 *  something the app reads once without thinking about it. */
export const MAX_ENTRIES = 100;

/** How big a body may be and still be worth keeping a hundred of. */
export const BODY_MAX_BYTES = 256 * 1024;

/**
 * The list with this send at the front.
 *
 * Nothing is collapsed. `queryHistory` folds a script run twice in a row into one entry because the
 * question was asked twice; a request sent twice is two answers, and the second one differing from
 * the first is usually why it was sent again.
 */
export function withEntry(list: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...list].slice(0, MAX_ENTRIES);
}

export function withoutEntry(list: HistoryEntry[], id: string): HistoryEntry[] {
  return list.filter((entry) => entry.id !== id);
}

/** Every entry with its body forgotten. The same array when none had one, so turning the switch off
 *  where there was nothing to forget writes nothing. */
export function withoutBodies(list: HistoryEntry[]): HistoryEntry[] {
  if (!list.some((entry) => entry.responseBody !== null)) return list;
  return list.map((entry) =>
    entry.responseBody === null ? entry : { ...entry, responseBody: null },
  );
}

/** What goes in `responseBody`: the body, or nothing at all. */
export function keptBody(base64: string | null, size: number, keep: boolean): string | null {
  if (!keep || base64 === null || size > BODY_MAX_BYTES) return null;
  return base64;
}

/**
 * The URL as the file remembers it.
 *
 * Built from the request rather than from what was actually sent, and that is the point: the sent
 * URL carries the secrets, and the Auth tab's query key — a credential whether it came from a
 * variable or was typed in by hand — is folded in by `buildRequest` and so never reaches this
 * string.
 */
export function historyUrl(request: RestRequest, vars: Record<string, string> | null): string {
  const { request: resolved } = resolveRequest(request, vars);
  return urlWithParams(resolved.url, resolved.params);
}
```

Add to `src/modules/rest/environments.ts`, below `previewVars`:

```ts
/**
 * The map the history is written with: every ordinary variable, and no secret one.
 *
 * A name that is not in the map is left standing in its braces, so `Bearer {{token}}` reads as
 * `Bearer {{token}}` a week later — which says what was sent without saying what the token was.
 * Written as its own loop rather than through `map` so that the first row of a name still decides,
 * exactly as `varMap` has it: a name claimed by a secret row is claimed, not skipped over.
 */
export function historyVars(env: Environment | null): Record<string, string> | null {
  if (env === null) return null;
  const out: Record<string, string> = {};
  const claimed = new Set<string>();
  for (const variable of env.vars) {
    if (variable.name === "" || claimed.has(variable.name)) continue;
    claimed.add(variable.name);
    if (!variable.secret) out[variable.name] = variable.value;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/rest/history.test.ts src/modules/rest/environments.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/rest/history.ts src/modules/rest/history.test.ts src/modules/rest/environments.ts src/modules/rest/environments.test.ts
git commit -m "feat(rest): decide what a history entry may hold"
```

---

### Task 2: The file it lives in

`rest-history.json`, read once and shared by every REST tab. The same shape as `queryHistory.ts`, including the part that matters most: **the file is read before the first entry is added**, or a send recorded early in a session would be written as the whole history and every earlier session would be gone.

**Files:**
- Create: `src/modules/rest/historyStore.ts`

**Interfaces:**
- Consumes: `HistoryEntry`, `withEntry`, `withoutEntry`, `withoutBodies` (Task 1).
- Produces: `useHistory()`, `recordSend(entry)`, `forgetEntry(id)`, `clearHistory()`, `dropHistoryBodies()`.

- [ ] **Step 1: Write the store**

`src/modules/rest/historyStore.ts`:

```ts
import { useEffect, useSyncExternalStore } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { withEntry, withoutBodies, withoutEntry, type HistoryEntry } from "./history";

/**
 * Everything this app has sent, newest first, shared by every REST tab.
 *
 * Written on every send and read only when the dialog is opened — which is usually much later in a
 * session. That gap is why {@link recordSend} waits for the file: an entry added to an empty list
 * and written back would be the whole history, and every earlier session would be gone.
 */

const FILE = "rest-history.json";
const KEY = "entries";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(FILE);
  return storePromise;
}

let snapshot: HistoryEntry[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** The list every reader sees from now on. Says nothing about whether the file has been read — only
 *  {@link publish} may claim that. */
function remember(list: HistoryEntry[]) {
  snapshot = list;
  for (const listener of listeners) listener();
}

function publish(list: HistoryEntry[]) {
  loaded = true;
  remember(list);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = getStore()
      .then(async (store) => publish((await store.get<HistoryEntry[]>(KEY)) ?? []))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Failures are swallowed: a history that could not be written is not worth interrupting anyone's
 *  work over, and it is still right in memory. */
function persist(list: HistoryEntry[]): void {
  void getStore()
    .then(async (store) => {
      await store.set(KEY, list);
      await store.save();
    })
    .catch(() => {});
}

export function useHistory(): HistoryEntry[] {
  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Adds a send to the front of the list, once the file it belongs at the front of has been read. */
export function recordSend(entry: HistoryEntry): void {
  void ensureLoaded().then(
    () => {
      const list = withEntry(snapshot, entry);
      publish(list);
      persist(list);
    },
    // The file could not be read. The send is still worth showing for the rest of the session, but
    // nothing is written back: what is on disk is unknown, and writing over it would lose it.
    () => remember(withEntry(snapshot, entry)),
  );
}

export function forgetEntry(id: string): void {
  void ensureLoaded().then(() => {
    const list = withoutEntry(snapshot, id);
    publish(list);
    persist(list);
  }, () => {});
}

export function clearHistory(): void {
  void ensureLoaded().then(() => {
    publish([]);
    persist([]);
  }, () => {});
}

/**
 * Forgets every stored body, keeping the entries themselves.
 *
 * What turning *Keep response bodies* off does. Stopping there and only refusing new ones would not
 * be enough: a switch about privacy that leaves what it already wrote sitting on disk is a lie.
 */
export function dropHistoryBodies(): void {
  void ensureLoaded().then(() => {
    const list = withoutBodies(snapshot);
    if (list === snapshot) return;
    publish(list);
    persist(list);
  }, () => {});
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: PASS — nothing imports the store yet, so this only proves it compiles.

- [ ] **Step 3: Commit**

```bash
git add src/modules/rest/historyStore.ts
git commit -m "feat(rest): keep the send history in a file of its own"
```

---

### Task 3: The send settings come from the workspace

The wire contract has carried `timeout_ms`, `follow_redirects` and `accept_invalid_certs` since Phase 1, hard-coded behind a constant named after that phase. Nothing about a request changes here — only where the three values are read from, and the fourth switch the history needs.

**Files:**
- Modify: `src/modules/rest/buildRequest.ts`
- Modify: `src/modules/rest/parsePaste.ts`, `src/modules/rest/buildRequest.test.ts`, `src/modules/rest/parsePaste.test.ts` (the rename)
- Modify: `src/modules/rest/workspace.ts`
- Test: `src/modules/rest/workspace.test.ts`
- Modify: `src/modules/rest/RestTab.tsx`

**Interfaces:**
- Consumes: `SendSettings` (`buildRequest.ts`).
- Produces: `DEFAULT_SEND_SETTINGS`; and from `workspace.ts`, a `Workspace` with `keepResponseBodies`, `timeoutMs`, `followRedirects`, `acceptInvalidCerts`, plus `sendSettings(workspace)`, `updateWorkspace(patch)`, `currentWorkspace()`, `clampTimeoutSeconds(seconds)`, `MIN_TIMEOUT_SECONDS`, `MAX_TIMEOUT_SECONDS`.

- [ ] **Step 1: Write the failing test**

`src/modules/rest/workspace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SEND_SETTINGS } from "./buildRequest";
import {
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  clampTimeoutSeconds,
  sendSettings,
  type Workspace,
} from "./workspace";

const workspace: Workspace = {
  sidebarWidth: 260,
  splitRatio: 0.5,
  lastEnvId: null,
  keepResponseBodies: true,
  timeoutMs: 5_000,
  followRedirects: false,
  acceptInvalidCerts: true,
};

describe("clampTimeoutSeconds", () => {
  it("keeps a sensible number", () => {
    expect(clampTimeoutSeconds(45)).toBe(45);
  });

  it("never allows a timeout of nothing", () => {
    expect(clampTimeoutSeconds(0)).toBe(MIN_TIMEOUT_SECONDS);
    expect(clampTimeoutSeconds(-10)).toBe(MIN_TIMEOUT_SECONDS);
  });

  it("has a ceiling", () => {
    expect(clampTimeoutSeconds(99_999)).toBe(MAX_TIMEOUT_SECONDS);
  });

  it("falls back to the default when the box is empty", () => {
    expect(clampTimeoutSeconds(Number.NaN)).toBe(DEFAULT_SEND_SETTINGS.timeoutMs / 1000);
  });
});

describe("sendSettings", () => {
  it("takes only the three the wire asks for", () => {
    expect(sendSettings(workspace)).toEqual({
      timeoutMs: 5_000,
      followRedirects: false,
      acceptInvalidCerts: true,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/rest/workspace.test.ts`
Expected: FAIL — `DEFAULT_SEND_SETTINGS`, `clampTimeoutSeconds` and `sendSettings` do not exist.

- [ ] **Step 3: Rename the constant**

In `src/modules/rest/buildRequest.ts`, replace the `PHASE_ONE_SETTINGS` declaration with:

```ts
/** What the workspace file starts from, and what `toCurl` builds with — a printed cURL command
 *  carries no timeout of its own, so the default is the honest thing to build it under. */
export const DEFAULT_SEND_SETTINGS: SendSettings = {
  timeoutMs: 30_000,
  followRedirects: true,
  acceptInvalidCerts: false,
};
```

and drop the stale line in that file's header comment saying Phase 4 will put `interpolate` in front of it — Phase 4 did.

Rename every use: `src/modules/rest/parsePaste.ts` (the import and the `toCurl` call), `src/modules/rest/buildRequest.test.ts`, `src/modules/rest/parsePaste.test.ts`, `src/modules/rest/RestTab.tsx`.

```bash
grep -rn "PHASE_ONE_SETTINGS" src
```
Expected after the edits: nothing.

- [ ] **Step 4: Widen the workspace**

In `src/modules/rest/workspace.ts`, add the import:

```ts
import { DEFAULT_SEND_SETTINGS, type SendSettings } from "./buildRequest";
```

Extend the interface — and replace the header comment's *"Phase 5 adds the send settings here"* with a sentence saying they are here now:

```ts
export interface Workspace {
  sidebarWidth: number;
  /** The request pane's share of the width between the two. */
  splitRatio: number;
  /** Only a seed. A REST tab reads this once, when this file first arrives, and writes it whenever
   *  its own choice changes — but it never reads it again, because a second tab moving to prod is
   *  not this tab moving with it. */
  lastEnvId: string | null;
  /** Whether a response body is kept with its history entry. Turning it off also forgets the ones
   *  already kept — see `dropHistoryBodies`. */
  keepResponseBodies: boolean;
  timeoutMs: number;
  followRedirects: boolean;
  /** Off. Turning it on stops the client checking any server's certificate, on every request. */
  acceptInvalidCerts: boolean;
}

/** A timeout of nothing is a request that always fails, and one of a day is a tab that never comes
 *  back. Both ends belong to the box, not to the wire. */
export const MIN_TIMEOUT_SECONDS = 1;
export const MAX_TIMEOUT_SECONDS = 600;

export function clampTimeoutSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_SEND_SETTINGS.timeoutMs / 1000;
  return Math.min(MAX_TIMEOUT_SECONDS, Math.max(MIN_TIMEOUT_SECONDS, Math.round(seconds)));
}

/** The three the wire asks for, out of the seven kept here. */
export function sendSettings(workspace: Workspace): SendSettings {
  return {
    timeoutMs: workspace.timeoutMs,
    followRedirects: workspace.followRedirects,
    acceptInvalidCerts: workspace.acceptInvalidCerts,
  };
}
```

Extend `DEFAULTS`:

```ts
const DEFAULTS: Workspace = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  splitRatio: DEFAULT_SPLIT_RATIO,
  lastEnvId: null,
  keepResponseBodies: true,
  ...DEFAULT_SEND_SETTINGS,
};
```

And add, beside the existing setters:

```ts
/** What the store holds now, for a caller that is not a component — the send path, which reads the
 *  settings as they stand rather than as they were when its handler was made. */
export function currentWorkspace(): Workspace {
  return snapshot;
}

/** A settings change. One entry point rather than a setter each: the Settings pane changes one
 *  field at a time and none of them needs anything the others do not. */
export function updateWorkspace(patch: Partial<Workspace>): void {
  write({ ...snapshot, ...patch });
}
```

- [ ] **Step 5: Send with them**

In `src/modules/rest/RestTab.tsx`, import `sendSettings` from `./workspace` and build with it:

```ts
const wire = buildRequest(resolved.request, sendId, sendSettings(workspace));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/rest
git commit -m "refactor(rest): read the send settings from the workspace file"
```

---

### Task 4: Every send is recorded

The entry is written where the send happens and nowhere else. Nothing is drawn yet — the file fills up, and Task 5 opens it.

**Files:**
- Modify: `src/modules/rest/RestTab.tsx`

**Interfaces:**
- Consumes: `historyUrl`, `keptBody`, `HistoryEntry` (Task 1); `recordSend` (Task 2); `historyVars` (Task 1); `currentWorkspace` (Task 3).

- [ ] **Step 1: Record both outcomes**

In `src/modules/rest/RestTab.tsx`, add the imports:

```ts
import { historyUrl, keptBody, type HistoryEntry } from "./history";
import { recordSend } from "./historyStore";
```

and add `historyVars` to what is already imported from `./environments`.

In `send()`, after `const wire = …`, mint the half of the entry both outcomes share:

```ts
    const startedAt = Date.now();
    /* Built from the request, not from `wire`: the URL on the wire carries the secrets, and the
       Auth tab's query key is a credential whichever way it was typed. */
    const stub = {
      id: crypto.randomUUID(),
      requestId: request.id,
      envName: env?.name ?? "",
      method: request.method,
      url: historyUrl(request, historyVars(env)),
      startedAt,
    } satisfies Partial<HistoryEntry>;
```

In the `try`, after the `setSends` that publishes the response:

```ts
      recordSend({
        ...stub,
        durationMs: Date.now() - startedAt,
        status: response.status,
        statusText: response.status_text,
        size: response.body_size,
        error: null,
        responseBody: keptBody(
          response.body_base64,
          response.body_size,
          currentWorkspace().keepResponseBodies,
        ),
      });
```

`currentWorkspace()` rather than the `workspace` already in scope: this reads the switch as it stands when the response lands, which may be a minute after the send began.

In the `catch`, hoist the banner's message to a `const message = errorMessage(t, e)` so it is not computed twice, use it in the `setSends` that is already there, and add below it:

```ts
      /* A cancelled send is not recorded: nothing came back and nothing was learned, and an entry
         with neither a status nor an error would be a blank row nobody could read. A timeout or a
         refused connection is an answer, and is kept. */
      if (!cancelled) {
        recordSend({
          ...stub,
          durationMs: Date.now() - startedAt,
          status: null,
          statusText: "",
          size: 0,
          error: message,
          responseBody: null,
        });
      }
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Check it by hand**

Run `npm run dev:app`, send two requests — one that works, one to a host that does not exist — then look at `rest-history.json` in the app's data directory. Expected: two entries, newest first; the failed one with `status: null` and a message in `error`; a secret variable still in its braces in `url`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/rest/RestTab.tsx
git commit -m "feat(rest): remember every request that was sent"
```

---

### Task 5: The history dialog

What the file is for. Opened from the sidebar header or with `Ctrl/Cmd+H`, and closed as soon as the entry being looked for is found.

**Files:**
- Create: `src/modules/rest/components/HistoryDialog/HistoryDialog.tsx`
- Create: `src/modules/rest/components/HistoryDialog/HistoryDialog.module.css`
- Create: `src/modules/rest/components/HistoryDialog/index.ts`
- Modify: `src/modules/rest/components/RequestList/RequestList.tsx`, `RequestList.module.css`
- Modify: `src/modules/rest/shortcuts.ts`, `src/modules/rest/RestTab.tsx`
- Modify: `src/modules/rest/i18n/en.ts`, `src/modules/rest/i18n/vi.ts`

**Interfaces:**
- Consumes: `useHistory`, `forgetEntry`, `clearHistory` (Task 2); `HistoryEntry`, `BODY_MAX_BYTES` (Task 1); `decodeBase64` (`api.ts`); `detectBody` (`contentType.ts`); `formatBytes`, `prettyJson` (`format.ts`); `useRequestLists` (`requestsStore.ts`), `findRequest` (`requests.ts`); `useDialogExit` (`components/dialogMotion.ts`).
- Produces: `HistoryDialog` with props `{ onOpenRequest: (id: string) => void; onClose: () => void }`; `RequestList` gains `onHistory: () => void`; the shortcut id `rest.history`.

- [ ] **Step 1: The strings**

Add to the `rest` group of `src/modules/rest/i18n/en.ts`, after the sidebar-menu block:

```ts
    // History
    historyTitle: "History",
    historyOpen: "History",
    historyFilter: "Filter by URL",
    historyEmpty: "Nothing has been sent yet.",
    historyNoMatch: "Nothing matches that.",
    historyClear: "Clear",
    historyClearConfirm: "Clear it all?",
    historyDrop: "Forget this one",
    historyDropConfirm: "Forget it?",
    historyFailed: "Failed",
    historyOpenRequest: "Open the request",
    historyRequestGone: "The request this was sent from has been deleted.",
    historyNoBody: "The response body was not kept.",
    historyBodyTooBig: "The response was over {{limit}}, so the body was not kept.",
    duration: "{{ms}} ms",
```

and the same keys in `vi.ts`:

```ts
    historyTitle: "Lịch sử",
    historyOpen: "Lịch sử",
    historyFilter: "Lọc theo URL",
    historyEmpty: "Chưa gửi gì.",
    historyNoMatch: "Không có gì khớp.",
    historyClear: "Xoá hết",
    historyClearConfirm: "Xoá sạch?",
    historyDrop: "Quên mục này",
    historyDropConfirm: "Quên?",
    historyFailed: "Hỏng",
    historyOpenRequest: "Mở request",
    historyRequestGone: "Request gửi mục này đã bị xoá.",
    historyNoBody: "Không giữ nội dung response.",
    historyBodyTooBig: "Response lớn hơn {{limit}} nên không giữ nội dung.",
    duration: "{{ms}} ms",
```

Add the shortcut label to both, beside the three already there:

```ts
    shortcutHistory: "Open the history",
```
```ts
    shortcutHistory: "Mở lịch sử",
```

- [ ] **Step 2: The chord**

In `src/modules/rest/shortcuts.ts`, add to `defs`:

```ts
      { id: "rest.history", chord: { key: "h" }, labelKey: "rest.shortcutHistory" },
```

- [ ] **Step 3: The dialog**

`src/modules/rest/components/HistoryDialog/HistoryDialog.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import { useDialogExit } from "../../../../components/dialogMotion";
import { CloseIcon, TrashIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { decodeBase64 } from "../../api";
import { detectBody } from "../../contentType";
import { formatBytes, prettyJson } from "../../format";
import { BODY_MAX_BYTES, type HistoryEntry } from "../../history";
import { clearHistory, forgetEntry, useHistory } from "../../historyStore";
import { findRequest } from "../../requests";
import { useRequestLists } from "../../requestsStore";
import styles from "./HistoryDialog.module.css";

interface Props {
  /** Opens the request an entry was sent from. The dialog closes itself on the way. */
  onOpenRequest: (id: string) => void;
  onClose: () => void;
}

/** The class of a status code, which is all its colour is about. */
function statusClass(status: number): string {
  if (status >= 500) return styles.s5xx;
  if (status >= 400) return styles.s4xx;
  if (status >= 300) return styles.s3xx;
  return styles.s2xx;
}

/**
 * Everything this app has sent, newest first.
 *
 * A list rather than a pane down the side: it is opened to find one send, and it closes as soon as
 * that send is found. One entry is open at a time — the body underneath is the expensive part to
 * decode and the only part worth scrolling.
 *
 * The stored body is decoded and sniffed here rather than kept as text: the file holds base64
 * exactly as it came off the wire, and what it is — JSON, HTML, a PNG — is `detectBody`'s question,
 * asked from the bytes alone because the headers were never stored.
 */
function HistoryDialog({ onOpenRequest, onClose }: Props) {
  const { t, lang } = useTranslation();
  const history = useHistory();
  const lists = useRequestLists();
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
  const { close, cls } = useDialogExit();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close(onClose);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, onClose]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return history;
    return history.filter(
      (entry) => entry.url.toLowerCase().includes(needle) || entry.method.toLowerCase() === needle,
    );
  }, [history, filter]);

  const when = useMemo(
    () => new Intl.DateTimeFormat(lang, { dateStyle: "short", timeStyle: "medium" }),
    [lang],
  );

  /** The stored body as something to put on screen, or the reason there is nothing. */
  function body(entry: HistoryEntry) {
    if (entry.responseBody === null) {
      return (
        <p className={`${styles.note} muted`}>
          {entry.size > BODY_MAX_BYTES
            ? t("rest.historyBodyTooBig", { limit: formatBytes(BODY_MAX_BYTES) })
            : t("rest.historyNoBody")}
        </p>
      );
    }
    const bytes = decodeBase64(entry.responseBody);
    const detected = detectBody([], bytes);
    if (detected.text === null) {
      return (
        <p className={`${styles.note} muted`}>
          {t("rest.binaryBody", { mime: detected.mime, size: formatBytes(bytes.length) })}
        </p>
      );
    }
    return (
      <pre className={styles.body}>
        {detected.kind === "json" ? prettyJson(detected.text) : detected.text}
      </pre>
    );
  }

  return createPortal(
    <>
      <div className={cls(styles.overlay)} onClick={() => close(onClose)} />
      <div
        className={cls(styles.dialog)}
        role="dialog"
        aria-modal="true"
        aria-label={t("rest.historyTitle")}
      >
        <div className={styles.header}>
          <h3 className={styles.title}>{t("rest.historyTitle")}</h3>
          <button
            type="button"
            className={styles.headerClose}
            onClick={() => close(onClose)}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <CloseIcon />
          </button>
        </div>

        <div className={styles.tools}>
          <Input
            size="small"
            value={filter}
            placeholder={t("rest.historyFilter")}
            aria-label={t("rest.historyFilter")}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          <Button
            size="small"
            disabled={history.length === 0}
            onClick={() => {
              setConfirmDrop(null);
              if (confirmClear) {
                clearHistory();
                setConfirmClear(false);
                return;
              }
              setConfirmClear(true);
            }}
          >
            <TrashIcon size="0.9em" />
            {/* Two presses rather than a dialog on top of a dialog: the button says what it is
                about to do, and a click anywhere else takes the offer back. */}
            {confirmClear ? t("rest.historyClearConfirm") : t("rest.historyClear")}
          </Button>
        </div>

        {shown.length === 0 ? (
          <p className={`${styles.note} muted`}>
            {history.length === 0 ? t("rest.historyEmpty") : t("rest.historyNoMatch")}
          </p>
        ) : (
          <ul
            className={styles.list}
            onMouseDown={() => {
              setConfirmClear(false);
              setConfirmDrop(null);
            }}
          >
            {shown.map((entry) => {
              const open = entry.id === openId;
              const source =
                entry.requestId === null ? undefined : findRequest(lists, entry.requestId);
              return (
                <li key={entry.id} className={styles.item}>
                  <div className={styles.row}>
                    <button
                      type="button"
                      className={styles.entry}
                      aria-expanded={open}
                      title={entry.url}
                      onClick={() => setOpenId(open ? null : entry.id)}
                    >
                      <span className={`rest-method rest-method-${entry.method}`}>
                        {entry.method}
                      </span>
                      <span className={styles.url}>{entry.url}</span>
                      <span className={styles.meta}>
                        <span>{when.format(entry.startedAt)}</span>
                        {entry.envName !== "" && <span>{entry.envName}</span>}
                        <span>{t("rest.duration", { ms: entry.durationMs })}</span>
                        {entry.status === null ? (
                          <span className={styles.failed}>{t("rest.historyFailed")}</span>
                        ) : (
                          <>
                            <span className={statusClass(entry.status)}>
                              {entry.status} {entry.statusText}
                            </span>
                            <span>{formatBytes(entry.size)}</span>
                          </>
                        )}
                      </span>
                    </button>
                    {/* One send forgotten, rather than the whole list — the same two-press arming
                        the query history uses, and for the same reason. */}
                    <button
                      type="button"
                      className={
                        confirmDrop === entry.id ? `${styles.drop} ${styles.dropArmed}` : styles.drop
                      }
                      title={
                        confirmDrop === entry.id
                          ? t("rest.historyDropConfirm")
                          : t("rest.historyDrop")
                      }
                      aria-label={t("rest.historyDrop")}
                      // The list disarms on mouse-down, which lands before this button's click and
                      // would clear the arming in time for the confirming press to miss it.
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => {
                        if (confirmDrop !== entry.id) {
                          setConfirmDrop(entry.id);
                          return;
                        }
                        setConfirmDrop(null);
                        forgetEntry(entry.id);
                      }}
                    >
                      <TrashIcon size="0.9em" />
                    </button>
                  </div>

                  {open && (
                    <div className={styles.detail}>
                      {entry.error === null ? (
                        body(entry)
                      ) : (
                        <p className={styles.error}>{entry.error}</p>
                      )}
                      {source === undefined ? (
                        <p className={`${styles.note} muted`}>{t("rest.historyRequestGone")}</p>
                      ) : (
                        <Button
                          size="small"
                          onClick={() => {
                            onOpenRequest(source.id);
                            close(onClose);
                          }}
                        >
                          {t("rest.historyOpenRequest")}
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>,
    document.body,
  );
}

export default HistoryDialog;
```

`src/modules/rest/components/HistoryDialog/index.ts`:

```ts
export { default } from "./HistoryDialog";
```

`HistoryDialog.module.css`: model the overlay, dialog, header, title and close button on `EnvironmentDialog.module.css` — same tokens, same paddings, and the same `composes`-free plain classes. `.list` is a scrolling column; `.entry` a flex column holding the method badge and URL on one line and `.meta` — small, muted, gapped — beneath; `.url` takes the remaining width with `overflow: hidden; text-overflow: ellipsis`. `.body` is a `pre` with `overflow: auto`, `max-height: 40vh` and the monospace token. `.s2xx`, `.s3xx`, `.s4xx`, `.s5xx` take the four colours from `ResponseStatusBar.module.css` — copied rather than shared, because four colours in a second CSS module is a smaller thing than a shared stylesheet neither component would own.

- [ ] **Step 4: The button in the sidebar**

In `src/modules/rest/components/RequestList/RequestList.tsx`, add `onHistory: () => void` to `Props` — documented as *"Opens the history dialog; the sidebar header is where the spec puts it"* — take it in the parameter list, import `HistoryIcon`, and put it beside New inside `.headerRow`:

```tsx
          <button
            type="button"
            className={styles.historyButton}
            onClick={onHistory}
            title={t("rest.historyOpen")}
            aria-label={t("rest.historyOpen")}
          >
            <HistoryIcon size="1em" />
          </button>
```

`.historyButton` in `RequestList.module.css`: the same shape as `.pin` — a bare icon button, muted, taking the accent on hover.

- [ ] **Step 5: Wire it into the tab**

In `src/modules/rest/RestTab.tsx`: import `HistoryDialog`, add `const [historyOpen, setHistoryOpen] = useState(false);`, pass `onHistory={() => setHistoryOpen(true)}` to `RequestList`, register the chord beside the other three:

```ts
  useShortcut("rest.history", () => setHistoryOpen(true), active);
```

and render it beside the environment dialog:

```tsx
      {historyOpen && (
        <HistoryDialog onOpenRequest={open} onClose={() => setHistoryOpen(false)} />
      )}
```

- [ ] **Step 6: Verify**

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run `npm run dev:app`: send a few requests, open the dialog from the sidebar button and with `Ctrl+H`, expand one and read the body, forget one, clear the lot, and open a request from an entry.

- [ ] **Step 7: Commit**

```bash
git add src/modules/rest
git commit -m "feat(rest): show what was sent in a history dialog"
```

---

### Task 6: The Settings pane

The module's own pane in the app's Settings dialog, through `ModuleDefinition.settings` — the mechanism the shell has had since the split and which only `db` has used so far.

**Files:**
- Create: `src/modules/rest/components/RestSettings/RestSettings.tsx`
- Create: `src/modules/rest/components/RestSettings/RestSettings.module.css`
- Create: `src/modules/rest/components/RestSettings/index.ts`
- Modify: `src/modules/rest/index.ts`
- Modify: `src/modules/rest/i18n/en.ts`, `src/modules/rest/i18n/vi.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `useWorkspace`, `updateWorkspace`, `clampTimeoutSeconds`, `MIN_TIMEOUT_SECONDS`, `MAX_TIMEOUT_SECONDS` (Task 3); `useHistory`, `clearHistory`, `dropHistoryBodies` (Task 2); `BODY_MAX_BYTES`, `MAX_ENTRIES` (Task 1); `formatBytes` (`format.ts`).
- Produces: `RestSettings`, a component taking no props — which is what `ModuleSettingsSection.Section` is typed as.

- [ ] **Step 1: The strings**

Add to `src/modules/rest/i18n/en.ts`:

```ts
    // Settings pane
    settingsTitle: "REST",
    settingsHistoryGroup: "History",
    settingsKeepBodies: "Keep response bodies",
    settingsKeepBodiesHint:
      "Bodies up to {{limit}} are kept with each entry. Turning this off also forgets the ones already kept.",
    settingsClearHistory: "Clear the history",
    settingsClearHistoryConfirm: "Clear it all?",
    settingsHistoryCount: "{{n}} of {{max}} kept",
    settingsSendGroup: "Sending",
    settingsTimeout: "Timeout",
    settingsTimeoutUnit: "seconds",
    settingsFollowRedirects: "Follow redirects",
    settingsInvalidCerts: "Accept self-signed certificates",
    settingsInvalidCertsHint:
      "Turns certificate checking off for every request — leave it off unless you know the server.",
    settingsGlobalHint: "These three apply to every request.",
```

and `vi.ts`:

```ts
    settingsTitle: "REST",
    settingsHistoryGroup: "Lịch sử",
    settingsKeepBodies: "Lưu nội dung response vào lịch sử",
    settingsKeepBodiesHint:
      "Giữ nội dung tới {{limit}} cho mỗi mục. Tắt đi thì xoá luôn phần đã lưu.",
    settingsClearHistory: "Xoá toàn bộ lịch sử",
    settingsClearHistoryConfirm: "Xoá sạch?",
    settingsHistoryCount: "Đang giữ {{n}}/{{max}}",
    settingsSendGroup: "Gửi",
    settingsTimeout: "Thời gian chờ",
    settingsTimeoutUnit: "giây",
    settingsFollowRedirects: "Đi theo redirect",
    settingsInvalidCerts: "Chấp nhận chứng chỉ tự ký",
    settingsInvalidCertsHint:
      "Tắt kiểm tra chứng chỉ cho mọi request — chỉ bật khi biết rõ máy chủ.",
    settingsGlobalHint: "Ba mục này áp cho mọi request.",
```

- [ ] **Step 2: The pane**

`src/modules/rest/components/RestSettings/RestSettings.tsx`:

```tsx
import { useState } from "react";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import { TrashIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { formatBytes } from "../../format";
import { BODY_MAX_BYTES, MAX_ENTRIES } from "../../history";
import { clearHistory, dropHistoryBodies, useHistory } from "../../historyStore";
import {
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  clampTimeoutSeconds,
  updateWorkspace,
  useWorkspace,
} from "../../workspace";
import styles from "./RestSettings.module.css";

/**
 * The REST module's pane in the app's Settings dialog.
 *
 * Every control writes through to `rest-workspace.json` as it is changed, so there is no Save
 * button here either. One of them is destructive on purpose: turning *Keep response bodies* off
 * forgets the bodies already kept, because a switch about privacy that leaves what it wrote on disk
 * is a lie. The line under it says so before it is pressed.
 */
function RestSettings() {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const history = useHistory();
  const [confirmClear, setConfirmClear] = useState(false);
  /** The box while it is being typed in, so a half-typed number is not clamped mid-keystroke. */
  const [seconds, setSeconds] = useState<string | null>(null);

  function commitTimeout(text: string) {
    updateWorkspace({ timeoutMs: clampTimeoutSeconds(Number(text)) * 1000 });
    setSeconds(null);
  }

  return (
    <>
      <div className={styles.group}>
        <span className={styles.groupLabel}>{t("rest.settingsHistoryGroup")}</span>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={workspace.keepResponseBodies}
            onChange={(e) => {
              updateWorkspace({ keepResponseBodies: e.target.checked });
              // Not merely "stop recording them" — see the note on the component.
              if (!e.target.checked) dropHistoryBodies();
            }}
          />
          <span>{t("rest.settingsKeepBodies")}</span>
        </label>
        <p className={`${styles.hint} muted`}>
          {t("rest.settingsKeepBodiesHint", { limit: formatBytes(BODY_MAX_BYTES) })}
        </p>

        <div className={styles.row}>
          <Button
            size="small"
            disabled={history.length === 0}
            onClick={() => {
              if (confirmClear) {
                clearHistory();
                setConfirmClear(false);
                return;
              }
              setConfirmClear(true);
            }}
            onBlur={() => setConfirmClear(false)}
          >
            <TrashIcon size="0.9em" />
            {confirmClear ? t("rest.settingsClearHistoryConfirm") : t("rest.settingsClearHistory")}
          </Button>
          <span className={`${styles.count} muted`}>
            {t("rest.settingsHistoryCount", { n: history.length, max: MAX_ENTRIES })}
          </span>
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>{t("rest.settingsSendGroup")}</span>

        <div className={styles.row}>
          <span className={styles.label}>{t("rest.settingsTimeout")}</span>
          <Input
            size="small"
            type="number"
            className={styles.number}
            min={MIN_TIMEOUT_SECONDS}
            max={MAX_TIMEOUT_SECONDS}
            value={seconds ?? String(workspace.timeoutMs / 1000)}
            aria-label={t("rest.settingsTimeout")}
            onChange={(e) => setSeconds(e.target.value)}
            onBlur={(e) => commitTimeout(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTimeout(e.currentTarget.value);
            }}
          />
          <span className="muted">{t("rest.settingsTimeoutUnit")}</span>
        </div>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={workspace.followRedirects}
            onChange={(e) => updateWorkspace({ followRedirects: e.target.checked })}
          />
          <span>{t("rest.settingsFollowRedirects")}</span>
        </label>

        <label className={styles.check}>
          <input
            type="checkbox"
            checked={workspace.acceptInvalidCerts}
            onChange={(e) => updateWorkspace({ acceptInvalidCerts: e.target.checked })}
          />
          <span>{t("rest.settingsInvalidCerts")}</span>
        </label>
        <p className={`${styles.hint} muted`}>{t("rest.settingsInvalidCertsHint")}</p>
        <p className={`${styles.hint} muted`}>{t("rest.settingsGlobalHint")}</p>
      </div>
    </>
  );
}

export default RestSettings;
```

`src/modules/rest/components/RestSettings/index.ts`:

```ts
export { default } from "./RestSettings";
```

`RestSettings.module.css`: model on `ToolsSection.module.css` — `.group` a column with a gap and a bottom margin, `.groupLabel` the small heading above it, `.row` a flex row with a gap and centred items, `.check` a flex row holding the box and its label, `.hint` small and muted with no top margin, `.number` about 5rem wide, `.label` a fixed first column so the two rows line up.

- [ ] **Step 3: Register it**

`src/modules/rest/index.ts`:

```ts
import type { ModuleDefinition } from "../../shell/module";
import { GlobeIcon } from "../../icons";
import RestTab from "./RestTab";
import RestSettings from "./components/RestSettings";
import { REST_SHORTCUTS } from "./shortcuts";

/** REST client: composing an HTTP request, sending it, and reading what came back. */
export const restModule: ModuleDefinition = {
  id: "rest",
  labelKey: "app.moduleRest",
  Icon: GlobeIcon,
  defaultTitleKey: "rest.newTabTitle",
  Tab: RestTab,
  settings: { labelKey: "rest.settingsTitle", Icon: GlobeIcon, Section: RestSettings },
  shortcuts: REST_SHORTCUTS,
};
```

- [ ] **Step 4: The changelog**

In `CHANGELOG.md`, under `## [Unreleased]` -> `### Added`, directly below the SSH tunnel line so the REST entries stay together, newest first:

```markdown
- The REST client keeps a history of everything it sent, and takes its timeout, redirect and certificate settings from a pane of its own.
```

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: PASS

Boundary greps, from [.agent/conventions/adding-a-module.md](../../../.agent/conventions/adding-a-module.md):

```powershell
Get-ChildItem -Recurse src/components,src/core,src/icons -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: nothing.

```powershell
Get-ChildItem -Recurse src/shell,src/i18n -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: only `src/shell/registry.ts` and `src/i18n/dicts.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/rest CHANGELOG.md
git commit -m "feat(rest): add the module's Settings pane"
```

---

## What no test can say

Open `npm run dev:app` and check by hand:

- **Two module panes in Settings.** `db` has been the only module contributing one; the shell's tab list and its panels are now built from two, which is the first time that loop has had more than one thing in it.
- **`Ctrl+H`** opens the history from a REST tab, does nothing from a db tab, and is listed under the REST scope in the shortcuts table in both languages.
- **The timeout is real.** Set it to 1 second, send to a deliberately slow endpoint (`https://httpbin.org/delay/5`), and expect the timeout banner rather than a response.
- **Redirects.** Turn *Follow redirects* off and send to `https://httpbin.org/redirect/1`: a `302` in the status bar rather than the page it points at.
- **Self-signed certificates.** `https://self-signed.badssl.com/` fails with the connection error, and succeeds with the switch on.
- **The privacy switch.** Send something, confirm the body is in the dialog, turn *Keep response bodies* off, and confirm the body is gone from the entry that already had it — gone from `rest-history.json` on disk, not just from the screen.
- **A body too big to keep.** Send to an endpoint returning more than 256 KB and confirm the entry says so rather than saying nothing was kept.
- **A deleted request.** Send one, delete it from the sidebar, and confirm its entry says the request has been deleted instead of offering to open it.
- **It survives a restart.** Close the app and reopen it: the history is there, and so is the timeout that was set.
