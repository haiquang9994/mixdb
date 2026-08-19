# REST Client Module — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A request can be written once and sent anywhere: `{{var}}` in its URL, tables, body and auth fields resolves against an environment picked at the end of the tab strip, values marked secret live in the OS credential store rather than on disk, and a request that asks for a variable the environment has not got does not go out at all.

**Architecture:** Three pure functions do the deciding and are the whole of the risk. `interpolate` turns one string into another and says which names it could not fill; `varMap` turns the chosen environment into what that function is given; `resolveRequest` runs the fold over a whole request and hands back a resolved copy plus the names still missing. Everything else is plumbing: an `environmentsStore` that splits an environment between `rest-environments.json` and the keyring the same way `savedConnections.ts` splits a connection, a dropdown, a dialog, and one preview line under the URL box. `buildRequest` is unchanged — the resolved request goes into it exactly as an unresolved one did. Rust is untouched.

**Tech Stack:** TypeScript (strict), React 19, CSS Modules, vitest, `@tauri-apps/plugin-store`, and the existing `secrets_save` / `secrets_load` / `secrets_delete` commands.

**Spec:** [docs/superpowers/specs/2026-08-18-rest-client-module-design.md](../specs/2026-08-18-rest-client-module-design.md) — §2 (`Environment`, the four files, secrets through the keyring), §3 (the interpolation rules and what blocks a send), §5 (the dropdown at the end of the tab strip), §7 (testing), scoped by §8's phase table: *"Environment: dropdown, dialog, nội suy, biến secret qua keyring"*.

**Earlier plans (the code this one builds on):** [phase 1](2026-08-18-rest-client-phase-1.md), [phase 2](2026-08-18-rest-client-phase-2.md), [phase 3](2026-08-20-rest-client-phase-3.md)

## Global Constraints

- **Pure logic is tested; components are not.** The repo has no jsdom and no component tests, and this phase does not add either. Everything that can be got wrong — what counts as a variable, what a missing one does, what a cycle does, which fields are resolved and which are left alone, what goes in the file and what goes in the keyring — is a pure function under `npm test`.
- **The module boundary holds.** No file outside `src/modules/rest/` learns an HTTP concept. Check with the two greps in [.agent/conventions/adding-a-module.md](../../../.agent/conventions/adding-a-module.md) before finishing.
- **Strings go in both dictionaries.** `src/modules/rest/i18n/en.ts` and `vi.ts`, groups flat, symbols written as escapes (`—`, `…`, `“`) while Vietnamese letters stay literal — match what is already in `vi.ts`. No literal English in JSX. See [.agent/conventions/i18n.md](../../../.agent/conventions/i18n.md).
- **Components live in their own folder** with `index.ts`, per [.agent/conventions/component-structure.md](../../../.agent/conventions/component-structure.md). New here: `EnvironmentSelect`, `EnvironmentDialog`, `UrlPreview` — all under `src/modules/rest/components/`.
- **No history, no Settings pane.** Those are Phase 5. `PHASE_ONE_SETTINGS` is still where the three send settings come from, and nothing writes `rest-history.json`.
- **No Rust.** `src-tauri/` is not touched. `WireRequest`, `WireBody` and `RestResponse` do not change, and no new command is added — the credential store is reached through the three commands `secrets.rs` has exported since the db module needed them.
- **No new dependency.**
- **Commits happen only when the user asks for one.** The user's standing instruction is that nothing is committed unprompted and one request authorises one commit. Each task's commit step gives the message to use *when* a commit is asked for; do not run it on your own initiative.
- Commit messages take a prefix and a scope: `feat(rest): …`, `refactor(rest): …`. No `Co-Authored-By` trailer.
- Verify with `npm test` and `npm run build` (which is `tsc && vite build`, so it is the typecheck too).

---

## Scope: Phase 4 only

Eight decisions, settled here so no task has to re-argue them.

### 1. Resolving happens between the request and `buildRequest`, and never lands in the store

`send()` today reads `activeRequest` and hands it to `buildRequest`. From this phase it reads `activeRequest`, puts it through `resolveRequest`, and hands *that* to `buildRequest`.

The resolved copy is a value that lives for the length of one send. **It is never written back.** `saveRequest({ ...request, lastUsedAt: Date.now() })` keeps using the original, because a request whose `{{token}}` had been replaced by a token would be a request that has lost the thing that made it portable — and, with a secret variable, a request that has just written a credential into `rest-requests.json`. This is the single most damaging thing this phase could get wrong, and it is one line.

### 2. The environment is the tab's, the last choice is the app's

Each REST tab holds its own `envId` in component state, so two tabs can sit side by side on dev and prod — that is what the spec asks for. `rest-workspace.json` gains `lastEnvId`, which is **only a seed**: a REST tab reads it once, when the workspace file first arrives, and writes it whenever its own choice changes. It is never read again after that first seed, because a second tab moving to prod is not this tab moving with it.

An `envId` naming an environment that has since been deleted resolves to None. Nothing has to clean up after a delete.

### 3. None means the text travels as text

With no environment chosen, `varMap` returns `null`, `resolveRequest` returns the request untouched, and nothing is blocked. `{{token}}` goes on the wire as those nine characters, exactly as it has since Phase 1. The preview line is not drawn either — it would only repeat the box above it.

The blocking rule only has meaning once an environment has been named: then a variable with no value is a mistake, and before then `{{` is a character somebody typed.

### 4. Nesting is resolved in the text, not in the variable map

`interpolate` runs the substitution repeatedly over the text — up to `MAX_PASSES` rounds — rather than resolving the environment's own values first and then doing one pass.

Resolving the map first is the tidier-looking option and it is wrong here: an environment holding `spare = {{unused}}` would then report `unused` as missing on every send, whether or not anything asked for `spare`. Running over the text keeps *missing* scoped to what the request actually reaches, which is the only scope that can honestly block a send.

Cost: a value that itself contains `{{x}}` **is** expanded again. That is what makes `baseUrl = https://{{host}}` work, and it is why the escape below has to survive between rounds.

### 5. Five rounds, and what happens at the sixth

`MAX_PASSES = 5`. Rounds run while a round still replaced something; the run is called cyclic when the ceiling is reached with a round still doing work. A chain five deep resolves and is *not* cyclic — the sixth round is the one that confirms nothing is left, and it is allowed.

A cyclic run blocks the send with its own message. The text is left mid-expansion; nobody sees it, because nothing is sent.

### 6. Parameter keys are resolved, where the spec's §3 says values

§3 lists what interpolation applies to as *"URL, giá trị params, cả key lẫn value của headers, …"* — header keys yes, parameter keys no. This plan resolves parameter keys as well, and the same for form and multipart field keys, so that every key/value table in the module follows one rule.

The spec's own §3 forbids the alternative: `buildRequest` builds the query from the Params rows, not from the URL text, so a `{{k}}` left in a key is a `{{k}}` on the wire — and *"gửi một request có chữ `{{token}}` trong header Authorization không giúp được ai"* is the reason the blocking rule exists at all. A rule that stops the header and lets the query through is one rule with a hole in it.

**Not** resolved, in either direction: a multipart part's `file`, and a binary body's `filePath`. Those are paths on this machine, exactly as §3 says.

### 7. The keyring holds a map per environment, and writes are debounced

Key: `rest-env:<envId>`, value: a map of *variable name -> value* for the variables marked secret. `rest-environments.json` holds every variable's name and its `secret` flag, and holds the value only for the ones not marked secret. That is `savedConnections.ts`'s split, applied to a different noun, and it is why the file stays readable and copyable.

Requests are persisted on every keystroke and that is fine — it is one JSON file. The credential store is not: on macOS a write may put a prompt on screen. So `environmentsStore` **debounces persistence by 400 ms** and, within that, writes an environment's keyring entry only when its secret map has actually changed since the last write. Closing the dialog flushes.

### 8. The preview shows dots where a secret went

The line under the URL box shows the URL after substitution, with the value of any variable marked secret replaced by `••••••`. What is sent is the real value.

The line exists to answer *did my variables resolve* — a missing name painted red, a resolved one shown as text, a resolved secret shown as dots all answer that. It does not exist to display a token, and it is the one place a token would otherwise be readable across a shared screen with nothing to click to hide it. It is also the same rule §2 already sets for the history file, which is easier to hold than two rules for the two places a resolved URL is shown.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/modules/rest/interpolate.ts` | **New.** `MAX_PASSES`, `Interpolated`, `interpolate`. One string in, one string out, plus what it could not fill. Pure. |
| `src/modules/rest/interpolate.test.ts` | **New.** The variable charset, the escape, nesting, cycles, missing names. |
| `src/modules/rest/environments.ts` | **New.** `EnvVar`, `Environment`, `SECRET_MASK`, `newEnvironment`, `newVar`, `varMap`, `previewVars`, `findEnvironment`, the reducers over `Environment[]`, and the pure halves of the keyring split (`withoutSecrets`, `secretsOf`, `withSecrets`). |
| `src/modules/rest/environments.test.ts` | **New.** What a variable resolves to, and what is kept out of the file. |
| `src/modules/rest/resolveRequest.ts` | **New.** `ResolvedRequest`, `resolveRequest` — the fold over a whole request. Pure. |
| `src/modules/rest/resolveRequest.test.ts` | **New.** Which fields are resolved, which are left alone, what is missing. |
| `src/modules/rest/environmentsStore.ts` | **New.** The list shared by every REST tab: read once from the file and the keyring, written back debounced. |
| `src/modules/rest/api.ts` | Three more invokes — the credential store, which is native and so belongs in this file and nowhere else. |
| `src/modules/rest/workspace.ts` | `lastEnvId` in `Workspace`, `setLastEnvId`, and `workspaceLoaded()` so a tab can seed from the file exactly once. |
| `src/modules/rest/components/EnvironmentSelect/` | **New folder.** The dropdown pinned at the end of the tab strip. |
| `src/modules/rest/components/EnvironmentDialog/` | **New folder.** Environments on the left, their variables on the right. |
| `src/modules/rest/components/UrlPreview/` | **New folder.** The resolved URL, and the line that says why Send is off. |
| `src/modules/rest/components/UrlBar/UrlBar.tsx` | One prop: `blocked`, which turns Send off for a reason that is not an empty URL. |
| `src/modules/rest/RestTab.tsx` | The environment state, the resolve before the send, the dropdown row, the dialog, the preview. |
| `src/modules/rest/rest.css` | `.rest-tabs-row` — the strip and the dropdown side by side, the dropdown not scrolling with the tabs. |
| `src/modules/rest/i18n/en.ts`, `vi.ts` | The environment strings. No new `error.*` key: nothing new comes back from Rust. |
| `CHANGELOG.md` | One line under `## [Unreleased]` -> `### Added`. |

---

### Task 1: What a variable is

The one function every other piece of this phase is built on. Nothing renders yet and no environment exists yet — the rule about what counts as a variable, what an escape does and when a run is a cycle is settled here, in a file with tests and no React in it.

**Files:**
- Create: `src/modules/rest/interpolate.ts`
- Test: `src/modules/rest/interpolate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const MAX_PASSES = 5`
  - `export interface Interpolated { text: string; missing: string[]; cyclic: boolean }`
  - `export function interpolate(text: string, vars: Record<string, string>): Interpolated`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/rest/interpolate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { interpolate } from "./interpolate";

const vars = { host: "api.example.com", baseUrl: "https://{{host}}", token: "t0k", empty: "" };

describe("interpolate", () => {
  it("puts a value where the variable was", () => {
    expect(interpolate("{{baseUrl}}/users", { baseUrl: "https://x.dev" }).text).toBe(
      "https://x.dev/users",
    );
  });

  it("expands a value that is itself made of variables", () => {
    expect(interpolate("{{baseUrl}}/users", vars).text).toBe("https://api.example.com/users");
  });

  it("leaves an unknown variable where it is and names it", () => {
    const out = interpolate("Bearer {{missing}}", vars);
    expect(out.text).toBe("Bearer {{missing}}");
    expect(out.missing).toEqual(["missing"]);
  });

  // A variable set to nothing is set. Reading it as missing would block a send over a value its
  // owner deliberately left empty.
  it("treats an empty value as a value", () => {
    const out = interpolate("{{empty}}!", vars);
    expect(out.text).toBe("!");
    expect(out.missing).toEqual([]);
  });

  it("names each missing variable once, in the order first met", () => {
    const out = interpolate("{{b}} {{a}} {{b}}", {});
    expect(out.missing).toEqual(["b", "a"]);
  });

  // The whole reason the charset is narrow: a body carrying a Handlebars template must reach the
  // server as it was written.
  it("leaves anything that is not a name alone", () => {
    const template = "{{#each items}}{{ spaced }}{{}}";
    const out = interpolate(template, vars);
    expect(out.text).toBe(template);
    expect(out.missing).toEqual([]);
  });

  it("takes a backslash as an instruction to send the braces themselves", () => {
    const out = interpolate("\\{{token}} and {{token}}", vars);
    expect(out.text).toBe("{{token}} and t0k");
    expect(out.missing).toEqual([]);
  });

  // The literal an escape produced must not be eaten by the round after it.
  it("keeps an escaped literal through the rounds that follow", () => {
    const out = interpolate("{{wrapper}}", { wrapper: "\\{{token}}", token: "t0k" });
    expect(out.text).toBe("{{token}}");
  });

  it("resolves a chain five deep without calling it a cycle", () => {
    const chain = { a: "{{b}}", b: "{{c}}", c: "{{d}}", d: "{{e}}", e: "end" };
    const out = interpolate("{{a}}", chain);
    expect(out.text).toBe("end");
    expect(out.cyclic).toBe(false);
  });

  it("gives up on a variable that refers back to itself", () => {
    expect(interpolate("{{loop}}", { loop: "{{loop}}" }).cyclic).toBe(true);
    expect(interpolate("{{a}}", { a: "{{b}}", b: "{{a}}" }).cyclic).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/modules/rest/interpolate.test.ts`
Expected: FAIL — `Failed to resolve import "./interpolate"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/rest/interpolate.ts`:

```ts
/**
 * `{{var}}` turned into what the environment says it is.
 *
 * The only place the shape of a variable is decided, and the only place that decides what happens
 * when there is no value for one. Pure, so both are settled under `npm test` rather than in a
 * component nobody can run without a server.
 */

/** A name is letters, digits, and the three marks names are usually built from. Anything else
 *  between braces is not a variable: `{{#each items}}` and `{{ x }}` are a template the request is
 *  carrying to a server, and they travel through untouched. */
const VAR = /(\\?)\{\{([A-Za-z0-9_.-]+)\}\}/g;

/** How many rounds of substitution a text is allowed. Five is far past anything real —
 *  `baseUrl = https://{{host}}` is two — and finite, which is what a variable pointing at itself
 *  needs it to be. A chain exactly five deep still resolves: the round that finds nothing left to
 *  do is not one of the five. */
export const MAX_PASSES = 5;

export interface Interpolated {
  /** Every known variable replaced. An unknown one is left in its braces, which is what the
   *  preview line under the URL box paints red. */
  text: string;
  /** Names the text asked for that the environment had no value for, each once, in the order they
   *  were first met. */
  missing: string[];
  /** The rounds ran out with work still being done: a variable refers back to itself, directly or
   *  through another. The text is left mid-expansion — nothing is sent, so nobody sees it. */
  cyclic: boolean;
}

/** Stands in for an escaped `\{{name}}` while the rounds run, so a literal an escape produced is
 *  not substituted by the round after it. A control character no URL, header or form value holds,
 *  and it is put back only where this function itself left one. */
const FROZEN = "\u0000";

function restore(text: string, literals: string[]): string {
  if (literals.length === 0) return text;
  return text.replace(
    new RegExp(`${FROZEN}(\\d+)${FROZEN}`, "g"),
    (match, index: string) => literals[Number(index)] ?? match,
  );
}

export function interpolate(text: string, vars: Record<string, string>): Interpolated {
  const missing: string[] = [];
  const literals: string[] = [];
  let current = text;
  let changed = true;
  let rounds = 0;

  while (changed && rounds <= MAX_PASSES) {
    changed = false;
    current = current.replace(VAR, (match, escape: string, name: string) => {
      if (escape !== "") {
        changed = true;
        literals.push(`{{${name}}}`);
        return `${FROZEN}${literals.length - 1}${FROZEN}`;
      }
      const value = vars[name];
      if (value === undefined) {
        if (!missing.includes(name)) missing.push(name);
        return match;
      }
      changed = true;
      return value;
    });
    rounds++;
  }

  // The loop leaves on one of two conditions. Out of work is the ordinary end; out of rounds with
  // work still waiting is the other one, and there is no text that reaches it honestly.
  return { text: restore(current, literals), missing, cyclic: changed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/rest/interpolate.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/interpolate.ts src/modules/rest/interpolate.test.ts
git commit -m "feat(rest): resolve {{var}} against a set of values"
```

---

### Task 2: The environment, and what it hands to `interpolate`

The data an environment is, and the two maps it turns into — one for sending, one for showing. Both are pure, which is what lets the keyring split be tested without a keyring.

**Files:**
- Create: `src/modules/rest/environments.ts`
- Test: `src/modules/rest/environments.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface EnvVar { name: string; value: string; secret: boolean }`
  - `export interface Environment { id: string; name: string; vars: EnvVar[] }`
  - `export const SECRET_MASK: string`
  - `export function newEnvironment(id: string, name: string): Environment`
  - `export function newVar(): EnvVar`
  - `export function varMap(env: Environment | null): Record<string, string> | null`
  - `export function previewVars(env: Environment | null): Record<string, string> | null`
  - `export function findEnvironment(list: Environment[], id: string | null): Environment | null`
  - `export function addEnvironment(list: Environment[], env: Environment): Environment[]`
  - `export function updateEnvironment(list: Environment[], env: Environment): Environment[]`
  - `export function removeEnvironment(list: Environment[], id: string): Environment[]`
  - `export function withVariables(env: Environment, names: string[]): Environment`
  - `export function withoutSecrets(env: Environment): Environment`
  - `export function secretsOf(env: Environment): Record<string, string>`
  - `export function withSecrets(env: Environment, secrets: Record<string, string>): Environment`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/rest/environments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SECRET_MASK,
  addEnvironment,
  findEnvironment,
  newEnvironment,
  previewVars,
  removeEnvironment,
  secretsOf,
  updateEnvironment,
  varMap,
  withSecrets,
  withVariables,
  withoutSecrets,
} from "./environments";

const dev = (): ReturnType<typeof newEnvironment> => ({
  id: "e1",
  name: "Dev",
  vars: [
    { name: "host", value: "api.dev", secret: false },
    { name: "token", value: "t0k", secret: true },
  ],
});

describe("varMap", () => {
  it("is null for no environment, which is what stops interpolation running at all", () => {
    expect(varMap(null)).toBeNull();
  });

  it("gives every variable its value, secret or not", () => {
    expect(varMap(dev())).toEqual({ host: "api.dev", token: "t0k" });
  });

  // A row typed into and not yet named is the empty one at the foot of the table.
  it("passes over a row with no name", () => {
    const env = { ...dev(), vars: [{ name: "", value: "orphan", secret: false }] };
    expect(varMap(env)).toEqual({});
  });

  // Two rows can be given the same name, and one of them has to win. The first does, because it
  // is the one nearer the top of a table read from the top.
  it("keeps the first of two rows with the same name", () => {
    const env = {
      ...dev(),
      vars: [
        { name: "host", value: "first", secret: false },
        { name: "host", value: "second", secret: false },
      ],
    };
    expect(varMap(env)).toEqual({ host: "first" });
  });
});

describe("previewVars", () => {
  it("shows a secret as dots and everything else as itself", () => {
    expect(previewVars(dev())).toEqual({ host: "api.dev", token: SECRET_MASK });
  });

  it("is null for no environment", () => {
    expect(previewVars(null)).toBeNull();
  });
});

describe("the keyring split", () => {
  it("keeps a secret's name and flag in the file and its value out", () => {
    expect(withoutSecrets(dev()).vars).toEqual([
      { name: "host", value: "api.dev", secret: false },
      { name: "token", value: "", secret: true },
    ]);
  });

  it("hands the credential store only the secrets", () => {
    expect(secretsOf(dev())).toEqual({ token: "t0k" });
  });

  it("puts the values back where they were", () => {
    const stored = withoutSecrets(dev());
    expect(withSecrets(stored, secretsOf(dev()))).toEqual(dev());
  });

  // An entry the user deleted from the OS store, or one written before a variable was marked
  // secret: the row is still there and its value is simply empty.
  it("reads a secret the store has nothing for as empty", () => {
    expect(withSecrets(withoutSecrets(dev()), {}).vars[1].value).toBe("");
  });
});

describe("the list", () => {
  it("finds one by id and answers null for an id nothing has", () => {
    const list = [dev()];
    expect(findEnvironment(list, "e1")?.name).toBe("Dev");
    expect(findEnvironment(list, "gone")).toBeNull();
    expect(findEnvironment(list, null)).toBeNull();
  });

  it("adds, replaces and removes", () => {
    const prod = newEnvironment("e2", "Prod");
    const two = addEnvironment([dev()], prod);
    expect(two.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(updateEnvironment(two, { ...prod, name: "Live" })[1].name).toBe("Live");
    expect(removeEnvironment(two, "e1").map((e) => e.id)).toEqual(["e2"]);
  });

  // What the blocked-send button does: the names go in with nothing in them, ready to be filled.
  it("adds the variables a request asked for and skips the ones already there", () => {
    const filled = withVariables(dev(), ["token", "apiKey"]);
    expect(filled.vars.map((v) => v.name)).toEqual(["host", "token", "apiKey"]);
    expect(filled.vars[2]).toEqual({ name: "apiKey", value: "", secret: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/modules/rest/environments.test.ts`
Expected: FAIL — `Failed to resolve import "./environments"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/rest/environments.ts`:

```ts
/**
 * An environment: a named set of values that `{{var}}` resolves against.
 *
 * One list, shared by the whole app — the request list does not change when the environment does,
 * because an environment only decides what a request's variables come out as.
 *
 * Everything here is pure. Where an environment is *kept* — `rest-environments.json` for the
 * names, the OS credential store for the values marked secret — is `environmentsStore.ts`, and the
 * two halves of that split are the last three functions in this file so they can be tested without
 * a keyring.
 */

export interface EnvVar {
  name: string;
  value: string;
  /** Kept in the OS credential store instead of the file, and shown as dots in the URL preview. */
  secret: boolean;
}

export interface Environment {
  id: string;
  name: string;
  vars: EnvVar[];
}

/** What a secret's value looks like in the preview line. Six of them: enough to read as "something
 *  is here", short enough not to push the rest of a URL off the end of the line. */
export const SECRET_MASK = "\u2022\u2022\u2022\u2022\u2022\u2022";

export function newEnvironment(id: string, name: string): Environment {
  return { id, name, vars: [] };
}

/** An empty row for the variables table. Not secret: the flag is a decision, and a row nobody has
 *  looked at yet has not had one made about it. */
export function newVar(): EnvVar {
  return { name: "", value: "", secret: false };
}

/** Name to value, for the rows that have a name. The first of two rows sharing a name wins — it is
 *  the one nearer the top of the table, which is the one a reader would expect to be in force. */
function map(env: Environment, valueOf: (v: EnvVar) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const variable of env.vars) {
    if (variable.name === "" || variable.name in out) continue;
    out[variable.name] = valueOf(variable);
  }
  return out;
}

/** What `interpolate` is given on the way to the wire. **Null means no environment is chosen**,
 *  which is not the same as an environment with nothing in it: null turns interpolation off
 *  altogether, so `{{var}}` reaches the server as text and no send is ever blocked. */
export function varMap(env: Environment | null): Record<string, string> | null {
  return env === null ? null : map(env, (v) => v.value);
}

/** The same map for the preview line, with secrets shown rather than told. What is sent is the
 *  real value; this is only what is drawn under the URL box. */
export function previewVars(env: Environment | null): Record<string, string> | null {
  return env === null ? null : map(env, (v) => (v.secret ? SECRET_MASK : v.value));
}

export function findEnvironment(list: Environment[], id: string | null): Environment | null {
  if (id === null) return null;
  return list.find((env) => env.id === id) ?? null;
}

export function addEnvironment(list: Environment[], env: Environment): Environment[] {
  return [...list, env];
}

export function updateEnvironment(list: Environment[], env: Environment): Environment[] {
  return list.map((existing) => (existing.id === env.id ? env : existing));
}

export function removeEnvironment(list: Environment[], id: string): Environment[] {
  return list.filter((env) => env.id !== id);
}

/** The environment with a row for each name it has not got, empty and waiting to be filled. What
 *  the button under a blocked Send does: the names are already known, and typing them out again is
 *  the part nobody should have to do. */
export function withVariables(env: Environment, names: string[]): Environment {
  const held = new Set(env.vars.map((v) => v.name));
  const added = names.filter((name) => !held.has(name)).map((name) => ({ ...newVar(), name }));
  return added.length === 0 ? env : { ...env, vars: [...env.vars, ...added] };
}

/** The environment as it goes to disk: every row, and the value of the secret ones dropped. */
export function withoutSecrets(env: Environment): Environment {
  return { ...env, vars: env.vars.map((v) => (v.secret ? { ...v, value: "" } : v)) };
}

/** What the credential store is handed, keyed by variable name. */
export function secretsOf(env: Environment): Record<string, string> {
  const out: Record<string, string> = {};
  for (const variable of env.vars) {
    if (variable.secret && variable.name !== "") out[variable.name] = variable.value;
  }
  return out;
}

/** The environment as it came off disk, with the credential store's half put back. A secret the
 *  store has nothing for stays empty — which is what an entry deleted from the OS store, or a
 *  variable marked secret before anything was typed into it, looks like. */
export function withSecrets(env: Environment, secrets: Record<string, string>): Environment {
  return {
    ...env,
    vars: env.vars.map((v) => (v.secret ? { ...v, value: secrets[v.name] ?? v.value } : v)),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/rest/environments.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/environments.ts src/modules/rest/environments.test.ts
git commit -m "feat(rest): add the environment and the maps it resolves to"
```

---

### Task 3: A whole request resolved

`interpolate` handles one string. This is the list of strings a request is made of — and, just as importantly, the list it is not: two file paths that are paths on this machine and never anything else.

**Files:**
- Create: `src/modules/rest/resolveRequest.ts`
- Test: `src/modules/rest/resolveRequest.test.ts`

**Interfaces:**
- Consumes: `interpolate` from `./interpolate`; `KeyValue`, `MultipartField`, `RestRequest` from `./types`.
- Produces:
  - `export interface ResolvedRequest { request: RestRequest; missing: string[]; cyclic: boolean }`
  - `export function resolveRequest(request: RestRequest, vars: Record<string, string> | null): ResolvedRequest`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/rest/resolveRequest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveRequest } from "./resolveRequest";
import type { RestRequest } from "./types";

const vars = { host: "api.dev", token: "t0k", user: "ann" };

const row = (key: string, value: string, enabled = true) => ({ id: key, enabled, key, value });

function request(patch: Partial<RestRequest> = {}): RestRequest {
  return {
    id: "r1",
    name: "",
    method: "GET",
    url: "https://{{host}}/users",
    params: [],
    headers: [],
    body: { kind: "none" },
    auth: { kind: "none" },
    origin: "manual",
    createdAt: 0,
    lastUsedAt: 0,
    ...patch,
  };
}

describe("resolveRequest", () => {
  // The whole of what "no environment" means, in one test.
  it("changes nothing when no environment is chosen", () => {
    const original = request({ headers: [row("X-{{host}}", "{{token}}")] });
    const out = resolveRequest(original, null);
    expect(out.request).toBe(original);
    expect(out.missing).toEqual([]);
    expect(out.cyclic).toBe(false);
  });

  it("resolves the url", () => {
    expect(resolveRequest(request(), vars).request.url).toBe("https://api.dev/users");
  });

  it("resolves both halves of a header row", () => {
    const out = resolveRequest(request({ headers: [row("X-{{host}}", "Bearer {{token}}")] }), vars);
    expect(out.request.headers[0]).toMatchObject({ key: "X-api.dev", value: "Bearer t0k" });
  });

  it("resolves both halves of a param row", () => {
    const out = resolveRequest(request({ params: [row("{{user}}_id", "{{token}}")] }), vars);
    expect(out.request.params[0]).toMatchObject({ key: "ann_id", value: "t0k" });
  });

  it("resolves a raw body", () => {
    const out = resolveRequest(
      request({ body: { kind: "raw", language: "json", text: '{"t":"{{token}}"}' } }),
      vars,
    );
    expect(out.request.body).toEqual({ kind: "raw", language: "json", text: '{"t":"t0k"}' });
  });

  it("resolves a form field", () => {
    const out = resolveRequest(request({ body: { kind: "form", fields: [row("u", "{{user}}")] } }), vars);
    expect(out.request.body).toMatchObject({ fields: [{ key: "u", value: "ann" }] });
  });

  it("resolves every auth kind's fields", () => {
    expect(resolveRequest(request({ auth: { kind: "bearer", token: "{{token}}" } }), vars).request.auth)
      .toEqual({ kind: "bearer", token: "t0k" });
    expect(
      resolveRequest(
        request({ auth: { kind: "basic", username: "{{user}}", password: "{{token}}" } }),
        vars,
      ).request.auth,
    ).toEqual({ kind: "basic", username: "ann", password: "t0k" });
    expect(
      resolveRequest(
        request({ auth: { kind: "apiKey", name: "{{user}}-key", value: "{{token}}", in: "query" } }),
        vars,
      ).request.auth,
    ).toEqual({ kind: "apiKey", name: "ann-key", value: "t0k", in: "query" });
  });

  // A path is a path on this machine. Nothing in it is a variable, whatever it looks like.
  it("never touches a file path", () => {
    const multipart = resolveRequest(
      request({
        body: { kind: "multipart", fields: [{ ...row("f", ""), file: "C:/{{host}}/a.png" }] },
      }),
      vars,
    );
    expect((multipart.request.body as { fields: { file?: string }[] }).fields[0].file).toBe(
      "C:/{{host}}/a.png",
    );

    const binary = resolveRequest(
      request({ body: { kind: "binary", filePath: "/tmp/{{host}}.bin" } }),
      vars,
    );
    expect(binary.request.body).toEqual({ kind: "binary", filePath: "/tmp/{{host}}.bin" });
  });

  // An unticked row is not sent, so what is in it is not a reason to stop a send. Parking a row is
  // how a request with a variable nobody has a value for is sent anyway.
  it("leaves an unticked row alone and does not count what is in it", () => {
    const out = resolveRequest(
      request({ url: "https://{{host}}", headers: [row("X-Off", "{{nope}}", false)] }),
      vars,
    );
    expect(out.request.headers[0].value).toBe("{{nope}}");
    expect(out.missing).toEqual([]);
  });

  it("collects what is missing across the whole request, each name once", () => {
    const out = resolveRequest(
      request({
        url: "https://{{gone}}",
        headers: [row("A", "{{other}}")],
        body: { kind: "raw", language: "text", text: "{{gone}}" },
      }),
      vars,
    );
    expect(out.missing).toEqual(["gone", "other"]);
  });

  it("reports a cycle found anywhere in the request", () => {
    const out = resolveRequest(request({ url: "{{loop}}" }), { loop: "{{loop}}" });
    expect(out.cyclic).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/modules/rest/resolveRequest.test.ts`
Expected: FAIL — `Failed to resolve import "./resolveRequest"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/rest/resolveRequest.ts`:

```ts
import { interpolate } from "./interpolate";
import type { KeyValue, MultipartField, RestRequest } from "./types";

/**
 * A request with its variables put in, on its way to `buildRequest`.
 *
 * **The copy this returns is never written back to the store.** It exists for the length of one
 * send. A request whose `{{token}}` had been replaced by a token is a request that has stopped
 * being portable — and, when the variable was a secret one, a request that has just written a
 * credential into `rest-requests.json`.
 *
 * Two things are deliberately left as they are. An **unticked row** is not sent, so it is not
 * resolved and what is in it is not a reason to stop a send — parking a row is how a request with
 * an unfilled variable goes out anyway. A **file path** is a path on this machine, and nothing in
 * it is a variable however much it looks like one.
 */

export interface ResolvedRequest {
  /** The request as it will be built. The same object when no environment is chosen. */
  request: RestRequest;
  /** Names the request asked for that the environment had no value for. Not empty means Send is
   *  off: a request carrying the literal text `{{token}}` in an Authorization header helps nobody. */
  missing: string[];
  /** A variable refers back to itself. Also stops the send, and says so in its own words. */
  cyclic: boolean;
}

export function resolveRequest(
  request: RestRequest,
  vars: Record<string, string> | null,
): ResolvedRequest {
  // No environment: the text travels as text, and nothing can be missing from a set nobody named.
  if (vars === null) return { request, missing: [], cyclic: false };

  // Bound to a const because a parameter's narrowing does not survive into a closure, and `take`
  // is one.
  const values = vars;
  const missing: string[] = [];
  let cyclic = false;

  function take(text: string): string {
    const out = interpolate(text, values);
    for (const name of out.missing) if (!missing.includes(name)) missing.push(name);
    cyclic = cyclic || out.cyclic;
    return out.text;
  }

  const row = <T extends KeyValue>(item: T): T =>
    item.enabled ? { ...item, key: take(item.key), value: take(item.value) } : item;

  const body = ((): RestRequest["body"] => {
    switch (request.body.kind) {
      case "none":
      case "binary":
        return request.body;
      case "raw":
        return { ...request.body, text: take(request.body.text) };
      case "form":
        return { ...request.body, fields: request.body.fields.map(row) };
      case "multipart":
        // `file` is left out of `row` by construction: it copies `key` and `value` and nothing else.
        return { ...request.body, fields: request.body.fields.map<MultipartField>(row) };
    }
  })();

  const auth = ((): RestRequest["auth"] => {
    switch (request.auth.kind) {
      case "none":
        return request.auth;
      case "bearer":
        return { ...request.auth, token: take(request.auth.token) };
      case "basic":
        return {
          ...request.auth,
          username: take(request.auth.username),
          password: take(request.auth.password),
        };
      case "apiKey":
        return { ...request.auth, name: take(request.auth.name), value: take(request.auth.value) };
    }
  })();

  return {
    request: {
      ...request,
      url: take(request.url),
      params: request.params.map(row),
      headers: request.headers.map(row),
      body,
      auth,
    },
    missing,
    cyclic,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/rest/resolveRequest.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run everything and typecheck**

Run: `npm test && npm run build`
Expected: every test passes, no type errors.

- [ ] **Step 6: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/resolveRequest.ts src/modules/rest/resolveRequest.test.ts
git commit -m "feat(rest): resolve a whole request against an environment"
```

---

### Task 4: Where an environment is kept

The file, the credential store, and the one copy in memory every REST tab reads. The shape of the split is already tested from Task 2; what is added here is four lines of `Store`, three invokes, and the rule about when a credential-store write actually happens.

**Files:**
- Modify: `src/modules/rest/api.ts`
- Create: `src/modules/rest/environmentsStore.ts`

**Interfaces:**
- Consumes: `Environment`, `addEnvironment`, `findEnvironment`, `newEnvironment`, `removeEnvironment`, `secretsOf`, `updateEnvironment`, `withSecrets`, `withVariables`, `withoutSecrets` from `./environments`.
- Produces, from `api.ts`:
  - `export function envSecretsSave(id: string, secrets: Record<string, string>): Promise<void>`
  - `export function envSecretsLoad(id: string): Promise<Record<string, string>>`
  - `export function envSecretsDelete(id: string): Promise<void>`
- Produces, from `environmentsStore.ts`:
  - `export function useEnvironments(): Environment[]`
  - `export function createEnvironment(name: string): Environment`
  - `export function saveEnvironment(env: Environment): void`
  - `export function deleteEnvironment(id: string): void`
  - `export function addVariables(id: string, names: string[]): void`
  - `export function flushEnvironments(): Promise<void>`

- [ ] **Step 1: Add the credential-store calls to `api.ts`**

Append to `src/modules/rest/api.ts`:

```ts
/**
 * The OS credential store, where a variable marked secret keeps its value.
 *
 * `secrets.rs` is shared and takes any string as an id, so this module writes its entries under
 * `rest-env:<envId>` and nothing new was needed on the Rust side. Saving an empty map deletes the
 * entry rather than storing `{}` — an environment with nothing to hide leaves nothing behind.
 */
export function envSecretsSave(id: string, secrets: Record<string, string>): Promise<void> {
  return invoke("secrets_save", { id, secrets });
}

/** What is stored for an environment, or nothing when it has never had a secret in it. */
export function envSecretsLoad(id: string): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("secrets_load", { id });
}

/** Forgets an environment's secrets, for when the environment itself goes. */
export function envSecretsDelete(id: string): Promise<void> {
  return invoke("secrets_delete", { id });
}
```

- [ ] **Step 2: Write the store**

Create `src/modules/rest/environmentsStore.ts`:

```ts
import { useEffect, useSyncExternalStore } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { envSecretsDelete, envSecretsLoad, envSecretsSave } from "./api";
import {
  addEnvironment,
  findEnvironment,
  newEnvironment,
  removeEnvironment,
  secretsOf,
  updateEnvironment,
  withSecrets,
  withVariables,
  withoutSecrets,
  type Environment,
} from "./environments";

/**
 * The environment list, shared by every REST tab.
 *
 * One thing on disk is one thing in memory, exactly as `requestsStore` does it — an environment
 * edited in the dialog is the same environment the tab behind it resolves against.
 *
 * What differs is where it is written. The names, the `secret` flags and the ordinary values go to
 * `rest-environments.json`; the values marked secret go to the OS credential store, one entry per
 * environment. That is the split `savedConnections.ts` makes for a connection's password, and it
 * is what keeps the file worth reading: it says what a Dev environment is made of without saying
 * what the token is.
 */

const FILE = "rest-environments.json";
const KEY = "environments";

/** The credential-store id an environment's secrets live under. */
const SECRET_PREFIX = "rest-env:";

/**
 * How long a change waits before it is written.
 *
 * Requests are persisted on every keystroke and that costs one JSON file. The credential store is
 * not free in the same way — on macOS a write may put a prompt on screen — and a token is typed a
 * character at a time. So writing is put off until the typing stops, and the dialog flushes on its
 * way out so the last character is never the one left behind.
 */
const PERSIST_DELAY = 400;

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(FILE);
  return storePromise;
}

let snapshot: Environment[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
let timer: number | null = null;
const listeners = new Set<() => void>();

/** What was last written to the credential store for each environment. An environment whose
 *  secrets have not moved is not written again, so renaming one, or typing in an ordinary value,
 *  never reaches the OS store at all. Sorted, so the same set always stamps the same. */
const written = new Map<string, string>();

function stamp(secrets: Record<string, string>): string {
  return JSON.stringify(Object.entries(secrets).sort(([a], [b]) => a.localeCompare(b)));
}

function publish(list: Environment[]) {
  snapshot = list;
  loaded = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The file, with the credential store's half put back into each environment. */
async function load(): Promise<Environment[]> {
  const store = await getStore();
  const stored = (await store.get<Environment[]>(KEY)) ?? [];
  return Promise.all(
    stored.map(async (env) => {
      // An environment whose entry is gone from the OS store, or one that never had a secret in
      // it, reads as empty rather than as a failure — the same answer `secrets.rs` gives itself.
      const secrets = await envSecretsLoad(`${SECRET_PREFIX}${env.id}`).catch(
        (): Record<string, string> => ({}),
      );
      const filled = withSecrets(env, secrets);
      // Stamped from the filled environment rather than from what came back, so the first write
      // after a load compares like with like.
      written.set(env.id, stamp(secretsOf(filled)));
      return filled;
    }),
  );
}

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = load()
      .then(publish)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

async function persist(): Promise<void> {
  const list = snapshot;
  const store = await getStore();
  await store.set(KEY, list.map(withoutSecrets));
  await store.save();
  for (const env of list) {
    const secrets = secretsOf(env);
    const mark = stamp(secrets);
    if (written.get(env.id) === mark) continue;
    await envSecretsSave(`${SECRET_PREFIX}${env.id}`, secrets);
    written.set(env.id, mark);
  }
}

function schedule(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void persist().catch(() => {});
  }, PERSIST_DELAY);
}

/** In memory now, on disk shortly. */
function commit(list: Environment[]): void {
  publish(list);
  schedule();
}

/** Writes whatever is still waiting, now. The dialog calls this on its way out. */
export function flushEnvironments(): Promise<void> {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  return persist().catch(() => {});
}

export function useEnvironments(): Environment[] {
  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** A new environment at the end of the list, returned so the dialog can select it. */
export function createEnvironment(name: string): Environment {
  const env = newEnvironment(crypto.randomUUID(), name);
  commit(addEnvironment(snapshot, env));
  return env;
}

/** An edit to an environment. This is the whole of saving one: there is no Save button here
 *  either, for the same reason there is none for a request. */
export function saveEnvironment(env: Environment): void {
  commit(updateEnvironment(snapshot, env));
}

export function deleteEnvironment(id: string): void {
  commit(removeEnvironment(snapshot, id));
  // The secrets go with the environment they belonged to; leaving them behind would mean an entry
  // in the OS store that nothing will ever name again.
  written.delete(id);
  void envSecretsDelete(`${SECRET_PREFIX}${id}`).catch(() => {});
}

/** The names a blocked send asked for, added to an environment as empty rows. */
export function addVariables(id: string, names: string[]): void {
  const env = findEnvironment(snapshot, id);
  if (env === null) return;
  commit(updateEnvironment(snapshot, withVariables(env, names)));
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: no errors. Nothing imports the store yet, so this proves only that it compiles — which is the whole of what can be proved without the app.

- [ ] **Step 4: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/environmentsStore.ts src/modules/rest/api.ts
git commit -m "feat(rest): keep environments in a file and their secrets in the keyring"
```

---

### Task 5: The environments dialog

Environments down the left, the chosen one's variables on the right. Every edit lands as it is made — there is no Save button here for the same reason there is none for a request.

**Files:**
- Create: `src/modules/rest/components/EnvironmentDialog/EnvironmentDialog.tsx`
- Create: `src/modules/rest/components/EnvironmentDialog/EnvironmentDialog.module.css`
- Create: `src/modules/rest/components/EnvironmentDialog/index.ts`
- Modify: `src/modules/rest/i18n/en.ts`, `src/modules/rest/i18n/vi.ts`

**Interfaces:**
- Consumes: `newVar`, `Environment`, `EnvVar` from `../../environments`; `createEnvironment`, `deleteEnvironment`, `flushEnvironments`, `saveEnvironment`, `useEnvironments` from `../../environmentsStore`; `useDraftFocus` from `../../draftFocus`.
- Produces: `export default function EnvironmentDialog(props: { initialId: string | null; onClose: () => void })`

- [ ] **Step 1: Add the strings**

In `src/modules/rest/i18n/en.ts`, inside the `rest` group, after the `authOverridden` / `showValue` / `hideValue` block:

```ts
    // Environments
    envLabel: "Environment",
    envNone: "No environment",
    envManage: "Manage environments…",
    envDialogTitle: "Environments",
    envNew: "New",
    envDefaultName: "New environment",
    envNameLabel: "Name",
    envEmpty: "No environments yet.",
    envNonePicked: "Pick an environment, or make one.",
    envDelete: "Delete this environment",
    envDeleteTitle: "Delete this environment?",
    envDeleteMessage:
      "“{{name}}” and everything in it will be gone for good, including the values kept in the credential store.",
    envVarName: "Variable",
    envVarValue: "Value",
    envVarSecret: "Secret",
    envVarSecretHint: "Kept in the OS credential store instead of the environments file.",
    envAddVar: "Add variable",
    envRemoveVar: "Remove variable",
    previewLabel: "Sends to",
    missingVars: "No value for {{names}} in “{{env}}”.",
    addMissingVars: "Add to “{{env}}”",
    varCycle: "A variable in “{{env}}” refers back to itself.",
```

The matching block in `src/modules/rest/i18n/vi.ts`, in the same place:

```ts
    envLabel: "Environment",
    envNone: "Không dùng environment",
    envManage: "Quản lý environment…",
    envDialogTitle: "Environment",
    envNew: "Thêm",
    envDefaultName: "Environment mới",
    envNameLabel: "Tên",
    envEmpty: "Chưa có environment nào.",
    envNonePicked: "Chọn một environment, hoặc tạo mới.",
    envDelete: "Xoá environment này",
    envDeleteTitle: "Xoá environment này?",
    envDeleteMessage:
      "“{{name}}” và mọi thứ trong đó sẽ mất hẳn, kể cả các giá trị đang giữ trong credential store.",
    envVarName: "Biến",
    envVarValue: "Giá trị",
    envVarSecret: "Bí mật",
    envVarSecretHint: "Giữ trong credential store của hệ điều hành, không nằm trong tệp environment.",
    envAddVar: "Thêm biến",
    envRemoveVar: "Xoá biến",
    previewLabel: "Gửi tới",
    missingVars: "Không có giá trị cho {{names}} trong “{{env}}”.",
    addMissingVars: "Thêm vào “{{env}}”",
    varCycle: "Một biến trong “{{env}}” trỏ ngược về chính nó.",
```

- [ ] **Step 2: Write the component**

Create `src/modules/rest/components/EnvironmentDialog/EnvironmentDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import Input from "../../../../components/Input";
import { useDialogExit } from "../../../../components/dialogMotion";
import { CloseIcon, EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { useDraftFocus } from "../../draftFocus";
import { newVar, type EnvVar, type Environment } from "../../environments";
import {
  createEnvironment,
  deleteEnvironment,
  flushEnvironments,
  saveEnvironment,
  useEnvironments,
} from "../../environmentsStore";
import styles from "./EnvironmentDialog.module.css";

interface Props {
  /** Which environment to open on — the one the tab strip was showing. */
  initialId: string | null;
  onClose: () => void;
}

/**
 * The environments, and what is in them.
 *
 * Every edit is written through as it is made, so there is no Save button and no dialog asking
 * whether to keep anything — the same stance the request pane takes, for the same reason. The
 * writes are debounced, which is why leaving flushes: a token typed and a dialog closed in the
 * same second must not lose its last character.
 *
 * A variable marked secret has its value kept in the OS credential store rather than in
 * `rest-environments.json`, and is shown as dots until its owner asks to see it. Unmarking one
 * moves the value back into the file on the next write — which is the honest reading of unticking
 * a box called Secret.
 */
function EnvironmentDialog({ initialId, onClose }: Props) {
  const { t } = useTranslation();
  const environments = useEnvironments();
  const [chosenId, setChosenId] = useState<string | null>(initialId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Which value boxes have been asked to show themselves, by row. Held by position: a variable
   *  has no id of its own, and rows are only ever added at the foot or taken out. */
  const [revealed, setRevealed] = useState<number[]>([]);
  const { close, cls } = useDialogExit();
  const { bind, owe } = useDraftFocus();

  /* The first environment when nothing is chosen, so the right-hand side is never empty while
     there is something to show — including straight after a delete. */
  const chosen = environments.find((env) => env.id === chosenId) ?? environments[0] ?? null;

  function done() {
    // The store is debounced, so the last keystroke is still in the air. This is what lands it.
    void flushEnvironments();
    onClose();
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Not while the confirm is up: that dialog owns Escape, and it answers it itself.
      if (e.key === "Escape" && !confirmDelete) close(done);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, confirmDelete, onClose]);

  function pick(id: string | null) {
    setChosenId(id);
    // Revealing is per row, and the rows are about to be a different environment's.
    setRevealed([]);
  }

  function edit(patch: Partial<Environment>) {
    if (chosen === null) return;
    saveEnvironment({ ...chosen, ...patch });
  }

  function updateVar(index: number, patch: Partial<EnvVar>) {
    if (chosen === null) return;
    edit({ vars: chosen.vars.map((v, i) => (i === index ? { ...v, ...patch } : v)) });
  }

  function appendVar(column: "name" | "value", text: string) {
    if (chosen === null) return;
    owe(`${chosen.vars.length}:${column}`);
    edit({ vars: [...chosen.vars, { ...newVar(), [column]: text }] });
  }

  return createPortal(
    <>
      <div className={cls(styles.overlay)} onClick={() => close(done)} />
      <div
        className={cls(styles.dialog)}
        role="dialog"
        aria-modal="true"
        aria-label={t("rest.envDialogTitle")}
      >
        <div className={styles.header}>
          <h3 className={styles.title}>{t("rest.envDialogTitle")}</h3>
          <button
            type="button"
            className={styles.headerClose}
            onClick={() => close(done)}
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <CloseIcon />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.list}>
            {environments.map((env) => (
              <button
                key={env.id}
                type="button"
                className={`${styles.item}${env.id === chosen?.id ? ` ${styles.itemActive}` : ""}`}
                onClick={() => pick(env.id)}
              >
                {env.name}
              </button>
            ))}
            {environments.length === 0 && (
              <p className={`${styles.empty} muted`}>{t("rest.envEmpty")}</p>
            )}
            <Button
              size="small"
              className={styles.add}
              onClick={() => pick(createEnvironment(t("rest.envDefaultName")).id)}
            >
              <PlusIcon size="1em" />
              {t("rest.envNew")}
            </Button>
          </div>

          <div className={styles.detail}>
            {chosen === null ? (
              <p className={`${styles.empty} muted`}>{t("rest.envNonePicked")}</p>
            ) : (
              <>
                <div className={styles.nameRow}>
                  <span className={styles.label}>{t("rest.envNameLabel")}</span>
                  <Input
                    className={styles.name}
                    size="small"
                    value={chosen.name}
                    aria-label={t("rest.envNameLabel")}
                    onChange={(e) => edit({ name: e.target.value })}
                  />
                  <button
                    type="button"
                    className={styles.delete}
                    onClick={() => setConfirmDelete(true)}
                    aria-label={t("rest.envDelete")}
                    title={t("rest.envDelete")}
                  >
                    <TrashIcon size="0.9em" />
                  </button>
                </div>

                <div className={styles.table}>
                  <div className={`${styles.row} ${styles.head}`}>
                    <span>{t("rest.envVarName")}</span>
                    <span>{t("rest.envVarValue")}</span>
                    <span title={t("rest.envVarSecretHint")}>{t("rest.envVarSecret")}</span>
                    <span />
                  </div>
                  {chosen.vars.map((variable, index) => {
                    const shown = !variable.secret || revealed.includes(index);
                    return (
                      <div key={index} className={styles.row}>
                        <Input
                          ref={bind(`${index}:name`)}
                          size="small"
                          value={variable.name}
                          aria-label={t("rest.envVarName")}
                          onChange={(e) => updateVar(index, { name: e.target.value })}
                        />
                        <div className={styles.value}>
                          <Input
                            ref={bind(`${index}:value`)}
                            size="small"
                            type={shown ? "text" : "password"}
                            value={variable.value}
                            aria-label={t("rest.envVarValue")}
                            onChange={(e) => updateVar(index, { value: e.target.value })}
                          />
                          {variable.secret && (
                            <button
                              type="button"
                              className={styles.reveal}
                              aria-label={shown ? t("rest.hideValue") : t("rest.showValue")}
                              title={shown ? t("rest.hideValue") : t("rest.showValue")}
                              onClick={() =>
                                setRevealed((prev) =>
                                  shown ? prev.filter((i) => i !== index) : [...prev, index],
                                )
                              }
                            >
                              {shown ? <EyeOffIcon size="0.9em" /> : <EyeIcon size="0.9em" />}
                            </button>
                          )}
                        </div>
                        <input
                          type="checkbox"
                          checked={variable.secret}
                          aria-label={t("rest.envVarSecret")}
                          title={t("rest.envVarSecretHint")}
                          onChange={(e) => updateVar(index, { secret: e.target.checked })}
                        />
                        <button
                          type="button"
                          className={styles.remove}
                          aria-label={t("rest.envRemoveVar")}
                          title={t("rest.envRemoveVar")}
                          onClick={() => {
                            setRevealed([]);
                            edit({ vars: chosen.vars.filter((_, i) => i !== index) });
                          }}
                        >
                          <CloseIcon size="0.9em" />
                        </button>
                      </div>
                    );
                  })}
                  {/* The empty row at the foot is not in the data: typing into it is what adds one,
                      exactly as in the request tables. */}
                  <div className={`${styles.row} ${styles.draft}`}>
                    <Input
                      size="small"
                      value=""
                      placeholder={t("rest.envAddVar")}
                      aria-label={t("rest.envAddVar")}
                      onChange={(e) => appendVar("name", e.target.value)}
                    />
                    <Input
                      size="small"
                      value=""
                      aria-label={t("rest.envVarValue")}
                      onChange={(e) => appendVar("value", e.target.value)}
                    />
                    <span />
                    <span />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {confirmDelete && chosen !== null && (
        <ConfirmDialog
          title={t("rest.envDeleteTitle")}
          message={t("rest.envDeleteMessage", { name: chosen.name })}
          confirmLabel={t("rest.delete")}
          danger
          onConfirm={() => {
            deleteEnvironment(chosen.id);
            setConfirmDelete(false);
            pick(null);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>,
    document.body,
  );
}

export default EnvironmentDialog;
```

- [ ] **Step 3: Write the styles**

Create `src/modules/rest/components/EnvironmentDialog/EnvironmentDialog.module.css`:

`composes:` brings the arrival and departure animation and nothing else — position, colour and box are each dialog's own, which is why they are written out here. The `z-index` pair sits **below** `ConfirmDialog`'s 80/81, because the delete confirmation opens on top of this dialog and has to be on top of it on screen too.

```css
.overlay {
  composes: overlay from "../../../../components/dialogMotion.module.css";
  position: fixed;
  inset: 0;
  z-index: 70;
  background: rgba(0, 0, 0, 0.35);
}

.dialog {
  composes: dialog from "../../../../components/dialogMotion.module.css";
  position: fixed;
  z-index: 71;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(46rem, calc(100vw - 2rem));
  height: min(30rem, calc(100vh - 4rem));
  background: var(--surface-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: 1rem;
  display: flex;
  flex-direction: column;
  text-align: left;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.title {
  margin: 0;
  font-size: 1rem;
}

.headerClose {
  display: flex;
  align-items: center;
  padding: 0.25rem;
  border: none;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
}

.headerClose:hover {
  opacity: 1;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.list {
  flex: 0 0 12rem;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding-right: 0.75rem;
  border-right: 1px solid var(--border);
  overflow: auto;
}

.item {
  text-align: left;
  padding: 0.4rem 0.5rem;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item:hover {
  background: var(--hover-bg);
}

.itemActive {
  background: var(--hover-bg);
  font-weight: 600;
}

.add {
  margin-top: 0.35rem;
  align-self: flex-start;
}

.detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  overflow: auto;
}

.nameRow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.label {
  flex: none;
  opacity: 0.7;
  font-size: 0.9em;
}

.name {
  flex: 1;
  min-width: 0;
}

.delete,
.remove,
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

.delete:hover,
.remove:hover,
.reveal:hover {
  opacity: 1;
}

.table {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9em;
}

/* Name, value, the Secret tick, the remove button. */
.row {
  display: grid;
  grid-template-columns: 1fr 1.4fr auto auto;
  align-items: center;
  gap: 0.4rem;
}

.head {
  opacity: 0.7;
  font-size: 0.85em;
  padding: 0 0.15rem;
}

.value {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
}

.value > input {
  flex: 1;
  min-width: 0;
}

.draft {
  opacity: 0.85;
}

.empty {
  margin: 0;
  padding: 0.4rem 0.15rem;
}
```

Create `src/modules/rest/components/EnvironmentDialog/index.ts`:

```ts
export { default } from "./EnvironmentDialog";
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: no errors. A wrong `composes:` path fails here rather than in `tsc`, so this is the step that proves the two of them.

- [ ] **Step 5: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/components/EnvironmentDialog src/modules/rest/i18n
git commit -m "feat(rest): add the environments dialog"
```

---

### Task 6: The dropdown at the end of the tab strip

Where an environment is chosen, and where the dialog is opened from. After this task environments can be made and picked; nothing resolves against one yet, which is Task 7.

**Files:**
- Create: `src/modules/rest/components/EnvironmentSelect/EnvironmentSelect.tsx`
- Create: `src/modules/rest/components/EnvironmentSelect/EnvironmentSelect.module.css`
- Create: `src/modules/rest/components/EnvironmentSelect/index.ts`
- Modify: `src/modules/rest/workspace.ts`
- Modify: `src/modules/rest/components/RequestTabs/RequestTabs.tsx`
- Modify: `src/modules/rest/rest.css`
- Modify: `src/modules/rest/RestTab.tsx`

**Interfaces:**
- Consumes: `Environment` from `../../environments`; `Select` from `../../../../components/Select`.
- Produces:
  - `export default function EnvironmentSelect(props: { environments: Environment[]; value: string | null; onChange: (id: string | null) => void; onManage: () => void })`
  - From `workspace.ts`: `Workspace.lastEnvId: string | null`, `export function setLastEnvId(lastEnvId: string | null): void`, `export function workspaceLoaded(): boolean`
  - `RequestTabs` gains `className?: string`.

**Strings:** `rest.envLabel`, `rest.envNone` and `rest.envManage` went into both dictionaries in Task 5's step 1, with the rest of the environment strings. Nothing new is added here.

- [ ] **Step 1: Give the workspace a last environment**

In `src/modules/rest/workspace.ts`, add the field to the interface and the default, and the two exports at the foot. The doc comment at the head of the file already promises this — *"Phase 4 adds `lastEnvId` here"* — so update it to say Phase 5 adds the send settings and nothing else.

```ts
export interface Workspace {
  sidebarWidth: number;
  /** The request pane's share of the width between the two. */
  splitRatio: number;
  /** Only a seed. A REST tab reads this once, when this file first arrives, and writes it whenever
   *  its own choice changes — but it never reads it again, because a second tab moving to prod is
   *  not this tab moving with it. */
  lastEnvId: string | null;
}
```

```ts
const DEFAULTS: Workspace = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  splitRatio: DEFAULT_SPLIT_RATIO,
  lastEnvId: null,
};
```

```ts
/** Whether the file has been read yet. A tab seeds its environment from `lastEnvId` the moment
 *  this turns true, and never again — which is not something a defaulted value can be told apart
 *  from a stored one. */
export function workspaceLoaded(): boolean {
  return loaded;
}

export function setLastEnvId(lastEnvId: string | null): void {
  write({ ...snapshot, lastEnvId });
}
```

- [ ] **Step 2: Write the dropdown**

Create `src/modules/rest/components/EnvironmentSelect/EnvironmentSelect.tsx`:

```tsx
import Select from "../../../../components/Select";
import { useTranslation } from "../../../../i18n";
import type { Environment } from "../../environments";
import styles from "./EnvironmentSelect.module.css";

/** Two values that are not an environment id. Ids are `crypto.randomUUID()`, so neither can ever
 *  be one. */
const NONE = "none";
const MANAGE = "manage";

interface Props {
  environments: Environment[];
  /** Null is None, which is also what a chosen environment since deleted resolves to. */
  value: string | null;
  onChange: (id: string | null) => void;
  onManage: () => void;
}

/**
 * Which environment this REST tab resolves against, pinned at the end of the tab strip.
 *
 * It sits with the tabs rather than in the request pane because an environment is a property of
 * the workspace, not of a request: the same request is sent against dev and against prod, and the
 * list of requests does not change when the environment does.
 *
 * *Manage environments…* is the last entry rather than a button of its own — it is reached rarely,
 * and it is reached from here, which is the only place the environments are named.
 */
function EnvironmentSelect({ environments, value, onChange, onManage }: Props) {
  const { t } = useTranslation();
  return (
    <Select<string>
      className={styles.select}
      size="small"
      value={value ?? NONE}
      ariaLabel={t("rest.envLabel")}
      title={t("rest.envLabel")}
      optionAlign="right"
      options={[
        { value: NONE, label: t("rest.envNone") },
        ...environments.map((env) => ({ value: env.id, label: env.name })),
        { value: MANAGE, label: t("rest.envManage") },
      ]}
      onChange={(picked) => {
        if (picked === MANAGE) {
          onManage();
          return;
        }
        onChange(picked === NONE ? null : picked);
      }}
    />
  );
}

export default EnvironmentSelect;
```

Create `src/modules/rest/components/EnvironmentSelect/EnvironmentSelect.module.css`:

```css
.select {
  min-width: 9rem;
  max-width: 14rem;
}
```

Create `src/modules/rest/components/EnvironmentSelect/index.ts`:

```ts
export { default } from "./EnvironmentSelect";
```

- [ ] **Step 3: Let the strip take a class**

In `src/modules/rest/components/RequestTabs/RequestTabs.tsx`, add `className` to `Props` and pass it through — the row around it needs to tell the strip not to draw its own edge:

```tsx
interface Props {
  tabs: RestRequest[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** What a request with neither name nor URL is called. */
  label: (request: RestRequest) => string;
  /** Handed to the strip. The workspace puts the environment dropdown beside it and moves the
   *  background and the bottom edge onto the row that holds both. */
  className?: string;
}
```

```tsx
function RequestTabs({ tabs, activeId, onSelect, onClose, onNew, label, className }: Props) {
  const { t } = useTranslation();
  return (
    <TabStrip role="tablist" className={className}>
```

- [ ] **Step 4: Put the two side by side**

Append to `src/modules/rest/rest.css`:

```css
/* The tab strip and the environment dropdown share one edge.
 *
 * The strip scrolls sideways when the tabs run past its width. The dropdown must not go with them:
 * it belongs to the workspace rather than to any one request, and it has to stay reachable
 * whatever is scrolled where. So it is a sibling of the strip, not a child of it.
 *
 * The row draws the background and the bottom border, and the strip inside it is told to draw
 * neither. Two class names beat the one in `TabStrip.module.css`, which is how a module's own
 * stylesheet wins here without a knob being added to the shared component. */
.rest-tabs-row {
  display: flex;
  align-items: stretch;
  min-width: 0;
  background: rgb(128 128 128 / 0.08);
  border-bottom: 1px solid var(--border);
}

.rest-tabs-row .rest-tabs-strip {
  flex: 1;
  min-width: 0;
  background: transparent;
  border-bottom: none;
}

.rest-env {
  flex: none;
  display: flex;
  align-items: center;
  padding: 0.4rem 0.5rem 0.4rem 0.35rem;
}
```

- [ ] **Step 5: Wire it into the workspace**

In `src/modules/rest/RestTab.tsx`:

Add to the imports:

```tsx
import EnvironmentDialog from "./components/EnvironmentDialog";
import EnvironmentSelect from "./components/EnvironmentSelect";
import { findEnvironment } from "./environments";
import { useEnvironments } from "./environmentsStore";
```

and add `setLastEnvId` and `workspaceLoaded` to the existing `./workspace` import.

Add the state, under `const workspace = useWorkspace();`:

```tsx
  const environments = useEnvironments();
  const [envId, setEnvId] = useState<string | null>(null);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  /** Whether `lastEnvId` has been taken. Once, and once only — see the note on the field. */
  const envSeeded = useRef(false);
```

Add the seeding effect beside the two that already follow the workspace file:

```tsx
  useEffect(() => {
    if (envSeeded.current || !workspaceLoaded()) return;
    envSeeded.current = true;
    setEnvId(workspace.lastEnvId);
  }, [workspace]);
```

Add, near `label`:

```tsx
  /* Null when nothing is chosen, and also when what was chosen has since been deleted — which is
     the whole of what deleting an environment has to clean up. */
  const env = findEnvironment(environments, envId);

  function chooseEnv(id: string | null) {
    setEnvId(id);
    // Written for the next REST tab to open with; this one keeps its own choice from here.
    setLastEnvId(id);
  }
```

Replace the `<RequestTabs … />` element with the row:

```tsx
        <div className="rest-tabs-row">
          <RequestTabs
            className="rest-tabs-strip"
            tabs={tabs}
            activeId={currentId}
            onSelect={setActiveId}
            onClose={close}
            onNew={makeRequest}
            label={label}
          />
          <div className="rest-env">
            <EnvironmentSelect
              environments={environments}
              value={env?.id ?? null}
              onChange={chooseEnv}
              onManage={() => setEnvDialogOpen(true)}
            />
          </div>
        </div>
```

And add the dialog as the last child of the root `<div className="rest-tab">`, after the `</div>` that closes `rest-main`:

```tsx
      {envDialogOpen && (
        <EnvironmentDialog initialId={env?.id ?? null} onClose={() => setEnvDialogOpen(false)} />
      )}
```

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 7: Check it by hand**

Run `npm run dev:app`, open a REST tab:
- The dropdown sits at the right end of the tab strip and reads *No environment*.
- Open enough request tabs to make the strip scroll: the tabs scroll, the dropdown does not move.
- *Manage environments…* opens the dialog. Make one called `Dev`, give it `host` = `httpbin.org`, and one called `token` with Secret ticked and any value.
- Close the dialog, pick `Dev` in the dropdown. Open a second REST tab with `Ctrl/Cmd+2`: it starts on `Dev` too. Set it to *No environment*, then go back to the first tab — it is still on `Dev`.
- Restart the app: a new REST tab starts on whichever was chosen last.
- Reopen the dialog: the secret's value is dots, the eye shows it, and it is the value that was typed — which is it having come back out of the credential store.
- Open `rest-environments.json` in the app data folder: `token` is there with `"secret": true` and `"value": ""`, and `host` has its value in full.

- [ ] **Step 8: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/components/EnvironmentSelect src/modules/rest/components/RequestTabs src/modules/rest/workspace.ts src/modules/rest/rest.css src/modules/rest/RestTab.tsx
git commit -m "feat(rest): pick an environment from the end of the tab strip"
```

---

### Task 7: The request actually resolves

The fold from Task 3 put between the request and `buildRequest`, the preview line under the URL box, and Send turned off when a variable has no value.

**Files:**
- Create: `src/modules/rest/components/UrlPreview/UrlPreview.tsx`
- Create: `src/modules/rest/components/UrlPreview/UrlPreview.module.css`
- Create: `src/modules/rest/components/UrlPreview/index.ts`
- Modify: `src/modules/rest/components/UrlBar/UrlBar.tsx`
- Modify: `src/modules/rest/RestTab.tsx`

**Interfaces:**
- Consumes: `interpolate` from `../../interpolate`; `previewVars`, `varMap` from `./environments`; `resolveRequest` from `./resolveRequest`; `addVariables` from `./environmentsStore`.
- Produces:
  - `export default function UrlPreview(props: { preview: string; missing: string[]; cyclic: boolean; envName: string; onAddMissing: () => void })`
  - `UrlBar` gains `blocked?: boolean`.

**Strings:** `rest.previewLabel`, `rest.missingVars`, `rest.addMissingVars` and `rest.varCycle` went into both dictionaries in Task 5's step 1. Nothing new is added here.

- [ ] **Step 1: Write the preview line**

Create `src/modules/rest/components/UrlPreview/UrlPreview.tsx`:

```tsx
import Button from "../../../../components/Button";
import { useTranslation } from "../../../../i18n";
import styles from "./UrlPreview.module.css";

/** Splits the line into text and whatever is still in braces. The capturing group is what keeps
 *  the braces in the pieces rather than throwing them away. */
const PIECES = /(\{\{[A-Za-z0-9_.-]+\}\})/g;
const IS_VAR = /^\{\{[A-Za-z0-9_.-]+\}\}$/;

interface Props {
  /** The URL with its variables put in, and the value of a secret one shown as dots. */
  preview: string;
  /** Names the environment had nothing for, anywhere in the request — not only in the URL. */
  missing: string[];
  cyclic: boolean;
  envName: string;
  /** Adds every missing name to the chosen environment and opens the dialog on it. */
  onAddMissing: () => void;
}

/**
 * What the URL above will actually be, and why Send is off when it is.
 *
 * Only drawn when an environment is chosen: with None there is nothing to resolve, and the line
 * would repeat the box above it word for word.
 *
 * A secret's value is dots. The line is here to answer *did my variables resolve* — a missing name
 * in red, a filled one as text and a secret as dots all answer that, and none of them needs a token
 * to be readable across a shared screen with nothing to click to hide it. What is sent is the real
 * value; this is the same rule the history file follows in Phase 5.
 *
 * Only names in `missing` are painted. A `\{{literal}}` the user escaped on purpose comes through
 * here in braces too, and it is not a mistake.
 */
function UrlPreview({ preview, missing, cyclic, envName, onAddMissing }: Props) {
  const { t } = useTranslation();

  return (
    <div className={styles.preview}>
      <p className={styles.line}>
        <span className={styles.label}>{t("rest.previewLabel")}</span>
        <code className={styles.url}>
          {preview.split(PIECES).map((piece, i) =>
            IS_VAR.test(piece) && missing.includes(piece.slice(2, -2)) ? (
              <em key={i} className={styles.missing}>
                {piece}
              </em>
            ) : (
              <span key={i}>{piece}</span>
            ),
          )}
        </code>
      </p>

      {cyclic ? (
        <p className={styles.blocked} role="alert">
          {t("rest.varCycle", { env: envName })}
        </p>
      ) : (
        missing.length > 0 && (
          <p className={styles.blocked} role="alert">
            <span>{t("rest.missingVars", { names: missing.join(", "), env: envName })}</span>
            <Button size="small" onClick={onAddMissing}>
              {t("rest.addMissingVars", { env: envName })}
            </Button>
          </p>
        )
      )}
    </div>
  );
}

export default UrlPreview;
```

Create `src/modules/rest/components/UrlPreview/UrlPreview.module.css`:

```css
.preview {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0 0.5rem 0.4rem;
  font-size: 0.85em;
}

.line {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  margin: 0;
  min-width: 0;
}

.label {
  flex: none;
  opacity: 0.6;
}

.url {
  min-width: 0;
  opacity: 0.85;
  /* A URL has no spaces to break at, and a preview that widened the pane would move the Send
     button out from under the pointer. */
  overflow-wrap: anywhere;
}

.missing {
  font-style: normal;
  color: #e03131;
}

.blocked {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: 0;
  color: #e03131;
}
```

Create `src/modules/rest/components/UrlPreview/index.ts`:

```ts
export { default } from "./UrlPreview";
```

- [ ] **Step 2: Let Send be turned off for a second reason**

In `src/modules/rest/components/UrlBar/UrlBar.tsx`, add the prop and use it:

```tsx
  /** Turns Send off for a reason that is not an empty URL: a variable the environment has no value
   *  for. What is wrong is said under the box, by `UrlPreview`, rather than in a tooltip here. */
  blocked?: boolean;
```

```tsx
function UrlBar({
  inputRef,
  method,
  url,
  sending,
  blocked = false,
  onMethodChange,
  onUrlChange,
  onPasteText,
  onSend,
  onCancel,
}: Props) {
```

```tsx
      <Button
        className={styles.send}
        variant="primary"
        onClick={sending ? onCancel : onSend}
        // Only the URL is required. A GET with nothing else filled in is a whole request.
        disabled={!sending && (url.trim() === "" || blocked)}
      >
```

Enter in the URL box sends too, so it takes the same guard:

```tsx
        onKeyDown={(e) => {
          if (e.key === "Enter" && !sending && !blocked) onSend();
        }}
```

- [ ] **Step 3: Resolve before building**

In `src/modules/rest/RestTab.tsx`, add to the imports:

```tsx
import UrlPreview from "./components/UrlPreview";
import { previewVars, varMap } from "./environments";
import { interpolate } from "./interpolate";
import { resolveRequest } from "./resolveRequest";
```

add `addVariables` to the existing `./environmentsStore` import, and `findEnvironment` is already there from Task 6.

Add these **after `const currentId = activeRequest?.id ?? null;`** — not beside `env`, which is declared further up. All three read `activeRequest`, and `activeRequest` is itself derived from `tabs`, so anything placed above that line reads a binding that does not exist yet:

```tsx
  /* Resolved once per render rather than at the moment of sending, so that the line under the URL
     box and the state of the Send button are two readings of one answer and cannot disagree. */
  const resolved = useMemo(
    () => (activeRequest === undefined ? null : resolveRequest(activeRequest, varMap(env))),
    [activeRequest, env],
  );
  /** The URL as the line below the box shows it: secrets as dots, anything unfilled still in its
   *  braces. Not drawn at all with no environment chosen, when it would only repeat the box. */
  const preview = useMemo(
    () =>
      activeRequest === undefined || env === null
        ? null
        : interpolate(activeRequest.url, previewVars(env) ?? {}).text,
    [activeRequest, env],
  );
  /** A request that asks for a value nobody has does not go out. Sending `{{token}}` as those nine
   *  characters helps nobody, and a server's answer to it is not an answer to anything. */
  const blocked = resolved !== null && (resolved.missing.length > 0 || resolved.cyclic);
```

Change the head of `send()`:

```tsx
  async function send() {
    if (!activeRequest || resolved === null || blocked) return;
    const request = activeRequest;
    const sendId = crypto.randomUUID();
    const wire = buildRequest(resolved.request, sendId, PHASE_ONE_SETTINGS);
```

The line that stamps the request is **unchanged**, and that is the point:

```tsx
    // `request`, not `resolved.request`. What is stored keeps its variables — writing the resolved
    // copy back would strip a request of the thing that made it portable and, the first time a
    // secret variable was used, would put a credential into `rest-requests.json`.
    saveRequest({ ...request, lastUsedAt: Date.now() });
```

Add the guard to the send shortcut:

```tsx
  useShortcut(
    "rest.send",
    () => void send(),
    active && activeRequest !== undefined && sendState.phase !== "sending" && !blocked,
  );
```

Pass `blocked` to `UrlBar` and put the line under it:

```tsx
              <UrlBar
                inputRef={urlRef}
                method={activeRequest.method}
                url={activeRequest.url}
                sending={sendState.phase === "sending"}
                blocked={blocked}
                onMethodChange={(method) => edit({ method })}
                onUrlChange={editUrl}
                onPasteText={pasteInto}
                onSend={() => void send()}
                onCancel={cancel}
              />
              {env !== null && preview !== null && resolved !== null && (
                <UrlPreview
                  preview={preview}
                  missing={resolved.missing}
                  cyclic={resolved.cyclic}
                  envName={env.name}
                  onAddMissing={() => {
                    addVariables(env.id, resolved.missing);
                    setEnvDialogOpen(true);
                  }}
                />
              )}
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run build`
Expected: every test passes, no type errors.

- [ ] **Step 5: Check it by hand**

Run `npm run dev:app` with the `Dev` environment from Task 6 (`host` = `httpbin.org`, `token` secret):

1. URL `https://{{host}}/get`, environment `Dev`: the line below reads `https://httpbin.org/get`, Send is on, and the response comes back.
2. Switch to *No environment*: the line disappears, Send is still on, and the response is a failure to reach a host called `{{host}}` — the text went out as text, which is Phase 1's behaviour and still correct.
3. Back on `Dev`, add a header `Authorization: Bearer {{token}}` and send: `httpbin` echoes the real token back. The preview line still shows only the URL.
4. Put `{{token}}` in the URL as a query value: the line shows `••••••` where the token is. The response shows the real one.
5. Add `{{nope}}` to the URL: it goes red in the line, Send goes grey, `Ctrl/Cmd+Enter` does nothing, and the message names `nope` and `Dev`.
6. Press *Add to “Dev”*: the dialog opens with a row called `nope` waiting for a value. Type one, close the dialog — Send comes back on.
7. Untick the header row holding `{{token}}` while `token` is deleted from the environment: Send stays on, because an unticked row is not sent.
8. Give `Dev` a variable `loop` = `{{loop}}` and put `{{loop}}` in the URL: the cycle message appears and Send is off.
9. Reopen the request from the sidebar and look at the URL box: it still says `{{host}}`, not `httpbin.org`. Check `rest-requests.json` — the same. **This is the check that matters most in this phase.**

- [ ] **Step 6: Commit (only if a commit was asked for)**

```bash
git add src/modules/rest/components/UrlPreview src/modules/rest/components/UrlBar src/modules/rest/RestTab.tsx
git commit -m "feat(rest): resolve variables on the way out and block a send that cannot"
```

---

### Task 8: The changelog, and the checks the tests cannot make

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Write the entry**

`## [Unreleased]` already has an `### Added` heading with the Phase 3 lines under it. Add one line to it — at the top, because the update panel shows the first line of a release's notes and this is the bigger of the three:

```markdown
### Added

- REST requests take `{{variables}}` from an environment picked at the end of the tab strip, with values marked secret kept in the OS credential store instead of on disk.
- REST requests carry credentials: a bearer token, basic auth, or an API key sent as a header or a query parameter.
- REST bodies can now be a form, a multipart upload with files from disk, or a single file sent as it is.
```

One line, `Added` because none of it existed, per [.agent/conventions/changelog.md](../../../.agent/conventions/changelog.md).

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

`npm run dev:app`, `https://httpbin.org` throughout:

1. Two environments, `Dev` and `Prod`, each with `host` and a secret `token`. Two REST tabs open, one on each: the same request sends to a different host from each tab, and neither tab moves when the other one does.
2. Rename `Dev` while a request in it is on screen: the dropdown and the blocked-send message both follow the new name.
3. Delete `Prod` while a tab is on it: that tab falls back to *No environment* and sends nothing unresolved.
4. Restart the app. The environments, their variables and the secret values are all back; the tab starts on whichever environment was chosen last.
5. Look in Windows Credential Manager (or Keychain / Secret Service): there is an entry under `MixDB` named `rest-env:<uuid>`, and it holds the token. `rest-environments.json` does not.
6. Untick Secret on that variable, wait a second, and look again: the value is now in the file and the entry no longer holds it. Tick it back and check the reverse.
7. `{{baseUrl}}` = `https://{{host}}` used in a request's URL: nesting resolves, and the preview shows the whole URL.
8. Paste a cURL command with `{{host}}` in its URL: the braces survive the paste, and the request resolves when sent.
9. **Copy as cURL** on a request with variables in it: the command holds the resolved values, because `toCurl` builds from the `WireRequest`. Paste it back and send — the same bytes go out.

- [ ] **Step 5: Commit (only if a commit was asked for)**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note REST environments and variables"
```

---

## What this phase deliberately leaves

- **No history and no Settings pane.** Phase 5. `PHASE_ONE_SETTINGS` is still where timeout, redirects and certificates come from, and nothing writes `rest-history.json` — including the `envName` field §2 reserves for it.
- **No per-request environment.** An environment belongs to the tab, as §2 says. A request that only ever makes sense against one environment is a request with that host typed into it.
- **No variable completion in the boxes.** Typing `{{` offers nothing; the preview line is what tells you whether you got the name right. A completion list over CodeMirror and over four plain inputs is its own piece of work.
- **No marker on a shadowed duplicate.** Two rows may share a name and the first wins — a rule with a test on it, but nothing in the dialog points at the second row to say it is doing nothing.
- **The keyboard is not aimed at the new row.** *Add to “Dev”* makes the rows and opens the dialog; which box has the keyboard is wherever the dialog puts it. Aiming it means waiting for the store to load before the row it names exists, which is more machinery than the second of typing it saves.
- **`{{var}}` is not resolved in a file path**, in either the multipart table or a binary body — §3's rule, kept as written.
- **No import or export of environments.** `rest-environments.json` is readable and copyable on purpose, which is most of what an export would be for.
