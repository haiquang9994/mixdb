# Frontend

React 19 + TypeScript, built by Vite. No router, no state library, no CSS framework — state is
local `useState` plus the i18n context, with the theme and accent hooks persisting to
`localStorage`.

## Entry path

`main.tsx` → `I18nProvider` → `shell/App` (tab bar) → the registry's module → `modules/db/DbTab`
(form, then workspace).

## The shell and its modules

Four directories, and the rule that separates them:

| Directory | Holds | May import from |
| --- | --- | --- |
| `shell/` | Tab bar, `[+]` menu, shortcuts, Settings, theme, update, `module.ts`, `registry.ts` | `core/`, `components/`, `icons/`, `i18n/` — plus `modules/` in `registry.ts` **only** |
| `core/` | Helpers with no module's concepts in them: `platform`, `reload`, `scroll`, `clipboard`, `textEntry`, `errors`, `nativeContextMenu`, `paneCache`, `sidebarKeyboard`, `virtualRows` | `components/`, `i18n/` |
| `components/` | Primitives any module may use | `core/`, `icons/`, `i18n/`, each other |
| `modules/<id>/` | Everything about one module, including its own components, i18n and global CSS | anything above |

Something earns a place in `core/` or `components/` when **(a)** it contains no module's concepts
and **(b)** another module would have a real use for it. `JsonView` passes — a read-only JSON
viewer with no BSON in it, which a REST client will want for a response body. `FilterBar` does not,
despite the general-sounding name: it is built from the SQL and Mongo operator lists.

The contract itself is [`shell/module.ts`](../../src/shell/module.ts) — `ModuleDefinition`,
`ModuleTabProps`, `TabBadge`, `ModuleSettingsSection` — and it deliberately has no lifecycle hooks,
no persistence API and no event bus. See [overview](overview.md) and
[adding-a-module](../conventions/adding-a-module.md).

**The boundary is not typechecked.** A primitive that imports from `modules/db/` compiles fine.
What catches it is a grep, which is part of adding a module.

## Per-database folders

Each supported database owns a folder with the same shape:

| File | Role |
| --- | --- |
| `<db>/api.ts` | **The only place `invoke` is called** for that database. One typed function per Tauri command, with the doc comment explaining the semantics. |
| `<db>/Workspace.tsx` | The whole UI once connected: sidebar of databases/tables/keys, content area. |
| `<db>/filters.ts` | The operator list for the filter bar (mysql, mongo). |

Extra helpers live alongside: `mongo/bsonTypes.ts`, `mongo/docOps.ts`, `redis/keyTree.ts`,
`redis/json.ts`.

A workspace receives `connectionId` and renders everything from it. It never knows how the
connection was made.

**Adding a database kind** — a kind, not a module — means: a `DbKind` in
`src/modules/db/types.ts` *and* `src-tauri/src/modules/db/models.rs`, a default port in
`DEFAULT_PORTS`, a name in `DbTab`'s `KIND_LABEL`, its logo in `src/modules/db/icons.tsx` with the
matching `.kind-<kind>` colours in `src/modules/db/db.css`, a branch in its workspace switch, the
new folder, and the backend side (see [backend.md](backend.md)).

## Components

`<Name>/` with `<Name>.tsx`, `<Name>.module.css`, `index.ts`, under `src/components/` if it is a
primitive and under `src/modules/<id>/components/` otherwise. Import from the folder, never the
file. See [component-structure](../conventions/component-structure.md) and
[css-modules](../conventions/css-modules.md).

- **`src/components/`** — `Button`, `Input` (+`Textarea`), `Select`, `ItemList`, `Pagination`,
  `ActionBar`, `ErrorBanner`, `LoadingOverlay`, `ConfirmDialog`, `NameDialog`, `ContextMenu`,
  `Tooltip`, `JsonView`, plus `dialogMotion` and `contextMenuPosition`.
- **`src/shell/components/`** — `GlassFilter`, `SettingsModal`, `UpdateToast`: the shell's own.
- **`src/modules/db/components/`** — the grids (`SqlTable`, `NoSqlTable`), the document views
  (`Document`, `DocumentNode`), the Redis views, `QueryEditor`, `SqlEditor`, `TableStructure`, the
  dialogs, `FilterBar`, `TransferOverlay`, and `ToolsSection` — which the shell's Settings dialog
  renders through `ModuleDefinition.settings`, since a dump tool is `mysqldump`, not an app
  setting.

### `Ctrl+R` belongs to the pane, not to the app

[`src/core/reload.ts`](../../src/core/reload.ts) takes the key off the webview. Reloading the webview drops
every open connection, every unsaved draft and every staged edit, so a pane that carries a reload
button claims the key for that button instead through `useReloadShortcut`.

Two things a new pane has to get right:

- **The gate is "is this the pane in front", and a dialog counts.** Every connection tab stays
  mounted behind the one on show, so the flag is `active && <this pane's mode is selected>` — and
  the pane's own dialogs are subtracted from it as well. A reload fired from behind a form throws
  away what was being typed into it; from behind a confirmation it acts on the thing being asked
  about. Each call site spells its dialogs out; there is no central modal register to lean on.
- **Label the button with `withReloadShortcut`.** A shortcut nothing on screen mentions is one
  nobody has.

What reaches the webview differs by build, on purpose. `isBlockedReload` swallows plain `Ctrl/Cmd+R`
in both, so what is developed against is what ships; `F5` and the hard reload stay live under
`npm run dev:app` and are swallowed too in a packaged build.

> **Unverified**, and worth checking the day someone has a packaged build open: the blocking is a
> DOM `preventDefault` in [`shell/App.tsx`](../../src/shell/App.tsx), and WebView2 handles reload as a browser
> accelerator. If the key gets through anyway, the fix is Tauri-side rather than more JavaScript.

### The webview's right-click menu is refused

[`src/core/nativeContextMenu.ts`](../../src/core/nativeContextMenu.ts), called once from `main.tsx`, closes
the other way to the same Reload — and to Back, Save as and View source, none of which mean
anything in a database client. It is one listener on the `document`, so the panes that answer a
right-click themselves see the event first and are untouched by it: the sidebar's connections
([`DbTab`](../../src/modules/db/DbTab.tsx)), the Redis key groups, the item lists. A new menu
is added the same way as those — an `onContextMenu` that calls `preventDefault` and opens
[`ContextMenu`](../../src/components/ContextMenu.tsx); nothing has to be registered here.

Text fields keep the native menu, because cut, copy and paste on a right-click are the webview's to
give and no part of the app replaces them. Both this and `Ctrl+A` ask
[`src/core/textEntry.ts`](../../src/core/textEntry.ts) which elements those are — one answer, so the two
gestures cannot come to disagree about the same field.

The cost, and it is a real one: text selected outside a text field — a grid cell, an error message —
has no Copy on a right-click any more. A pane that wants one owns it, the same as any other entry.

## Styling

- Two global stylesheets, one per owner. [`src/shell/App.css`](../../src/shell/App.css) has the
  resets, the scrollbars, the tab chrome, the classes any module may use (`.visually-hidden`,
  `.context-menu`, `.select-*`, `.muted`) and the custom properties everything builds on;
  [`src/modules/db/db.css`](../../src/modules/db/db.css) has the connection form, the saved list,
  the three workspaces and the engine colours. `glass.css` is the shell's too — `glass`,
  `glass-pill`, `glass-sheet` and `glass-scrim` are a material it offers every module.
- **Order between them is not guaranteed.** Vite decides it from the import graph, and `db.css` is
  reached through the registry before the shell's own is. Where a module rule has to beat a shell
  rule, it wins on specificity, never on order.
- Dark mode is `[data-theme="dark"]` plus a `prefers-color-scheme` block, both redefining the same
  tokens. A new color belongs in the token set, not hardcoded in a module.
- Font is Fira Code, bundled via `@fontsource` — no network fonts.

### Tokens

Reach for one of these before writing a literal. A raw grey, radius or shadow in a module is drift.

| Group | Tokens | Notes |
| --- | --- | --- |
| Radius | `--radius-sm` 6 / `--radius-md` 8 / `--radius-lg` 12 | badge · control, row · dialog, menu |
| Grey | `--border-soft` / `--border` / `--border-strong` / `--hover-bg` | soft = table grid; strong = hover |
| Height | `--shadow-sm` / `--shadow-md` / `--shadow-lg` | `sm` is `none` in dark — a control on a dark page casts nothing |
| Surface | `--page-bg`, `--surface-bg` | `page-bg` is what sticky headers paint to hide rows under them |
| Control | `--control-radius`, `--control-shadow`, `--control-bg`, `--control-border`, `--control-color` | mirrored by Button/Input/Select's own modules |

### Interaction states

Three states, three distinct signals — do not mix them:

- **Hover** takes weight, never colour: `border-color: var(--border-strong)`.
- **Focus** takes the accent: `border-color: var(--accent)` plus `box-shadow: var(--focus-ring)`,
  and only on `:focus-visible`, so a ring means the keyboard is there. Text inputs also show the
  accent border on plain `:focus`, since it marks where typing lands.
- **Selection** takes an accent wash: `rgb(var(--accent-rgb) / 0.15)` and `--accent-text`.

`--focus-ring` is **inset**. It has to be: workspaces are `overflow: hidden` with scroll panes
nested inside them, and controls sit flush against those edges — an outward ring loses whichever
side is against a boundary, and no padding on the control's own container can bring it back.
Anything drawing its own ring (`outline`) uses a negative `outline-offset` for the same reason.

### Buttons

`<Button variant="primary">` fills with `--accent-solid` and sets `--accent-on-solid` type — **one
per screen or dialog**, on the action that screen is asking for. Light mode fills with the darker
accent cast so white type clears 4.5:1; dark mode fills with `--accent` and uses near-black type.
A destructive confirm stays `default` and keeps its red: filling it would dress the dangerous
choice as the recommended one.

### The accent

The accent is user-chosen (Settings → Accent colour), so **no module may name a hue**. Three tokens
are the whole interface:

| Token | For |
| --- | --- |
| `--accent` | Solid: borders, icons, the resizer, `accent-color` on checkboxes |
| `--accent-text` | Text on the page — the readable cast, darker in light mode, lighter in dark |
| `--accent-rgb` | Bare channels, so a rule mixes its own wash: `rgb(var(--accent-rgb) / 0.15)` |

Behind them, `shell/App.css` defines all ten palettes as `--c-<name>` / `-text` / `-rgb`, and
`:root[data-accent="<name>"]` points the three tokens at one of them. Every palette stays defined
whichever one is in force — that is what lets the swatch row in `SettingsModal` show all ten at
once, each button carrying only `--accent-swatch: var(--c-<name>)`. The dark theme restates the
`--c-*` values and nothing else, so accent and swatches follow the theme with no
`[data-theme][data-accent]` selectors.

Adding an eleventh colour: values in both halves of `shell/App.css`, the name in `ACCENT_COLORS`
(`src/shell/theme.ts`), and `settings.accent<Name>` in `src/i18n/en.ts` and `vi.ts`. The hue must clear 4.5:1 against
the light page in its `-text` cast — the accent carries text — and must not read as the red that
means destructive, since the accent also marks selected rows.

## Types

`src/modules/db/types.ts` mirrors the Rust `modules/db/models.rs` and the command return shapes (`MysqlTablePage`,
`MysqlTableStructure`, `MysqlStatementResult`, `MongoCollectionPage`, …). When a Rust struct that
crosses the boundary changes, this file changes with it — nothing checks the two agree.

Note the naming asymmetry: Rust uses snake_case fields and serde does **not** rename them, so
TypeScript mirrors match (`use_ssl`, `key_path`), while command *arguments* are camelCase because
Tauri converts them (`pageSize` → `page_size`).

## i18n, icons, filters

See the conventions files: [i18n](../conventions/i18n.md), [icons](../conventions/icons.md),
[filter-bar](../conventions/filter-bar.md).
