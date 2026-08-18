# REST Client Module — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the second MixDB module — a REST client tab that composes an HTTP request, sends it through Rust, and shows the response as a render, a tree or raw bytes.

**Architecture:** A folder under `src/modules/rest/` plus one line in `src/shell/registry.ts`, mirroring the `db` module. Rust holds two commands and no logic: `rest_send` takes an already-resolved request and returns bytes; `rest_cancel` cuts it short. Everything that can be got wrong — query-string syncing, content-type sniffing, the viewer's fallback chain, building the wire payload — is a pure TypeScript function under `npm test`.

**Tech Stack:** Tauri 2, React 19, TypeScript (strict), CSS Modules, `@tauri-apps/plugin-store`, vitest; Rust with `reqwest` (native-tls) and `tokio-util`.

**Spec:** [docs/superpowers/specs/2026-08-18-rest-client-module-design.md](../specs/2026-08-18-rest-client-module-design.md)

## Scope: Phase 1 only

The spec sets out five phases (§8). **This plan covers Phase 1 and nothing else.** Phase 1 is a working REST client on its own: open a tab, pick a method, type a URL, add params/headers, write a raw body, send, read the response.

Phases 2–5 (paste/cURL, Auth and the other body types, Environment, History and the Settings pane) each get their own plan, written against the code this one lands rather than against imagined signatures.

**One deliberate deviation from the spec's phasing.** The spec puts form-urlencoded, multipart and binary bodies in Phase 3. This plan implements their **transport** — `WireBody`'s four variants in Rust, and `buildRequest`'s mapping to them — in Phase 1, because that is the wire contract the spec says Rust should be written once for, and because both halves are a handful of lines each with real tests. Phase 3 then adds only the panes that let a user build those bodies. Nothing in Phase 1's UI can produce them.

## Global Constraints

- **Module boundary.** No file outside `src/modules/rest/` may know a REST concept, with exactly two exceptions: `src/shell/registry.ts` and `src/i18n/dicts.ts`, one line each. `tsc` does not check this — the two greps in `.agent/conventions/adding-a-module.md` do.
- **`src/components/` may not import from `src/modules/`.** The `Splitter` added in Task 2 is a primitive and stays free of REST concepts.
- **Every user-visible string goes through `t("...")`**, added to **both** `src/modules/rest/i18n/en.ts` and `vi.ts`. Non-ASCII is written as escapes (`"·"`).
- **A module dictionary imports nothing from `src/i18n/`** — `dicts.ts` imports it, so the reverse closes the circle.
- **No group name may appear in two dictionaries** except `error`, which is merged by hand in `dicts.ts`.
- **Components live in their own folder** with `Component.tsx`, `Component.module.css`, `index.ts`; consumers import the folder, never the `.tsx`.
- **Icons are inline SVG** on the 24×24 grid in `src/icons/icons.tsx`, exported alphabetically from `src/icons/index.ts`.
- **Tests are pure logic only.** vitest runs with no DOM: `describe`/`it`/`expect` from `"vitest"`. **No jsdom, no component tests, no `DOMParser` in a tested module.** `TextDecoder`, `atob` and `Uint8Array` are available in node; `DOMParser` is not.
- **TypeScript runs `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.**
- **Rust struct fields are snake_case on both sides** — serde does not rename them here. Tauri *does* convert camelCase command **arguments** to snake_case parameters.
- **A backend command touches five places** (`.agent/conventions/adding-a-command.md`); missing the `modules::handler()` line fails at runtime, not at build time.
- **Backend errors are `AppError`** via `err!("error.xxx")`, never an English sentence. The frontend renders them through `errorMessage(t, e)` from `src/core/errors.ts`.
- **Verification after every task:** `npm run build` (tsc + vite) and `npm test`. Rust tasks also `cargo check --manifest-path src-tauri/Cargo.toml`.
- **Commits use `<type>(<scope>): <message>`** — feat, fix, refactor, perf, docs, style, test, chore, ci, build. Concise, imperative, English. **Never add a `Co-Authored-By` trailer.**
- **Hardcoded send settings for Phase 1:** `timeout_ms: 30_000`, `follow_redirects: true`, `accept_invalid_certs: false`. The `WireRequest` contract carries all three from day one; Phase 5 only changes where the values come from.
- **No interpolation in Phase 1.** `{{var}}` travels to the wire as literal text. `interpolate.ts` does not exist yet.

## File structure

**Created — frontend**

| File | Responsibility |
| --- | --- |
| `src/components/Splitter/{Splitter.tsx,Splitter.module.css,clamp.ts,clamp.test.ts,index.ts}` | A draggable divider; `clamp.ts` is its arithmetic |
| `src/modules/rest/index.ts` | The `ModuleDefinition` |
| `src/modules/rest/types.ts` | `RestRequest`, `Body`, `Auth`, the wire types |
| `src/modules/rest/RestTab.tsx` | Sidebar │ splitter │ tab strip + request │ splitter │ response |
| `src/modules/rest/rest.css` | This module's global layout classes |
| `src/modules/rest/api.ts` | The only file that calls `invoke` for REST |
| `src/modules/rest/shortcuts.ts` | `REST_SHORTCUTS` |
| `src/modules/rest/i18n/{en,vi}.ts` | This module's strings |
| `src/modules/rest/requests.ts` + `.test.ts` | `rest-requests.json`, and the pure list reducers |
| `src/modules/rest/requestsStore.ts` | The shared list every REST tab reads |
| `src/modules/rest/workspace.ts` | `rest-workspace.json` — sidebar width, split ratio |
| `src/modules/rest/syncUrlParams.ts` + `.test.ts` | URL ⇄ Params, both directions |
| `src/modules/rest/contentType.ts` + `.test.ts` | Kind detection, `availableModes`, `pickMode` |
| `src/modules/rest/buildRequest.ts` + `.test.ts` | `RestRequest` → `WireRequest` |
| `src/modules/rest/format.ts` + `.test.ts` | `formatBytes`, `hexDump`, `prettyJson` |
| `src/modules/rest/jsonTree.ts` + `.test.ts` | JSON → tree nodes |
| `src/modules/rest/components/…` | `RequestList`, `UrlBar`, `KeyValueTable`, `BodyEditor`, `ResponseStatusBar`, `ResponsePane`, `TreeView`, `HexView`, `HtmlPreview` |

**Created — backend**

| File | Responsibility |
| --- | --- |
| `src-tauri/src/modules/rest/mod.rs` | `register()` |
| `src-tauri/src/modules/rest/models.rs` | `WireRequest`, `WireBody`, `WirePart`, `RestResponse` |
| `src-tauri/src/modules/rest/state.rs` | Client cache + in-flight cancellation tokens |
| `src-tauri/src/modules/rest/commands.rs` | `rest_send`, `rest_cancel` |

**Modified**

| File | Change |
| --- | --- |
| `src/shell/registry.ts` | One import, one entry in `MODULES` |
| `src/i18n/dicts.ts` | Two imports, two spreads, the `error` merge, the `Collision` type |
| `src/i18n/{en,vi}.ts` | `app.moduleRest` |
| `src/icons/icons.tsx`, `src/icons/index.ts` | `GlobeIcon`, `SendIcon`, `StopIcon` |
| `src-tauri/Cargo.toml` | `reqwest`, `tokio-util` |
| `src-tauri/src/lib.rs` | One `register` line |
| `src-tauri/src/modules/mod.rs` | `pub mod rest;` + a block in `handler()` |
| `CHANGELOG.md` | One line under `## [Unreleased]` / `### Added` |

---

### Task 1: Module scaffold, icons, strings, registry

Ends with: the `[+]` button opens a menu of two modules, and choosing **REST** opens a tab that says it is empty. This is the first time both the `[+]` menu branch and a two-entry `registry.ts` have ever run.

**Files:**
- Create: `src/modules/rest/index.ts`, `src/modules/rest/RestTab.tsx`, `src/modules/rest/rest.css`, `src/modules/rest/i18n/en.ts`, `src/modules/rest/i18n/vi.ts`
- Modify: `src/icons/icons.tsx`, `src/icons/index.ts`, `src/i18n/en.ts`, `src/i18n/vi.ts`, `src/i18n/dicts.ts`, `src/shell/registry.ts`
- Test: none — this is wiring. `npm run build` and a click are what verify it.

**Interfaces:**
- Consumes: `ModuleDefinition`, `ModuleTabProps` from `src/shell/module.ts`; `IconProps` from `src/icons`.
- Produces: `restModule: ModuleDefinition` (id `"rest"`); the `rest.*` translation group; `GlobeIcon`, `SendIcon`, `StopIcon`.

- [ ] **Step 1: Add the three icons**

In `src/icons/icons.tsx`, keeping the file's existing style:

```tsx
export function GlobeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9s1.3-6.3 3.8-9z" />
    </Icon>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12l16-8-6 8 6 8-16-8z" />
    </Icon>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Icon>
  );
}
```

Add `GlobeIcon`, `SendIcon`, `StopIcon` to the alphabetical export list in `src/icons/index.ts`.

- [ ] **Step 2: Write the module dictionary — English**

Create `src/modules/rest/i18n/en.ts`. This is every string Phase 1 needs; later tasks use these keys and add none.

```ts
/**
 * What the REST module calls things.
 *
 * Plain data, importing nothing from `src/i18n/`: `dicts.ts` imports this file, so anything
 * imported back out of there would close the circle.
 */
const restEn = {
  rest: {
    newTabTitle: "New request",
    newRequest: "New request",
    untitled: "Untitled request",
    saved: "Saved",
    recent: "Recent ({{n}}/{{max}})",
    filterPlaceholder: "Filter requests",
    noSaved: "Nothing saved yet.",
    noRecent: "Requests you paste land here.",
    emptyMain: "Press New request to start.",
    resizeSidebar: "Drag to resize the sidebar",
    resizePanes: "Drag to resize the request and response panes",
    // Request pane
    method: "Method",
    urlPlaceholder: "https://example.com/path",
    send: "Send",
    cancel: "Cancel",
    sending: "Sending…",
    paramsTab: "Params",
    bodyTab: "Body",
    requestHeadersTab: "Headers",
    keyColumn: "Key",
    valueColumn: "Value",
    rowEnabled: "Include this row",
    addRow: "Add row",
    removeRow: "Remove row",
    noRows: "Nothing here yet — type in the last row to add one.",
    bodyKind: "Body type",
    bodyNone: "None",
    bodyRaw: "Raw",
    bodyLanguage: "Language",
    langJson: "JSON",
    langXml: "XML",
    langHtml: "HTML",
    langText: "Text",
    bodyPlaceholder: "Request body",
    // Response pane
    responseEmpty: "Nothing sent yet.",
    cancelled: "Cancelled",
    previewTab: "Preview",
    sourceTab: "Source",
    rawTab: "Raw",
    responseHeadersTab: "Headers ({{n}})",
    totalTimeHint: "Total time, from the first byte sent to the last byte read",
    sizeHint: "Size of the response body",
    realSizeHint: "Cut for display — the body is really {{size}}",
    redirected: "Redirected",
    finalUrlHint: "Ended at {{url}}",
    wrapLines: "Wrap lines",
    loadExternal: "Load external resources",
    loadExternalHint:
      "Off by default: turning it on lets the page fetch images, styles and tracking pixels from the server it came from.",
    truncatedNotice: "Showing the first {{shown}} of {{total}}.",
    sourceTooBig: "The body is over {{limit}} — the tree is off so the app stays responsive. Raw still works.",
    binaryBody: "{{mime}} · {{size}}",
    binaryHint: "Nothing to render for this type.",
    copyValue: "Copy value",
    copyPath: "Copy path",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    // Sidebar menu
    rename: "Rename",
    renameTitle: "Rename request",
    duplicate: "Duplicate",
    delete: "Delete",
    deleteTitle: "Delete this request?",
    deleteMessage: "“{{name}}” will be gone for good.",
    copySuffix: "{{name}} copy",
    // Shortcuts
    shortcutScope: "REST",
    shortcutSend: "Send the request",
    shortcutNewRequest: "New request",
    shortcutCloseRequest: "Close the request tab",
  },
  error: {
    restTimeout: "The request timed out. {{message}}",
    restConnect: "Could not reach the server. {{message}}",
    restRedirectLoop: "Too many redirects. {{message}}",
    restInvalidUrl: "That is not a URL the client can send to. {{message}}",
    restFileUnreadable: "Could not read {{path}}. {{message}}",
    restBuildFailed: "The request could not be built. {{message}}",
    /* Never shown as a banner — the status bar says "Cancelled" instead. It is a code rather
       than a flag on the response because a cancelled send has no response to put a flag on. */
    restCancelled: "The request was cancelled.",
  },
};

export type RestDict = typeof restEn;

export default restEn;
```

- [ ] **Step 3: Write the module dictionary — Vietnamese**

Create `src/modules/rest/i18n/vi.ts` with the same keys. The `RestDict` annotation makes a missing key a type error here.

```ts
import type { RestDict } from "./en";

const restVi: RestDict = {
  rest: {
    newTabTitle: "Request mới",
    newRequest: "Request mới",
    untitled: "Request chưa đặt tên",
    saved: "Đã lưu",
    recent: "Gần đây ({{n}}/{{max}})",
    filterPlaceholder: "Lọc request",
    noSaved: "Chưa lưu gì.",
    noRecent: "Request dán vào sẽ nằm ở đây.",
    emptyMain: "Bấm Request mới để bắt đầu.",
    resizeSidebar: "Kéo để đổi rộng sidebar",
    resizePanes: "Kéo để chia lại request và response",
    method: "Method",
    urlPlaceholder: "https://example.com/path",
    send: "Gửi",
    cancel: "Huỷ",
    sending: "Đang gửi…",
    paramsTab: "Params",
    bodyTab: "Body",
    requestHeadersTab: "Headers",
    keyColumn: "Khoá",
    valueColumn: "Giá trị",
    rowEnabled: "Dùng dòng này",
    addRow: "Thêm dòng",
    removeRow: "Xoá dòng",
    noRows: "Chưa có gì — gõ vào dòng cuối để thêm.",
    bodyKind: "Kiểu body",
    bodyNone: "Không có",
    bodyRaw: "Raw",
    bodyLanguage: "Ngôn ngữ",
    langJson: "JSON",
    langXml: "XML",
    langHtml: "HTML",
    langText: "Text",
    bodyPlaceholder: "Nội dung request",
    responseEmpty: "Chưa gửi lần nào.",
    cancelled: "Đã huỷ",
    previewTab: "Preview",
    sourceTab: "Source",
    rawTab: "Raw",
    responseHeadersTab: "Headers ({{n}})",
    totalTimeHint: "Tổng thời gian, từ byte gửi đầu tiên tới byte đọc cuối cùng",
    sizeHint: "Kích thước body của response",
    realSizeHint: "Đã cắt để hiển thị — body thật là {{size}}",
    redirected: "Có redirect",
    finalUrlHint: "Kết thúc ở {{url}}",
    wrapLines: "Xuống dòng",
    loadExternal: "Tải tài nguyên ngoài",
    loadExternalHint:
      "Mặc định tắt: bật lên là trang tự gọi ảnh, CSS và cả pixel theo dõi tới máy chủ của nó.",
    truncatedNotice: "Đang hiện {{shown}} đầu trong {{total}}.",
    sourceTooBig: "Body lớn hơn {{limit}} — tắt cây để app không treo. Raw vẫn xem được.",
    binaryBody: "{{mime}} · {{size}}",
    binaryHint: "Kiểu này không render được.",
    copyValue: "Sao chép giá trị",
    copyPath: "Sao chép đường dẫn",
    expandAll: "Mở hết",
    collapseAll: "Gập hết",
    rename: "Đổi tên",
    renameTitle: "Đổi tên request",
    duplicate: "Nhân bản",
    delete: "Xoá",
    deleteTitle: "Xoá request này?",
    deleteMessage: "“{{name}}” sẽ mất hẳn.",
    copySuffix: "{{name}} copy",
    shortcutScope: "REST",
    shortcutSend: "Gửi request",
    shortcutNewRequest: "Request mới",
    shortcutCloseRequest: "Đóng tab request",
  },
  error: {
    restTimeout: "Request quá thời gian chờ. {{message}}",
    restConnect: "Không tới được máy chủ. {{message}}",
    restRedirectLoop: "Redirect quá nhiều lần. {{message}}",
    restInvalidUrl: "Đây không phải URL gửi được. {{message}}",
    restFileUnreadable: "Không đọc được {{path}}. {{message}}",
    restBuildFailed: "Không dựng được request. {{message}}",
    restCancelled: "Request đã bị huỷ.",
  },
};

export default restVi;
```

- [ ] **Step 4: Add the module's name to the shared dictionary**

The `[+]` menu label belongs to the shell's list, next to `moduleDatabase`. In `src/i18n/en.ts`, inside the `app` group after `moduleDatabase`:

```ts
    moduleRest: "REST",
```

And in `src/i18n/vi.ts`, in the same place:

```ts
    moduleRest: "REST",
```

- [ ] **Step 5: Merge the dictionary in `dicts.ts`**

Replace the body of `src/i18n/dicts.ts` below the imports. The `Collision` type has to grow a term per pair of dictionaries — that is what makes a repeated group a build error instead of a silently swallowed one.

```ts
import shared from "./en";
import sharedVi from "./vi";
import dbEn from "../modules/db/i18n/en";
import dbVi from "../modules/db/i18n/vi";
import restEn from "../modules/rest/i18n/en";
import restVi from "../modules/rest/i18n/vi";
```

```ts
export const EN = {
  ...shared,
  ...dbEn,
  ...restEn,
  error: { ...shared.error, ...dbEn.error, ...restEn.error },
};

export const VI = {
  ...sharedVi,
  ...dbVi,
  ...restVi,
  error: { ...sharedVi.error, ...dbVi.error, ...restVi.error },
};
```

```ts
/* Outside `error`, no two dictionaries may name the same group: the second spread would silently
   replace the first and take every key of that group with it. One term per pair, so a third
   module adds three. */
type Collision =
  | Exclude<Extract<keyof typeof shared, keyof typeof dbEn>, "error">
  | Exclude<Extract<keyof typeof shared, keyof typeof restEn>, "error">
  | Exclude<Extract<keyof typeof dbEn, keyof typeof restEn>, "error">;
const noCollision: [Collision] extends [never] ? true : never = true;
void noCollision;
```

- [ ] **Step 6: Write the placeholder tab and its stylesheet**

Create `src/modules/rest/rest.css`:

```css
/* This module's layout. Component-scoped rules live in each component's CSS Module instead. */
.rest-tab {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.rest-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
}
```

Create `src/modules/rest/RestTab.tsx`:

```tsx
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import "./rest.css";

/** The REST client's whole workspace. Filled in over the tasks that follow. */
function RestTab({}: ModuleTabProps) {
  const { t } = useTranslation();
  return (
    <div className="rest-tab">
      <p className="rest-empty muted">{t("rest.emptyMain")}</p>
    </div>
  );
}

export default RestTab;
```

- [ ] **Step 7: Write the module definition**

Create `src/modules/rest/index.ts`:

```ts
import type { ModuleDefinition } from "../../shell/module";
import { GlobeIcon } from "../../icons";
import RestTab from "./RestTab";

/** REST client: composing an HTTP request, sending it, and reading what came back. */
export const restModule: ModuleDefinition = {
  id: "rest",
  labelKey: "app.moduleRest",
  Icon: GlobeIcon,
  defaultTitleKey: "rest.newTabTitle",
  Tab: RestTab,
};
```

- [ ] **Step 8: Register it**

In `src/shell/registry.ts`, one import and one entry. `DEFAULT_MODULE_ID` stays `"db"` — `Ctrl+T` and a plain click keep opening what they always did.

```ts
import { dbModule } from "../modules/db";
import { restModule } from "../modules/rest";

export const MODULES: ModuleDefinition[] = [dbModule, restModule];
```

- [ ] **Step 9: Verify the build and the boundary**

```bash
npm run build
npm test
```
Expected: both pass. Then the two boundary greps from `.agent/conventions/adding-a-module.md`:

```powershell
Get-ChildItem -Recurse src/components,src/core,src/icons -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: nothing.

```powershell
Get-ChildItem -Recurse src/shell,src/i18n -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: only `src/shell/registry.ts` (now two lines) and `src/i18n/dicts.ts` (now four).

- [ ] **Step 10: Verify by hand — the two things nothing has ever exercised**

```bash
npm run dev:app
```
Check, and note the result:
1. The `[+]` button opens a **menu**, not a tab. It lists **Database** and **REST**, each with its icon.
2. Choosing REST opens a tab titled "New request" carrying the globe icon, showing "Press New request to start."
3. Choosing Database still opens the connection form.
4. `Ctrl+T` still opens a database tab.

- [ ] **Step 11: Commit**

```bash
git add src/modules/rest src/icons src/i18n src/shell/registry.ts
git commit -m "feat(rest): add the REST module shell and register it"
```

---

### Task 2: The `Splitter` primitive

Two divider bars are needed — sidebar ⇄ main, and request ⇄ response — one measured in pixels and one as a ratio. The component owns the drag; the caller owns the arithmetic, which is a pure function with tests.

The three hand-written resizers in `SqlWorkspace` / `MongoWorkspace` / `RedisWorkspace` are **not touched**. Moving them onto this is a separate commit, decided later.

**Files:**
- Create: `src/components/Splitter/clamp.ts`, `src/components/Splitter/clamp.test.ts`, `src/components/Splitter/Splitter.tsx`, `src/components/Splitter/Splitter.module.css`, `src/components/Splitter/index.ts`

**Interfaces:**
- Consumes: nothing but React.
- Produces: `Splitter` (default export of the folder), `clampSize(start, delta, min, max): number`, `clampRatio(start, deltaPx, totalPx, min, max): number`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Splitter/clamp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampRatio, clampSize } from "./clamp";

describe("clampSize", () => {
  it("adds the drag to where the drag started", () => {
    expect(clampSize(240, 60, 160, 480)).toBe(300);
  });

  it("moves left on a negative drag", () => {
    expect(clampSize(240, -60, 160, 480)).toBe(180);
  });

  it("stops at the minimum however far the pointer goes", () => {
    expect(clampSize(240, -900, 160, 480)).toBe(160);
  });

  it("stops at the maximum", () => {
    expect(clampSize(240, 900, 160, 480)).toBe(480);
  });
});

describe("clampRatio", () => {
  it("turns a drag in pixels into a share of the whole", () => {
    expect(clampRatio(0.5, 100, 1000, 0.2, 0.8)).toBeCloseTo(0.6);
  });

  it("stops at the minimum share", () => {
    expect(clampRatio(0.5, -1000, 1000, 0.2, 0.8)).toBeCloseTo(0.2);
  });

  it("stops at the maximum share", () => {
    expect(clampRatio(0.5, 1000, 1000, 0.2, 0.8)).toBeCloseTo(0.8);
  });

  // A pane laid out but not yet measured reports zero, and dividing by it would give NaN — which
  // travels into a style attribute and collapses the layout rather than failing anywhere visible.
  it("leaves the ratio alone when the container has no width yet", () => {
    expect(clampRatio(0.5, 100, 0, 0.2, 0.8)).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/Splitter/clamp.test.ts`
Expected: FAIL — `Failed to resolve import "./clamp"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/Splitter/clamp.ts`:

```ts
/**
 * Where a divider ends up, given where the drag started and how far it has gone.
 *
 * Kept apart from the component because it is the half that can be wrong: the drag itself is four
 * event listeners, and this is the arithmetic that decides whether a pane can be dragged shut.
 */

/** A pane's new size in pixels. */
export function clampSize(start: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, start + delta));
}

/** A pane's new share of the space, for a divider that splits by ratio rather than by width.
 *  A container with no width yet gives no share to compute, so the ratio is left as it was. */
export function clampRatio(
  start: number,
  deltaPx: number,
  totalPx: number,
  min: number,
  max: number,
): number {
  if (totalPx <= 0) return start;
  return Math.min(max, Math.max(min, start + deltaPx / totalPx));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/Splitter/clamp.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the component**

Create `src/components/Splitter/Splitter.module.css`:

```css
.splitter {
  align-self: stretch;
  position: relative;
  flex: 0 0 5px;
}

.vertical {
  cursor: col-resize;
}

.horizontal {
  flex: 0 0 5px;
  width: 100%;
  cursor: row-resize;
}

.splitter::after {
  content: "";
  position: absolute;
  background: var(--border);
}

.vertical::after {
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
}

.horizontal::after {
  left: 0;
  right: 0;
  top: 2px;
  height: 1px;
}

.vertical:hover::after,
.vertical:active::after {
  left: 1px;
  width: 3px;
  background: var(--accent);
}

.horizontal:hover::after,
.horizontal:active::after {
  top: 1px;
  height: 3px;
  background: var(--accent);
}
```

Create `src/components/Splitter/Splitter.tsx`:

```tsx
import { useCallback } from "react";
import styles from "./Splitter.module.css";

interface SplitterProps {
  /** Which way the bar runs. `vertical` is a bar between two panes side by side. */
  orientation: "vertical" | "horizontal";
  /** Read aloud; the bar has no text of its own. */
  ariaLabel: string;
  title?: string;
  /** The drag is about to start — the caller records whatever it is about to move from. */
  onDragStart?: () => void;
  /** How far the pointer has come since the drag began, in pixels. Positive is right, or down. */
  onDrag: (delta: number) => void;
  /** The same distance, once, when the button is let go — where a caller persists the result. */
  onDragEnd?: (delta: number) => void;
  onDoubleClick?: () => void;
}

/**
 * The bar between two panes.
 *
 * It reports distances and nothing else: what a pixel of drag means is the caller's, because one
 * divider moves a sidebar in pixels and the next splits a pane by ratio. Listeners go on the
 * document rather than the bar, so a fast drag that outruns the pointer keeps resizing.
 */
function Splitter({
  orientation,
  ariaLabel,
  title,
  onDragStart,
  onDrag,
  onDragEnd,
  onDoubleClick,
}: SplitterProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Otherwise the webview starts a text selection and the panes flicker blue under the drag.
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const distance = (ev: MouseEvent) =>
        orientation === "vertical" ? ev.clientX - startX : ev.clientY - startY;
      onDragStart?.();

      function onMouseMove(ev: MouseEvent) {
        onDrag(distance(ev));
      }
      function onMouseUp(ev: MouseEvent) {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        onDragEnd?.(distance(ev));
      }
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [orientation, onDrag, onDragEnd, onDragStart],
  );

  return (
    <div
      className={`${styles.splitter} ${styles[orientation]}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      title={title}
    />
  );
}

export default Splitter;
```

Create `src/components/Splitter/index.ts`:

```ts
export { default } from "./Splitter";
export { clampRatio, clampSize } from "./clamp";
```

- [ ] **Step 6: Verify**

Run: `npm run build && npm test`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/Splitter
git commit -m "feat(components): add a shared Splitter with tested clamping"
```

---

### Task 3: Types, the request list on disk, and the workspace file

Ends with: the request list is a shared store every REST tab reads, with pure reducers under test. Nothing renders it yet.

**Files:**
- Create: `src/modules/rest/types.ts`, `src/modules/rest/requests.ts`, `src/modules/rest/requests.test.ts`, `src/modules/rest/requestsStore.ts`, `src/modules/rest/workspace.ts`

**Interfaces:**
- Consumes: `Store` from `@tauri-apps/plugin-store`; the `useSyncExternalStore` pattern of `src/modules/db/savedConnectionsStore.ts`.
- Produces:
  - `types.ts`: `Method`, `METHODS`, `KeyValue`, `RawLanguage`, `Body`, `MultipartField`, `Auth`, `RestRequest`, `RequestLists`, `WireRequest`, `WireBody`, `WirePart`, `RestResponse`.
  - `requests.ts`: `RECENT_LIMIT = 10`, `newRequest(id, now): RestRequest`, `newRow(id): KeyValue`, `addSaved(lists, req)`, `updateRequest(lists, req)`, `removeRequest(lists, id)`, `findRequest(lists, id)`, `loadRequests(): Promise<RequestLists>`, `persistRequests(lists): void`.
  - `requestsStore.ts`: `useRequestLists(): RequestLists`, `saveRequest(req)`, `createRequest(): RestRequest`, `deleteRequest(id)`.
  - `workspace.ts`: `useWorkspace()`, `setSidebarWidth(px)`, `setSplitRatio(r)`, `DEFAULT_SIDEBAR_WIDTH`, `DEFAULT_SPLIT_RATIO`.

- [ ] **Step 1: Write `types.ts`**

Every type the spec's §2 and §3 name, written once. `Auth` and three of the five `Body` variants have no UI until Phase 3 — the types are here now so the file, and the JSON on disk, do not change shape under them.

```ts
/** The types the REST module is made of, and the ones it shares with Rust.
 *
 *  Nothing verifies that the wire types below still match `src-tauri/src/modules/rest/models.rs`
 *  — changing one means changing the other by hand. Fields stay snake_case on both sides because
 *  serde does not rename them. */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** In the order the dropdown offers them: the two everyone wants first. */
export const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** One row of the Params or Headers table. Unticked rows are kept and left out of the request —
 *  the only way to park a header without losing what was typed in it. */
export interface KeyValue {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
}

export type RawLanguage = "json" | "xml" | "html" | "text";

/** A multipart field is a key/value row that may carry a file path instead of a value. */
export interface MultipartField extends KeyValue {
  file?: string;
}

export type Body =
  | { kind: "none" }
  | { kind: "raw"; language: RawLanguage; text: string }
  | { kind: "form"; fields: KeyValue[] }
  | { kind: "multipart"; fields: MultipartField[] }
  | { kind: "binary"; filePath: string };

export type Auth =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "basic"; username: string; password: string }
  | { kind: "apiKey"; name: string; value: string; in: "header" | "query" };

export interface RestRequest {
  id: string;
  /** Empty means the sidebar shows a shortened URL instead. */
  name: string;
  method: Method;
  /** Kept with `{{var}}` in it; resolving happens on the way to the wire, from Phase 4. */
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  body: Body;
  auth: Auth;
  origin: "manual" | "paste";
  createdAt: number;
  /** Stamped when Send is pressed, not when the tab is opened — see the spec's §5. */
  lastUsedAt: number;
}

/** The two groups of the sidebar, which is also the shape of `rest-requests.json`. */
export interface RequestLists {
  saved: RestRequest[];
  recent: RestRequest[];
}

/* ── The wire ── */

export type WireBody =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "file"; path: string }
  | { kind: "multipart"; parts: WirePart[] };

export interface WirePart {
  name: string;
  /** The field's text, for a plain part. */
  value: string | null;
  /** A file to send instead, read and streamed by Rust. */
  path: string | null;
}

export interface WireRequest {
  /** What `rest_cancel` names. Minted per send, not per request: two sends of the same request
   *  are two things to cancel. */
  request_id: string;
  method: Method;
  /** Final. Params are already folded in and, from Phase 4, variables already resolved. */
  url: string;
  /** A list rather than a map: `Set-Cookie` may repeat, and so may anything the user types twice. */
  headers: [string, string][];
  body: WireBody;
  timeout_ms: number;
  follow_redirects: boolean;
  accept_invalid_certs: boolean;
}

export interface RestResponse {
  status: number;
  status_text: string;
  http_version: string;
  headers: [string, string][];
  /** Base64 even for text: a response may be an image, a PDF or gzip, and Rust cannot assume
   *  UTF-8. The webview decodes to bytes and decides for itself whether they are readable. */
  body_base64: string;
  /** The real length, including whatever was cut. */
  body_size: number;
  truncated: boolean;
  final_url: string;
  total_ms: number;
  ttfb_ms: number;
}
```

- [ ] **Step 2: Write the failing test for the list reducers**

Create `src/modules/rest/requests.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addSaved, findRequest, newRequest, removeRequest, updateRequest } from "./requests";
import type { RequestLists } from "./types";

function lists(over: Partial<RequestLists> = {}): RequestLists {
  return { saved: [], recent: [], ...over };
}

describe("newRequest", () => {
  it("starts as a GET nobody has named, made by hand", () => {
    const req = newRequest("id-1", 1000);
    expect(req.id).toBe("id-1");
    expect(req.method).toBe("GET");
    expect(req.url).toBe("");
    expect(req.name).toBe("");
    expect(req.origin).toBe("manual");
    expect(req.body).toEqual({ kind: "none" });
    expect(req.auth).toEqual({ kind: "none" });
    expect(req.createdAt).toBe(1000);
    expect(req.lastUsedAt).toBe(1000);
  });

  it("starts with no rows in either table", () => {
    const req = newRequest("id-1", 1000);
    expect(req.params).toEqual([]);
    expect(req.headers).toEqual([]);
  });
});

describe("addSaved", () => {
  it("puts a new request at the top of Saved", () => {
    const a = newRequest("a", 1);
    const b = newRequest("b", 2);
    const after = addSaved(addSaved(lists(), a), b);
    expect(after.saved.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("leaves Recent alone", () => {
    const recent = [newRequest("r", 1)];
    expect(addSaved(lists({ recent }), newRequest("a", 2)).recent).toBe(recent);
  });
});

describe("updateRequest", () => {
  it("replaces the request in whichever group holds it", () => {
    const edited = { ...newRequest("r", 1), url: "https://example.com" };
    const after = updateRequest(lists({ recent: [newRequest("r", 1)] }), edited);
    expect(after.recent[0].url).toBe("https://example.com");
  });

  it("keeps the request where it was rather than promoting it", () => {
    const edited = { ...newRequest("r", 1), url: "https://example.com" };
    const after = updateRequest(lists({ recent: [newRequest("r", 1)] }), edited);
    expect(after.saved).toEqual([]);
  });

  // Drafts follow the request, and the request may have been dropped from Recent while a tab on
  // it was still open. Nothing to update is not an error — it is a tab outliving its row.
  it("changes nothing when the request is in neither group", () => {
    const before = lists({ saved: [newRequest("a", 1)] });
    expect(updateRequest(before, newRequest("ghost", 2))).toEqual(before);
  });
});

describe("removeRequest", () => {
  it("takes it out of Saved", () => {
    const after = removeRequest(lists({ saved: [newRequest("a", 1), newRequest("b", 2)] }), "a");
    expect(after.saved.map((r) => r.id)).toEqual(["b"]);
  });

  it("takes it out of Recent", () => {
    const after = removeRequest(lists({ recent: [newRequest("r", 1)] }), "r");
    expect(after.recent).toEqual([]);
  });
});

describe("findRequest", () => {
  it("looks in both groups", () => {
    const both = lists({ saved: [newRequest("a", 1)], recent: [newRequest("r", 2)] });
    expect(findRequest(both, "a")?.id).toBe("a");
    expect(findRequest(both, "r")?.id).toBe("r");
    expect(findRequest(both, "nope")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run src/modules/rest/requests.test.ts`
Expected: FAIL — `Failed to resolve import "./requests"`.

- [ ] **Step 4: Write `requests.ts`**

```ts
import { Store } from "@tauri-apps/plugin-store";
import type { KeyValue, RequestLists, RestRequest } from "./types";

/**
 * The request list on disk, and the pure reducers that shape it.
 *
 * Two groups, both flat: **Saved** is what someone chose to keep, **Recent** is what pasting a
 * cURL command left behind. Only the reducers are tested; the file access around them is four
 * lines of `Store` and has nothing to get wrong.
 */

/** How many pasted requests are kept. Filling up drops the one least recently *sent* — see the
 *  spec's §5. Enforced from Phase 2, which is where anything is put in Recent at all. */
export const RECENT_LIMIT = 10;

const FILE = "rest-requests.json";
const KEY = "lists";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(FILE);
  return storePromise;
}

/** An empty row for the Params or Headers table. Ticked, because a row is typed in to be used. */
export function newRow(id: string): KeyValue {
  return { id, enabled: true, key: "", value: "" };
}

/** A request as it starts life: a GET with nothing in it. */
export function newRequest(id: string, now: number): RestRequest {
  return {
    id,
    name: "",
    method: "GET",
    url: "",
    params: [],
    headers: [],
    body: { kind: "none" },
    auth: { kind: "none" },
    origin: "manual",
    createdAt: now,
    lastUsedAt: now,
  };
}

export function findRequest(lists: RequestLists, id: string): RestRequest | undefined {
  return lists.saved.find((r) => r.id === id) ?? lists.recent.find((r) => r.id === id);
}

/** Newest first, which is where someone looks for what they just made. */
export function addSaved(lists: RequestLists, request: RestRequest): RequestLists {
  return { ...lists, saved: [request, ...lists.saved] };
}

/**
 * The list with this request's new state in it, in the group it is already in.
 *
 * Editing a Recent request does **not** promote it to Saved — pinning is the only thing that
 * does. A request in neither group is one whose row went away while a tab on it stayed open, and
 * the list is returned untouched.
 */
export function updateRequest(lists: RequestLists, request: RestRequest): RequestLists {
  const swap = (list: RestRequest[]) => list.map((r) => (r.id === request.id ? request : r));
  return { saved: swap(lists.saved), recent: swap(lists.recent) };
}

export function removeRequest(lists: RequestLists, id: string): RequestLists {
  return {
    saved: lists.saved.filter((r) => r.id !== id),
    recent: lists.recent.filter((r) => r.id !== id),
  };
}

/** What is on disk, or two empty groups. A file that cannot be read is an empty sidebar for the
 *  session, not a crash. */
export async function loadRequests(): Promise<RequestLists> {
  const store = await getStore();
  const stored = await store.get<RequestLists>(KEY);
  return { saved: stored?.saved ?? [], recent: stored?.recent ?? [] };
}

/** Writes the list as it now stands. Failures are swallowed: the list is still right in memory,
 *  and nothing here is worth interrupting someone's typing over. */
export function persistRequests(lists: RequestLists): void {
  void getStore()
    .then(async (store) => {
      await store.set(KEY, lists);
      await store.save();
    })
    .catch(() => {});
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/modules/rest/requests.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Write the shared store**

Create `src/modules/rest/requestsStore.ts`, following `savedConnectionsStore.ts` exactly:

```ts
import { useEffect, useSyncExternalStore } from "react";
import {
  addSaved,
  loadRequests,
  newRequest,
  persistRequests,
  removeRequest,
  updateRequest,
} from "./requests";
import type { RequestLists, RestRequest } from "./types";

/**
 * The request list, shared by every REST tab.
 *
 * One thing on disk is one thing in memory: read once, written through here, handed to every tab
 * that asks. A request edited in one tab is the same request in the next — which matters more
 * here than for connections, because a draft lives in the request itself.
 */

const EMPTY: RequestLists = { saved: [], recent: [] };

let snapshot: RequestLists = EMPTY;
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(lists: RequestLists) {
  snapshot = lists;
  loaded = true;
  for (const listener of listeners) listener();
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
    inFlight = loadRequests()
      .then(publish)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

export function useRequestLists(): RequestLists {
  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** What the store currently holds, for callers outside a component — the send path, which needs
 *  the request as it stands rather than as it was when a handler was made. */
export function currentLists(): RequestLists {
  return snapshot;
}

/** A fresh request at the top of Saved, returned so the caller can open a tab on it. */
export function createRequest(): RestRequest {
  const request = newRequest(crypto.randomUUID(), Date.now());
  const lists = addSaved(snapshot, request);
  publish(lists);
  persistRequests(lists);
  return request;
}

/**
 * Writes a request's new state through, wherever it lives.
 *
 * This is the whole of "saving": there is no unsaved state, no Save button and no dialog asking
 * whether to keep anything, because every edit lands here as it is made.
 */
export function saveRequest(request: RestRequest): void {
  const lists = updateRequest(snapshot, request);
  publish(lists);
  persistRequests(lists);
}

export function deleteRequest(id: string): void {
  const lists = removeRequest(snapshot, id);
  publish(lists);
  persistRequests(lists);
}
```

- [ ] **Step 7: Write the workspace store**

Create `src/modules/rest/workspace.ts`. Small enough to hold both the read and the write; it is the one file the later phases add `lastEnvId` and the send settings to.

```ts
import { useEffect, useSyncExternalStore } from "react";
import { Store } from "@tauri-apps/plugin-store";

/**
 * How the REST workspace is laid out, kept between sessions.
 *
 * The shell remembers no tabs, so nothing here is about which requests were open — only about
 * the furniture, which is the same in every REST tab and so belongs to the app rather than to one
 * of them. Phase 4 adds `lastEnvId` here and Phase 5 the send settings.
 */

export interface Workspace {
  sidebarWidth: number;
  /** The request pane's share of the width between the two. */
  splitRatio: number;
}

export const DEFAULT_SIDEBAR_WIDTH = 260;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 520;
export const DEFAULT_SPLIT_RATIO = 0.5;
export const MIN_SPLIT_RATIO = 0.2;
export const MAX_SPLIT_RATIO = 0.8;

const FILE = "rest-workspace.json";
const KEY = "workspace";
const DEFAULTS: Workspace = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  splitRatio: DEFAULT_SPLIT_RATIO,
};

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) storePromise = Store.load(FILE);
  return storePromise;
}

let snapshot: Workspace = DEFAULTS;
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Workspace) {
  snapshot = next;
  loaded = true;
  for (const listener of listeners) listener();
}

function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = getStore()
      .then(async (store) => publish({ ...DEFAULTS, ...(await store.get<Workspace>(KEY)) }))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

function write(next: Workspace): void {
  publish(next);
  void getStore()
    .then(async (store) => {
      await store.set(KEY, next);
      await store.save();
    })
    .catch(() => {});
}

export function useWorkspace(): Workspace {
  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
  );
}

export function setSidebarWidth(sidebarWidth: number): void {
  write({ ...snapshot, sidebarWidth });
}

export function setSplitRatio(splitRatio: number): void {
  write({ ...snapshot, splitRatio });
}
```

- [ ] **Step 8: Verify**

Run: `npm run build && npm test`
Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add src/modules/rest
git commit -m "feat(rest): add the request types, the list on disk and the workspace store"
```

---

### Task 4: `syncUrlParams` — the URL box and the Params table, both ways

**Files:**
- Create: `src/modules/rest/syncUrlParams.ts`, `src/modules/rest/syncUrlParams.test.ts`

**Interfaces:**
- Consumes: `KeyValue` from `./types`.
- Produces: `paramsFromUrl(url, existing, nextId): KeyValue[]`, `urlWithParams(url, params): string`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/rest/syncUrlParams.test.ts`. `nextId` is passed in rather than called for, so the function stays pure and the test can name the rows it expects.

```ts
import { describe, expect, it } from "vitest";
import { paramsFromUrl, urlWithParams } from "./syncUrlParams";
import type { KeyValue } from "./types";

/** Ids in order, so a test can say which row it means. */
function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

function row(over: Partial<KeyValue> & { id: string }): KeyValue {
  return { enabled: true, key: "", value: "", ...over };
}

describe("paramsFromUrl", () => {
  it("makes a row per query parameter", () => {
    expect(paramsFromUrl("https://x.test/a?page=2&q=hi", [], counter())).toEqual([
      row({ id: "new-1", key: "page", value: "2" }),
      row({ id: "new-2", key: "q", value: "hi" }),
    ]);
  });

  it("decodes percent escapes and pluses", () => {
    const params = paramsFromUrl("https://x.test/a?q=a%20b+c&t=%26", [], counter());
    expect(params.map((p) => p.value)).toEqual(["a b c", "&"]);
  });

  it("gives a parameter with no value an empty one", () => {
    expect(paramsFromUrl("https://x.test/a?flag", [], counter())[0]).toEqual(
      row({ id: "new-1", key: "flag", value: "" }),
    );
  });

  // The URL is the only source for the rows that are in it, so a row that was there keeps its id
  // and its tick and is simply refilled — which is what stops the table's rows jumping about as
  // the URL is typed.
  it("refills the rows already there rather than replacing them", () => {
    const existing = [row({ id: "kept", key: "page", value: "1" })];
    expect(paramsFromUrl("https://x.test/a?page=9", existing, counter())).toEqual([
      row({ id: "kept", key: "page", value: "9" }),
    ]);
  });

  // An unticked row is not in the URL, so the URL cannot say anything about it — it stays put,
  // which is the whole point of being able to untick one.
  it("keeps unticked rows and passes over them", () => {
    const existing = [
      row({ id: "off", enabled: false, key: "debug", value: "1" }),
      row({ id: "on", key: "page", value: "1" }),
    ];
    expect(paramsFromUrl("https://x.test/a?page=2", existing, counter())).toEqual([
      row({ id: "off", enabled: false, key: "debug", value: "1" }),
      row({ id: "on", key: "page", value: "2" }),
    ]);
  });

  it("drops the ticked rows the URL no longer has", () => {
    const existing = [row({ id: "a", key: "page", value: "1" }), row({ id: "b", key: "q", value: "x" })];
    expect(paramsFromUrl("https://x.test/a?page=1", existing, counter()).map((p) => p.id)).toEqual(["a"]);
  });

  it("finds nothing in a URL with no query", () => {
    expect(paramsFromUrl("https://x.test/a", [], counter())).toEqual([]);
  });

  it("stops at the fragment", () => {
    expect(paramsFromUrl("https://x.test/a?page=2#section", [], counter())).toEqual([
      row({ id: "new-1", key: "page", value: "2" }),
    ]);
  });
});

describe("urlWithParams", () => {
  it("writes the ticked rows back onto the URL", () => {
    const params = [row({ id: "a", key: "page", value: "2" }), row({ id: "b", key: "q", value: "hi" })];
    expect(urlWithParams("https://x.test/a", params)).toBe("https://x.test/a?page=2&q=hi");
  });

  it("replaces whatever query was there", () => {
    expect(urlWithParams("https://x.test/a?old=1", [row({ id: "a", key: "new", value: "2" })])).toBe(
      "https://x.test/a?new=2",
    );
  });

  it("leaves unticked rows out", () => {
    const params = [row({ id: "a", enabled: false, key: "debug", value: "1" })];
    expect(urlWithParams("https://x.test/a?debug=1", params)).toBe("https://x.test/a");
  });

  it("leaves out a row with no key, which is the empty row waiting to be typed in", () => {
    expect(urlWithParams("https://x.test/a", [row({ id: "a", key: "", value: "x" })])).toBe("https://x.test/a");
  });

  it("encodes what would otherwise change the query's shape", () => {
    const params = [row({ id: "a", key: "q", value: "a b&c=d" })];
    expect(urlWithParams("https://x.test/a", params)).toBe("https://x.test/a?q=a%20b%26c%3Dd");
  });

  // A variable that came out as `%7B%7Btoken%7D%7D` would no longer be one: Phase 4 resolves
  // `{{name}}` on the finished URL, and the braces have to survive to be found there.
  it("leaves a {{variable}} legible", () => {
    const params = [row({ id: "a", key: "key", value: "{{apiKey}}" })];
    expect(urlWithParams("https://x.test/a", params)).toBe("https://x.test/a?key={{apiKey}}");
  });

  it("keeps the fragment at the end", () => {
    expect(urlWithParams("https://x.test/a#top", [row({ id: "a", key: "page", value: "2" })])).toBe(
      "https://x.test/a?page=2#top",
    );
  });

  it("round-trips a URL through the table and back", () => {
    const url = "https://x.test/a?page=2&q=a%20b";
    expect(urlWithParams(url, paramsFromUrl(url, [], counter()))).toBe(url);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/modules/rest/syncUrlParams.test.ts`
Expected: FAIL — `Failed to resolve import "./syncUrlParams"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/rest/syncUrlParams.ts`:

```ts
import type { KeyValue } from "./types";

/**
 * The URL box and the Params table are two views of one thing.
 *
 * Written by hand rather than with `URL` and `URLSearchParams`, for two reasons that both matter:
 * the box holds text that is not a URL yet while it is being typed, and it holds `{{var}}`, which
 * `URLSearchParams` would percent-encode into something Phase 4 could no longer recognise.
 */

interface Parts {
  base: string;
  query: string;
  hash: string;
}

/** The URL cut into the three pieces this file cares about. The fragment comes off first: a `?`
 *  after a `#` is part of the fragment, not a query. */
function parts(url: string): Parts {
  const hashAt = url.indexOf("#");
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const rest = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = rest.indexOf("?");
  return {
    base: queryAt === -1 ? rest : rest.slice(0, queryAt),
    query: queryAt === -1 ? "" : rest.slice(queryAt + 1),
    hash,
  };
}

/** A stray `%` is what someone is halfway through typing, not a reason to throw. */
function decode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

/** Encoded, except for the braces of a variable — see the note at the top of the file. */
function encode(text: string): string {
  return encodeURIComponent(text).replace(/%7B%7B/gi, "{{").replace(/%7D%7D/gi, "}}");
}

/**
 * The Params table for this URL, keeping as much of the table already there as the URL allows.
 *
 * Ticked rows are refilled from the query in order, so a row keeps its id — and so the table does
 * not rebuild itself under the cursor on every keystroke in the URL box. Unticked rows are not in
 * the URL at all, so they are passed over and kept exactly where they were.
 *
 * `nextId` supplies ids for rows the URL has and the table does not, which is what keeps this a
 * pure function.
 */
export function paramsFromUrl(url: string, existing: KeyValue[], nextId: () => string): KeyValue[] {
  const pairs = parts(url)
    .query.split("&")
    .filter((part) => part !== "")
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return { key: decode(part), value: "" };
      return { key: decode(part.slice(0, eq)), value: decode(part.slice(eq + 1)) };
    });

  const rows: KeyValue[] = [];
  let taken = 0;
  for (const row of existing) {
    if (!row.enabled) {
      rows.push(row);
      continue;
    }
    const pair = pairs[taken];
    // The URL has fewer parameters than the table had ticked rows: the extra rows are gone.
    if (pair === undefined) continue;
    taken++;
    rows.push({ ...row, key: pair.key, value: pair.value });
  }
  for (const pair of pairs.slice(taken)) {
    rows.push({ id: nextId(), enabled: true, key: pair.key, value: pair.value });
  }
  return rows;
}

/** The URL with the ticked rows as its query. A row with no key is the empty one at the foot of
 *  the table waiting to be typed in, and belongs in no URL. */
export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = parts(url);
  const query = params
    .filter((row) => row.enabled && row.key !== "")
    .map((row) => `${encode(row.key)}=${encode(row.value)}`)
    .join("&");
  return query === "" ? `${base}${hash}` : `${base}?${query}${hash}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/rest/syncUrlParams.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/rest/syncUrlParams.ts src/modules/rest/syncUrlParams.test.ts
git commit -m "feat(rest): sync the URL box and the Params table both ways"
```

---

### Task 5: `contentType` — what came back, and which views it has

The viewer's fallback chain is data, not a run of `if`s in JSX. **No `DOMParser` here** — vitest runs without a DOM, and this file has to be testable.

**Files:**
- Create: `src/modules/rest/contentType.ts`, `src/modules/rest/contentType.test.ts`

**Interfaces:**
- Produces: `BodyKind`, `ViewMode`, `DetectedBody`, `SOURCE_MAX_BYTES`, `headerValue(headers, name)`, `detectBody(headers, bytes)`, `availableModes(kind, byteLength)`, `pickMode(preferred, available)`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/rest/contentType.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SOURCE_MAX_BYTES,
  availableModes,
  detectBody,
  headerValue,
  pickMode,
} from "./contentType";

const utf8 = (text: string) => new TextEncoder().encode(text);
const raw = (...bytes: number[]) => new Uint8Array(bytes);
const ct = (value: string): [string, string][] => [["Content-Type", value]];

describe("headerValue", () => {
  it("does not care about the case of the name", () => {
    expect(headerValue([["CONTENT-TYPE", "text/plain"]], "content-type")).toBe("text/plain");
  });

  it("answers null when the header is absent", () => {
    expect(headerValue([], "content-type")).toBeNull();
  });

  it("takes the first of a repeated header", () => {
    expect(headerValue([["x", "a"], ["x", "b"]], "x")).toBe("a");
  });
});

describe("detectBody: the header is believed first", () => {
  it("reads application/json as JSON", () => {
    expect(detectBody(ct("application/json"), utf8("{}")).kind).toBe("json");
  });

  it("reads a +json suffix as JSON", () => {
    expect(detectBody(ct("application/problem+json"), utf8("{}")).kind).toBe("json");
  });

  it("reads text/html as HTML", () => {
    expect(detectBody(ct("text/html; charset=utf-8"), utf8("<p>hi</p>")).kind).toBe("html");
  });

  it("reads application/xml as XML", () => {
    expect(detectBody(ct("application/xml"), utf8("<a/>")).kind).toBe("xml");
  });

  it("reads an image by its type alone", () => {
    expect(detectBody(ct("image/png"), raw(1, 2, 3)).kind).toBe("image");
  });

  it("reads a PDF by its type alone", () => {
    expect(detectBody(ct("application/pdf"), raw(1, 2, 3)).kind).toBe("pdf");
  });

  it("reads an unknown type as binary", () => {
    expect(detectBody(ct("application/x-thing"), raw(1, 2, 3)).kind).toBe("binary");
  });

  it("takes the charset from the header", () => {
    expect(detectBody(ct("text/html; charset=iso-8859-1"), utf8("<p>x</p>")).charset).toBe("iso-8859-1");
  });

  it("defaults the charset to utf-8", () => {
    expect(detectBody(ct("text/html"), utf8("<p>x</p>")).charset).toBe("utf-8");
  });

  // A declared text type whose bytes will not decode is binary whatever the header says —
  // otherwise Raw shows replacement characters and calls them the response.
  it("calls a text type binary when the bytes are not readable", () => {
    expect(detectBody(ct("text/html; charset=utf-8"), raw(0xff, 0xfe, 0xff)).kind).toBe("binary");
  });
});

describe("detectBody: the bytes decide when the header will not", () => {
  it("sniffs JSON out of application/octet-stream", () => {
    expect(detectBody(ct("application/octet-stream"), utf8('{"a":1}')).kind).toBe("json");
  });

  it("sniffs JSON out of text/plain", () => {
    expect(detectBody(ct("text/plain"), utf8("  [1,2]  ")).kind).toBe("json");
  });

  it("leaves text/plain as text when it only looks like JSON", () => {
    expect(detectBody(ct("text/plain"), utf8("{not json")).kind).toBe("text");
  });

  it("sniffs HTML by its doctype", () => {
    expect(detectBody([], utf8("<!DOCTYPE html><html></html>")).kind).toBe("html");
  });

  it("sniffs XML by its declaration", () => {
    expect(detectBody([], utf8('<?xml version="1.0"?><a/>')).kind).toBe("xml");
  });

  it("sniffs a PNG by its magic bytes", () => {
    expect(detectBody([], raw(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)).kind).toBe("image");
  });

  it("sniffs a JPEG by its magic bytes", () => {
    expect(detectBody([], raw(0xff, 0xd8, 0xff, 0xe0)).kind).toBe("image");
  });

  it("sniffs a PDF by its magic bytes", () => {
    expect(detectBody(ct("application/octet-stream"), utf8("%PDF-1.7\n")).kind).toBe("pdf");
  });

  it("falls back to binary when nothing decodes", () => {
    expect(detectBody([], raw(0x00, 0xff, 0xfe, 0x01)).kind).toBe("binary");
  });

  it("carries the decoded text for anything readable", () => {
    expect(detectBody(ct("application/json"), utf8('{"a":1}')).text).toBe('{"a":1}');
  });

  it("carries no text for bytes", () => {
    expect(detectBody(ct("image/png"), raw(1, 2, 3)).text).toBeNull();
  });
});

describe("availableModes", () => {
  it("gives JSON all three", () => {
    expect(availableModes("json", 10)).toEqual(["preview", "source", "raw"]);
  });

  it("gives HTML all three", () => {
    expect(availableModes("html", 10)).toEqual(["preview", "source", "raw"]);
  });

  // The spec's own example of the fallback rule: nothing to render, so Preview is not offered.
  it("gives XML a tree and the raw text, and no preview", () => {
    expect(availableModes("xml", 10)).toEqual(["source", "raw"]);
  });

  it("gives plain text only the raw text", () => {
    expect(availableModes("text", 10)).toEqual(["raw"]);
  });

  it("gives an image a preview and a hex dump", () => {
    expect(availableModes("image", 10)).toEqual(["preview", "raw"]);
  });

  it("gives a PDF a card and a hex dump", () => {
    expect(availableModes("pdf", 10)).toEqual(["preview", "raw"]);
  });

  it("gives binary a card and a hex dump", () => {
    expect(availableModes("binary", 10)).toEqual(["preview", "raw"]);
  });

  // The tree is not virtualised, so a body this size would be hundreds of thousands of DOM nodes.
  it("takes the tree away from a body too big to build one for", () => {
    expect(availableModes("json", SOURCE_MAX_BYTES + 1)).toEqual(["preview", "raw"]);
  });

  it("keeps the tree right up to the limit", () => {
    expect(availableModes("json", SOURCE_MAX_BYTES)).toContain("source");
  });

  it("always offers raw", () => {
    const kinds = ["json", "html", "xml", "text", "image", "pdf", "binary"] as const;
    for (const kind of kinds) expect(availableModes(kind, 10)).toContain("raw");
  });
});

describe("pickMode", () => {
  it("keeps what was chosen when it is still on offer", () => {
    expect(pickMode("source", ["preview", "source", "raw"])).toBe("source");
  });

  it("falls to the best available when it is not", () => {
    expect(pickMode("source", ["preview", "raw"])).toBe("preview");
  });

  it("falls all the way to raw when that is all there is", () => {
    expect(pickMode("preview", ["raw"])).toBe("raw");
  });

  // Choosing Source and then getting an image shows Preview, but Source is still what was chosen
  // — the next JSON response goes straight back to it. Nothing slides down and stays down.
  it("does not decide anything, so the choice can come back", () => {
    expect(pickMode("source", ["preview", "source", "raw"])).toBe("source");
    expect(pickMode("source", ["preview", "raw"])).toBe("preview");
    expect(pickMode("source", ["preview", "source", "raw"])).toBe("source");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/modules/rest/contentType.test.ts`
Expected: FAIL — `Failed to resolve import "./contentType"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/rest/contentType.ts`:

```ts
/**
 * What a response body is, and which of the three views it can be shown in.
 *
 * The fallback chain the spec asks for — no preview, fall to the tree; no tree, fall to raw — is
 * {@link availableModes} plus {@link pickMode}, two pure functions with tests, rather than
 * conditionals spread through the viewer.
 *
 * Nothing here touches `DOMParser`: the test run has no DOM, and this is the part that has to be
 * covered. Parsing a document into a tree happens in the component that draws it.
 */

export type BodyKind = "json" | "html" | "xml" | "text" | "image" | "pdf" | "binary";
export type ViewMode = "preview" | "source" | "raw";

export interface DetectedBody {
  kind: BodyKind;
  /** Lowercased, without its parameters. Empty when the response declared none. */
  mime: string;
  charset: string;
  /** The body as text, or null when it is not readable as any — which is what "binary" means. */
  text: string | null;
}

/** Past this the Source tree is not offered. The tree is not virtualised, and 2 MB of JSON is
 *  several hundred thousand nodes — building them all is how a webview stops answering. */
export const SOURCE_MAX_BYTES = 2 * 1024 * 1024;

/** The first value of a header, whatever case the server spelled the name in. */
export function headerValue(headers: [string, string][], name: string): string | null {
  const wanted = name.toLowerCase();
  const found = headers.find(([key]) => key.toLowerCase() === wanted);
  return found ? found[1] : null;
}

function parseContentType(raw: string | null): { mime: string; charset: string } {
  if (raw === null) return { mime: "", charset: "utf-8" };
  const [first, ...params] = raw.split(";");
  let charset = "utf-8";
  for (const param of params) {
    const eq = param.indexOf("=");
    if (eq === -1) continue;
    if (param.slice(0, eq).trim().toLowerCase() !== "charset") continue;
    const value = param.slice(eq + 1).trim().replace(/^"|"$/g, "").toLowerCase();
    if (value !== "") charset = value;
  }
  return { mime: first.trim().toLowerCase(), charset };
}

/** What the declared type says this is, or null when it declared nothing. */
function kindFromMime(mime: string): BodyKind | null {
  if (mime === "") return null;
  if (mime === "application/json" || mime.endsWith("+json")) return "json";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime === "text/xml" || mime === "application/xml" || mime.endsWith("+xml")) return "xml";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("text/")) return "text";
  return "binary";
}

/** The two types that mean "I did not look": one is the default for anything unknown, and the
 *  other is what half the world's JSON APIs send. Both are sniffed rather than believed. */
function isVague(mime: string): boolean {
  return mime === "application/octet-stream" || mime === "text/plain";
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** The formats that announce themselves in their first few bytes. */
function sniffMagic(bytes: Uint8Array): BodyKind | null {
  if (startsWith(bytes, PNG) || startsWith(bytes, JPEG) || startsWith(bytes, GIF)) return "image";
  if (startsWith(bytes, RIFF) && startsWith(bytes.subarray(8), WEBP)) return "image";
  if (startsWith(bytes, PDF)) return "pdf";
  return null;
}

/** The text, or null when these bytes are not text in that charset. `fatal` is the whole point:
 *  without it every byte sequence decodes, into replacement characters that look like a response.
 *  An unknown charset label is the server's mistake, not the body's, so utf-8 is tried after it. */
function decodeText(bytes: Uint8Array, charset: string): string | null {
  for (const label of charset === "utf-8" ? ["utf-8"] : [charset, "utf-8"]) {
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes);
    } catch {
      // Either the label is not a charset or the bytes are not valid in it. Try the next.
    }
  }
  return null;
}

function sniffText(text: string): BodyKind | null {
  const head = text.trimStart();
  if (head.startsWith("{") || head.startsWith("[")) {
    try {
      JSON.parse(head);
      return "json";
    } catch {
      // Looks like JSON, is not. Fall through — it is text.
    }
  }
  if (/^<!doctype\s+html/i.test(head) || /^<html[\s>]/i.test(head)) return "html";
  if (head.startsWith("<?xml")) return "xml";
  return null;
}

/** What this body is. The declared type is believed unless it declared nothing or declared one of
 *  the two that mean nothing — see {@link isVague}. */
export function detectBody(headers: [string, string][], bytes: Uint8Array): DetectedBody {
  const { mime, charset } = parseContentType(headerValue(headers, "content-type"));
  const declared = kindFromMime(mime);

  if (declared !== null && !isVague(mime)) {
    if (declared === "image" || declared === "pdf" || declared === "binary") {
      return { kind: declared, mime, charset, text: null };
    }
    const text = decodeText(bytes, charset);
    if (text === null) return { kind: "binary", mime, charset, text: null };
    return { kind: declared, mime, charset, text };
  }

  const magic = sniffMagic(bytes);
  if (magic !== null) return { kind: magic, mime, charset, text: null };

  const text = decodeText(bytes, charset);
  if (text === null) return { kind: "binary", mime, charset, text: null };
  return { kind: sniffText(text) ?? "text", mime, charset, text };
}

/**
 * The views this body can be shown in, best first.
 *
 * Order is the fallback chain: preview, then the tree, then the raw bytes. Raw is always last and
 * always there, which is what makes {@link pickMode} total.
 */
export function availableModes(kind: BodyKind, byteLength: number): ViewMode[] {
  const modes: ViewMode[] = [];
  if (kind !== "xml" && kind !== "text") modes.push("preview");
  if ((kind === "json" || kind === "html" || kind === "xml") && byteLength <= SOURCE_MAX_BYTES) {
    modes.push("source");
  }
  modes.push("raw");
  return modes;
}

/**
 * Which view to show, given the one the user chose.
 *
 * The choice itself is never changed by this — the caller keeps it. So choosing Source and then
 * getting back an image shows the preview, and the next JSON response is a tree again.
 *
 * `available[0]` is always there: {@link availableModes} ends with `raw` for every kind.
 */
export function pickMode(preferred: ViewMode, available: ViewMode[]): ViewMode {
  return available.includes(preferred) ? preferred : available[0];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/rest/contentType.test.ts`
Expected: PASS, 41 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/rest/contentType.ts src/modules/rest/contentType.test.ts
git commit -m "feat(rest): detect the response kind and its viewer fallback chain"
```

---

### Task 6: `buildRequest` — UI state onto the wire

The last pure step before Rust. All five body kinds are mapped here even though Phase 1's UI can only produce two — see the scope note: this is transport, written once.

**Files:**
- Create: `src/modules/rest/buildRequest.ts`, `src/modules/rest/buildRequest.test.ts`
- Modify: `src/modules/rest/syncUrlParams.ts` — rename the private `encode` to `encodeComponent` and export it, so the form encoder shares the rule that keeps `{{var}}` legible:

```ts
/** Encoded, except for the braces of a variable — see the note at the top of the file. */
export function encodeComponent(text: string): string {
  return encodeURIComponent(text).replace(/%7B%7B/gi, "{{").replace(/%7D%7D/gi, "}}");
}
```
Update its two call sites in `urlWithParams` to the new name.

**Interfaces:**
- Consumes: `urlWithParams`, `encodeComponent` from `./syncUrlParams`; the types from `./types`.
- Produces: `SendSettings`, `PHASE_ONE_SETTINGS`, `buildRequest(request, requestId, settings): WireRequest`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/rest/buildRequest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PHASE_ONE_SETTINGS, buildRequest } from "./buildRequest";
import { newRequest } from "./requests";
import type { KeyValue, RestRequest } from "./types";

function row(over: Partial<KeyValue> & { id: string }): KeyValue {
  return { enabled: true, key: "", value: "", ...over };
}

function request(over: Partial<RestRequest> = {}): RestRequest {
  return { ...newRequest("r", 0), url: "https://x.test/a", ...over };
}

const build = (over: Partial<RestRequest> = {}) =>
  buildRequest(request(over), "send-1", PHASE_ONE_SETTINGS);

/** The header's value, whatever case it was written in. */
function header(wire: ReturnType<typeof build>, name: string): string | undefined {
  return wire.headers.find(([key]) => key.toLowerCase() === name)?.[1];
}

describe("buildRequest: the envelope", () => {
  it("carries the id the caller will cancel by", () => {
    expect(build().request_id).toBe("send-1");
  });

  it("carries the method", () => {
    expect(build({ method: "DELETE" }).method).toBe("DELETE");
  });

  it("carries Phase 1's hardcoded send settings", () => {
    const wire = build();
    expect(wire.timeout_ms).toBe(30_000);
    expect(wire.follow_redirects).toBe(true);
    expect(wire.accept_invalid_certs).toBe(false);
  });

  it("folds the Params table into the URL", () => {
    const wire = build({ params: [row({ id: "a", key: "page", value: "2" })] });
    expect(wire.url).toBe("https://x.test/a?page=2");
  });

  it("leaves the unticked headers out", () => {
    const wire = build({
      headers: [row({ id: "a", enabled: false, key: "X-Debug", value: "1" })],
    });
    expect(wire.headers).toEqual([]);
  });

  it("leaves out the empty row at the foot of the table", () => {
    const wire = build({ headers: [row({ id: "a", key: "", value: "" })] });
    expect(wire.headers).toEqual([]);
  });

  it("keeps a header repeated twice, twice", () => {
    const wire = build({
      headers: [row({ id: "a", key: "Cookie", value: "x=1" }), row({ id: "b", key: "Cookie", value: "y=2" })],
    });
    expect(wire.headers).toEqual([["Cookie", "x=1"], ["Cookie", "y=2"]]);
  });
});

describe("buildRequest: bodies", () => {
  it("sends nothing, and declares nothing, for no body", () => {
    const wire = build();
    expect(wire.body).toEqual({ kind: "none" });
    expect(header(wire, "content-type")).toBeUndefined();
  });

  it("sends a raw body as text", () => {
    const wire = build({ body: { kind: "raw", language: "json", text: '{"a":1}' } });
    expect(wire.body).toEqual({ kind: "text", text: '{"a":1}' });
  });

  it("declares a content type for each raw language", () => {
    const of = (language: "json" | "xml" | "html" | "text") =>
      header(build({ body: { kind: "raw", language, text: "x" } }), "content-type");
    expect(of("json")).toBe("application/json");
    expect(of("xml")).toBe("application/xml");
    expect(of("html")).toBe("text/html");
    expect(of("text")).toBe("text/plain");
  });

  // A content type the user typed is the one they meant — a REST client that overrides it is
  // one you cannot use to reproduce a bug.
  it("does not override a content type the user set", () => {
    const wire = build({
      headers: [row({ id: "a", key: "content-type", value: "application/vnd.api+json" })],
      body: { kind: "raw", language: "json", text: "{}" },
    });
    expect(wire.headers.filter(([key]) => key.toLowerCase() === "content-type")).toHaveLength(1);
    expect(header(wire, "content-type")).toBe("application/vnd.api+json");
  });

  it("encodes a form body and declares it", () => {
    const wire = build({
      body: {
        kind: "form",
        fields: [row({ id: "a", key: "name", value: "a b" }), row({ id: "b", key: "x", value: "1" })],
      },
    });
    expect(wire.body).toEqual({ kind: "text", text: "name=a%20b&x=1" });
    expect(header(wire, "content-type")).toBe("application/x-www-form-urlencoded");
  });

  it("leaves unticked form fields out", () => {
    const wire = build({
      body: { kind: "form", fields: [row({ id: "a", enabled: false, key: "x", value: "1" })] },
    });
    expect(wire.body).toEqual({ kind: "text", text: "" });
  });

  it("turns multipart fields into parts, text and file alike", () => {
    const wire = build({
      body: {
        kind: "multipart",
        fields: [
          row({ id: "a", key: "note", value: "hi" }),
          { ...row({ id: "b", key: "avatar" }), file: "C:/tmp/a.png" },
        ],
      },
    });
    expect(wire.body).toEqual({
      kind: "multipart",
      parts: [
        { name: "note", value: "hi", path: null },
        { name: "avatar", value: null, path: "C:/tmp/a.png" },
      ],
    });
  });

  // reqwest writes the boundary into the header itself, and a boundary guessed here would not
  // match the one it generates.
  it("declares nothing for multipart", () => {
    const wire = build({ body: { kind: "multipart", fields: [] } });
    expect(header(wire, "content-type")).toBeUndefined();
  });

  it("sends a binary body as a path for Rust to read", () => {
    const wire = build({ body: { kind: "binary", filePath: "C:/tmp/a.bin" } });
    expect(wire.body).toEqual({ kind: "file", path: "C:/tmp/a.bin" });
    expect(header(wire, "content-type")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/modules/rest/buildRequest.test.ts`
Expected: FAIL — `Failed to resolve import "./buildRequest"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/rest/buildRequest.ts`:

```ts
import { encodeComponent, urlWithParams } from "./syncUrlParams";
import type { Body, KeyValue, RestRequest, WireBody, WirePart, WireRequest } from "./types";

/**
 * The state of the request pane, turned into the one thing Rust is given.
 *
 * Everything Rust would otherwise have to decide is decided here, where it can be tested without
 * a server: which URL, which headers, how a form is encoded, what content type to declare.
 *
 * Phase 4 puts `interpolate` in front of this. Until then `{{var}}` reaches the wire as text.
 */

export interface SendSettings {
  timeoutMs: number;
  followRedirects: boolean;
  acceptInvalidCerts: boolean;
}

/** Until the Settings pane exists in Phase 5. The contract already carries all three, so Phase 5
 *  changes where they come from and nothing else. */
export const PHASE_ONE_SETTINGS: SendSettings = {
  timeoutMs: 30_000,
  followRedirects: true,
  acceptInvalidCerts: false,
};

const CONTENT_TYPE = "content-type";

const RAW_TYPES = {
  json: "application/json",
  xml: "application/xml",
  html: "text/html",
  text: "text/plain",
} as const;

/** The rows that are actually sent: ticked, and with something in the key. */
function live(rows: KeyValue[]): KeyValue[] {
  return rows.filter((row) => row.enabled && row.key !== "");
}

/** The body on the wire, and the content type it implies — null where the body implies none, or
 *  where reqwest writes the header itself. */
function wireBody(body: Body): { body: WireBody; contentType: string | null } {
  switch (body.kind) {
    case "none":
      return { body: { kind: "none" }, contentType: null };
    case "raw":
      return { body: { kind: "text", text: body.text }, contentType: RAW_TYPES[body.language] };
    case "form":
      return {
        body: {
          kind: "text",
          text: live(body.fields)
            .map((field) => `${encodeComponent(field.key)}=${encodeComponent(field.value)}`)
            .join("&"),
        },
        contentType: "application/x-www-form-urlencoded",
      };
    case "multipart": {
      const parts: WirePart[] = live(body.fields).map((field) => ({
        name: field.key,
        value: field.file === undefined ? field.value : null,
        path: field.file ?? null,
      }));
      // No content type: the boundary is reqwest's to generate and to announce.
      return { body: { kind: "multipart", parts }, contentType: null };
    }
    case "binary":
      // No default type either — a file's type is the user's to declare, and guessing it from an
      // extension would be wrong at exactly the moment it mattered.
      return { body: { kind: "file", path: body.filePath }, contentType: null };
  }
}

/** Everything Rust needs and nothing it has to work out. `requestId` is minted per send, not per
 *  request: sending the same request twice gives two things to cancel. */
export function buildRequest(
  request: RestRequest,
  requestId: string,
  settings: SendSettings,
): WireRequest {
  const { body, contentType } = wireBody(request.body);
  const headers: [string, string][] = live(request.headers).map((row) => [row.key, row.value]);
  const declared = headers.some(([key]) => key.toLowerCase() === CONTENT_TYPE);
  if (contentType !== null && !declared) headers.push(["Content-Type", contentType]);

  return {
    request_id: requestId,
    method: request.method,
    url: urlWithParams(request.url, request.params),
    headers,
    body,
    timeout_ms: settings.timeoutMs,
    follow_redirects: settings.followRedirects,
    accept_invalid_certs: settings.acceptInvalidCerts,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the new file's 17 tests, and Task 4's still green after the rename.

- [ ] **Step 5: Commit**

```bash
git add src/modules/rest
git commit -m "feat(rest): build the wire request from the request pane's state"
```

---

### Task 7: The Rust side — `rest_send` and `rest_cancel`

Two commands and no logic: build a `reqwest::Request` from what arrived, send it, time it, hand back the bytes. Five places, per `.agent/conventions/adding-a-command.md`.

**Files:**
- Create: `src-tauri/src/modules/rest/mod.rs`, `models.rs`, `state.rs`, `commands.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/modules/mod.rs`
- Test: none. The repo has no `cargo test` culture and this layer is thin by design; `cargo check` compiles it and `npm run dev:app` exercises it.

**Interfaces:**
- Consumes: `AppError` and the `err!` macro from `crate::error`.
- Produces: commands `rest_send(req: WireRequest) -> RestResponse` and `rest_cancel(request_id: String)`; `rest::register(builder)`.

- [ ] **Step 1: Add the two dependencies**

In `src-tauri/Cargo.toml`, under `[dependencies]`:

```toml
# The HTTP client the REST module sends through. `native-tls` rather than rustls so the app
# carries one TLS stack, not two — sqlx already builds against it. Default features are off to
# keep blocking, cookies and JSON out; the content encodings are on because a body that arrives
# gzipped and is shown as bytes is a bug report nobody can read.
reqwest = { version = "0.12", default-features = false, features = ["native-tls", "multipart", "stream", "gzip", "brotli", "deflate", "http2"] }
# `CancellationToken` for the Cancel button, and `ReaderStream` for sending a file without
# reading it all into memory first.
tokio-util = { version = "0.7", features = ["io"] }
```

- [ ] **Step 2: Write the models**

Create `src-tauri/src/modules/rest/models.rs`:

```rust
//! What crosses the boundary for a REST request. Mirrored by hand in
//! `src/modules/rest/types.ts` — nothing checks that the two agree.

use serde::{Deserialize, Serialize};

/// A request with every decision already made: the URL is final, the headers are final, the body
/// is already encoded. Rust chooses nothing here.
#[derive(Debug, Deserialize)]
pub struct WireRequest {
    /// What `rest_cancel` names. Minted per send, not per request.
    pub request_id: String,
    pub method: String,
    pub url: String,
    /// A list, not a map: a header may legitimately appear twice.
    pub headers: Vec<(String, String)>,
    pub body: WireBody,
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub accept_invalid_certs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WireBody {
    None,
    /// Raw and form-urlencoded alike: the frontend encoded it and declared its type.
    Text { text: String },
    /// A file streamed from disk.
    File { path: String },
    /// The one body Rust assembles, because the boundary and the file streaming are reqwest's.
    Multipart { parts: Vec<WirePart> },
}

#[derive(Debug, Deserialize)]
pub struct WirePart {
    pub name: String,
    /// The field's text, for a plain part.
    pub value: Option<String>,
    /// A file to send instead.
    pub path: Option<String>,
}

/// One response, whole. A `500` is a successful send and comes back through here like any other.
#[derive(Debug, Serialize)]
pub struct RestResponse {
    pub status: u16,
    pub status_text: String,
    pub http_version: String,
    pub headers: Vec<(String, String)>,
    /// Base64 even for text: a response may be an image, a PDF or a gzip, and nothing here can
    /// assume UTF-8. The 33% the encoding adds is the price of not guessing.
    pub body_base64: String,
    /// The real length, including anything cut for being over the cap.
    pub body_size: u64,
    pub truncated: bool,
    /// Where the request ended up, which is how the frontend knows it was redirected.
    pub final_url: String,
    pub total_ms: u64,
    /// Time to the last header, i.e. when the response began rather than when it finished.
    pub ttfb_ms: u64,
}
```

- [ ] **Step 3: Write the state**

Create `src-tauri/src/modules/rest/state.rs`:

```rust
use std::collections::HashMap;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

/// What a client has to be built for. Neither can be changed after the client exists, and both
/// vary per request — so there is a client per combination rather than one for the app.
///
/// `(follow_redirects, accept_invalid_certs)`.
pub type ClientKey = (bool, bool);

/// Blocking locks rather than async ones: nothing is awaited while either is held. The client is
/// cloned out and the map released before anything is sent — a `reqwest::Client` is an `Arc`
/// inside, so cloning it shares the connection pool rather than copying it.
#[derive(Default)]
pub struct RestState {
    /// Kept and reused, which is what makes the second request to a host skip the TLS handshake.
    pub clients: Mutex<HashMap<ClientKey, reqwest::Client>>,
    /// Every send in flight, by the id it was given. Cancelling is looking one up and telling it.
    pub inflight: Mutex<HashMap<String, CancellationToken>>,
}
```

- [ ] **Step 4: Write the commands**

Create `src-tauri/src/modules/rest/commands.rs`:

```rust
use std::time::{Duration, Instant};

use base64::Engine;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use tauri::State;
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;

use super::models::{RestResponse, WireBody, WireRequest};
use super::state::RestState;
use crate::error::AppError;

/// How much of a response body is kept. Past this it is counted and dropped: everything read has
/// to cross the IPC boundary as base64 and then sit in the webview's memory, and 16 MB of that is
/// already generous. The 30-second timeout is what stops an endless body outright.
const MAX_BODY: usize = 16 * 1024 * 1024;

/// Hops before a redirect chain is called a loop.
const MAX_REDIRECTS: usize = 10;

/// The client for these two settings, built once and kept.
fn client_for(state: &RestState, follow: bool, insecure: bool) -> Result<reqwest::Client, AppError> {
    let key = (follow, insecure);
    if let Some(client) = state.clients.lock().unwrap().get(&key) {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .redirect(if follow { Policy::limited(MAX_REDIRECTS) } else { Policy::none() })
        .danger_accept_invalid_certs(insecure)
        .build()
        .map_err(|e| err!("error.restBuildFailed", message = e))?;
    state.clients.lock().unwrap().insert(key, client.clone());
    Ok(client)
}

/// Which of the failures reqwest can report this is.
///
/// DNS, a refused connection and a rejected certificate are all `is_connect()` and are not told
/// apart here: doing so means walking `source()` and matching the text of whichever library is
/// underneath, which breaks silently at the next upgrade. The original message travels along
/// instead — "dns error", "certificate verify failed" — where it is worth reading.
fn classify(e: reqwest::Error) -> AppError {
    if e.is_timeout() {
        err!("error.restTimeout", message = e)
    } else if e.is_redirect() {
        err!("error.restRedirectLoop", message = e)
    } else if e.is_connect() {
        err!("error.restConnect", message = e)
    } else {
        err!("error.restBuildFailed", message = e)
    }
}

async fn file_body(path: &str) -> Result<reqwest::Body, AppError> {
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| err!("error.restFileUnreadable", path = path, message = e))?;
    Ok(reqwest::Body::wrap_stream(ReaderStream::new(file)))
}

/// Sends the request and reads all of it. Split out so `tokio::select!` has one future to race
/// against the cancellation token — dropping this one is what aborts the request.
async fn collect(builder: reqwest::RequestBuilder, started: Instant) -> Result<RestResponse, AppError> {
    let mut res = builder.send().await.map_err(classify)?;
    // `send` returns once the headers are in, so this is when the response began.
    let ttfb_ms = started.elapsed().as_millis() as u64;

    let status = res.status();
    let http_version = format!("{:?}", res.version());
    let final_url = res.url().to_string();
    let headers = res
        .headers()
        .iter()
        .map(|(name, value)| {
            (name.as_str().to_string(), value.to_str().unwrap_or_default().to_string())
        })
        .collect::<Vec<_>>();

    // Read in chunks rather than with `bytes()`, so the size can be counted past the point where
    // the bytes stop being kept.
    let mut body: Vec<u8> = Vec::new();
    let mut body_size: u64 = 0;
    while let Some(chunk) = res.chunk().await.map_err(classify)? {
        body_size += chunk.len() as u64;
        if body.len() < MAX_BODY {
            let room = MAX_BODY - body.len();
            body.extend_from_slice(&chunk[..room.min(chunk.len())]);
        }
    }

    Ok(RestResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or_default().to_string(),
        http_version,
        headers,
        body_base64: base64::engine::general_purpose::STANDARD.encode(&body),
        body_size,
        truncated: body_size > body.len() as u64,
        final_url,
        total_ms: started.elapsed().as_millis() as u64,
        ttfb_ms,
    })
}

/// Sends one request and hands back everything that came of it.
///
/// A `500` is a success here — the send worked, and the response is a response. Only a failure to
/// get one at all is an `Err`.
#[tauri::command]
pub async fn rest_send(
    state: State<'_, RestState>,
    req: WireRequest,
) -> Result<RestResponse, AppError> {
    let client = client_for(&state, req.follow_redirects, req.accept_invalid_certs)?;
    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|e| err!("error.restBuildFailed", message = e))?;
    let url = reqwest::Url::parse(&req.url).map_err(|e| err!("error.restInvalidUrl", message = e))?;

    let mut headers = HeaderMap::new();
    for (name, value) in &req.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| err!("error.restBuildFailed", message = e))?;
        let value =
            HeaderValue::from_str(value).map_err(|e| err!("error.restBuildFailed", message = e))?;
        // `append`, not `insert`: two Cookie headers are two headers, and the frontend already
        // decided there should be two.
        headers.append(name, value);
    }

    let mut builder = client
        .request(method, url)
        .headers(headers)
        .timeout(Duration::from_millis(req.timeout_ms));

    builder = match req.body {
        WireBody::None => builder,
        WireBody::Text { text } => builder.body(text),
        WireBody::File { path } => builder.body(file_body(&path).await?),
        WireBody::Multipart { parts } => {
            let mut form = reqwest::multipart::Form::new();
            for part in parts {
                form = match part.path {
                    Some(path) => {
                        let file_name = std::path::Path::new(&path)
                            .file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "file".to_string());
                        let body = file_body(&path).await?;
                        form.part(
                            part.name,
                            reqwest::multipart::Part::stream(body).file_name(file_name),
                        )
                    }
                    None => form.text(part.name, part.value.unwrap_or_default()),
                };
            }
            builder.multipart(form)
        }
    };

    let token = CancellationToken::new();
    state.inflight.lock().unwrap().insert(req.request_id.clone(), token.clone());
    let started = Instant::now();

    let outcome = tokio::select! {
        // Dropping `collect` is what actually aborts the request; the token only wins the race.
        _ = token.cancelled() => Err(err!("error.restCancelled")),
        result = collect(builder, started) => result,
    };

    state.inflight.lock().unwrap().remove(&req.request_id);
    outcome
}

/// Cuts a send short. Nothing to cancel is not an error — the request finished between the click
/// and this call, which is the commonest way for a Cancel button to be pressed too late.
#[tauri::command]
pub async fn rest_cancel(state: State<'_, RestState>, request_id: String) -> Result<(), AppError> {
    let token = state.inflight.lock().unwrap().remove(&request_id);
    if let Some(token) = token {
        token.cancel();
    }
    Ok(())
}
```

- [ ] **Step 5: Write the module's `mod.rs`**

Create `src-tauri/src/modules/rest/mod.rs`:

```rust
//! REST client: sending one HTTP request and handing back what came of it.
//!
//! Deliberately thin. Which URL, which headers, how a form is encoded and what content type to
//! declare are all settled in `src/modules/rest/` before anything arrives here — see the spec's
//! "Rust is just plumbing".

pub mod commands;
pub mod models;
pub mod state;

/// Puts this module's own state in the app. Called once, from `lib.rs`.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.manage(state::RestState::default())
}
```

- [ ] **Step 6: Register the module and its commands**

In `src-tauri/src/modules/mod.rs`, beside `pub mod db;`:

```rust
pub mod rest;
```

and a block of its own at the end of `generate_handler!`:

```rust
        // ── rest ──
        rest::commands::rest_send,
        rest::commands::rest_cancel,
```

In `src-tauri/src/lib.rs`, after the `db` line:

```rust
    let builder = modules::db::register(builder);
    let builder = modules::rest::register(builder);
```

- [ ] **Step 7: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles. A first run downloads `reqwest` and `tokio-util` and takes a few minutes.

- [ ] **Step 8: Commit**

```bash
git add src-tauri
git commit -m "feat(rest): add the rest_send and rest_cancel backend commands"
```

---

### Task 8: `api.ts` and the formatting helpers

**Files:**
- Create: `src/modules/rest/api.ts`, `src/modules/rest/format.ts`, `src/modules/rest/format.test.ts`

**Interfaces:**
- Consumes: `invoke` from `@tauri-apps/api/core`; `WireRequest`, `RestResponse` from `./types`.
- Produces: `restSend(req)`, `restCancel(requestId)`, `decodeBase64(b64): Uint8Array`; `formatBytes(n)`, `hexDump(bytes, maxBytes)`, `prettyJson(text)`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/rest/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatBytes, hexDump, prettyJson } from "./format";

describe("formatBytes", () => {
  it("counts small bodies in bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("drops a trailing zero rather than showing 1.0 KB", () => {
    expect(formatBytes(1024)).toBe("1 KB");
  });

  it("keeps one decimal where it says something", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("climbs through the units", () => {
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
  });
});

describe("hexDump", () => {
  it("has nothing to say about no bytes", () => {
    expect(hexDump(new Uint8Array(), 100)).toBe("");
  });

  it("writes the offset, the bytes and the readable characters", () => {
    const line = hexDump(new TextEncoder().encode("Hi"), 100);
    expect(line.startsWith("00000000  48 69")).toBe(true);
    expect(line.endsWith("  Hi")).toBe(true);
  });

  it("puts sixteen bytes on a line", () => {
    const dump = hexDump(new Uint8Array(20), 100);
    expect(dump.split("\n")).toHaveLength(2);
    expect(dump.split("\n")[1].startsWith("00000010")).toBe(true);
  });

  it("stands a dot in for anything unprintable", () => {
    expect(hexDump(new Uint8Array([0x00, 0x41]), 100).endsWith("  .A")).toBe(true);
  });

  it("stops at the cap", () => {
    expect(hexDump(new Uint8Array(64), 16).split("\n")).toHaveLength(1);
  });
});

describe("prettyJson", () => {
  it("lays JSON out over lines", () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  // The Preview tab shows what came back. Text that is not JSON is still what came back.
  it("hands back anything it cannot parse, untouched", () => {
    expect(prettyJson("not json")).toBe("not json");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/modules/rest/format.test.ts`
Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 3: Write `format.ts`**

```ts
/** Turning bytes and text into what the response pane shows. All pure, all tested. */

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** A size someone can read at a glance. One decimal, and not even that when it would be a zero. */
export function formatBytes(bytes: number): string {
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit++;
  }
  const shown = unit === 0 ? String(size) : size.toFixed(1).replace(/\.0$/, "");
  return `${shown} ${UNITS[unit]}`;
}

/** Sixteen bytes to a line: the offset, the bytes in hex, and the printable characters. `47` is
 *  what sixteen two-digit numbers and the spaces between them come to, so short last lines still
 *  line their text column up with the ones above. */
export function hexDump(bytes: Uint8Array, maxBytes: number): string {
  const shown = bytes.subarray(0, maxBytes);
  const lines: string[] = [];
  for (let offset = 0; offset < shown.length; offset += 16) {
    const slice = shown.subarray(offset, offset + 16);
    const hex = Array.from(slice, (byte) => byte.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(47, " ");
    const text = Array.from(slice, (byte) =>
      byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".",
    ).join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  ${text}`);
  }
  return lines.join("\n");
}

/** JSON laid out, or the text exactly as it arrived. A body the server called JSON and got wrong
 *  is still the thing being debugged — reformatting is not worth hiding it for. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/rest/format.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write `api.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { RestResponse, WireRequest } from "./types";

/**
 * The only file in this module that calls `invoke`.
 *
 * Both commands reject with an `AppError` — `{ code, params }` — which callers put through
 * `errorMessage(t, e)` rather than rendering. One code is not an error at all: `error.restCancelled`
 * is what a cancelled send comes back as, and the status bar says "Cancelled" instead of a banner.
 */

/** The code a cancelled send rejects with. Named here so no caller has to spell it. */
export const CANCELLED = "error.restCancelled";

/** Sends the request and waits for all of it. A `500` resolves — only a failure to get any
 *  response at all rejects. */
export function restSend(req: WireRequest): Promise<RestResponse> {
  return invoke<RestResponse>("rest_send", { req });
}

/** Cuts a send short by the `request_id` it was given. Never rejects for a send already finished. */
export function restCancel(requestId: string): Promise<void> {
  return invoke("rest_cancel", { requestId });
}

/** The response body as bytes. Everything downstream — decoding to text, sniffing the type,
 *  the hex dump — works from these rather than from the base64. */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run build && npm test`

```bash
git add src/modules/rest
git commit -m "feat(rest): add the invoke wrappers and the response formatting helpers"
```

---

### Task 9: `KeyValueTable` and `UrlBar`

**Files:**
- Create: `src/modules/rest/components/KeyValueTable/{KeyValueTable.tsx,KeyValueTable.module.css,index.ts}`
- Create: `src/modules/rest/components/UrlBar/{UrlBar.tsx,UrlBar.module.css,index.ts}`

**Interfaces:**
- Consumes: `Input`, `Button`, `Select` from `src/components/`; `CloseIcon`, `SendIcon`, `StopIcon` from `src/icons`; `KeyValue`, `Method`, `METHODS` from `../../types`.
- Produces: `KeyValueTable` with props `{ rows, onChange, keyPlaceholder?, valuePlaceholder? }`; `UrlBar` with props `{ method, url, sending, onMethodChange, onUrlChange, onSend, onCancel }`.

- [ ] **Step 1: Write `KeyValueTable`**

`KeyValueTable.module.css`:

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
  grid-template-columns: 1.5rem minmax(0, 1fr) minmax(0, 2fr) 1.75rem;
  gap: 0.35rem;
  align-items: center;
}

.head {
  font-size: 0.8em;
  opacity: 0.7;
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

`KeyValueTable.tsx`:

```tsx
import Input from "../../../../components/Input";
import { CloseIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import type { KeyValue } from "../../types";
import styles from "./KeyValueTable.module.css";

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

/**
 * The Params and Headers tables, and from Phase 3 the form-body one too.
 *
 * There is always one empty row at the foot, and it is not in the data: typing into it is what
 * adds a row. That is what makes a table with no Add button, and it is why an empty table is
 * still something you can type into.
 *
 * The tick is how a row is parked. An unticked row is left out of the request and kept in the
 * table, which is the only way to try without a header and get it back.
 */
function KeyValueTable({ rows, onChange, keyPlaceholder, valuePlaceholder }: Props) {
  const { t } = useTranslation();

  function update(id: string, patch: Partial<KeyValue>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function append(patch: Partial<KeyValue>) {
    onChange([...rows, { id: crypto.randomUUID(), enabled: true, key: "", value: "", ...patch }]);
  }

  return (
    <div className={styles.table}>
      <div className={`${styles.row} ${styles.head}`}>
        <span />
        <span>{t("rest.keyColumn")}</span>
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
            size="small"
            value={row.key}
            placeholder={keyPlaceholder}
            aria-label={t("rest.keyColumn")}
            onChange={(e) => update(row.id, { key: e.target.value })}
          />
          <Input
            size="small"
            value={row.value}
            placeholder={valuePlaceholder}
            aria-label={t("rest.valueColumn")}
            onChange={(e) => update(row.id, { value: e.target.value })}
          />
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
          placeholder={keyPlaceholder ?? t("rest.addRow")}
          aria-label={t("rest.addRow")}
          onChange={(e) => append({ key: e.target.value })}
        />
        <Input
          size="small"
          value=""
          placeholder={valuePlaceholder}
          aria-label={t("rest.valueColumn")}
          onChange={(e) => append({ value: e.target.value })}
        />
        <span />
      </div>
    </div>
  );
}

export default KeyValueTable;
```

`index.ts`: `export { default } from "./KeyValueTable";`

- [ ] **Step 2: Write `UrlBar`**

`UrlBar.module.css`:

```css
.bar {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
  /* The response's status bar is set to the same height, which is what the spec asks for. */
  min-height: 3rem;
  box-sizing: border-box;
}

.method {
  flex: 0 0 7rem;
}

.url {
  flex: 1;
  min-width: 0;
  font-family: "Fira Code", monospace;
}

.send {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
```

`UrlBar.tsx`:

```tsx
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { SendIcon, StopIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { METHODS, type Method } from "../../types";
import styles from "./UrlBar.module.css";

interface Props {
  method: Method;
  url: string;
  /** While this is true the button cancels instead of sending. */
  sending: boolean;
  onMethodChange: (method: Method) => void;
  onUrlChange: (url: string) => void;
  onSend: () => void;
  onCancel: () => void;
}

/** The top row of the request pane: what to send, where, and the one button that does it. */
function UrlBar({ method, url, sending, onMethodChange, onUrlChange, onSend, onCancel }: Props) {
  const { t } = useTranslation();

  return (
    <div className={styles.bar}>
      <Select<Method>
        className={styles.method}
        value={method}
        options={METHODS.map((m) => ({ value: m, label: m }))}
        onChange={onMethodChange}
        ariaLabel={t("rest.method")}
        size="small"
      />
      <Input
        className={styles.url}
        value={url}
        placeholder={t("rest.urlPlaceholder")}
        aria-label={t("rest.urlPlaceholder")}
        onChange={(e) => onUrlChange(e.target.value)}
        // Enter in the URL box is the oldest gesture there is for "go".
        onKeyDown={(e) => {
          if (e.key === "Enter" && !sending) onSend();
        }}
      />
      <Button
        className={styles.send}
        variant="primary"
        onClick={sending ? onCancel : onSend}
        // Only the URL is required. A GET with nothing else filled in is a whole request.
        disabled={!sending && url.trim() === ""}
      >
        {sending ? <StopIcon size="1em" /> : <SendIcon size="1em" />}
        {sending ? t("rest.cancel") : t("rest.send")}
      </Button>
    </div>
  );
}

export default UrlBar;
```

`index.ts`: `export { default } from "./UrlBar";`

- [ ] **Step 3: Verify and commit**

Run: `npm run build && npm test`
Expected: both pass. Nothing renders these yet, so `noUnusedLocals` is the only thing checking them — that is fine, it catches the import paths.

```bash
git add src/modules/rest/components
git commit -m "feat(rest): add the key/value table and the URL bar"
```

---

### Task 10: `BodyEditor`

**Files:**
- Create: `src/modules/rest/components/BodyEditor/{BodyEditor.tsx,BodyEditor.module.css,index.ts}`

**Interfaces:**
- Consumes: `Select`; `Body`, `RawLanguage` from `../../types`; `prettyJson` from `../../format`.
- Produces: `BodyEditor` with props `{ body, onChange }`.

- [ ] **Step 1: Write the component**

`BodyEditor.module.css`:

```css
.editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.toolbar {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--border);
}

.kind {
  flex: 0 0 8rem;
}

.language {
  flex: 0 0 7rem;
}

.text {
  flex: 1;
  min-height: 0;
  resize: none;
  border: none;
  outline: none;
  padding: 0.5rem;
  background: transparent;
  color: inherit;
  font-family: "Fira Code", monospace;
  font-size: 0.9em;
  line-height: 1.5;
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

`BodyEditor.tsx`:

```tsx
import Button from "../../../../components/Button";
import Select from "../../../../components/Select";
import { FormatIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { prettyJson } from "../../format";
import type { Body, RawLanguage } from "../../types";
import styles from "./BodyEditor.module.css";

interface Props {
  body: Body;
  onChange: (body: Body) => void;
}

/**
 * The Body tab.
 *
 * Phase 1 offers two kinds: none, and a raw string with a language that decides only what content
 * type is declared for it. Form, multipart and binary are Phase 3 — `Body` already has them, and
 * `buildRequest` already puts them on the wire, so this is the only file that grows.
 *
 * A plain `<textarea>` rather than the shared one, which grows to fit its text: this pane has a
 * height of its own and the box should fill it, not push the layout about as a body is pasted in.
 */
function BodyEditor({ body, onChange }: Props) {
  const { t } = useTranslation();

  const languages: { value: RawLanguage; label: string }[] = [
    { value: "json", label: t("rest.langJson") },
    { value: "xml", label: t("rest.langXml") },
    { value: "html", label: t("rest.langHtml") },
    { value: "text", label: t("rest.langText") },
  ];

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <Select<Body["kind"]>
          className={styles.kind}
          size="small"
          value={body.kind}
          ariaLabel={t("rest.bodyKind")}
          options={[
            { value: "none", label: t("rest.bodyNone") },
            { value: "raw", label: t("rest.bodyRaw") },
          ]}
          onChange={(kind) =>
            onChange(kind === "none" ? { kind: "none" } : { kind: "raw", language: "json", text: "" })
          }
        />
        {body.kind === "raw" && (
          <>
            <Select<RawLanguage>
              className={styles.language}
              size="small"
              value={body.language}
              ariaLabel={t("rest.bodyLanguage")}
              options={languages}
              onChange={(language) => onChange({ ...body, language })}
            />
            {body.language === "json" && (
              <Button size="small" onClick={() => onChange({ ...body, text: prettyJson(body.text) })}>
                <FormatIcon size="1em" />
              </Button>
            )}
          </>
        )}
      </div>
      {body.kind === "raw" ? (
        <textarea
          className={styles.text}
          value={body.text}
          placeholder={t("rest.bodyPlaceholder")}
          aria-label={t("rest.bodyTab")}
          spellCheck={false}
          onChange={(e) => onChange({ ...body, text: e.target.value })}
        />
      ) : (
        <p className={`${styles.empty} muted`}>{t("rest.bodyNone")}</p>
      )}
    </div>
  );
}

export default BodyEditor;
```

`index.ts`: `export { default } from "./BodyEditor";`

- [ ] **Step 2: Verify and commit**

Run: `npm run build && npm test`

```bash
git add src/modules/rest/components/BodyEditor
git commit -m "feat(rest): add the body editor with raw bodies"
```

---

### Task 11: The sidebar — `RequestList`

Two flat groups. **RECENT is empty in Phase 1** — nothing puts anything in it until pasting arrives in Phase 2 — but it is drawn, with its counter and its explanation, because that is the shape the sidebar keeps.

**Files:**
- Create: `src/modules/rest/components/RequestList/{RequestList.tsx,RequestList.module.css,index.ts}`
- Modify: `src/modules/rest/format.ts`, `src/modules/rest/format.test.ts` — add `shortUrl`
- Modify: `src/modules/rest/i18n/en.ts`, `src/modules/rest/i18n/vi.ts` — four keys the rename dialog needs

**Interfaces:**
- Consumes: `ContextMenu`, `NameDialog`, `ConfirmDialog`, `Input`, `Button`; `PlusIcon`, `HistoryIcon`; `RequestLists`, `RestRequest`; `RECENT_LIMIT`.
- Produces: `RequestList` with props `{ lists, activeId, onOpen, onNew, onSave, onDelete }`; `shortUrl(url): string`.

- [ ] **Step 1: Write the failing test for `shortUrl`**

Append to `src/modules/rest/format.test.ts`:

```ts
import { shortUrl } from "./format";

describe("shortUrl", () => {
  it("drops the scheme and the query, which is what a sidebar row has no room for", () => {
    expect(shortUrl("https://api.example.test/v1/users?page=2")).toBe("api.example.test/v1/users");
  });

  it("keeps a scheme that is not http, since dropping it would mislead", () => {
    expect(shortUrl("ftp://x.test/a")).toBe("ftp://x.test/a");
  });

  it("drops a trailing slash", () => {
    expect(shortUrl("https://x.test/")).toBe("x.test");
  });

  it("has nothing to shorten in an empty URL", () => {
    expect(shortUrl("")).toBe("");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/modules/rest/format.test.ts`
Expected: FAIL — `shortUrl is not a function`.

- [ ] **Step 3: Add `shortUrl` to `format.ts`**

```ts
/** A URL short enough for a sidebar row: no scheme, no query, no trailing slash. Only `http` and
 *  `https` lose their scheme — anything else is unusual enough that hiding it would mislead. */
export function shortUrl(url: string): string {
  const withoutScheme = url.replace(/^https?:\/\//i, "");
  const withoutQuery = withoutScheme.split(/[?#]/)[0];
  return withoutQuery.replace(/\/$/, "");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/rest/format.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Add the four dialog strings**

In `src/modules/rest/i18n/en.ts`, inside `rest`, beside `rename`:

```ts
    nameLabel: "Name",
    nameEmpty: "A request needs a name.",
    renameSubmit: "Rename",
    renameSaving: "Renaming…",
```

In `src/modules/rest/i18n/vi.ts`, in the same place:

```ts
    nameLabel: "Tên",
    nameEmpty: "Request cần một cái tên.",
    renameSubmit: "Đổi tên",
    renameSaving: "Đang đổi…",
```

- [ ] **Step 6: Write the component**

`RequestList.module.css`:

```css
.sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
}

.headerRow {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.newButton {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
}

.groups {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.groupHead {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.5rem;
  background: none;
  border: none;
  color: inherit;
  font-size: 0.75em;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.7;
  cursor: pointer;
}

.groupHead:hover {
  opacity: 1;
}

.row {
  width: 100%;
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

.row:hover {
  background: var(--surface-hover, rgba(127, 127, 127, 0.12));
}

.rowActive {
  background: var(--surface-active, rgba(127, 127, 127, 0.2));
}

.method {
  flex: 0 0 3.2rem;
  font-size: 0.7em;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  padding: 0.4rem 0.75rem 0.8rem;
  font-size: 0.85em;
}

/* One colour class per method, so a row is recognisable before it is read. */
.mGET { color: #2f9e44; }
.mPOST { color: #f08c00; }
.mPUT { color: #1971c2; }
.mPATCH { color: #7048e8; }
.mDELETE { color: #e03131; }
.mHEAD, .mOPTIONS { color: #868e96; }
```

`RequestList.tsx`:

```tsx
import { useMemo, useState } from "react";
import Button from "../../../../components/Button";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ContextMenu from "../../../../components/ContextMenu";
import Input from "../../../../components/Input";
import NameDialog from "../../../../components/NameDialog";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import { shortUrl } from "../../format";
import { RECENT_LIMIT } from "../../requests";
import type { RequestLists, RestRequest } from "../../types";
import styles from "./RequestList.module.css";

interface Props {
  lists: RequestLists;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** A request with something changed — a rename, or the copy a duplicate makes. */
  onSave: (request: RestRequest) => void;
  onDuplicate: (request: RestRequest) => void;
  onDelete: (id: string) => void;
}

interface MenuState {
  request: RestRequest;
  x: number;
  y: number;
}

/**
 * The request list: **Saved**, which is what someone chose to keep, and **Recent**, which is what
 * pasting left behind.
 *
 * Recent is empty until Phase 2 puts anything in it, and is drawn anyway: the counter is how the
 * ten-request ceiling is visible before it is hit, and an explanation reads better than a group
 * that appears out of nowhere the first time a cURL command is pasted.
 */
function RequestList({ lists, activeId, onOpen, onNew, onSave, onDuplicate, onDelete }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [openGroups, setOpenGroups] = useState({ saved: true, recent: true });
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<RestRequest | null>(null);
  const [deleting, setDeleting] = useState<RestRequest | null>(null);

  /** What a row shows: the name, else the URL cut down, else that it has neither yet. */
  const label = (request: RestRequest) =>
    request.name !== "" ? request.name : shortUrl(request.url) || t("rest.untitled");

  const match = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") return () => true;
    return (request: RestRequest) =>
      label(request).toLowerCase().includes(needle) || request.url.toLowerCase().includes(needle);
    // `label` is rebuilt each render and depends only on `t`, so the filter follows the language.
  }, [filter, t]);

  function rows(list: RestRequest[], emptyMessage: string) {
    const shown = list.filter(match);
    if (shown.length === 0) return <p className={`${styles.empty} muted`}>{emptyMessage}</p>;
    return shown.map((request) => (
      <button
        key={request.id}
        type="button"
        className={`${styles.row}${request.id === activeId ? ` ${styles.rowActive}` : ""}`}
        onClick={() => onOpen(request.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ request, x: e.clientX, y: e.clientY });
        }}
      >
        <span className={`${styles.method} ${styles[`m${request.method}`]}`}>{request.method}</span>
        <span className={styles.name}>{label(request)}</span>
      </button>
    ));
  }

  function group(key: "saved" | "recent", heading: string, list: RestRequest[], empty: string) {
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
        {open && rows(list, empty)}
      </>
    );
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <Button className={styles.newButton} size="small" onClick={onNew}>
            <PlusIcon size="1em" />
            {t("rest.newRequest")}
          </Button>
        </div>
        <Input
          size="small"
          value={filter}
          placeholder={t("rest.filterPlaceholder")}
          aria-label={t("rest.filterPlaceholder")}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className={styles.groups}>
        {group("saved", t("rest.saved"), lists.saved, t("rest.noSaved"))}
        {group(
          "recent",
          t("rest.recent", { n: lists.recent.length, max: RECENT_LIMIT }),
          lists.recent,
          t("rest.noRecent"),
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
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
            className="context-menu-delete"
            onClick={() => {
              // A saved request is asked about; a Recent one would not be, but nothing is in
              // Recent until Phase 2 and one branch is easier to get right than two.
              setDeleting(menu.request);
              setMenu(null);
            }}
          >
            {t("rest.delete")}
          </button>
        </ContextMenu>
      )}

      {renaming && (
        <NameDialog
          title={t("rest.renameTitle")}
          ariaLabel={t("rest.renameTitle")}
          label={t("rest.nameLabel")}
          initialName={renaming.name !== "" ? renaming.name : label(renaming)}
          emptyError={t("rest.nameEmpty")}
          submitLabel={t("rest.renameSubmit")}
          savingLabel={t("rest.renameSaving")}
          onCancel={() => setRenaming(null)}
          onSubmit={async (name) => {
            onSave({ ...renaming, name });
            setRenaming(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t("rest.deleteTitle")}
          message={t("rest.deleteMessage", { name: label(deleting) })}
          confirmLabel={t("rest.delete")}
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDelete(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

export default RequestList;
```

`index.ts`: `export { default } from "./RequestList";`

- [ ] **Step 7: Verify and commit**

Run: `npm run build && npm test`

```bash
git add src/modules/rest
git commit -m "feat(rest): add the request sidebar with saved and recent groups"
```

---

### Task 12: `RestTab` — the layout, the tab strip and the request pane

Ends with: a real workspace. Requests can be made, opened in tabs, edited in every field, and everything survives closing the tab and reopening it. The response side is still a placeholder — Task 13 fills it.

**Files:**
- Modify: `src/modules/rest/RestTab.tsx`, `src/modules/rest/rest.css`
- Create: `src/modules/rest/components/RequestTabs/{RequestTabs.tsx,RequestTabs.module.css,index.ts}`

**Interfaces:**
- Consumes: everything built so far — `useRequestLists`, `createRequest`, `saveRequest`, `deleteRequest`, `findRequest`, `useWorkspace`, `Splitter`, `clampRatio`, `clampSize`, `RequestList`, `UrlBar`, `KeyValueTable`, `BodyEditor`, `paramsFromUrl`, `urlWithParams`.
- Produces: `RequestTabs` with props `{ tabs, activeId, onSelect, onClose }`; a `RestTab` that Task 13 adds sending to.

- [ ] **Step 1: Write the tab strip**

`RequestTabs.module.css`:

```css
.strip {
  display: flex;
  align-items: stretch;
  gap: 0.15rem;
  padding: 0.25rem 0.25rem 0;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  /* Phase 4 pins the environment dropdown to the right of this, outside the scrolling area. */
  scrollbar-width: thin;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.5rem;
  max-width: 14rem;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  background: none;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.tabActive {
  border-color: var(--border);
  background: var(--surface, rgba(127, 127, 127, 0.1));
}

.title {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 10rem;
}

.method {
  font-size: 0.7em;
  font-weight: 600;
  opacity: 0.8;
}

.close {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.5;
  cursor: pointer;
  display: flex;
}

.close:hover {
  opacity: 1;
}
```

`RequestTabs.tsx`:

```tsx
import { CloseIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import type { RestRequest } from "../../types";
import styles from "./RequestTabs.module.css";

interface Props {
  tabs: RestRequest[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  /** What a request with neither name nor URL is called. */
  label: (request: RestRequest) => string;
}

/**
 * The open requests, across the top of the main area.
 *
 * Closing asks nothing: there is no unsaved state to lose, because every edit is written through
 * to the request as it is made. Middle-click closes too, which is what a tab strip does.
 */
function RequestTabs({ tabs, activeId, onSelect, onClose, label }: Props) {
  const { t } = useTranslation();
  return (
    <div className={styles.strip} role="tablist">
      {tabs.map((request) => (
        <div
          key={request.id}
          role="tab"
          aria-selected={request.id === activeId}
          tabIndex={0}
          className={`${styles.tab}${request.id === activeId ? ` ${styles.tabActive}` : ""}`}
          onClick={() => onSelect(request.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onSelect(request.id);
          }}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(request.id);
          }}
        >
          <span className={styles.method}>{request.method}</span>
          <span className={styles.title}>{label(request)}</span>
          <button
            type="button"
            className={styles.close}
            aria-label={t("rest.shortcutCloseRequest")}
            title={t("rest.shortcutCloseRequest")}
            onClick={(e) => {
              e.stopPropagation();
              onClose(request.id);
            }}
          >
            <CloseIcon size="0.85em" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default RequestTabs;
```

`index.ts`: `export { default } from "./RequestTabs";`

- [ ] **Step 2: Extend `rest.css`**

Replace the file with the workspace's layout:

```css
/* This module's layout. Component-scoped rules live in each component's CSS Module instead. */
.rest-tab {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.rest-sidebar {
  flex: 0 0 auto;
  min-width: 0;
  border-right: 1px solid var(--border);
  display: flex;
}

.rest-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.rest-panes {
  flex: 1;
  min-height: 0;
  display: flex;
}

.rest-request-pane,
.rest-response-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.rest-response-pane {
  flex: 1;
}

/* The tabs inside a pane — Params/Body/Headers, and Preview/Source/Raw/Headers. */
.rest-pane-tabs {
  display: flex;
  gap: 0.15rem;
  padding: 0.25rem 0.5rem 0;
  border-bottom: 1px solid var(--border);
}

.rest-pane-tab {
  padding: 0.3rem 0.6rem;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: inherit;
  cursor: pointer;
  font-size: 0.9em;
  opacity: 0.7;
}

.rest-pane-tab:hover {
  opacity: 1;
}

.rest-pane-tab-active {
  border-bottom-color: var(--accent);
  opacity: 1;
}

.rest-pane-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.rest-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
}
```

- [ ] **Step 3: Give the store a way to add a request that does not exist yet**

`saveRequest` replaces a request already in a group and does nothing for one that is not — so a duplicate needs its own door in. Add to `src/modules/rest/requestsStore.ts`:

```ts
/** Adds a request that is not in either group yet — a duplicate, and from Phase 2 a paste. */
export function addRequest(request: RestRequest): void {
  const lists = addSaved(snapshot, request);
  publish(lists);
  persistRequests(lists);
}
```

- [ ] **Step 4: Rewrite `RestTab.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import Splitter, { clampRatio, clampSize } from "../../components/Splitter";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import BodyEditor from "./components/BodyEditor";
import KeyValueTable from "./components/KeyValueTable";
import RequestList from "./components/RequestList";
import RequestTabs from "./components/RequestTabs";
import UrlBar from "./components/UrlBar";
import { shortUrl } from "./format";
import { findRequest } from "./requests";
import {
  addRequest,
  createRequest,
  deleteRequest,
  saveRequest,
  useRequestLists,
} from "./requestsStore";
import { paramsFromUrl, urlWithParams } from "./syncUrlParams";
import type { RestRequest } from "./types";
import {
  MAX_SIDEBAR_WIDTH,
  MAX_SPLIT_RATIO,
  MIN_SIDEBAR_WIDTH,
  MIN_SPLIT_RATIO,
  setSidebarWidth,
  setSplitRatio,
  useWorkspace,
} from "./workspace";
import "./rest.css";

type RequestTabKey = "params" | "body" | "headers";

/**
 * The REST client's workspace: the request list, the requests open on it, and the pane each one
 * is edited and answered in.
 *
 * **Nothing here is a draft.** Every edit is written straight through to the request in the shared
 * store, so closing a tab loses nothing, two REST tabs cannot overwrite each other, and there is
 * no Save button, no dirty mark and no dialog asking whether to keep anything. Which requests are
 * open is the only state that lives in this component, and it is the only state the app does not
 * remember — the shell keeps no tabs either.
 */
function RestTab({ onTitleChange }: ModuleTabProps) {
  const { t } = useTranslation();
  const lists = useRequestLists();
  const workspace = useWorkspace();

  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [requestTabs, setRequestTabs] = useState<Record<string, RequestTabKey>>({});

  const [width, setWidth] = useState(workspace.sidebarWidth);
  const [ratio, setRatio] = useState(workspace.splitRatio);
  const dragFrom = useRef(0);
  const panesRef = useRef<HTMLDivElement>(null);

  // The workspace file is read once, after the first render — so the furniture starts at its
  // defaults and moves to what was saved when it arrives.
  useEffect(() => setWidth(workspace.sidebarWidth), [workspace.sidebarWidth]);
  useEffect(() => setRatio(workspace.splitRatio), [workspace.splitRatio]);

  const label = (request: RestRequest) =>
    request.name !== "" ? request.name : shortUrl(request.url) || t("rest.untitled");

  /* The open tabs, resolved afresh from the store: a request edited anywhere shows its new name
     here, and one deleted from the sidebar takes its tab with it. */
  const tabs = useMemo(
    () => openIds.map((id) => findRequest(lists, id)).filter((r): r is RestRequest => r !== undefined),
    [openIds, lists],
  );
  const activeRequest = activeId === null ? undefined : findRequest(lists, activeId);

  // The shell's tab is named after whatever is open in it.
  useEffect(() => {
    onTitleChange(activeRequest ? label(activeRequest) : t("rest.newTabTitle"));
  }, [activeRequest, onTitleChange, t]);

  // A tab whose request is gone stops being open, and the keyboard lands on the one beside it.
  useEffect(() => {
    setOpenIds((prev) => prev.filter((id) => findRequest(lists, id) !== undefined));
  }, [lists]);
  useEffect(() => {
    if (activeId !== null && !openIds.includes(activeId)) {
      setActiveId(openIds[openIds.length - 1] ?? null);
    }
  }, [openIds, activeId]);

  function open(id: string) {
    setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
  }

  function close(id: string) {
    setOpenIds((prev) => prev.filter((open) => open !== id));
  }

  function makeRequest() {
    open(createRequest().id);
  }

  function duplicate(request: RestRequest) {
    const copy: RestRequest = {
      ...structuredClone(request),
      id: crypto.randomUUID(),
      name: t("rest.copySuffix", { name: label(request) }),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      // A copy is something someone chose to have, whatever the original was.
      origin: "manual",
    };
    addRequest(copy);
    open(copy.id);
  }

  /** An edit to the request on screen. Everything in the request pane goes through this. */
  function edit(patch: Partial<RestRequest>) {
    if (!activeRequest) return;
    saveRequest({ ...activeRequest, ...patch });
  }

  /** The URL box changed: the Params table is rewritten from it. */
  function editUrl(url: string) {
    if (!activeRequest) return;
    saveRequest({ ...activeRequest, url, params: paramsFromUrl(url, activeRequest.params, crypto.randomUUID) });
  }

  /** The Params table changed: the URL is rewritten from it. */
  function editParams(params: RestRequest["params"]) {
    if (!activeRequest) return;
    saveRequest({ ...activeRequest, params, url: urlWithParams(activeRequest.url, params) });
  }

  const requestTab = activeId === null ? "params" : (requestTabs[activeId] ?? "params");

  const paneTabs: { key: RequestTabKey; label: string }[] = [
    { key: "params", label: t("rest.paramsTab") },
    { key: "body", label: t("rest.bodyTab") },
    { key: "headers", label: t("rest.requestHeadersTab") },
  ];

  return (
    <div className="rest-tab">
      <aside className="rest-sidebar" style={{ width }}>
        <RequestList
          lists={lists}
          activeId={activeId}
          onOpen={open}
          onNew={makeRequest}
          onSave={saveRequest}
          onDuplicate={duplicate}
          onDelete={deleteRequest}
        />
      </aside>

      <Splitter
        orientation="vertical"
        ariaLabel={t("rest.resizeSidebar")}
        title={t("rest.resizeSidebar")}
        onDragStart={() => {
          dragFrom.current = width;
        }}
        onDrag={(delta) =>
          setWidth(clampSize(dragFrom.current, delta, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH))
        }
        onDragEnd={(delta) =>
          setSidebarWidth(clampSize(dragFrom.current, delta, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH))
        }
      />

      <div className="rest-main">
        <RequestTabs
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={close}
          label={label}
        />

        {activeRequest === undefined ? (
          <p className="rest-empty muted">{t("rest.emptyMain")}</p>
        ) : (
          <div className="rest-panes" ref={panesRef}>
            <section className="rest-request-pane" style={{ flex: `0 0 ${ratio * 100}%` }}>
              <UrlBar
                method={activeRequest.method}
                url={activeRequest.url}
                sending={false}
                onMethodChange={(method) => edit({ method })}
                onUrlChange={editUrl}
                onSend={() => {}}
                onCancel={() => {}}
              />
              <div className="rest-pane-tabs" role="tablist">
                {paneTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={requestTab === tab.key}
                    className={`rest-pane-tab${requestTab === tab.key ? " rest-pane-tab-active" : ""}`}
                    onClick={() => setRequestTabs((prev) => ({ ...prev, [activeRequest.id]: tab.key }))}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="rest-pane-body">
                {requestTab === "params" && (
                  <KeyValueTable rows={activeRequest.params} onChange={editParams} />
                )}
                {requestTab === "body" && (
                  <BodyEditor body={activeRequest.body} onChange={(body) => edit({ body })} />
                )}
                {requestTab === "headers" && (
                  <KeyValueTable rows={activeRequest.headers} onChange={(headers) => edit({ headers })} />
                )}
              </div>
            </section>

            <Splitter
              orientation="vertical"
              ariaLabel={t("rest.resizePanes")}
              title={t("rest.resizePanes")}
              onDragStart={() => {
                dragFrom.current = ratio;
              }}
              onDrag={(delta) =>
                setRatio(
                  clampRatio(
                    dragFrom.current,
                    delta,
                    panesRef.current?.clientWidth ?? 0,
                    MIN_SPLIT_RATIO,
                    MAX_SPLIT_RATIO,
                  ),
                )
              }
              onDragEnd={(delta) =>
                setSplitRatio(
                  clampRatio(
                    dragFrom.current,
                    delta,
                    panesRef.current?.clientWidth ?? 0,
                    MIN_SPLIT_RATIO,
                    MAX_SPLIT_RATIO,
                  ),
                )
              }
            />

            <section className="rest-response-pane">
              <p className="rest-empty muted">{t("rest.responseEmpty")}</p>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default RestTab;
```

- [ ] **Step 5: Verify**

Run: `npm run build && npm test`
Expected: both pass, with no unused-import errors.

- [ ] **Step 6: Verify by hand**

```bash
npm run dev:app
```
Open a REST tab and check, noting the result:
1. **New request** adds a row under SAVED and opens a tab on it.
2. Typing `https://x.test/a?page=2` in the URL box grows a row in **Params**; changing the value there rewrites the URL.
3. Unticking a Params row takes it out of the URL and leaves the row in the table.
4. The Body tab switches between None and Raw, and the JSON format button lays a body out.
5. Right-click a sidebar row: **Rename** changes what the row and the tab say; **Duplicate** makes a second row; **Delete** asks first, then closes the tab too.
6. Both splitters drag, and both are still where you left them after the app is restarted.
7. Closing a tab and reopening the request from the sidebar shows every edit still there — including a half-typed URL.
8. Open the same request in two REST tabs (`Ctrl+T`, then the `[+]` menu): an edit in one shows in the other.

- [ ] **Step 7: Commit**

```bash
git add src/modules/rest
git commit -m "feat(rest): assemble the workspace layout, tab strip and request pane"
```

---

### Task 13: Sending — the status bar, the Raw tab and the Headers tab

Ends with a REST client that works. Preview and Source arrive in the next two tasks; the tab strip is driven by a list of implemented modes so that neither of them is ever offered before it exists.

**Files:**
- Create: `src/modules/rest/components/ResponseStatusBar/{ResponseStatusBar.tsx,ResponseStatusBar.module.css,index.ts}`
- Create: `src/modules/rest/components/HexView/{HexView.tsx,HexView.module.css,index.ts}`
- Create: `src/modules/rest/components/ResponsePane/{ResponsePane.tsx,ResponsePane.module.css,index.ts}`
- Modify: `src/modules/rest/RestTab.tsx`

**Interfaces:**
- Consumes: `restSend`, `restCancel`, `decodeBase64`, `CANCELLED` from `./api`; `buildRequest`, `PHASE_ONE_SETTINGS`; `detectBody`, `availableModes`, `pickMode`, `SOURCE_MAX_BYTES`; `formatBytes`, `hexDump`; `errorMessage` from `src/core/errors`; `ErrorBanner`.
- Produces: `SendState` and `IDLE_SEND` (exported from `ResponsePane`), `ResponseStatusBar`, `HexView`, `ResponsePane`.

- [ ] **Step 1: Write `HexView`**

`HexView.module.css`:

```css
.hex {
  margin: 0;
  padding: 0.5rem;
  overflow: auto;
  font-family: "Fira Code", monospace;
  font-size: 0.85em;
  line-height: 1.45;
  white-space: pre;
}

.notice {
  padding: 0.4rem 0.5rem;
  font-size: 0.85em;
}
```

`HexView.tsx`:

```tsx
import { useMemo } from "react";
import { useTranslation } from "../../../../i18n";
import { formatBytes, hexDump } from "../../format";
import styles from "./HexView.module.css";

/** How much of a body is dumped. Past this the page is thousands of lines of monospace and no
 *  faster to read for it. */
const MAX_DUMP = 5 * 1024 * 1024;

interface Props {
  bytes: Uint8Array;
  /** The real length, which may be more than `bytes` holds when Rust cut the body. */
  totalSize: number;
}

/** Raw, for a body that is not text: offset, bytes, and the characters that are printable. */
function HexView({ bytes, totalSize }: Props) {
  const { t } = useTranslation();
  const dump = useMemo(() => hexDump(bytes, MAX_DUMP), [bytes]);
  const cut = bytes.length > MAX_DUMP || totalSize > bytes.length;

  return (
    <>
      {cut && (
        <p className={`${styles.notice} muted`}>
          {t("rest.truncatedNotice", {
            shown: formatBytes(Math.min(bytes.length, MAX_DUMP)),
            total: formatBytes(totalSize),
          })}
        </p>
      )}
      <pre className={styles.hex}>{dump}</pre>
    </>
  );
}

export default HexView;
```

`index.ts`: `export { default } from "./HexView";`

- [ ] **Step 2: Write `ResponseStatusBar`**

`ResponseStatusBar.module.css`:

```css
.bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
  /* Level with the method/URL/Send row across the split, which is what the spec asks for. */
  min-height: 3rem;
  box-sizing: border-box;
  font-size: 0.9em;
}

.status {
  font-weight: 600;
}

.s2xx { color: #2f9e44; }
.s3xx { color: #1971c2; }
.s4xx { color: #f08c00; }
.s5xx { color: #e03131; }

.figure {
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}

.redirect {
  opacity: 0.8;
}
```

`ResponseStatusBar.tsx`:

```tsx
import { useTranslation } from "../../../../i18n";
import { formatBytes } from "../../format";
import type { SendState } from "../ResponsePane";
import styles from "./ResponseStatusBar.module.css";

interface Props {
  state: SendState;
}

/** The class of a status code, which is all its colour is about. */
function statusClass(status: number): string {
  if (status >= 500) return styles.s5xx;
  if (status >= 400) return styles.s4xx;
  if (status >= 300) return styles.s3xx;
  return styles.s2xx;
}

/**
 * What came back, in one line: the code, how long it took and how big it was.
 *
 * A cancelled send says so here rather than through a banner — nothing went wrong, someone
 * changed their mind. A send that failed leaves the previous response's line in place, because
 * the banner above is already saying what happened.
 */
function ResponseStatusBar({ state }: Props) {
  const { t } = useTranslation();
  const { response } = state;

  if (state.phase === "sending") return <div className={styles.bar}>{t("rest.sending")}</div>;
  if (state.phase === "cancelled" && response === null) {
    return <div className={`${styles.bar} muted`}>{t("rest.cancelled")}</div>;
  }
  if (response === null) return <div className={styles.bar} />;

  const redirected = response.final_url !== state.sentUrl;

  return (
    <div className={styles.bar}>
      <span className={`${styles.status} ${statusClass(response.status)}`}>
        {response.status} {response.status_text}
      </span>
      <span className={styles.figure} title={t("rest.totalTimeHint")}>
        {response.total_ms} ms
      </span>
      <span
        className={styles.figure}
        title={
          response.truncated
            ? t("rest.realSizeHint", { size: formatBytes(response.body_size) })
            : t("rest.sizeHint")
        }
      >
        {formatBytes(response.body_size)}
      </span>
      {redirected && (
        <span className={styles.redirect} title={t("rest.finalUrlHint", { url: response.final_url })}>
          {t("rest.redirected")}
        </span>
      )}
      {state.phase === "cancelled" && <span className="muted">{t("rest.cancelled")}</span>}
    </div>
  );
}

export default ResponseStatusBar;
```

`index.ts`: `export { default } from "./ResponseStatusBar";`

- [ ] **Step 3: Write `ResponsePane`**

`ResponsePane.module.css`:

```css
.pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.raw {
  margin: 0;
  padding: 0.5rem;
  font-family: "Fira Code", monospace;
  font-size: 0.85em;
  line-height: 1.5;
  white-space: pre;
  overflow: auto;
}

.rawWrapped {
  white-space: pre-wrap;
  word-break: break-word;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.85em;
}

.headers {
  display: grid;
  grid-template-columns: minmax(8rem, auto) minmax(0, 1fr);
  gap: 0.15rem 0.75rem;
  padding: 0.5rem;
  font-family: "Fira Code", monospace;
  font-size: 0.85em;
  align-content: start;
}

.headerName {
  opacity: 0.75;
}

.headerValue {
  word-break: break-all;
}

.notice {
  padding: 0.4rem 0.5rem;
  font-size: 0.85em;
}
```

`ResponsePane.tsx`:

```tsx
import { useState } from "react";
import ErrorBanner from "../../../../components/ErrorBanner";
import { useTranslation } from "../../../../i18n";
import { SOURCE_MAX_BYTES, availableModes, pickMode, type DetectedBody, type ViewMode } from "../../contentType";
import { formatBytes } from "../../format";
import type { RestResponse } from "../../types";
import HexView from "../HexView";
import ResponseStatusBar from "../ResponseStatusBar";
import styles from "./ResponsePane.module.css";

/** How much of a text body is put on screen. Past this the webview spends its time laying out
 *  characters nobody is reading. */
const MAX_TEXT = 5 * 1024 * 1024;

/**
 * The modes that exist so far.
 *
 * `availableModes` answers what a body *could* be shown as; this is what has been built. Task 14
 * adds `source` and Task 15 adds `preview`, one word each, and until then neither is ever offered
 * — which is what keeps every task in this plan something you can ship.
 */
const IMPLEMENTED: ViewMode[] = ["raw"];

export interface SendState {
  phase: "idle" | "sending" | "done" | "cancelled" | "failed";
  /** The id `rest_cancel` names, while a send is in flight. */
  sendId: string | null;
  /** The URL that was actually sent, which is how a redirect is spotted. */
  sentUrl: string;
  response: RestResponse | null;
  bytes: Uint8Array | null;
  detected: DetectedBody | null;
  /** Already translated. A failed send keeps the previous response on screen underneath it. */
  error: string | null;
}

export const IDLE_SEND: SendState = {
  phase: "idle",
  sendId: null,
  sentUrl: "",
  response: null,
  bytes: null,
  detected: null,
  error: null,
};

interface Props {
  state: SendState;
  /** The viewer the user last chose, kept even while this body cannot be shown in it. */
  preferred: ViewMode;
  onPreferredChange: (mode: ViewMode) => void;
  headersOpen: boolean;
  onHeadersOpenChange: (open: boolean) => void;
  onDismissError: () => void;
}

/** The right-hand pane: the status line, four tabs, and whichever of them is open. */
function ResponsePane({
  state,
  preferred,
  onPreferredChange,
  headersOpen,
  onHeadersOpenChange,
  onDismissError,
}: Props) {
  const { t } = useTranslation();
  const [wrap, setWrap] = useState(false);

  const { response, bytes, detected } = state;
  const size = bytes?.length ?? 0;
  const possible = detected === null ? [] : availableModes(detected.kind, size);
  const offered = possible.filter((mode) => IMPLEMENTED.includes(mode));
  const mode = offered.length === 0 ? null : pickMode(preferred, offered);

  const tabs: { key: ViewMode | "headers"; label: string }[] = [
    ...offered.map((m) => ({
      key: m,
      label: m === "preview" ? t("rest.previewTab") : m === "source" ? t("rest.sourceTab") : t("rest.rawTab"),
    })),
    ...(response === null
      ? []
      : [{ key: "headers" as const, label: t("rest.responseHeadersTab", { n: response.headers.length }) }]),
  ];

  function view() {
    if (headersOpen && response !== null) {
      return (
        <div className={styles.headers}>
          {response.headers.map(([name, value], i) => (
            // Keyed on the position: a header may appear twice with the same name and value, and
            // the order they arrived in is part of what the tab is for.
            <div key={`${name}-${i}`} style={{ display: "contents" }}>
              <span className={styles.headerName}>{name}</span>
              <span className={styles.headerValue}>{value}</span>
            </div>
          ))}
        </div>
      );
    }
    if (bytes === null || detected === null || mode === null) {
      return <p className="rest-empty muted">{t("rest.responseEmpty")}</p>;
    }
    if (mode === "raw") {
      if (detected.text === null) {
        return <HexView bytes={bytes} totalSize={response?.body_size ?? bytes.length} />;
      }
      const shown = detected.text.slice(0, MAX_TEXT);
      return (
        <>
          <label className={styles.toolbar}>
            <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
            {t("rest.wrapLines")}
          </label>
          {shown.length < detected.text.length && (
            <p className={`${styles.notice} muted`}>
              {t("rest.truncatedNotice", {
                shown: formatBytes(MAX_TEXT),
                total: formatBytes(response?.body_size ?? bytes.length),
              })}
            </p>
          )}
          <pre className={`${styles.raw}${wrap ? ` ${styles.rawWrapped}` : ""}`}>{shown}</pre>
        </>
      );
    }
    // Tasks 14 and 15 add the other two; until then `IMPLEMENTED` keeps them off the strip.
    return null;
  }

  return (
    <div className={styles.pane}>
      <ResponseStatusBar state={state} />
      {state.error !== null && <ErrorBanner message={state.error} onDismiss={onDismissError} />}
      {tabs.length > 0 && (
        <div className="rest-pane-tabs" role="tablist">
          {tabs.map((tab) => {
            const selected = tab.key === "headers" ? headersOpen : !headersOpen && tab.key === mode;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`rest-pane-tab${selected ? " rest-pane-tab-active" : ""}`}
                onClick={() => {
                  if (tab.key === "headers") {
                    onHeadersOpenChange(true);
                    return;
                  }
                  onHeadersOpenChange(false);
                  onPreferredChange(tab.key);
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
      {detected !== null && size > SOURCE_MAX_BYTES && !headersOpen && (
        <p className={`${styles.notice} muted`}>
          {t("rest.sourceTooBig", { limit: formatBytes(SOURCE_MAX_BYTES) })}
        </p>
      )}
      <div className={styles.body}>{view()}</div>
    </div>
  );
}

export default ResponsePane;
```

`index.ts`:

```ts
export { default } from "./ResponsePane";
export { IDLE_SEND, type SendState } from "./ResponsePane";
```

- [ ] **Step 4: Wire sending into `RestTab`**

Add to the imports:

```tsx
import { CANCELLED, decodeBase64, restCancel, restSend } from "./api";
import { PHASE_ONE_SETTINGS, buildRequest } from "./buildRequest";
import { detectBody, type ViewMode } from "./contentType";
import ResponsePane, { IDLE_SEND, type SendState } from "./components/ResponsePane";
import { errorMessage } from "../../core/errors";
```

Add the state, beside the others:

```tsx
  const [sends, setSends] = useState<Record<string, SendState>>({});
  const [preferredModes, setPreferredModes] = useState<Record<string, ViewMode>>({});
  const [headersOpen, setHeadersOpen] = useState<Record<string, boolean>>({});
```

Add the send and cancel handlers:

```tsx
  /**
   * Sends the request on screen.
   *
   * `lastUsedAt` is stamped here and nowhere else — opening a tab to look at a request does not
   * count as using it, which is what keeps Recent's ceiling honest from Phase 2 on.
   */
  async function send() {
    if (!activeRequest) return;
    const request = activeRequest;
    const sendId = crypto.randomUUID();
    const wire = buildRequest(request, sendId, PHASE_ONE_SETTINGS);

    setSends((prev) => ({
      ...prev,
      [request.id]: {
        ...(prev[request.id] ?? IDLE_SEND),
        phase: "sending",
        sendId,
        sentUrl: wire.url,
        error: null,
      },
    }));
    saveRequest({ ...request, lastUsedAt: Date.now() });

    try {
      const response = await restSend(wire);
      const bytes = decodeBase64(response.body_base64);
      setSends((prev) => ({
        ...prev,
        [request.id]: {
          phase: "done",
          sendId: null,
          sentUrl: wire.url,
          response,
          bytes,
          detected: detectBody(response.headers, bytes),
          error: null,
        },
      }));
    } catch (e) {
      // Cancelling is not a failure, and a failure leaves the previous response where it was —
      // the banner says what happened, and the pane still holds what is being compared against.
      const cancelled = typeof e === "object" && e !== null && (e as { code?: string }).code === CANCELLED;
      setSends((prev) => ({
        ...prev,
        [request.id]: {
          ...(prev[request.id] ?? IDLE_SEND),
          phase: cancelled ? "cancelled" : "failed",
          sendId: null,
          error: cancelled ? null : errorMessage(t, e),
        },
      }));
    }
  }

  function cancel() {
    const sendId = activeId === null ? null : sends[activeId]?.sendId;
    if (sendId) void restCancel(sendId);
  }
```

In the request pane, replace the two empty handlers and the `sending` prop:

```tsx
              <UrlBar
                method={activeRequest.method}
                url={activeRequest.url}
                sending={sendState.phase === "sending"}
                onMethodChange={(method) => edit({ method })}
                onUrlChange={editUrl}
                onSend={() => void send()}
                onCancel={cancel}
              />
```

with, just above the `return`:

```tsx
  const sendState = activeId === null ? IDLE_SEND : (sends[activeId] ?? IDLE_SEND);
```

Replace the placeholder response section with:

```tsx
            <section className="rest-response-pane">
              <ResponsePane
                state={sendState}
                preferred={activeId === null ? "preview" : (preferredModes[activeId] ?? "preview")}
                onPreferredChange={(mode) =>
                  setPreferredModes((prev) => ({ ...prev, [activeRequest.id]: mode }))
                }
                headersOpen={headersOpen[activeRequest.id] ?? false}
                onHeadersOpenChange={(open) =>
                  setHeadersOpen((prev) => ({ ...prev, [activeRequest.id]: open }))
                }
                onDismissError={() =>
                  setSends((prev) => ({
                    ...prev,
                    [activeRequest.id]: { ...(prev[activeRequest.id] ?? IDLE_SEND), error: null },
                  }))
                }
              />
            </section>
```

- [ ] **Step 5: Verify**

Run: `npm run build && npm test`
Expected: both pass.

- [ ] **Step 6: Verify by hand — the first real request**

```bash
npm run dev:app
```
Against `httpbin.org`, checking and noting each:
1. `GET https://httpbin.org/get` — a green `200 OK`, a time, a size, and the JSON in **Raw**.
2. `GET https://httpbin.org/status/500` — a red `500 Internal Server Error`, **and no error banner**: the send worked.
3. `POST https://httpbin.org/post` with a raw JSON body — the echo shows the body and `Content-Type: application/json`.
4. A header added in the Headers tab comes back in the echo; unticking it takes it out.
5. **Headers** tab lists the response's headers in the order they arrived.
6. `GET https://httpbin.org/delay/10` then **Cancel** — the status bar says Cancelled, no banner appears, and the button goes back to Send.
7. `GET https://httpbin.org/delay/40` — after 30 seconds a banner reads as a timeout.
8. `GET https://nonexistent.invalid/` — a banner about not reaching the server, carrying the DNS message.
9. `GET https://httpbin.org/redirect/2` — the bar shows a redirect mark whose tooltip is the final URL.
10. `GET https://httpbin.org/image/png` — Raw is a hex dump, not mojibake.
11. Switch to another request tab and back: its own response is still there.

- [ ] **Step 7: Commit**

```bash
git add src/modules/rest
git commit -m "feat(rest): send requests and show the response status, raw body and headers"
```

---

### Task 14: The Source tab — `jsonTree`, `domTree` and `TreeView`

**Files:**
- Create: `src/modules/rest/jsonTree.ts`, `src/modules/rest/jsonTree.test.ts`, `src/modules/rest/domTree.ts`
- Create: `src/modules/rest/components/TreeView/{TreeView.tsx,TreeView.module.css,index.ts}`
- Modify: `src/modules/rest/components/ResponsePane/ResponsePane.tsx` — add `"source"` to `IMPLEMENTED` and render it

**Interfaces:**
- Consumes: `copyText` from `src/core/clipboard.ts`; `ContextMenu`.
- Produces: `TreeNode`, `buildJsonTree(value, label?, path?): TreeNode`, `buildDomTree(text, kind): TreeNode | null`, `TreeView` with props `{ root }`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/rest/jsonTree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildJsonTree } from "./jsonTree";

describe("buildJsonTree", () => {
  it("makes a leaf of a scalar", () => {
    expect(buildJsonTree(42)).toEqual({
      path: "$",
      label: "$",
      value: "42",
      summary: null,
      children: null,
    });
  });

  it("quotes a string so it cannot be mistaken for a number", () => {
    expect(buildJsonTree("42").value).toBe('"42"');
  });

  it("writes null and the booleans as themselves", () => {
    expect(buildJsonTree(null).value).toBe("null");
    expect(buildJsonTree(true).value).toBe("true");
  });

  it("counts an object's fields on the branch", () => {
    const tree = buildJsonTree({ a: 1, b: 2 });
    expect(tree.summary).toBe("{2}");
    expect(tree.value).toBeNull();
    expect(tree.children?.map((c) => c.label)).toEqual(["a", "b"]);
  });

  it("counts an array's items", () => {
    expect(buildJsonTree([1, 2, 3]).summary).toBe("[3]");
  });

  it("gives every node the path that reaches it", () => {
    const tree = buildJsonTree({ data: { items: [{ id: 7 }] } });
    const id = tree.children![0].children![0].children![0].children![0];
    expect(id.path).toBe("$.data.items[0].id");
  });

  // A key with a dot or a space in it cannot be written with one, so it is written the other way
  // — which matters because the path is what "Copy path" puts on the clipboard.
  it("brackets a key that cannot be written after a dot", () => {
    expect(buildJsonTree({ "content-type": 1 }).children![0].path).toBe('$["content-type"]');
  });

  it("names an array's children by their index", () => {
    expect(buildJsonTree(["a"]).children![0].label).toBe("0");
  });

  it("has nothing under an empty object", () => {
    expect(buildJsonTree({})).toEqual({
      path: "$",
      label: "$",
      value: null,
      summary: "{0}",
      children: [],
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/modules/rest/jsonTree.test.ts`
Expected: FAIL — `Failed to resolve import "./jsonTree"`.

- [ ] **Step 3: Write `jsonTree.ts`**

```ts
/** A parsed body as a tree of nodes the Source tab can draw. One shape for JSON and for a
 *  document, so `TreeView` knows nothing about either. */
export interface TreeNode {
  /** How this node is reached — `$.data.items[3].id`. Unique within a tree, so it is also the
   *  React key, and it is what "Copy path" copies. */
  path: string;
  label: string;
  /** The scalar as text, for a leaf. Null on a branch. */
  value: string | null;
  /** What a collapsed branch shows: `{3}`, `[2]`. Null on a leaf. */
  summary: string | null;
  children: TreeNode[] | null;
}

/** Whether a key can be written after a dot, or has to go in brackets. */
function isPlainKey(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function childPath(parent: string, key: string): string {
  return isPlainKey(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

/** The tree for a parsed JSON value. `label` and `path` are what the root is called — the
 *  defaults are what a response body gets, and the recursion supplies its own. */
export function buildJsonTree(value: unknown, label = "$", path = "$"): TreeNode {
  if (Array.isArray(value)) {
    return {
      path,
      label,
      value: null,
      summary: `[${value.length}]`,
      children: value.map((item, i) => buildJsonTree(item, String(i), `${path}[${i}]`)),
    };
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      path,
      label,
      value: null,
      summary: `{${entries.length}}`,
      children: entries.map(([key, item]) => buildJsonTree(item, key, childPath(path, key))),
    };
  }
  return {
    path,
    label,
    // Quoted, so `"42"` and `42` are not the same thing on screen — which is half of what anyone
    // opens a response tree to find out.
    value: typeof value === "string" ? JSON.stringify(value) : String(value),
    summary: null,
    children: null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/rest/jsonTree.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write `domTree.ts`**

```ts
import type { TreeNode } from "./jsonTree";

/**
 * An HTML or XML body as a tree.
 *
 * Not covered by `npm test`, and it cannot be: `DOMParser` is a webview API and the test run has
 * no DOM. That is exactly why the part that *can* be tested — which kinds get a Source tab at all
 * — lives in `contentType.ts` instead of here.
 *
 * `parseFromString` with `text/html` runs no script and fetches nothing: it builds a document and
 * stops. There is no way for a response to act on the app through this.
 */

/** An element written the way it would be recognised: `div#main.card`. */
function elementLabel(element: Element): string {
  const id = element.id !== "" ? `#${element.id}` : "";
  const classes = Array.from(element.classList, (name) => `.${name}`).join("");
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

function fromNode(node: Node, path: string, index: number): TreeNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim() ?? "";
    // Whitespace between tags is not content, and a tree full of it is unreadable.
    if (text === "") return null;
    return { path: `${path}/text()[${index}]`, label: "#text", value: text, summary: null, children: null };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as Element;
  const here = `${path}/${element.tagName.toLowerCase()}[${index}]`;
  const attributes: TreeNode[] = Array.from(element.attributes, (attr) => ({
    path: `${here}/@${attr.name}`,
    label: `@${attr.name}`,
    value: attr.value,
    summary: null,
    children: null,
  }));
  const children = Array.from(element.childNodes)
    .map((child, i) => fromNode(child, here, i))
    .filter((child): child is TreeNode => child !== null);
  const all = [...attributes, ...children];

  return {
    path: here,
    label: elementLabel(element),
    value: null,
    summary: `<${all.length}>`,
    children: all,
  };
}

/** The tree for a document, or null when it will not parse — which is what takes the Source tab
 *  away and drops the viewer to Raw. */
export function buildDomTree(text: string, kind: "html" | "xml"): TreeNode | null {
  const doc = new DOMParser().parseFromString(text, kind === "html" ? "text/html" : "application/xml");
  // The XML parser reports a failure as a document containing one of these rather than by throwing.
  if (doc.querySelector("parsererror") !== null) return null;
  const root = doc.documentElement;
  if (!root) return null;
  return fromNode(root, "", 0);
}
```

- [ ] **Step 6: Write `TreeView`**

`TreeView.module.css`:

```css
.tree {
  padding: 0.5rem;
  font-family: "Fira Code", monospace;
  font-size: 0.85em;
  line-height: 1.6;
  overflow: auto;
}

.node {
  padding-left: 1rem;
}

.line {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  cursor: default;
}

.toggle {
  background: none;
  border: none;
  color: inherit;
  padding: 0;
  cursor: pointer;
  display: flex;
  width: 1em;
}

.label {
  opacity: 0.85;
}

.value {
  color: var(--accent);
  word-break: break-all;
}

.summary {
  opacity: 0.55;
}
```

`TreeView.tsx`:

```tsx
import { useState } from "react";
import ContextMenu from "../../../../components/ContextMenu";
import { copyText } from "../../../../core/clipboard";
import { ChevronDownIcon, ChevronRightIcon } from "../../../../icons";
import { useTranslation } from "../../../../i18n";
import type { TreeNode } from "../../jsonTree";
import styles from "./TreeView.module.css";

interface Props {
  root: TreeNode;
}

interface MenuState {
  node: TreeNode;
  x: number;
  y: number;
}

/**
 * The Source tab: a body as a tree that folds.
 *
 * Written here rather than borrowed from the database module's `DocumentNode`, which does a
 * similar job — that one lives behind the module boundary and may not be imported across it, and
 * it is an editor besides. This one only reads.
 *
 * How deep it opens on arrival: two levels. Everything closed is a wall, and everything open is
 * the Raw tab with more indentation.
 */
const OPEN_DEPTH = 2;

function TreeView({ root }: Props) {
  const { t } = useTranslation();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);

  function toggle(path: string) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function draw(node: TreeNode, depth: number) {
    const branch = node.children !== null && node.children.length > 0;
    // Deep nodes start closed, and a node the user has touched is in `closed` either way.
    const open = branch && (depth < OPEN_DEPTH ? !closed.has(node.path) : closed.has(node.path));

    return (
      <div key={node.path} className={styles.node}>
        <div
          className={styles.line}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ node, x: e.clientX, y: e.clientY });
          }}
        >
          {branch ? (
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={open}
              aria-label={open ? t("rest.collapseAll") : t("rest.expandAll")}
              onClick={() => toggle(node.path)}
            >
              {open ? <ChevronDownIcon size="0.85em" /> : <ChevronRightIcon size="0.85em" />}
            </button>
          ) : (
            <span className={styles.toggle} />
          )}
          <span className={styles.label}>{node.label}</span>
          {node.value !== null && <span className={styles.value}>{node.value}</span>}
          {node.summary !== null && !open && <span className={styles.summary}>{node.summary}</span>}
        </div>
        {open && node.children?.map((child) => draw(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className={styles.tree}>
      {draw(root, 0)}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            type="button"
            onClick={() => {
              // A refusal is reported by `copyText`; nothing here has a banner to put it on, so
              // it is swallowed rather than left as an unhandled rejection.
              void copyText(menu.node.value ?? menu.node.summary ?? "").catch(() => {});
              setMenu(null);
            }}
          >
            {t("rest.copyValue")}
          </button>
          <button
            type="button"
            onClick={() => {
              void copyText(menu.node.path).catch(() => {});
              setMenu(null);
            }}
          >
            {t("rest.copyPath")}
          </button>
        </ContextMenu>
      )}
    </div>
  );
}

export default TreeView;
```

`index.ts`: `export { default } from "./TreeView";`

- [ ] **Step 7: Turn the Source tab on**

In `ResponsePane.tsx`:

```tsx
const IMPLEMENTED: ViewMode[] = ["source", "raw"];
```

Add the imports:

```tsx
import { useMemo, useState } from "react";
import { buildDomTree } from "../../domTree";
import { buildJsonTree, type TreeNode } from "../../jsonTree";
import TreeView from "../TreeView";
```

Build the tree once per body, above the `view` function:

```tsx
  /** The tree for this body, or null when it will not parse — which drops the viewer to Raw. */
  const tree = useMemo<TreeNode | null>(() => {
    if (detected === null || detected.text === null) return null;
    if (detected.kind === "json") {
      try {
        return buildJsonTree(JSON.parse(detected.text));
      } catch {
        return null;
      }
    }
    if (detected.kind === "html" || detected.kind === "xml") {
      return buildDomTree(detected.text, detected.kind);
    }
    return null;
  }, [detected]);
```

And in `view`, before the `mode === "raw"` branch:

```tsx
    if (mode === "source") {
      // A body that would not parse has no tree, so Raw is what is left — the same fallback the
      // tab strip applies, arrived at one step later.
      if (tree === null) return <p className="rest-empty muted">{t("rest.responseEmpty")}</p>;
      return <TreeView root={tree} />;
    }
```

- [ ] **Step 8: Verify**

Run: `npm run build && npm test`

- [ ] **Step 9: Verify by hand**

```bash
npm run dev:app
```
1. `GET https://httpbin.org/get` — **Source** shows a tree opened two levels deep, folding on click.
2. Right-click a leaf: **Copy path** gives something like `$.headers.Host`.
3. `GET https://httpbin.org/html` — Source is a DOM tree with attributes as `@name` rows.
4. `GET https://httpbin.org/xml` — Source is the tree, and **there is no Preview tab**: the spec's own example of the fallback rule.
5. `GET https://httpbin.org/image/png` — no Source tab at all.

- [ ] **Step 10: Commit**

```bash
git add src/modules/rest
git commit -m "feat(rest): add the response source tree for JSON, HTML and XML"
```

---

### Task 15: The Preview tab

**Files:**
- Create: `src/modules/rest/components/HtmlPreview/{HtmlPreview.tsx,HtmlPreview.module.css,index.ts}`
- Modify: `src/modules/rest/components/ResponsePane/ResponsePane.tsx` — add `"preview"` to `IMPLEMENTED` and render it

**Interfaces:**
- Consumes: `JsonView` from `src/components/JsonView`; `formatBytes`.
- Produces: `HtmlPreview` with props `{ html, finalUrl }`.

- [ ] **Step 1: Write `HtmlPreview`**

`HtmlPreview.module.css`:

```css
.preview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.5rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.85em;
}

.frame {
  flex: 1;
  min-height: 0;
  border: none;
  /* The page inside is the server's, not the app's — its own background, not ours showing through. */
  background: #fff;
}
```

`HtmlPreview.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "../../../../i18n";
import styles from "./HtmlPreview.module.css";

interface Props {
  html: string;
  /** Where the response ended up, which is what external resources would be resolved against. */
  finalUrl: string;
}

/**
 * A rendered HTML response, behind the tightest sandbox there is.
 *
 * `sandbox` is present and **empty**: no `allow-scripts`, no `allow-same-origin`, no forms and no
 * top-level navigation. A script in the response does not run, and there is no path from the
 * frame to Tauri's IPC. Nothing about this is configurable.
 *
 * No `<base href>` by default either, so images, stylesheets and tracking pixels do not load and
 * the page shown is its own markup and inline CSS. Turning that on is a decision to let the app
 * call the server again, which is why it is a checkbox and why it starts off.
 */
function HtmlPreview({ html, finalUrl }: Props) {
  const { t } = useTranslation();
  const [external, setExternal] = useState(false);

  const document =
    external && finalUrl !== ""
      ? html.replace(/<head([^>]*)>/i, `<head$1><base href="${finalUrl.replace(/"/g, "&quot;")}">`)
      : html;

  return (
    <div className={styles.preview}>
      <label className={styles.toolbar} title={t("rest.loadExternalHint")}>
        <input type="checkbox" checked={external} onChange={(e) => setExternal(e.target.checked)} />
        {t("rest.loadExternal")}
      </label>
      <iframe
        // Remounted when the switch is flipped: a `<base>` added to a document already loaded
        // changes nothing about what it already fetched.
        key={external ? "external" : "isolated"}
        className={styles.frame}
        sandbox=""
        srcDoc={document}
        title={t("rest.previewTab")}
      />
    </div>
  );
}

export default HtmlPreview;
```

`index.ts`: `export { default } from "./HtmlPreview";`

- [ ] **Step 2: Add the preview branch to `ResponsePane`**

```tsx
const IMPLEMENTED: ViewMode[] = ["preview", "source", "raw"];
```

Add the imports:

```tsx
import { useEffect, useMemo, useState } from "react";
import JsonView from "../../../../components/JsonView";
import HtmlPreview from "../HtmlPreview";
```

An image needs an object URL, and an object URL has to be given back:

```tsx
  /** A blob URL for an image body, revoked when the body changes. Left as the empty string for
   *  anything that is not an image — creating one for a 12 MB PDF nobody will look at is waste. */
  const [imageUrl, setImageUrl] = useState("");
  useEffect(() => {
    if (detected?.kind !== "image" || bytes === null) {
      setImageUrl("");
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: detected.mime || "image/png" }));
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [detected, bytes]);
```

And in `view`, before the `source` branch:

```tsx
    if (mode === "preview") {
      if (detected.kind === "json" && detected.text !== null) {
        try {
          return <JsonView value={JSON.parse(detected.text)} />;
        } catch {
          // Called JSON, is not. The text as it came is more use than an error.
          return <pre className={styles.raw}>{detected.text}</pre>;
        }
      }
      if (detected.kind === "html" && detected.text !== null) {
        return <HtmlPreview html={detected.text} finalUrl={response?.final_url ?? ""} />;
      }
      if (detected.kind === "image") {
        return imageUrl === "" ? null : (
          <img className={styles.image} src={imageUrl} alt={t("rest.previewTab")} />
        );
      }
      // PDF and anything else binary: what it is and how big, which is all that can honestly be
      // said without a viewer. Saving a response to a file is out of scope for this phase.
      return (
        <div className={styles.card}>
          <p>{t("rest.binaryBody", {
            mime: detected.mime || t("rest.binaryHint"),
            size: formatBytes(response?.body_size ?? bytes.length),
          })}</p>
          <p className="muted">{t("rest.binaryHint")}</p>
        </div>
      );
    }
```

Add the two classes to `ResponsePane.module.css`:

```css
.image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  align-self: center;
  margin: auto;
  padding: 1rem;
}

.card {
  margin: auto;
  padding: 2rem;
  text-align: center;
}
```

- [ ] **Step 3: Verify**

Run: `npm run build && npm test`

- [ ] **Step 4: Verify by hand — including that the sandbox holds**

```bash
npm run dev:app
```
1. `GET https://httpbin.org/get` — **Preview** is the JSON, indented and coloured.
2. `GET https://httpbin.org/html` — Preview renders the page.
3. **The sandbox.** Send a request to any endpoint that echoes what you give it, with an HTML body containing `<script>document.title='xss'</script><p>hello</p>` — for example `POST https://httpbin.org/anything`, then read the echo. Better still, save that HTML on any local server and fetch it. Expected: the paragraph renders and **the script does not run**; the browser console shows the sandbox blocking it. If anything at all happens, stop and fix it before going on.
4. **Load external resources** off: a page with an `<img src="/image/png">` shows a broken image. On: it loads. Turning it back off shows the broken image again.
5. `GET https://httpbin.org/image/jpeg` — Preview shows the picture.
6. An endpoint returning a PDF — Preview is a card naming the type and the size, and Raw is a hex dump.
7. Choose **Source** on a JSON response, send an image, and confirm Preview is shown; send JSON again and confirm it is back on Source without being asked.

- [ ] **Step 5: Commit**

```bash
git add src/modules/rest
git commit -m "feat(rest): add the response preview for JSON, HTML, images and binaries"
```

---

### Task 16: Shortcuts, the changelog line, and the whole-phase check

**Files:**
- Create: `src/modules/rest/shortcuts.ts`
- Modify: `src/modules/rest/index.ts`, `src/modules/rest/RestTab.tsx`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `ShortcutGroup` from `src/core/shortcuts`; `useShortcut`.
- Produces: `REST_SHORTCUTS`, and a `restModule` that declares them.

**One conflict, decided here.** The spec asks for `Ctrl/Cmd+W` to close a *request* tab, and the shell already owns that chord for closing a *MixDB* tab. `decide()` handles this by design — "two panes may want one chord, and the day they do this is already the place that decides between them" — and resolves it in favour of whichever handler started listening last, which is the REST tab. So `rest.closeRequest` is registered **only while a request tab is actually open**: with the REST workspace empty, `Ctrl+W` closes the MixDB tab as it always did. The cost is a `console.warn` about the clash on every such press **in dev builds only**; that is expected, not a bug to chase.

- [ ] **Step 1: Write the shortcut catalogue**

Create `src/modules/rest/shortcuts.ts`:

```ts
import type { ShortcutGroup } from "../../core/shortcuts";

/**
 * The chords this module's panes answer, handed to the shell through
 * `ModuleDefinition.shortcuts` — the same way `DB_SHORTCUTS` is.
 *
 * Labelled from this module's own dictionary: the `shortcuts.*` group belongs to the shell, and a
 * second dictionary claiming it stops the build.
 */
export const REST_SHORTCUTS: ShortcutGroup[] = [
  {
    scope: "rest",
    labelKey: "rest.shortcutScope",
    defs: [
      /* No `whenTyping: "ignore"`: sending from inside the body editor is the whole reason this
         chord exists, and a body is a textarea. */
      { id: "rest.send", chord: { key: "enter" }, labelKey: "rest.shortcutSend" },
      { id: "rest.newRequest", chord: { key: "n" }, labelKey: "rest.shortcutNewRequest" },
      /* Shares `Ctrl/Cmd+W` with the shell's `app.closeTab`. Registered only while a request tab
         is open, so an empty REST workspace still closes the MixDB tab — see the plan's Task 16. */
      { id: "rest.closeRequest", chord: { key: "w" }, labelKey: "rest.shortcutCloseRequest" },
    ],
  },
];
```

- [ ] **Step 2: Declare them on the module**

In `src/modules/rest/index.ts`:

```ts
import { REST_SHORTCUTS } from "./shortcuts";

export const restModule: ModuleDefinition = {
  id: "rest",
  labelKey: "app.moduleRest",
  Icon: GlobeIcon,
  defaultTitleKey: "rest.newTabTitle",
  Tab: RestTab,
  shortcuts: REST_SHORTCUTS,
};
```

- [ ] **Step 3: Answer them in `RestTab`**

Take `active` from the props — it has been unused until now — and add the three registrations after the handlers:

```tsx
function RestTab({ active, onTitleChange }: ModuleTabProps) {
```

```tsx
import { useShortcut } from "../../core/shortcuts";
```

```tsx
  /* `active` — the prop, not the open request, which Task 12 named `activeRequest` — is what keeps
     the REST tabs behind this one quiet: all of them stay mounted, and all of them would otherwise
     answer the same keystroke. */
  useShortcut(
    "rest.send",
    () => void send(),
    active && activeRequest !== undefined && sendState.phase !== "sending",
  );
  useShortcut("rest.newRequest", makeRequest, active);
  // Only while there is a request tab to close — otherwise the chord is the shell's, as before.
  useShortcut(
    "rest.closeRequest",
    () => activeId !== null && close(activeId),
    active && activeId !== null,
  );
```

- [ ] **Step 4: Add the changelog line**

In `CHANGELOG.md`, under `## [Unreleased]` and `### Added` (creating the heading only if it is not there — never stub the three headings in advance):

```markdown
- REST client tabs: compose a request, send it, and read the response as a preview, a tree or raw bytes.
```

One line, and the headline of the release — which is what the update panel shows.

- [ ] **Step 5: Run everything**

```bash
npm run build
npm test
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: all three clean.

Then the two boundary greps:

```powershell
Get-ChildItem -Recurse src/components,src/core,src/icons -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: nothing.

```powershell
Get-ChildItem -Recurse src/shell,src/i18n -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: only `src/shell/registry.ts` and `src/i18n/dicts.ts`.

- [ ] **Step 6: Verify the shortcuts by hand**

```bash
npm run dev:app
```
1. In a REST tab with a request open, `Ctrl+Enter` sends — including with the cursor inside the body editor.
2. `Ctrl+N` makes a new request and opens it.
3. `Ctrl+W` with a request tab open closes that request tab and leaves the MixDB tab alone.
4. `Ctrl+W` with no request tab open closes the MixDB tab.
5. In a **database** tab, `Ctrl+Enter`, `Ctrl+N` and `Ctrl+W` behave exactly as they did before.
6. Settings → Shortcuts lists a **REST** section with the three chords.

- [ ] **Step 7: Commit**

```bash
git add src/modules/rest CHANGELOG.md
git commit -m "feat(rest): add the module's keyboard shortcuts"
```

---

## Phase 1 acceptance

Everything below has to be true before Phase 1 is called done. The first four are automated; the rest need `npm run dev:app` and a click, because nothing in the suite can say anything about them.

**Automated**
- [ ] `npm run build` clean
- [ ] `npm test` green — `clamp`, `requests`, `syncUrlParams`, `contentType`, `buildRequest`, `format`, `jsonTree`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` clean
- [ ] Both boundary greps return what `.agent/conventions/adding-a-module.md` says they should

**By hand — the things with no other check**
- [ ] The `[+]` menu lists two modules and opens either (its first run ever)
- [ ] `registry.ts` with two modules breaks nothing about the database tab
- [ ] A request survives a restart, half-typed URL and all
- [ ] Two REST tabs open on one request stay in step
- [ ] Send, and Cancel mid-flight
- [ ] A `500` shows as a response, not as an error banner; a timeout and an unreachable host show as banners
- [ ] Preview / Source / Raw / Headers, and the fallback when a mode is not available
- [ ] The sticky mode returns when it becomes available again
- [ ] **The HTML preview's sandbox blocks a script in the response** — the one check with a security consequence
- [ ] Both splitters drag and are remembered
- [ ] The three shortcuts, and that `Ctrl+W` still reaches the shell when it should

## Not in this plan

From the spec's §8, each with its own plan when its turn comes:

| Phase | What |
| --- | --- |
| 2 | Paste a cURL command or a URL into the URL box; Copy as cURL; the Recent group's rules |
| 3 | The Auth tab, and the panes for form, multipart and binary bodies |
| 4 | Environments: the dropdown, the dialog, `{{var}}` interpolation, secrets through the OS credential store |
| 5 | The history dialog and the module's Settings pane |

And from the spec's non-goals, not planned at all: streaming and SSE, WebSocket/GraphQL/gRPC, folder collections, Postman/Insomnia/OpenAPI import, pre- and post-request scripts, a cookie jar, saving a response to a file, per-hop timing, session restore, and moving the database module's three hand-written resizers onto the shared `Splitter`.









