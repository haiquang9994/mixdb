# AGENT.md

Short orientation for agents working on MixDB. Details live in [.agent/](.agent/) — read the
relevant file there before changing anything in that area.

## What this is

MixDB is a desktop database client built with **Tauri 2 + React 19 + TypeScript** (frontend) and
**Rust** (backend). It manages MySQL, MongoDB and Redis connections, optionally through an SSH
tunnel, and remembers saved connections.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install frontend dependencies |
| `npm run dev:app` | Run the full desktop app (Vite + Rust, hot reload) — the normal dev loop |
| `npm run dev` | Frontend only in a browser; every `invoke` fails, UI-only work |
| `npm run build` | Typecheck + build frontend (`tsc && vite build`) — the fastest check |
| `npm run build:app` | Full production bundle into `src-tauri/target/release/bundle/` |

There is no test suite and no linter config. `npm run build` is the verification step; TypeScript
runs `strict`, `noUnusedLocals` and `noUnusedParameters`, so it catches most mistakes.

## Layout

```
src/                 React frontend
  App.tsx            Tab bar; each tab is a ConnectionTab
  ConnectionTab.tsx  Connection form -> connects -> renders one workspace
  <db>/              Per-database code: Workspace.tsx, api.ts, filters.ts
  components/        Shared UI, one folder per component
  i18n/              en/vi dictionaries + provider
  types.ts           Shared types mirroring the Rust models
src-tauri/src/       Rust backend
  lib.rs             Tauri builder; every command must be registered here
  commands.rs        #[tauri::command] entry points
  db/                Per-database implementation modules
  state.rs           Live connections, keyed by id
  ssh_tunnel.rs      SSH port forwarding
```

## Rules that matter most

- **Frontend never talks to a database.** It calls `invoke(...)` through a per-database `api.ts`.
- **Every user-visible string goes through `t("...")`**, added to both `en.ts` and `vi.ts`.
- **Components use CSS Modules** and live in their own folder — see
  [.agent/conventions/component-structure.md](.agent/conventions/component-structure.md).
- **A new backend command touches five places.** Follow
  [.agent/conventions/adding-a-command.md](.agent/conventions/adding-a-command.md).
- Commit messages need a `type(scope): message` prefix (see the global rules).

## Where to read more

- [.agent/architecture/overview.md](.agent/architecture/overview.md) — process model, connection lifecycle
- [.agent/architecture/frontend.md](.agent/architecture/frontend.md) — React structure and patterns
- [.agent/architecture/backend.md](.agent/architecture/backend.md) — Rust structure and patterns
- [.agent/conventions/](.agent/conventions/) — code conventions
