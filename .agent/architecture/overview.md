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
2. The resulting handle (`MySqlPool`, `mongodb::Client` or a `redis::Connection`) is stored in
   `AppState.connections` under a new UUID, together with the `Tunnel`.
3. Every later command takes that `id` and calls one of `commands::{mysql_pool, mongo_client,
   redis_connection}`, which lock the map, **clone the handle out, and release the lock** before
   anything is run on it, erroring with `"Connection is not a … connection"` on a kind mismatch.
   Never hold `connections` across an `await` on a query: the map is one lock for the whole app,
   and a query awaited under it stops every other tab.
4. `disconnect_db(id)` removes the entry, which drops the handle and with it the `Tunnel`, whose
   own `Drop` aborts the forward. `ConnectionTab` calls it both from the Disconnect button and
   from an unmount cleanup — closing a tab is a disconnect, and the backend hears about it no
   other way.

Redis is the one kind whose handle reconnects itself: it goes through a `ConnectionManager`, since
a desktop client idles long enough for a server's `timeout` to close the socket underneath it. The
selected database is therefore part of the connection info rather than a `SELECT` sent by hand —
`redis::select_db` reopens the connection so that a later reconnect still lands in the right one.

## MongoDB is the odd one

Mongo is configured as a single connection string, not host/port/user/password — a seed list like
`mongodb://a:27017,b:27017/?replicaSet=rs0` cannot be expressed in separate fields. So:

- `ConnectionConfig.uri` carries everything, and `host`/`port`/`username`/`password` are ignored.
- Tunneling can't use `resolve_endpoint`; it parses the first endpoint back out of the URI
  (`mongo::first_endpoint`), tunnels that, and overrides the host afterwards.
- The frontend parses the URI with a regex (not `new URL`, which rejects seed lists) purely for
  cosmetics: the tab title and the initially selected database.

## Persistence

- **Saved connections** — split in two by [src/savedConnections.ts](../../src/savedConnections.ts),
  which is the only module that knows about the split:
  - What a connection *is* (host, port, user, database, sidebar width) — `tauri-plugin-store`,
    file `connections.json`, key `saved`. Plain text on purpose.
  - What lets you connect (`password`, the whole Mongo `uri`, the SSH password and key
    passphrase) — the OS credential store, through the `secrets_*` commands
    ([src-tauri/src/secrets.rs](../../src-tauri/src/secrets.rs)): Windows Credential Manager, the
    macOS Keychain, the Secret Service on Linux. One JSON entry per connection id, under the
    service name `MixDB`.

  A connection saved by an older build, with its password still in the file, is moved across the
  first time it is read and the file rewritten without it.
- **Theme** (`mixdb-theme`) and **language** (`mixdb-lang`) — `localStorage`, not the store.

## Security posture

`ssh_tunnel.rs` verifies host keys on a trust-on-first-use basis: a server never seen before is
accepted and its SHA-256 fingerprint written to `known_hosts.json` in the app data directory, and
a later connection offering a different key is refused with both fingerprints in the message. Its
own file, not OpenSSH's `~/.ssh/known_hosts`. Accepting a rebuilt server's new key means deleting
its entry there.

One deliberate tradeoff, marked in the code:

- `mysql.rs` runs user-authored SQL through `sqlx::AssertSqlSafe`, opting out of sqlx's injection
  guard. This is a database client — arbitrary SQL is the product, not a bug. Identifiers the app
  itself interpolates (database/table/column names) still go through `quote_ident`.

The webview itself runs under a CSP (`app.security.csp`, with a looser `devCsp` for Vite's HMR):
everything loads from `'self'`, and `script-src` allows no inline script — which is why the theme
preload lives in [public/theme-preload.js](../../public/theme-preload.js) rather than in
`index.html`. Adding a `<script>` to the HTML will silently not run.
