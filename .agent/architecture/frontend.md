# Frontend

React 19 + TypeScript, built by Vite. No router, no state library, no CSS framework — state is
local `useState` plus the i18n context, with the theme and accent hooks persisting to
`localStorage`.

## Entry path

`main.tsx` → `I18nProvider` → `App` (tab bar) → `ConnectionTab` (form, then workspace).

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

**Adding a database kind** means: a `DbKind` in `src/types.ts` *and* `src-tauri/src/models.rs`, a
default port in `DEFAULT_PORTS`, a badge in `ConnectionTab`'s `KIND_BADGE`, a branch in its
workspace switch, the new folder, and the backend side (see
[backend.md](backend.md)).

## Components

`src/components/<Name>/` with `<Name>.tsx`, `<Name>.module.css`, `index.ts`. Import from the folder,
never the file. See [component-structure](../conventions/component-structure.md) and
[css-modules](../conventions/css-modules.md).

Roughly grouped:

- **Primitives** — `Button`, `Input` (+`Textarea`), `Select`, `ItemList`, `Pagination`, `ActionBar`.
- **Feedback** — `ErrorBanner`, `LoadingOverlay`, `ConfirmDialog`.
- **Data views** — `SqlTable` (MySQL grid), `NoSqlTable`, `Document`/`DocumentNode`/`JsonView`
  (Mongo), `RedisKeyList`/`RedisValue`.
- **Editors/dialogs** — `QueryEditor`, `TableStructure`, `ColumnDialog`, `IndexDialog`,
  `InsertRowsDialog`, `InsertDocumentsDialog`, `FilterBar`, `SettingsModal`.

## Styling

- `src/App.css` is the only global stylesheet: resets, scrollbars, the tab chrome, and the CSS
  custom properties (`--control-*`, `--surface-bg`, `--accent*`) that component modules build on.
- Dark mode is `[data-theme="dark"]` plus a `prefers-color-scheme` block, both redefining the same
  tokens. A new color belongs in the token set, not hardcoded in a module.
- Font is Fira Code, bundled via `@fontsource` — no network fonts.

### The accent

The accent is user-chosen (Settings → Accent colour), so **no module may name a hue**. Three tokens
are the whole interface:

| Token | For |
| --- | --- |
| `--accent` | Solid: borders, icons, the resizer, `accent-color` on checkboxes |
| `--accent-text` | Text on the page — the readable cast, darker in light mode, lighter in dark |
| `--accent-rgb` | Bare channels, so a rule mixes its own wash: `rgb(var(--accent-rgb) / 0.15)` |

Behind them, App.css defines all ten palettes as `--c-<name>` / `-text` / `-rgb`, and
`:root[data-accent="<name>"]` points the three tokens at one of them. Every palette stays defined
whichever one is in force — that is what lets the swatch row in `SettingsModal` show all ten at
once, each button carrying only `--accent-swatch: var(--c-<name>)`. The dark theme restates the
`--c-*` values and nothing else, so accent and swatches follow the theme with no
`[data-theme][data-accent]` selectors.

Adding an eleventh colour: values in both halves of App.css, the name in `ACCENT_COLORS`
(`src/theme.ts`), and `settings.accent<Name>` in `en.ts`/`vi.ts`. The hue must clear 4.5:1 against
the light page in its `-text` cast — the accent carries text — and must not read as the red that
means destructive, since the accent also marks selected rows.

## Types

`src/types.ts` mirrors the Rust `models.rs` and the command return shapes (`MysqlTablePage`,
`MysqlTableStructure`, `MysqlStatementResult`, `MongoCollectionPage`, …). When a Rust struct that
crosses the boundary changes, this file changes with it — nothing checks the two agree.

Note the naming asymmetry: Rust uses snake_case fields and serde does **not** rename them, so
TypeScript mirrors match (`use_ssl`, `key_path`), while command *arguments* are camelCase because
Tauri converts them (`pageSize` → `page_size`).

## i18n, icons, filters

See the conventions files: [i18n](../conventions/i18n.md), [icons](../conventions/icons.md),
[filter-bar](../conventions/filter-bar.md).
