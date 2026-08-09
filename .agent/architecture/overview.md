# Architecture overview

MixDB is a Tauri 2 desktop app: a React webview for the UI, a Rust process for everything that
touches a network or a disk.

```
React webview                    Rust process
─────────────                    ────────────
ConnectionTab  ──invoke────────► commands.rs ──► db/{mysql,mongo,redis}.rs ──► server
<db>/api.ts    ◄─JSON result───              └─► ssh_tunnel.rs (optional hop)
```

The split is strict: **no database driver, credential handling or network call exists in the
frontend**. The webview only ever sends a command name plus JSON arguments and renders what comes
back.

## Tabs and connections

`App.tsx` owns a list of tabs. Each tab renders one `ConnectionTab`, and every tab is kept mounted
(hidden with `display: none`) so switching tabs never loses a connection or scroll position.
`Ctrl/Cmd+T` opens a tab, `Ctrl/Cmd+W` closes one; closing the last tab spawns a fresh one.

A `ConnectionTab` starts as a form. On connect it calls `connect_db` with a `ConnectionConfig`,
gets back a **connection id** (a UUID string), and swaps itself for the workspace matching the
database kind. That id is the first argument of every subsequent command — the backend looks the
live handle up by it in `AppState.connections`.

## Connection lifecycle

1. `connect_db(config)` — if `config.ssh` is set, `ssh_tunnel::open_tunnel` first opens a local
   listener that forwards to the real host, and the driver is pointed at `127.0.0.1:<local_port>`
   instead. All three kinds are wrapped in a 10s timeout.
2. The resulting handle (`MySqlPool`, `mongodb::Client` or a Redis multiplexed connection) is
   stored in `AppState.connections` under a new UUID, together with the tunnel's `JoinHandle`.
3. Every later command takes that `id`, locks the map, matches the handle against the kind it
   expects, and errors with `"Connection is not a … connection"` on a mismatch.
4. `disconnect_db(id)` removes the entry. `ActiveConnection`'s `Drop` aborts the tunnel task, so
   dropping the entry is enough to tear the SSH hop down too.

## MongoDB is the odd one

Mongo is configured as a single connection string, not host/port/user/password — a seed list like
`mongodb://a:27017,b:27017/?replicaSet=rs0` cannot be expressed in separate fields. So:

- `ConnectionConfig.uri` carries everything, and `host`/`port`/`username`/`password` are ignored.
- Tunneling can't use `resolve_endpoint`; it parses the first endpoint back out of the URI
  (`mongo::first_endpoint`), tunnels that, and overrides the host afterwards.
- The frontend parses the URI with a regex (not `new URL`, which rejects seed lists) purely for
  cosmetics: the tab title and the initially selected database.

## Persistence

- **Saved connections** — `tauri-plugin-store`, file `connections.json`, key `saved`. Wrapped by
  [src/savedConnections.ts](../../src/savedConnections.ts). Passwords are stored as typed, in
  plaintext; the UI masks the Mongo string behind a reveal confirmation but that is display only.
- **Theme** (`mixdb-theme`) and **language** (`mixdb-lang`) — `localStorage`, not the store.

## Security posture

Two deliberate tradeoffs, both marked in the code:

- `ssh_tunnel.rs` accepts **any** host key (no `known_hosts` verification).
- `mysql.rs` runs user-authored SQL through `sqlx::AssertSqlSafe`, opting out of sqlx's injection
  guard. This is a database client — arbitrary SQL is the product, not a bug. Identifiers the app
  itself interpolates (database/table/column names) still go through `quote_ident`.

The webview itself runs under a CSP (`app.security.csp`, with a looser `devCsp` for Vite's HMR):
everything loads from `'self'`, and `script-src` allows no inline script — which is why the theme
preload lives in [public/theme-preload.js](../../public/theme-preload.js) rather than in
`index.html`. Adding a `<script>` to the HTML will silently not run.
