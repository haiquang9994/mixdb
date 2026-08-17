# AGENT.md

Short orientation for agents working on MixDB. Details live in [.agent/](.agent/) — read the
relevant file there before changing anything in that area.

## What this is

MixDB is a desktop app built with **Tauri 2 + React 19 + TypeScript** (frontend) and **Rust**
(backend). It is a **shell** — a tab bar, keyboard shortcuts and a Settings dialog — plus one
**module** per kind of thing a tab can hold. Today there is one module, `db`: MySQL, PostgreSQL,
MongoDB and Redis connections, optionally through an SSH tunnel, with saved connections remembered.

The shell knows nothing about databases. Adding a module (a REST client, a terminal) is a folder
under `src/modules/` and a line in `src/shell/registry.ts` — see
[.agent/conventions/adding-a-module.md](.agent/conventions/adding-a-module.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install frontend dependencies |
| `npm run dev:app` | Run the full desktop app (Vite + Rust, hot reload) — the normal dev loop |
| `npm run dev` | Frontend only in a browser; every `invoke` fails, UI-only work |
| `npm run build` | Typecheck + build frontend (`tsc && vite build`) — the fastest check |
| `npm test` | Run the vitest suite (`vitest run`) |
| `npm run build:app` | Full production bundle into `src-tauri/target/release/bundle/` |
| `npm run notes` | Commits since the last tag, grouped — a draft for `## [Unreleased]` |
| `npm run set-version <v>` | Bump the six files that carry the version and cut the changelog |

Releasing is [docs/RELEASING.md](docs/RELEASING.md); the steps are the first section of it.

There is no linter config. `npm run build` is the fastest verification step; TypeScript runs
`strict`, `noUnusedLocals` and `noUnusedParameters`, so it catches most mistakes. `npm test` runs
vitest over the pure-logic modules (virtual rows, SQL statement splitting and guards, column
parsing, request building, tab badges). Neither says anything about CSS or about whether a Tauri
command is registered — only `npm run dev:app` and a click do.

## Layout

```
src/                 React frontend
  main.tsx           Entry point
  shell/             Tab bar, [+] menu, shortcuts, Settings — knows no module
    module.ts        ModuleDefinition, ModuleTabProps, TabBadge — what a module is
    registry.ts      MODULES, DEFAULT_MODULE_ID — the only file outside modules/ that names one
    App.css          Tokens + chrome + the classes any module may use
  core/              Helpers no module owns and any module may use
  components/        Shared primitives only, one folder each
  icons/  i18n/      Shared icons; the shared dictionaries and dicts.ts, which merges them
  modules/db/        The database module
    DbTab.tsx        Connection form -> connects -> renders one workspace
    sql/             The workspace every SQL engine shares, and the SqlApi/SqlDialect behind it
    <db>/            Per-database code: Workspace.tsx, api.ts, filters.ts
    components/      This module's own components
    i18n/            This module's own strings
    db.css  types.ts Its global styles; the types mirroring the Rust models
src-tauri/src/       Rust backend
  lib.rs             Tauri builder; each module registers its own state
  error.rs  secrets.rs  ssh/    Shared by every module
  modules/
    mod.rs           handler() — every command of every module, one block each
    db/              commands/, drivers/, models.rs, state.rs
```

## Rules that matter most

- **Frontend never talks to a database.** It calls `invoke(...)` through a per-database `api.ts`.
- **Nothing outside `src/modules/<id>/` knows that module's concepts.** No file in `shell/`,
  `core/`, `components/`, `icons/` or `i18n/` may import from `modules/`, with exactly two
  exceptions — `shell/registry.ts` and `i18n/dicts.ts`, the two places a module is joined to the
  app. `tsc` compiles a broken boundary happily, so it is checked by grep — see
  [adding-a-module](.agent/conventions/adding-a-module.md).
- **Every user-visible string goes through `t("...")`**, added to both `en.ts` and `vi.ts`.
- **Components use CSS Modules** and live in their own folder — see
  [.agent/conventions/component-structure.md](.agent/conventions/component-structure.md).
- **A new backend command touches five places.** Follow
  [.agent/conventions/adding-a-command.md](.agent/conventions/adding-a-command.md).
- Commit messages need a `type(scope): message` prefix (see the global rules).
- **`PG_VERSION` in `src-tauri/src/modules/db/drivers/tools.rs` expires every September.** `pg_dump` will not dump a
  server newer than itself, and nothing in the build says so. Bumping it, or any other pinned
  download, follows
  [.agent/conventions/bumping-tool-downloads.md](.agent/conventions/bumping-tool-downloads.md).
- **A change a user would notice gets a line in `## [Unreleased]`** in
  [CHANGELOG.md](CHANGELOG.md), under `### Added`, `### Changed` or `### Fixed`, written as part of
  the work rather than at release time. Follow
  [.agent/conventions/changelog.md](.agent/conventions/changelog.md) — one short line each, and a
  fix to something still unreleased is not a `Fixed` entry. That section becomes the release notes,
  see [docs/RELEASING.md](docs/RELEASING.md).

## Where to read more

- [.agent/architecture/overview.md](.agent/architecture/overview.md) — process model, connection lifecycle
- [.agent/architecture/frontend.md](.agent/architecture/frontend.md) — React structure and patterns
- [.agent/architecture/backend.md](.agent/architecture/backend.md) — Rust structure and patterns
- [.agent/conventions/](.agent/conventions/) — code conventions, and how changelog entries are written
