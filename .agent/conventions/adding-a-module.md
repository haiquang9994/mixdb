# Adding a module

A module is one kind of thing a tab can hold. There are three — `db`, `rest` and `terminal` — and
the steps below are what each of them did. Read the newest one alongside this: `terminal` is the
module that has been through the fewest changes of mind.

The shell knows only what [`src/shell/module.ts`](../../src/shell/module.ts) declares, so a module
is a folder plus a line in the registry — see [overview](../architecture/overview.md) for why the
contract is as small as it is.

## Frontend

1. **`src/modules/<id>/index.ts`** exporting a `ModuleDefinition`:

   ```ts
   import type { ModuleDefinition } from "../../shell/module";
   import { TerminalIcon } from "../../icons";
   import TerminalTab from "./TerminalTab";

   export const terminalModule: ModuleDefinition = {
     id: "terminal",
     labelKey: "app.moduleTerminal",
     Icon: TerminalIcon,
     defaultTitleKey: "terminal.newTabTitle",
     Tab: TerminalTab,
   };
   ```

2. **The tab component** takes `ModuleTabProps` — `active`, `onTitleChange`, `onBadgesChange` — and
   nothing else. `active` is false while the tab is behind another, and it stays mounted, so
   anything that grabs the keyboard has to check it. (A tab restored from the last session is not
   mounted until it is first picked — but nothing a module writes can tell: its first render is
   its first render either way.)

   Report a `TabBadge` for each mark the tab should carry. `className` styles the badge;
   `tabClassName` goes on the whole tab, for a mark that tints it. `label` is read aloud and
   `title` is the tooltip — the database module leaves `title` off the engine logo and sets it on
   the lock, which is what those two did before there was a contract.

3. **One line in [`src/shell/registry.ts`](../../src/shell/registry.ts)**, in `MODULES`. This is
   the only file outside `src/modules/` that may name a module.

4. **Strings** in `src/modules/<id>/i18n/{en,vi}.ts`, added to
   [`src/i18n/dicts.ts`](../../src/i18n/dicts.ts) — and to the hand-merged `error` group there if
   the module raises errors of its own. Its dictionaries must import nothing from `src/i18n/`; see
   [i18n](i18n.md).

5. **Global CSS**, if any, in `src/modules/<id>/<id>.css`, imported from the tab component.
   Component-scoped rules go in each component's CSS Module instead. Order between stylesheets is
   decided by Vite from the import graph — a rule that must beat one in `shell/App.css` wins on
   specificity, not on order.

6. **A Settings pane**, if the module needs one, through `ModuleDefinition.settings`. The shell's
   dialog builds its list from `MODULES`, so the module names its own pane and the shell never
   learns what is in it.

## Backend, if it needs one

7. **`src-tauri/src/modules/<id>/mod.rs`** with a `register`:

   ```rust
   pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
       builder.manage(state::TerminalState::default())
   }
   ```

   Tauri keys managed state by type, so this never meets another module's.

8. **One line in `lib.rs`**: `let builder = modules::terminal::register(builder);`

9. **A block in `modules::handler()`** in `src-tauri/src/modules/mod.rs`. One list, because Tauri
   takes exactly one `invoke_handler` — but the blocks are per module and only that module edits
   its own. A command missing from the list does not exist at runtime and nothing at build time
   says so.

   `error.rs`, `secrets.rs` and `ssh/` are shared; use them rather than copying.

## Check the boundary before you commit

No file outside `src/modules/<id>/` may know that module's concepts, and **nothing typechecks
this** — a primitive importing from `modules/db/` compiles perfectly. Two greps:

```powershell
Get-ChildItem -Recurse src/components,src/core,src/icons -Include *.ts,*.tsx |
  Select-String "modules/"
```
Expected: nothing.

```powershell
Get-ChildItem -Recurse src/shell,src/i18n -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: only `src/shell/registry.ts` and `src/i18n/dicts.ts` — the two places a module is joined
to the app, one line per module in each.

## What the second and third modules found

All three are settled now, and all three are worth knowing before adding a fourth:

- **The `[+]` menu.** With one module the button opens a tab outright; with more it opens a menu.
  Both branches are live in `shell/App.tsx`.
- **Shortcuts are contributed, not registered centrally.** A module's chords go in
  `src/modules/<id>/shortcuts.ts` and reach the dispatcher through `ModuleDefinition.shortcuts`;
  `src/core/shortcuts/` may not import from `shell/` or `modules/` at all. See
  [frontend](../architecture/frontend.md).
- **Secrets and `ssh/` are shared, host lists are not.** The terminal keeps its own saved hosts
  rather than reaching into the database module's — two modules wanting the same *shape* is not two
  modules wanting the same *data*.
