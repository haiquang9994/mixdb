# Frontend

React 19 + TypeScript, built by Vite. No router, no state library, no CSS framework — state is
local `useState` plus two React contexts (i18n, and the theme hook's `localStorage`).

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
  custom properties (`--control-*`, `--surface-bg`) that component modules build on.
- Dark mode is `[data-theme="dark"]` plus a `prefers-color-scheme` block, both redefining the same
  tokens. A new color belongs in the token set, not hardcoded in a module.
- Font is Fira Code, bundled via `@fontsource` — no network fonts.

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
