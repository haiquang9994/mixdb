# Kế hoạch triển khai: một nơi nhận phím tắt Ctrl/Cmd

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gom toàn bộ chord `Ctrl/Cmd` về một danh mục dữ liệu và đúng một listener trên `window`, rồi sinh bảng phím tắt trong Settings từ chính danh mục đó — không đổi hành vi nào người dùng đang có.

**Architecture:** `src/core/shortcuts/` là cơ chế thuần (không có danh mục của riêng nó): một hàm quyết định thuần `decide()`, một store singleton ở tầng module, và hai hook — `useShortcut` để đăng ký handler, `useShortcutDispatcher` để cài listener duy nhất. Shell giữ danh mục của mình và gộp với phần các module góp qua `ModuleDefinition.shortcuts`, rồi bơm xuống dispatcher. Ngữ cảnh đến từ ba nguồn tường minh: `enabled` (state React của component), `modalDepth` (đếm ở `useDialogExit` và `ContextMenu`), `typing` (`isTextEntry`).

**Tech Stack:** React 19, TypeScript strict, Vite, Vitest (chỉ test logic thuần — repo không có jsdom).

**Spec:** [docs/superpowers/specs/2026-08-18-global-shortcuts-design.md](../specs/2026-08-18-global-shortcuts-design.md)

## Global Constraints

Mọi task đều ngầm chịu các ràng buộc này.

- **Kiểm chứng sau mỗi task:** `npm run build` (`tsc` strict + `vite build`) phải xanh. `npm test` phải xanh từ task 1 trở đi.
- **`noUnusedLocals: true` và `noUnusedParameters: true`** trong `tsconfig.json`. Gỡ một cách dùng đi mà quên gỡ `import` là build đỏ, không phải cảnh báo. Mỗi task xoá code phải kiểm lại danh sách import của file đó.
- **Luật tầng** (`.agent/architecture/frontend.md`): `core/` chỉ được import `components/` và `i18n/`. `core/shortcuts/` **không** được tự đi lấy danh mục từ `shell/` hay `modules/`; danh mục luôn được truyền vào.
- **Bảo vệ trùng nhóm i18n** (`src/i18n/dicts.ts`): ngoài `error`, không hai từ điển nào được đặt trùng tên nhóm cấp một. Shell sở hữu nhóm mới `shortcuts`; module db **không** được mở nhóm cùng tên — nhãn của nó nằm trong `sqlTable.*` và `query.*`.
- **Không thêm jsdom, không test component.** Chỉ `decide.ts` có test tự động; phần nối dây được kiểm bằng danh sách thủ công ở cuối kế hoạch này.
- **Không đổi hành vi người dùng thấy** ngoài đúng hai thứ được nêu tên trong task 3 và task 7.
- **Comment và tên trong code viết bằng tiếng Anh**, theo đúng phần còn lại của repo. Văn bản kế hoạch này là tiếng Việt.
- **Commit message:** `<type>(<scope>): <message>`, tiếng Anh, thể mệnh lệnh. **Không** thêm trailer `Co-Authored-By`.
- Nhánh làm việc: `master`.

---

## Cấu trúc file

**Tạo mới (8 file):**

| File | Trách nhiệm |
| --- | --- |
| `src/core/shortcuts/types.ts` | `Chord`, `ShortcutDef`, `ShortcutGroup`. Thuần dữ liệu. |
| `src/core/shortcuts/decide.ts` | `decide()` — toàn bộ luật phân giải, hàm thuần. |
| `src/core/shortcuts/decide.test.ts` | Test của `decide()`. |
| `src/core/shortcuts/store.ts` | Singleton: handler đang đăng ký (có thứ tự), độ sâu modal. |
| `src/core/shortcuts/useShortcut.ts` | `useShortcut`, `useShortcutDispatcher`. |
| `src/core/shortcuts/index.ts` | Mặt tiền của thư mục — nơi duy nhất bên ngoài import tới. |
| `src/shell/shortcuts.ts` | `SHELL_SHORTCUTS`, `ALL_SHORTCUTS`. |
| `src/modules/db/shortcuts.ts` | `DB_SHORTCUTS`. |
| `src/shell/components/SettingsModal/ShortcutsSection.tsx` | Pane bảng phím tắt. |

**Sửa (12 file):** `src/shell/module.ts`, `src/shell/App.tsx`, `src/shell/components/SettingsModal/SettingsModal.tsx`, `src/shell/components/SettingsModal/SettingsModal.module.css`, `src/components/dialogMotion.ts`, `src/components/ContextMenu.tsx`, `src/core/reload.ts`, `src/modules/db/index.ts`, `src/modules/db/components/SqlTable/SqlTable.tsx`, `src/icons/icons.tsx`, `src/icons/index.ts`, `src/i18n/en.ts`, `src/i18n/vi.ts`, `src/modules/db/i18n/en.ts`, `src/modules/db/i18n/vi.ts`, `.agent/architecture/frontend.md`, `CHANGELOG.md`.

**Không đụng:** cả 10 file dialog (chúng đã gọi `useDialogExit`), 5 call site của `useReloadShortcut`, `src/core/platform.ts`, `src/core/textEntry.ts`, keymap CodeMirror.

### Hai chỗ kế hoạch này lệch khỏi spec, và vì sao

1. **`Mod+A` chuyển ở task 6 chứ không task 5.** Bảng "chia đợt" của spec xếp cả `T`, `W` và `A`-nuốt vào bước 5, nhưng quyền nuốt `Mod+A` nằm trên def `grid.selectAll` của module db, mà def đó chỉ vào danh mục ở bước 6. Bỏ nhánh `Mod+A` khỏi `App.tsx` ở bước 5 sẽ để hở một bước mà `Mod+A` bôi đen được giao diện. Trạng thái cuối **giống hệt** spec; chỉ đường đi tới đó đổi.
2. **Dòng CHANGELOG viết lại.** Spec đề nghị `### Changed` với "Phím tắt Ctrl/Cmd gom về một nơi, và Settings có bảng liệt kê chúng". Quy ước changelog nói rõ **refactor không vào file này**, và phần người dùng thật sự thấy là cái bảng mới — nên nó là `### Added` với đúng phần đó. Chi tiết ở task 7.

3. **Lọc modal đổi chỗ trong `decide` — sửa một lỗi hồi quy của spec.** Spec xếp luật theo thứ tự: (4) `modalDepth > 0` bỏ mọi def không `inModal`, rồi (6) `swallow` nếu def nào **còn lại** mang `unhandled: "swallow"`. Áp đúng như vậy thì khi có dialog mở, `grid.selectAll` bị loại ở bước 4 và `Mod+A` **không còn bị nuốt** — webview được phép bôi đen giao diện ngay sau lưng hộp thoại *Drop table?*. Hôm nay `App.tsx` nuốt vô điều kiện ngoài ô nhập liệu, nên đó là hồi quy thật.

   Kế hoạch này tách hai câu hỏi ra: **modal quyết định ai được *chạy*, không quyết định webview được cầm phím nào.** Lọc `inModal` chỉ áp khi chọn `live`; danh sách xét `swallow` vẫn là toàn bộ ứng viên sau khi lọc chord, `owner` và `typing`. Lọc `typing` **vẫn** cắt cả swallow — đúng như hôm nay, `Ctrl+A` trong ô nhập liệu là select-all của ô đó và phải tới được nó. Xem `decide.ts` ở task 1 và test *"still swallows behind a modal…"*.

---

## Task 1: Mô hình dữ liệu và hàm quyết định

Không nối vào đâu cả. Kết thúc task này repo có thêm một hàm thuần đã được test và chưa ai gọi.

**Files:**
- Create: `src/core/shortcuts/types.ts`
- Create: `src/core/shortcuts/decide.ts`
- Test: `src/core/shortcuts/decide.test.ts`

**Interfaces:**
- Consumes: `TranslationKey` từ `src/i18n`.
- Produces: `Chord`, `ShortcutDef`, `ShortcutGroup` (types.ts); `Press`, `Decision`, `ShortcutContext`, `decide(press: Press, groups: ShortcutGroup[], ctx: ShortcutContext): Decision` (decide.ts).

- [ ] **Step 1: Viết `types.ts`**

```ts
// src/core/shortcuts/types.ts
import type { TranslationKey } from "../../i18n";

/**
 * A chord, without the modifier that makes it one.
 *
 * There is no `ctrl` or `meta` here on purpose. Which of the two counts is a platform question with
 * exactly one right answer — `⌘` on a Mac, `Ctrl` elsewhere, and the other one being held rules the
 * chord out — and `core/platform.ts` exists to hold that answer once. A registry that let a chord
 * name its own modifier would be the first place that rule got broken, and the remap screen after
 * it the second.
 */
export interface Chord {
  /** Lower case, compared against `e.key.toLowerCase()`. */
  key: string;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDef {
  /** Never changes. This is what a handler registers under, and what a remapping would be filed
   *  against — so it outlives whatever key it happens to carry today. */
  id: string;
  chord: Chord;
  labelKey: TranslationKey;
  /** Left alone where the user is typing — see `core/textEntry.ts`. Select-all inside the filter
   *  bar is that field's own, not the grid's. */
  whenTyping?: "ignore";
  /** Still answers while a modal is up. Off by default: the keyboard belongs to whatever is on
   *  top. */
  inModal?: true;
  /** Take the key off the webview even when nothing is listening. Off by default, so an unclaimed
   *  chord goes through untouched. */
  unhandled?: "swallow";
  /** Listed in the table, ignored by the dispatcher. For the keys CodeMirror binds itself. */
  owner?: "editor";
}

/** One heading in the shortcut table. Grouping in the data is what makes a scope without a label
 *  impossible to write. */
export interface ShortcutGroup {
  scope: string;
  labelKey: TranslationKey;
  defs: ShortcutDef[];
}
```

- [ ] **Step 2: Viết test trước khi có `decide.ts`**

```ts
// src/core/shortcuts/decide.test.ts
import { describe, expect, it } from "vitest";
import { decide, type Press } from "./decide";
import type { ShortcutGroup } from "./types";

/** A press with the modifier down on `A`, which each test bends to what it is asking about. */
const press = (over: Partial<Press> = {}): Press => ({
  key: "a",
  shift: false,
  alt: false,
  mod: true,
  typing: false,
  ...over,
});

/* A catalogue of its own rather than the app's: these tests are about the rules, and a test that
   reads the real catalogue starts failing the day someone adds a shortcut to it. `labelKey` is a
   real key only because the type demands one — nothing here reads it. */
const GROUPS: ShortcutGroup[] = [
  {
    scope: "app",
    labelKey: "app.settings",
    defs: [
      { id: "app.newTab", chord: { key: "t" }, labelKey: "app.settings", inModal: true },
      { id: "pane.reload", chord: { key: "r" }, labelKey: "app.settings" },
    ],
  },
  {
    scope: "grid",
    labelKey: "app.settings",
    defs: [
      {
        id: "grid.selectAll",
        chord: { key: "a" },
        labelKey: "app.settings",
        whenTyping: "ignore",
        unhandled: "swallow",
      },
      { id: "grid.focusFilter", chord: { key: "f" }, labelKey: "app.settings" },
      {
        id: "editor.format",
        chord: { key: "f", shift: true },
        labelKey: "app.settings",
        owner: "editor",
      },
    ],
  },
  {
    /* A second pane that would want the same chord — the case the resolver is built for before it
       exists, so the remap screen does not have to retrofit it. */
    scope: "keys",
    labelKey: "app.settings",
    defs: [{ id: "keys.selectAll", chord: { key: "a" }, labelKey: "app.settings" }],
  },
];

const ctx = (enabled: string[], modalDepth = 0) => ({ modalDepth, enabled });

describe("decide", () => {
  it("ignores a press without the platform's modifier", () => {
    expect(decide(press({ mod: false }), GROUPS, ctx(["grid.selectAll"]))).toEqual({ do: "nothing" });
  });

  it("runs the shortcut whose handler is listening", () => {
    expect(decide(press(), GROUPS, ctx(["grid.selectAll"]))).toEqual({
      do: "run",
      id: "grid.selectAll",
    });
  });

  it("leaves a chord nothing claims alone", () => {
    expect(decide(press({ key: "q" }), GROUPS, ctx([]))).toEqual({ do: "nothing" });
  });

  it("matches shift and alt exactly", () => {
    // Ctrl+Shift+F is the editor's, not the filter bar's.
    expect(decide(press({ key: "f", shift: true }), GROUPS, ctx(["grid.focusFilter"]))).toEqual({
      do: "nothing",
    });
    expect(decide(press({ key: "f" }), GROUPS, ctx(["grid.focusFilter"]))).toEqual({
      do: "run",
      id: "grid.focusFilter",
    });
  });

  it("swallows a chord that asks to be swallowed when nobody is listening", () => {
    // Nothing selects rows on the connection form, and the webview must still not paint the whole
    // window blue.
    expect(decide(press(), GROUPS, ctx([]))).toEqual({ do: "swallow" });
  });

  it("does not swallow a chord that never asked to be", () => {
    expect(decide(press({ key: "r" }), GROUPS, ctx([]))).toEqual({ do: "nothing" });
  });

  it("holds every shortcut back while a modal is up, except the ones marked for it", () => {
    expect(decide(press({ key: "r" }), GROUPS, ctx(["pane.reload"], 1))).toEqual({ do: "nothing" });
    expect(decide(press({ key: "t" }), GROUPS, ctx(["app.newTab"], 1))).toEqual({
      do: "run",
      id: "app.newTab",
    });
  });

  it("still swallows behind a modal when the swallowing def is the one held back", () => {
    // The grid is not going to select anything from behind a question, but the webview selecting
    // the app's own chrome is no better an answer there than anywhere else. This is what `App.tsx`
    // did before the registry — swallow unconditionally, outside a text field — and losing it would
    // be a regression nobody asked for.
    expect(decide(press(), GROUPS, ctx(["grid.selectAll"], 1))).toEqual({ do: "swallow" });
  });

  it("stands aside where the user is typing", () => {
    // Ctrl+A in the filter bar is that field's select-all and has to reach it.
    expect(decide(press({ typing: true }), GROUPS, ctx(["grid.selectAll"]))).toEqual({
      do: "nothing",
    });
  });

  it("only stands aside for the shortcuts that asked to", () => {
    expect(decide(press({ key: "f", typing: true }), GROUPS, ctx(["grid.focusFilter"]))).toEqual({
      do: "run",
      id: "grid.focusFilter",
    });
  });

  it("never runs a shortcut the editor owns", () => {
    expect(
      decide(press({ key: "f", shift: true }), GROUPS, ctx(["editor.format"])),
    ).toEqual({ do: "nothing" });
  });

  it("breaks a tie on the order handlers were enabled, not the order they are declared", () => {
    // `grid.selectAll` comes first in the catalogue, so a resolver reading catalogue order would
    // answer the same both ways round. The last one enabled is the one on top.
    expect(decide(press(), GROUPS, ctx(["keys.selectAll", "grid.selectAll"]))).toEqual({
      do: "run",
      id: "grid.selectAll",
    });
    expect(decide(press(), GROUPS, ctx(["grid.selectAll", "keys.selectAll"]))).toEqual({
      do: "run",
      id: "keys.selectAll",
    });
  });

  it("ignores handlers listening for something else entirely", () => {
    expect(decide(press(), GROUPS, ctx(["pane.reload"]))).toEqual({ do: "swallow" });
  });
});
```

- [ ] **Step 3: Chạy test để thấy nó đỏ**

Run: `npx vitest run src/core/shortcuts/decide.test.ts`
Expected: FAIL — không phân giải được `./decide`.

- [ ] **Step 4: Viết `decide.ts`**

```ts
// src/core/shortcuts/decide.ts
import type { ShortcutDef, ShortcutGroup } from "./types";

/** A keystroke, already read: the DOM questions are asked once by the dispatcher and answered as
 *  plain flags, so everything below is testable without a browser. */
export interface Press {
  /** Already lower case. */
  key: string;
  shift: boolean;
  alt: boolean;
  /** What `hasPrimaryModifier` said. */
  mod: boolean;
  /** What `isTextEntry` said. */
  typing: boolean;
}

export type Decision =
  | { do: "run"; id: string }
  | { do: "swallow" }
  | { do: "nothing" };

export interface ShortcutContext {
  /** How many dialogs and menus are up. Anything above zero and the keyboard is theirs. */
  modalDepth: number;
  /** The ids listening right now, **in the order they started listening** — newest last. An array
   *  and not a set: the tie-break below needs that order, and the catalogue cannot supply it. */
  enabled: string[];
}

function matches(def: ShortcutDef, press: Press): boolean {
  return (
    def.chord.key === press.key &&
    (def.chord.shift ?? false) === press.shift &&
    (def.chord.alt ?? false) === press.alt
  );
}

/**
 * What a keystroke means: run something, take the key off the webview, or let it through.
 *
 * Every rule the app has about shortcuts lives here, and nothing else does — no DOM, no React, no
 * clock. The dispatcher around it is fifteen lines of glue, which is the point: this repo tests
 * pure logic and nothing else, so the logic is what everything worth being wrong about goes into.
 */
export function decide(press: Press, groups: ShortcutGroup[], ctx: ShortcutContext): Decision {
  if (!press.mod) return { do: "nothing" };

  const candidates = groups
    .flatMap((group) => group.defs)
    // A list, not a find: two panes may want one chord, and the day they do this is already the
    // place that decides between them rather than a thing to be rewritten.
    .filter((def) => matches(def, press))
    // CodeMirror binds these on the editor itself and gets there first. They are in the catalogue
    // to be listed, not to be dispatched.
    .filter((def) => def.owner !== "editor")
    // Where the user is typing, the field's own editing is left alone — and a chord left alone is
    // left alone completely, swallowing included.
    .filter((def) => !press.typing || def.whenTyping !== "ignore");

  const claimed = new Set(
    candidates
      // A modal decides who *acts*, not what the webview is allowed to have: the keyboard belongs
      // to whatever is on top, but select-all painting the app's chrome blue is no better an answer
      // behind a dialog than in front of one. So this filter is here rather than above.
      .filter((def) => ctx.modalDepth === 0 || def.inModal === true)
      .map((def) => def.id),
  );
  // Ordered by `ctx.enabled`, never by the catalogue: which handler came up last is a fact about
  // the screen, and the catalogue is static data that knows nothing about it.
  const live = ctx.enabled.filter((id) => claimed.has(id));

  if (live.length > 0) {
    if (live.length > 1 && import.meta.env.DEV) {
      console.warn(
        `Shortcut clash: ${live.join(", ")} all answer this chord. Running ${live[live.length - 1]}.`,
      );
    }
    return { do: "run", id: live[live.length - 1] };
  }

  return candidates.some((def) => def.unhandled === "swallow")
    ? { do: "swallow" }
    : { do: "nothing" };
}
```

- [ ] **Step 5: Chạy test để thấy nó xanh**

Run: `npx vitest run src/core/shortcuts/decide.test.ts`
Expected: PASS, 12 test.

- [ ] **Step 6: Chạy toàn bộ kiểm chứng**

Run: `npm test` rồi `npm run build`
Expected: cả hai xanh.

- [ ] **Step 7: Commit**

```bash
git add src/core/shortcuts/types.ts src/core/shortcuts/decide.ts src/core/shortcuts/decide.test.ts
git commit -m "feat(shortcuts): add the shortcut model and its resolver"
```

---

## Task 2: Store, hook và dispatcher với danh mục rỗng

Cơ chế đã chạy thật trên `window` nhưng danh mục rỗng, nên `decide` luôn trả `nothing` và không phím nào đổi nghĩa.

**Files:**
- Create: `src/core/shortcuts/store.ts`
- Create: `src/core/shortcuts/useShortcut.ts`
- Create: `src/core/shortcuts/index.ts`
- Create: `src/shell/shortcuts.ts`
- Modify: `src/shell/module.ts` (thêm một trường vào `ModuleDefinition`)
- Modify: `src/shell/App.tsx` (gọi dispatcher)

**Interfaces:**
- Consumes: `decide`, `Press`, `Decision`, `ShortcutGroup` (task 1); `hasPrimaryModifier` từ `src/core/platform`; `isTextEntry` từ `src/core/textEntry`; `MODULES` từ `src/shell/registry`.
- Produces:
  - `register(registration: { id: string; handler: () => void }): () => void`
  - `enabledIds(): string[]`
  - `run(id: string): void`
  - `enterModal(): () => void`
  - `modalDepth(): number`
  - `useShortcut(id: string, handler: () => void, enabled: boolean): void`
  - `useShortcutDispatcher(groups: ShortcutGroup[]): void`
  - `SHELL_SHORTCUTS: ShortcutGroup[]`, `ALL_SHORTCUTS: ShortcutGroup[]`
  - `ModuleDefinition.shortcuts?: ShortcutGroup[]`

- [ ] **Step 1: Viết `store.ts`**

```ts
// src/core/shortcuts/store.ts

/** One handler, listening. Held as an object so a registration can be cancelled by identity —
 *  two panes may be listening for the same id at once, and removing "the one with this id" would
 *  take the wrong one down. */
export interface Registration {
  id: string;
  handler: () => void;
}

/**
 * Who is listening, and what is standing over them.
 *
 * A module-level singleton rather than a React context, the same shape `core/reload.ts` already
 * has: nothing here belongs in the render tree, and a provider wrapped round `App` would be
 * ceremony for a list two entries long.
 */
const registrations: Registration[] = [];
let depth = 0;

/** Starts listening; the returned function stops. Order matters — see `enabledIds`. */
export function register(registration: Registration): () => void {
  registrations.push(registration);
  return () => {
    const at = registrations.indexOf(registration);
    if (at >= 0) registrations.splice(at, 1);
  };
}

/** The ids listening, oldest first — the order `decide` breaks ties on. */
export function enabledIds(): string[] {
  return registrations.map((registration) => registration.id);
}

/** Runs the newest handler registered under `id`, which is the one `decide` picked. */
export function run(id: string): void {
  for (let i = registrations.length - 1; i >= 0; i -= 1) {
    if (registrations[i].id === id) {
      registrations[i].handler();
      return;
    }
  }
}

/** Marks a dialog or menu as up; the returned function marks it down again. Idempotent, so a
 *  disposer called twice — which is what StrictMode does to an effect — cannot unbalance the
 *  count. */
export function enterModal(): () => void {
  depth += 1;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    depth -= 1;
  };
}

export function modalDepth(): number {
  return depth;
}
```

- [ ] **Step 2: Viết `useShortcut.ts`**

```ts
// src/core/shortcuts/useShortcut.ts
import { useEffect, useRef } from "react";
import { hasPrimaryModifier } from "../platform";
import { isTextEntry } from "../textEntry";
import { decide } from "./decide";
import { enabledIds, modalDepth, register, run } from "./store";
import type { ShortcutGroup } from "./types";

/**
 * Answers `id` for as long as `enabled` says this pane is the one being looked at.
 *
 * `enabled` is what keeps a chord unambiguous: every connection tab stays mounted behind the one
 * on show, and each of their grids would otherwise answer the same keystroke together.
 *
 * `handler` is read at the moment the key is pressed rather than when the listener was registered,
 * so it may close over state freely — a pane mid-request checks for that inside it, exactly as its
 * button's `disabled` does.
 */
export function useShortcut(id: string, handler: () => void, enabled: boolean): void {
  // Through a ref so the registration is made once per spell of being on screen, rather than torn
  // down and remade on every render that hands the hook a fresh closure.
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return register({ id, handler: () => latest.current() });
  }, [id, enabled]);
}

/**
 * The app's one keydown listener. Called once, by the shell.
 *
 * `groups` must be a stable value — a fresh array each render would rebind the listener each
 * render. The catalogues are module-level constants, which is what makes that true.
 */
export function useShortcutDispatcher(groups: ShortcutGroup[]): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // CodeMirror declares `preventDefault: true` on its own keymap and sits on the editor
      // element, so it always answers before anything on the window. An editor with the focus
      // wins, and it says so this way rather than by being negotiated with.
      if (e.defaultPrevented) return;

      const decision = decide(
        {
          key: e.key.toLowerCase(),
          shift: e.shiftKey,
          alt: e.altKey,
          mod: hasPrimaryModifier(e),
          typing: isTextEntry(e.target),
        },
        groups,
        { modalDepth: modalDepth(), enabled: enabledIds() },
      );

      if (decision.do === "nothing") return;
      // One `preventDefault`, and not only for tidiness: on a Mac this is what keeps `⌘W` on the
      // tab instead of letting the AppKit menu bar close the window. A handler that forgot it lost
      // its key to the operating system; there is nowhere left to forget it now.
      e.preventDefault();
      if (decision.do === "run") run(decision.id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [groups]);
}
```

- [ ] **Step 3: Viết `index.ts`**

```ts
// src/core/shortcuts/index.ts
export { decide, type Decision, type Press, type ShortcutContext } from "./decide";
export { enterModal } from "./store";
export { useShortcut, useShortcutDispatcher } from "./useShortcut";
export type { Chord, ShortcutDef, ShortcutGroup } from "./types";
```

- [ ] **Step 4: Thêm trường `shortcuts` vào `ModuleDefinition`**

Trong `src/shell/module.ts`, thêm import và một trường ngay sau `settings`:

```ts
import type { ShortcutGroup } from "../core/shortcuts";
```

```ts
  settings?: ModuleSettingsSection;
  /** The Ctrl/Cmd chords this module's panes answer, for the dispatcher to resolve and for
   *  Settings to list. Contributed exactly the way `settings` is: the shell collects them and
   *  knows nothing about what any of them do. */
  shortcuts?: ShortcutGroup[];
```

- [ ] **Step 5: Viết `src/shell/shortcuts.ts` với danh mục rỗng**

```ts
// src/shell/shortcuts.ts
import type { ShortcutGroup } from "../core/shortcuts";
import { MODULES } from "./registry";

/** The chords the app answers wherever you are — the tab bar's, and the reload every pane shares.
 *
 *  Empty until the shell's own keys are moved over. */
export const SHELL_SHORTCUTS: ShortcutGroup[] = [];

/**
 * Every chord in the app, the shell's and the modules'.
 *
 * Assembled here rather than inside `core/shortcuts/`: that folder is the mechanism and may not
 * import from `shell/` or `modules/` at all — see `.agent/architecture/frontend.md`. The
 * dispatcher is handed this list; it never goes looking for one.
 *
 * A module-level constant, so the dispatcher binds its listener once for the life of the app.
 */
export const ALL_SHORTCUTS: ShortcutGroup[] = [
  ...SHELL_SHORTCUTS,
  ...MODULES.flatMap((m) => m.shortcuts ?? []),
];
```

- [ ] **Step 6: Gọi dispatcher trong `App.tsx`**

Thêm import:

```ts
import { useShortcutDispatcher } from "../core/shortcuts";
import { ALL_SHORTCUTS } from "./shortcuts";
```

Và một dòng ngay dưới `useScrollAcceleration();`:

```ts
  useScrollAcceleration();
  useShortcutDispatcher(ALL_SHORTCUTS);
```

`useEffect` cũ giữ nguyên toàn bộ trong task này.

- [ ] **Step 7: Kiểm chứng**

Run: `npm run build` rồi `npm test`
Expected: cả hai xanh. Danh mục rỗng nên `decide` không bao giờ tìm được ứng viên; mọi phím vẫn do các listener cũ xử lý.

- [ ] **Step 8: Commit**

```bash
git add src/core/shortcuts/store.ts src/core/shortcuts/useShortcut.ts src/core/shortcuts/index.ts src/shell/shortcuts.ts src/shell/module.ts src/shell/App.tsx
git commit -m "feat(shortcuts): wire the dispatcher with an empty catalogue"
```

---

## Task 3: Đếm modal ở một chỗ

`useDialogExit` và `ContextMenu` báo lên store khi chúng có mặt. Chưa ai đọc con số đó — danh mục vẫn rỗng — nên task này không đổi hành vi nào.

**Files:**
- Modify: `src/components/dialogMotion.ts`
- Modify: `src/components/ContextMenu.tsx`

**Interfaces:**
- Consumes: `enterModal()` từ `src/core/shortcuts` (task 2).
- Produces: không có API mới. Từ đây `modalDepth()` là con số thật.

- [ ] **Step 1: Đếm trong `useDialogExit`**

`src/components/dialogMotion.ts` — thêm import:

```ts
import { enterModal } from "../core/shortcuts";
```

Và một effect ngay đầu thân `useDialogExit`, trước `const [closing, setClosing]`:

```ts
export function useDialogExit() {
  /* Every dialog in the app calls this hook, which makes it the one place that knows a dialog is
     up — so it is where the count is kept. Ten dialogs, and not one of their files has to say so.
     The count is what a global shortcut asks before acting: the keyboard belongs to whatever is on
     top, and a reload fired blind from behind a form throws away what was being typed into it.

     It stays up through the exit animation, because the dialog is still on screen for those 130ms
     and still holds the keyboard. */
  useEffect(() => enterModal(), []);

  const [closing, setClosing] = useState(false);
```

- [ ] **Step 2: Đếm trong `ContextMenu`**

`src/components/ContextMenu.tsx` — thêm import:

```ts
import { enterModal } from "../core/shortcuts";
```

Và một effect ngay trước `useEffect` đang có:

```ts
  /* An open menu is about to act on a selection, so it holds the keyboard the same way a dialog
     does — which is what lets the grid stop keeping its own `menu !== null` guard for `Ctrl+A`. */
  useEffect(() => enterModal(), []);
```

- [ ] **Step 3: Kiểm chứng**

Run: `npm run build` rồi `npm test`
Expected: cả hai xanh.

- [ ] **Step 4: Commit**

```bash
git add src/components/dialogMotion.ts src/components/ContextMenu.tsx
git commit -m "feat(shortcuts): count open dialogs and menus in one place"
```

---

## Task 4: `pane.reload` sang cơ chế mới

`Mod+R` là chord phủ rộng nhất — 5 pane, 4 loại DB — nhưng đã tập trung sẵn ở `core/reload.ts`, nên cắt sang cơ chế mới không làm xê dịch một call site nào. Cơ chế được chứng minh trên diện rộng trước khi chạm vào chỗ khó.

**Files:**
- Modify: `src/core/reload.ts` (viết lại `useReloadShortcut` thành vỏ mỏng)
- Modify: `src/shell/shortcuts.ts` (def đầu tiên)
- Modify: `src/i18n/en.ts`, `src/i18n/vi.ts` (nhóm `shortcuts` mới)

**Interfaces:**
- Consumes: `useShortcut` (task 2); `enterModal` đã chạy (task 3).
- Produces: id lệnh `"pane.reload"`. `useReloadShortcut(active: boolean, reload: () => void): void` giữ **nguyên chữ ký** — 5 call site không đụng tới.

**Hệ quả có chủ ý:** từ task này, `Mod+R` **không** chạy khi có dialog hoặc menu chuột phải mở. Với dialog đó đã là hành vi hôm nay (mỗi call site tự gác). Với menu chuột phải thì là mới: hôm nay `Ctrl+R` khi menu đang mở vẫn reload. Đây là hệ quả trực tiếp của quyết định trong spec — đếm `ContextMenu` như một modal — và là câu trả lời đúng: menu sắp hành động trên đúng cái mà reload sẽ thay thế.

- [ ] **Step 1: Thêm nhóm `shortcuts` vào từ điển tiếng Anh**

`src/i18n/en.ts` — thêm nhóm mới ngay sau nhóm `settings` (trước `update`):

```ts
  // The Ctrl/Cmd chords the app answers, as Settings lists them. A module's own chords are named in
  // that module's dictionary, beside the rest of its words — see `src/i18n/dicts.ts`, which will
  // not let two dictionaries claim the same group.
  shortcuts: {
    title: "Shortcuts",
    scope: {
      app: "App",
    },
    newTab: "New tab",
    closeTab: "Close tab",
    reload: "Reload the pane on screen",
  },
```

- [ ] **Step 2: Thêm nhóm `shortcuts` vào từ điển tiếng Việt**

`src/i18n/vi.ts` — cùng vị trí:

```ts
  // Các tổ hợp Ctrl/Cmd ứng dụng nhận, đúng như Settings liệt kê. Phím riêng của một module được
  // đặt tên trong từ điển của module đó.
  shortcuts: {
    title: "Phím tắt",
    scope: {
      app: "Ứng dụng",
    },
    newTab: "Tab mới",
    closeTab: "Đóng tab",
    reload: "Tải lại pane đang xem",
  },
```

- [ ] **Step 3: Thêm def đầu tiên vào `SHELL_SHORTCUTS`**

`src/shell/shortcuts.ts`:

```ts
/** The chords the app answers wherever you are — the tab bar's, and the reload every pane shares. */
export const SHELL_SHORTCUTS: ShortcutGroup[] = [
  {
    scope: "app",
    labelKey: "shortcuts.scope.app",
    defs: [
      /* Not `inModal`: the pane behind a dialog is not the one in front, and a reload fired from
         behind a confirmation acts on the very thing being asked about. */
      { id: "pane.reload", chord: { key: "r" }, labelKey: "shortcuts.reload" },
    ],
  },
];
```

- [ ] **Step 4: Viết lại `useReloadShortcut`**

`src/core/reload.ts` — đổi import ở đầu file:

```ts
import { hasPrimaryModifier, shortcutLabel } from "./platform";
import { useShortcut } from "./shortcuts";
```

(`useEffect` và `useRef` từ `react` không còn dùng — xoá cả dòng `import { useEffect, useRef } from "react";`, nếu không `noUnusedLocals` sẽ làm đỏ build.)

Thay toàn bộ thân `useReloadShortcut` bằng:

```ts
/**
 * Presses this pane's reload button on `Ctrl+R`, for as long as `active` says the pane is the one
 * being looked at.
 *
 * `active` is what keeps the key unambiguous: plenty of panes are mounted at once — the connection
 * tabs sitting in the background, the stats grid kept behind the data grid — and every one of them
 * would otherwise answer the same keystroke together.
 *
 * A dialog standing over the pane is answered centrally now: `pane.reload` is not marked `inModal`,
 * so anything open holds the key on its own. Call sites still pass their own dialogs in, and are
 * right to — a pane knows things about its own state that a modal count does not, and the flag
 * reads the same as the `disabled` on the button beside it.
 *
 * Kept as a named hook rather than a bare `useShortcut` call at each site: five panes say
 * `Ctrl+R` reloads me, and the name is where that fact and its reasons are written down.
 */
export function useReloadShortcut(active: boolean, reload: () => void): void {
  useShortcut("pane.reload", reload, active);
}
```

`isPaneReload`, `isWebviewReload`, `isBlockedReload`, `RELOAD_SHORTCUT` và `withReloadShortcut` **giữ nguyên** — `isBlockedReload` vẫn là thứ giữ webview không tự reload, và nó vẫn được `App.tsx` gọi.

- [ ] **Step 5: Kiểm chứng bằng build**

Run: `npm run build` rồi `npm test`
Expected: cả hai xanh, và **không** call site nào của `useReloadShortcut` phải sửa.

- [ ] **Step 6: Kiểm chứng thủ công**

Run: `npm run dev:app`
Kiểm:
1. `Mod+R` trên từng pane: Data, Structure, Stats, Query, và Mongo → pane tải lại.
2. Mở hai tab kết nối, chuyển tab → tab nền **không** trả lời.
3. `Mod+R` sau lưng hộp thoại *Drop table?* → không chạy.
4. `Mod+R` khi menu chuột phải đang mở → không chạy (mới, có chủ ý).

- [ ] **Step 7: Commit**

```bash
git add src/core/reload.ts src/shell/shortcuts.ts src/i18n/en.ts src/i18n/vi.ts
git commit -m "refactor(shortcuts): move Ctrl+R onto the shortcut registry"
```

---

## Task 5: `Mod+T` và `Mod+W` của shell

`Mod+A` **ở lại `App.tsx` trong task này** — xem "Hai chỗ kế hoạch này lệch khỏi spec" ở trên.

**Files:**
- Modify: `src/shell/shortcuts.ts`
- Modify: `src/shell/App.tsx`

**Interfaces:**
- Consumes: `useShortcut` (task 2), `SHELL_SHORTCUTS` (task 4), khoá i18n `shortcuts.newTab` / `shortcuts.closeTab` (task 4).
- Produces: id lệnh `"app.newTab"`, `"app.closeTab"`.

- [ ] **Step 1: Thêm hai def vào `SHELL_SHORTCUTS`**

`src/shell/shortcuts.ts` — hai dòng **trước** `pane.reload`:

```ts
    defs: [
      /* `inModal` because that is what they do today: `App.tsx` guards neither, so a new tab opens
         and a tab closes from behind an open dialog. The registry is the first thing that made the
         question visible, and a refactor that answers it differently is a refactor nobody can
         trust. Deciding otherwise later is one flag on one line. */
      { id: "app.newTab", chord: { key: "t" }, labelKey: "shortcuts.newTab", inModal: true },
      { id: "app.closeTab", chord: { key: "w" }, labelKey: "shortcuts.closeTab", inModal: true },
      /* Not `inModal`: the pane behind a dialog is not the one in front, and a reload fired from
         behind a confirmation acts on the very thing being asked about. */
      { id: "pane.reload", chord: { key: "r" }, labelKey: "shortcuts.reload" },
    ],
```

- [ ] **Step 2: Đăng ký hai handler trong `App.tsx`**

Thêm `useShortcut` vào import đã có:

```ts
import { useShortcut, useShortcutDispatcher } from "../core/shortcuts";
```

Thêm hai dòng ngay dưới `useShortcutDispatcher(ALL_SHORTCUTS);`:

```ts
  useShortcutDispatcher(ALL_SHORTCUTS);
  // Always listening — the tab bar is there on every screen the app has.
  useShortcut("app.newTab", () => openTab(), true);
  useShortcut("app.closeTab", () => closeTab(activeId), true);
```

- [ ] **Step 3: Thu nhỏ `useEffect` cũ**

Thay toàn bộ khối `useEffect` phím tắt trong `src/shell/App.tsx` bằng:

```ts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (hasPrimaryModifier(e) && e.key.toLowerCase() === "a" && !isTextEntry(e.target)) {
        // Outside a text field, select-all means "select the whole chrome of the app" — never
        // something the user wants. Moves onto the registry with the grid's own `Ctrl+A`, which is
        // the other half of the same keystroke.
        e.preventDefault();
      } else if (isBlockedReload(e)) {
        // Reloading the webview takes every open connection down with it, so no keystroke is left
        // able to ask for one. What `Ctrl+R` means instead is decided by the pane on screen, which
        // claims the key for its own reload button — see `useReloadShortcut`.
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
```

Dependency đổi từ `[activeId]` thành `[]`: `activeId` chỉ còn được đọc trong handler của `useShortcut`, và hook đó đọc handler qua ref tại thời điểm bấm phím.

- [ ] **Step 4: Kiểm chứng**

Run: `npm run build` rồi `npm test`
Expected: cả hai xanh. Không import nào thừa — `hasPrimaryModifier` và `isTextEntry` vẫn còn dùng ở nhánh `Mod+A`.

- [ ] **Step 5: Kiểm chứng thủ công**

Run: `npm run dev:app`
Kiểm:
1. `Mod+T` mở tab mới; `Mod+W` đóng tab đang xem; đóng tab cuối cùng thì một tab mới hiện ra.
2. Mở Settings rồi bấm `Mod+T` → tab mới vẫn mở (giữ nguyên hành vi hôm nay).
3. `Mod+R` vẫn đúng như task 4.

- [ ] **Step 6: Commit**

```bash
git add src/shell/shortcuts.ts src/shell/App.tsx
git commit -m "refactor(shortcuts): move the tab bar chords onto the registry"
```

---

## Task 6: `Mod+A` và `Mod+F` của lưới — bước rủi ro nhất

Đây là bước duy nhất xoá hai lần đoán ngữ cảnh: `document.querySelector('[role="dialog"]')` và `menu !== null`. `Mod+A` hôm nay chạy **hai đường** — `App.tsx` nuốt *và* `SqlTable` hành động, đúng chỉ nhờ thứ tự mount — và sau bước này phải còn đúng một đường qua `unhandled: "swallow"`.

**Files:**
- Create: `src/modules/db/shortcuts.ts`
- Modify: `src/modules/db/index.ts`
- Modify: `src/modules/db/i18n/en.ts`, `src/modules/db/i18n/vi.ts`
- Modify: `src/modules/db/components/SqlTable/SqlTable.tsx`
- Modify: `src/shell/App.tsx`

**Interfaces:**
- Consumes: `useShortcut` (task 2); `ModuleDefinition.shortcuts` (task 2); `enterModal` đang chạy ở `ContextMenu` và `useDialogExit` (task 3).
- Produces: id lệnh `"grid.selectAll"`, `"grid.focusFilter"`; `DB_SHORTCUTS: ShortcutGroup[]`.

- [ ] **Step 1: Thêm khoá i18n cho lưới, tiếng Anh**

`src/modules/db/i18n/en.ts`, trong nhóm `sqlTable` (bắt đầu ở dòng 414), thêm ba khoá ngay sau `reloadRows`:

```ts
    reloadRows: "Reload rows",
    // Named for the shortcut table in Settings; the chord itself is drawn from the registry.
    shortcutScope: "Table data",
    shortcutSelectAll: "Select every row on the page",
    shortcutFilter: "Jump to the filter bar",
```

- [ ] **Step 2: Thêm khoá i18n cho lưới, tiếng Việt**

`src/modules/db/i18n/vi.ts`, trong nhóm `sqlTable`, ngay sau `reloadRows`:

```ts
    reloadRows: "Tải lại dữ liệu",
    // Đặt tên cho bảng phím tắt trong Cài đặt; bản thân tổ hợp phím lấy từ danh mục.
    shortcutScope: "Dữ liệu bảng",
    shortcutSelectAll: "Chọn mọi dòng trên trang",
    shortcutFilter: "Nhảy tới thanh lọc",
```

- [ ] **Step 3: Viết `src/modules/db/shortcuts.ts`**

```ts
// src/modules/db/shortcuts.ts
import type { ShortcutGroup } from "../../core/shortcuts";

/**
 * The chords this module's panes answer, handed to the shell through `ModuleDefinition.shortcuts`.
 *
 * Labelled out of this module's own dictionary rather than a `shortcuts.*` group of its own: the
 * shell owns that group name, and a second dictionary claiming it stops the build — see
 * `src/i18n/dicts.ts`. It reads better this way anyway, with "Select every row" sitting beside the
 * rest of the grid's words where a translator is already looking.
 */
export const DB_SHORTCUTS: ShortcutGroup[] = [
  {
    scope: "db.data",
    labelKey: "sqlTable.shortcutScope",
    defs: [
      /* `swallow` is what stops the webview painting the app's own chrome blue where no grid is
         listening — on the connection form, on a future module's tab. That is exactly what
         `App.tsx` did before, unconditionally and outside a text field; what is new is only that
         the authority for it now sits in the data beside the grid that acts on the key. If that
         placement ever gets in the way, the fix is a shell-owned def carrying nothing but
         `unhandled: "swallow"`, not a change to the mechanism. */
      {
        id: "grid.selectAll",
        chord: { key: "a" },
        labelKey: "sqlTable.shortcutSelectAll",
        whenTyping: "ignore",
        unhandled: "swallow",
      },
      /* No `whenTyping`: jumping to the filter bar is what the user wants from inside the filter
         bar too, and from a cell open for editing. That matches today — the `f` branch runs before
         the text-field check. */
      { id: "grid.focusFilter", chord: { key: "f" }, labelKey: "sqlTable.shortcutFilter" },
    ],
  },
];
```

- [ ] **Step 4: Đăng ký danh mục vào định nghĩa module**

`src/modules/db/index.ts` — thêm import và một trường:

```ts
import { DB_SHORTCUTS } from "./shortcuts";
```

```ts
  settings: { labelKey: "tools.title", Icon: WrenchIcon, Section: ToolsSection },
  shortcuts: DB_SHORTCUTS,
```

- [ ] **Step 5: Thay handler trong `SqlTable.tsx`**

Xoá toàn bộ khối từ comment `/** The two chords the Data tab answers…` tới hết `useEffect` gắn `onKeyDown` (khoảng dòng 1131–1189, gồm `handleWindowShortcut`, `shortcutRef` và `useEffect`), thay bằng:

```ts
  /**
   * The two chords the Data tab answers from wherever the focus happens to be: `Ctrl+A` — `⌘A` on a
   * Mac — for every row on the page, and `Ctrl+F` for the filter bar.
   *
   * Answered from the window rather than from the scroll box, because "click the grid first" is not
   * something the user should have to know: the tab is the one on screen, so the tab is what the
   * chord is about. `active` is what keeps that unambiguous — every background connection tab has a
   * grid mounted too, and each would otherwise answer the same keystroke alongside this one.
   *
   * What used to sit here as well was a guess at everything standing over the grid: a scan of the
   * document for `[role="dialog"]`, and a check on this component's own right-click menu. Both are
   * now the dispatcher's business, and both are counted rather than sniffed — see
   * `src/core/shortcuts/`.
   */
  useShortcut(
    "grid.selectAll",
    () => {
      if (rows.length === 0) return;
      setSelectedRows(new Set(rows.map((_, i) => i)));
      anchorRowRef.current = 0;
      // Delete and Escape act on the selection and are the grid's own keys, so the keyboard is
      // handed to it — otherwise a selection made from across the pane could not be acted on
      // without a click.
      focusGrid();
    },
    active,
  );

  useShortcut(
    "grid.focusFilter",
    () => {
      // The grid is being left for the bar above it, so whatever cell is open goes back as it was
      // rather than being written out by the blur that follows — see {@link cancelEdit}.
      cancelEdit();
      filterBarRef.current?.focusValue();
    },
    active,
  );
```

Thêm import:

```ts
import { useShortcut } from "../../../../core/shortcuts";
```

- [ ] **Step 6: Dọn import thừa trong `SqlTable.tsx`**

Run: `npm run build`
Expected: nếu `hasPrimaryModifier` hoặc `isTextEntry` không còn nơi nào dùng trong file, `tsc` báo lỗi `noUnusedLocals`. Xoá đúng phần không dùng khỏi hai dòng import:

```ts
import { IS_MAC, hasPrimaryModifier } from "../../../../core/platform";
import { isTextEntry } from "../../../../core/textEntry";
```

Kiểm bằng `grep -n "hasPrimaryModifier\|isTextEntry\|IS_MAC" src/modules/db/components/SqlTable/SqlTable.tsx` trước khi xoá — `IS_MAC` được dùng ở chỗ khác trong file và **phải giữ**.

- [ ] **Step 7: Bỏ nhánh `Mod+A` khỏi `App.tsx`**

`src/shell/App.tsx` — `useEffect` phím tắt còn lại đúng một nhánh:

```ts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Reloading the webview takes every open connection down with it, so no keystroke is left
      // able to ask for one. What `Ctrl+R` means instead is decided by the pane on screen, which
      // claims the key for its own reload button — see `useReloadShortcut`.
      //
      // The last chord not on the registry, and it is not a command: nothing is being asked for
      // here, only refused. See `isBlockedReload` for what differs between builds.
      if (isBlockedReload(e)) e.preventDefault();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
```

Rồi xoá hai import đã hết dùng:

```ts
import { hasPrimaryModifier } from "../core/platform";
import { isTextEntry } from "../core/textEntry";
```

- [ ] **Step 8: Kiểm chứng bằng build**

Run: `npm run build` rồi `npm test`
Expected: cả hai xanh.

- [ ] **Step 9: Kiểm chứng thủ công — bước này nhiều rủi ro nhất, chạy hết**

Run: `npm run dev:app`
Kiểm:
1. Trong lưới Data, `Mod+A` → chọn hết dòng của trang, và bàn phím nhảy vào lưới (bấm `Delete` ngay sau đó thấy hỏi xoá).
2. Trong ô lọc, `Mod+A` → chọn chữ **trong ô**, không chọn dòng.
3. Ở màn hình nhập kết nối (chưa có lưới nào), `Mod+A` → **không** bôi đen giao diện.
4. `Mod+A` khi menu chuột phải trên lưới đang mở → không chạy.
5. `Mod+A` sau lưng hộp thoại *Drop table?* → không chọn dòng, **và cũng không bôi đen giao diện** (phím vẫn bị nuốt — xem chỗ lệch số 3 ở đầu kế hoạch).
6. `Mod+F` → con trỏ vào ô lọc; nếu đang sửa dở một ô thì ô đó **hoàn tác** chứ không ghi xuống.
7. `Mod+F` khi con trỏ đang ở trong ô lọc → vẫn nhảy về ô giá trị.
8. Mở hai tab kết nối, `Mod+A` chỉ tác động lên tab đang xem.
9. `Mod+Shift+F` trong SQL editor → format. Bằng chứng dispatcher không cướp phím của CodeMirror.

- [ ] **Step 10: Commit**

```bash
git add src/modules/db/shortcuts.ts src/modules/db/index.ts src/modules/db/i18n/en.ts src/modules/db/i18n/vi.ts src/modules/db/components/SqlTable/SqlTable.tsx src/shell/App.tsx
git commit -m "refactor(shortcuts): move the grid chords onto the registry"
```

---

## Task 7: Bảng phím tắt trong Settings, và tài liệu

**Files:**
- Create: `src/shell/components/SettingsModal/ShortcutsSection.tsx`
- Modify: `src/icons/icons.tsx`, `src/icons/index.ts`
- Modify: `src/shell/components/SettingsModal/SettingsModal.tsx`
- Modify: `src/shell/components/SettingsModal/SettingsModal.module.css`
- Modify: `src/modules/db/shortcuts.ts` (nhóm `db.query`)
- Modify: `src/modules/db/i18n/en.ts`, `src/modules/db/i18n/vi.ts`
- Modify: `.agent/architecture/frontend.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `ALL_SHORTCUTS` (task 2); `Chord` (task 1); `shortcutLabel` từ `src/core/platform`; `DB_SHORTCUTS` (task 6).
- Produces: `KeyboardIcon`; component `ShortcutsSection`; mục pane `"shortcuts"` trong `SECTIONS`.

- [ ] **Step 1: Vẽ `KeyboardIcon`**

`src/icons/icons.tsx` — thêm một component (đặt cạnh các icon khác, thứ tự trong file này không bắt buộc):

```tsx
/** The shortcut table in Settings. */
export function KeyboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01" />
      <path d="M6 14h.01M18 14h.01" />
      <path d="M9.5 14h5" />
    </Icon>
  );
}
```

- [ ] **Step 2: Export nó theo thứ tự chữ cái**

`src/icons/index.ts` — chèn giữa `HistoryIcon` và `LockIcon`:

```ts
  HistoryIcon,
  KeyboardIcon,
  LockIcon,
```

- [ ] **Step 3: Thêm nhóm `db.query` vào danh mục db**

`src/modules/db/i18n/en.ts`, nhóm `query`, thêm hai khoá:

```ts
    shortcutScope: "Query editor",
    shortcutFormat: "Format the script",
```

`src/modules/db/i18n/vi.ts`, nhóm `query`:

```ts
    shortcutScope: "Trình soạn truy vấn",
    shortcutFormat: "Định dạng câu lệnh",
```

`src/modules/db/shortcuts.ts` — nhóm thứ hai:

```ts
  {
    scope: "db.query",
    labelKey: "query.shortcutScope",
    defs: [
      /* CodeMirror binds this on the editor element itself, so it answers before anything on the
         window ever sees it. It is here to be listed — a shortcut the table left out is one the
         user has no way to find. `owner` is what keeps the dispatcher's hands off it. */
      {
        id: "editor.format",
        chord: { key: "f", shift: true },
        labelKey: "query.shortcutFormat",
        owner: "editor",
      },
    ],
  },
```

- [ ] **Step 4: Viết `ShortcutsSection.tsx`**

```tsx
// src/shell/components/SettingsModal/ShortcutsSection.tsx
import { shortcutLabel } from "../../../core/platform";
import type { Chord } from "../../../core/shortcuts";
import { useTranslation } from "../../../i18n";
import { ALL_SHORTCUTS } from "../../shortcuts";
import styles from "./SettingsModal.module.css";

/** The chord as this platform spells it — `⌘A` on a Mac, `Ctrl+A` elsewhere. The same function
 *  names the reload button, so the table and the tooltips cannot come to disagree about a key. */
function chordLabel(chord: Chord): string {
  return shortcutLabel(chord.key.toUpperCase(), { shift: chord.shift, alt: chord.alt });
}

/**
 * Every Ctrl/Cmd shortcut the app has, read straight out of the catalogue the dispatcher resolves
 * against — so the table cannot say one thing while the app does another. A module's chords appear
 * because the module contributed them, not because this file knows about it.
 *
 * Read-only. The keys are not remappable yet, and a control that does nothing is worse than none.
 */
function ShortcutsSection() {
  const { t } = useTranslation();

  return (
    <>
      {ALL_SHORTCUTS.map((group) => (
        <div key={group.scope} className={styles.section}>
          <span className={styles.sectionLabel}>{t(group.labelKey)}</span>
          {group.defs.map((def) => (
            <div key={def.id} className={styles.shortcutRow}>
              <span>{t(def.labelKey)}</span>
              <kbd className={styles.shortcutKey}>{chordLabel(def.chord)}</kbd>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

export default ShortcutsSection;
```

- [ ] **Step 5: Thêm CSS**

`src/shell/components/SettingsModal/SettingsModal.module.css` — thêm sau `.sectionLabel`:

```css
/* One shortcut: what it does on the left, the chord on the right, so the keys line up as a column
   the eye can run down. */
.shortcutRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 1.9rem;
}

.shortcutKey {
  padding: 0.1em 0.4em;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-bg);
  font-family: inherit;
  font-size: 0.92em;
  line-height: 1.4;
  white-space: nowrap;
}
```

- [ ] **Step 6: Cắm pane vào `SettingsModal`**

`src/shell/components/SettingsModal/SettingsModal.tsx`:

Import:

```ts
import { CloseIcon, DownloadIcon, KeyboardIcon, PaletteIcon } from "../../../icons";
```

```ts
import ShortcutsSection from "./ShortcutsSection";
```

`SECTIONS` — thêm ngay sau `appearance`, **trước** phần của các module (nó nói về toàn app, không về một module):

```ts
const SECTIONS: { id: SectionId; labelKey: TranslationKey; icon: ComponentType<IconProps> }[] = [
  { id: "appearance", labelKey: "settings.appearance", icon: PaletteIcon },
  { id: "shortcuts", labelKey: "shortcuts.title", icon: KeyboardIcon },
  ...MODULES.flatMap((m) =>
    m.settings ? [{ id: m.id, labelKey: m.settings.labelKey, icon: m.settings.Icon }] : [],
  ),
  { id: "update", labelKey: "update.title", icon: DownloadIcon },
];
```

Và một panel, ngay sau panel `appearance` và trước khối `MODULES.map`:

```tsx
          <div
            className={styles.panel}
            role="tabpanel"
            id="settings-panel-shortcuts"
            aria-labelledby="settings-tab-shortcuts"
            hidden={section !== "shortcuts"}
          >
            <ShortcutsSection />
          </div>
```

- [ ] **Step 7: Cập nhật `.agent/architecture/frontend.md`**

Ba sửa đổi trong file:

**(a)** Trong bảng "The shell and its modules", hàng `core/`, thêm `shortcuts` vào danh sách helper:

```
| `core/` | Helpers with no module's concepts in them: `platform`, `reload`, `shortcuts`, `scroll`, `clipboard`, `textEntry`, `errors`, `nativeContextMenu`, `paneCache`, `sidebarKeyboard`, `virtualRows` | `components/`, `i18n/` |
```

**(b)** Trong mục "### `Ctrl+R` belongs to the pane, not to the app", sửa dòng đầu của gạch đầu dòng thứ nhất — câu "Each call site spells its dialogs out; there is no central modal register to lean on" **không còn đúng**:

```
- **The gate is "is this the pane in front", and a dialog counts.** Every connection tab stays
  mounted behind the one on show, so the flag is `active && <this pane's mode is selected>`. The
  pane's own dialogs are subtracted from it as well, which is belt and braces: anything open is
  counted centrally now (see below), and a pane still knows things about its own state that a
  count does not.
```

**(c)** Thêm một mục mới ngay sau mục `Ctrl+R`:

```markdown
### Every Ctrl/Cmd chord goes through one listener

[`src/core/shortcuts/`](../../src/core/shortcuts/) is the whole of it: a command is a line of data
— an id, a default chord, a label key, a group — and a pane answers one by calling `useShortcut(id,
handler, enabled)`. There is exactly one `keydown` listener on the window, installed by the shell.
Settings draws its shortcut table from the same catalogue the dispatcher resolves against, so the
table cannot describe an app that does not exist.

- **Ctrl/Cmd chords only.** `Escape`, the arrow keys, `Enter` and `Delete` in a grid or a dialog
  are the widget's own and stay where they are. Nobody remaps those.
- **A chord names no modifier.** `{ key: "a", shift: true }` and nothing else — which of `Ctrl` and
  `⌘` counts is [`platform.ts`](../../src/core/platform.ts)'s single answer, and a registry that
  let a chord override it would be the first place that answer got broken.
- **`preventDefault` is central.** Whatever runs or is swallowed, the dispatcher takes the key. On
  a Mac that is what keeps `⌘W` on the tab instead of the AppKit menu bar.
- **Context comes from three places, none of them a guess:** `enabled` is the pane's own React
  state, `modalDepth` is counted by [`dialogMotion`](../../src/components/dialogMotion.ts) and
  [`ContextMenu`](../../src/components/ContextMenu.tsx), and `typing` is
  [`textEntry`](../../src/core/textEntry.ts). No component scans the document for `[role="dialog"]`
  any more.
- **A module contributes chords the way it contributes a Settings pane** — `ModuleDefinition.shortcuts`,
  collected in [`shell/shortcuts.ts`](../../src/shell/shortcuts.ts). `core/shortcuts/` holds no
  catalogue of its own; it may not import from `shell/` or `modules/` at all.

> **`e.defaultPrevented` is a double-edged rule.** The dispatcher stands down for any event
> something else already claimed, which is exactly how CodeMirror keeps `Ctrl+Shift+F`, undo,
> search and the rest of its keymap. It also means a component that calls `preventDefault` on a
> chord for reasons of its own will **silently** disable that shortcut app-wide. If a global key
> stops working in one pane and nowhere else, this is the first thing to look at.

All the rules live in `decide()`, a pure function with no DOM, no React and no clock, and
`decide.test.ts` covers them; the glue around it is about fifteen lines and nothing automated
touches it.
```

- [ ] **Step 8: Thêm dòng CHANGELOG**

`CHANGELOG.md`, dưới `## [Unreleased]`:

```markdown
## [Unreleased]

### Added

- Settings has a Shortcuts pane listing every Ctrl/Cmd shortcut in the app.
```

Chỉ một dòng, và chỉ nói về cái người dùng thấy: quy ước changelog loại refactor ra khỏi file này, nên phần "gom về một nơi" không có mặt.

- [ ] **Step 9: Kiểm chứng**

Run: `npm run build` rồi `npm test`
Expected: cả hai xanh.

- [ ] **Step 10: Kiểm chứng thủ công**

Run: `npm run dev:app`
Kiểm:
1. Settings → pane **Shortcuts** nằm ngay dưới Appearance, có icon bàn phím.
2. Bảng có ba nhóm: App (New tab / Close tab / Reload the pane on screen), Table data (Select every row / Jump to the filter bar), Query editor (Format the script).
3. Mỗi chord vẽ đúng chính tả nền tảng — `Ctrl+A` trên Windows.
4. Đổi ngôn ngữ sang Tiếng Việt → mọi nhãn dịch, chord giữ nguyên.
5. Bảng khớp hành vi thật ở từng dòng.

- [ ] **Step 11: Commit**

```bash
git add src/shell/components/SettingsModal src/icons src/modules/db/shortcuts.ts src/modules/db/i18n .agent/architecture/frontend.md CHANGELOG.md
git commit -m "feat(shortcuts): list every shortcut in Settings"
```

---

## Kiểm chứng thủ công cuối cùng

Chạy sau task 7, trên bản đã gộp đủ bảy bước. Đây là thay thế cho test tự động của phần nối dây — `npm test` chỉ phủ `decide()`.

Run: `npm run dev:app`

1. `Mod+T`, `Mod+W` trên thanh tab.
2. `Mod+R` trên từng pane: Data, Structure, Stats, Query, Mongo. Mở hai tab, đổi tab → tab nền **không** trả lời.
3. `Mod+R` sau lưng hộp thoại *Drop table?* → không chạy.
4. `Mod+A`: trong lưới chọn hết dòng; trong ô lọc chọn chữ trong ô; ở màn hình nhập kết nối không bôi đen giao diện.
5. `Mod+A` khi menu chuột phải đang mở → không chạy. Sau lưng hộp thoại cũng không chạy, nhưng vẫn không bôi đen giao diện.
6. `Mod+F` → vào ô lọc, và ô đang sửa dở **hoàn tác** chứ không ghi xuống.
7. `Mod+Shift+F` trong SQL editor → format.
8. **Trên Mac:** `⌘W` đóng tab chứ không đóng cửa sổ; `Ctrl+A` **không** chọn dòng.
9. **Bản đóng gói:** `Mod+R` không reload webview.
10. Bảng trong Settings khớp hành vi thật.

Mục 8 cần một máy Mac, mục 9 cần `npm run build:app`. Không có thì ghi rõ **chưa kiểm chứng** ở đúng hai mục đó — **không** báo là xong. Mục 9 vốn đã được `frontend.md` tự đánh dấu *Unverified* từ trước.
