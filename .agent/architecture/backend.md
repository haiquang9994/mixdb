# Backend

Rust, crate `mixdb` (lib name `tauri_app_lib`), edition 2021, async on Tokio.

## Layout

Shared by every module:

| File | Role |
| --- | --- |
| `main.rs` | Six lines: calls `tauri_app_lib::run()`. |
| `lib.rs` | The Tauri builder: plugins, one `register` call per module, `invoke_handler(modules::handler())`. Around 35 lines, and it names no module's types. |
| `error.rs` | `AppError` and the `err!` macro. Declared first and with `#[macro_use]`, so everything below it has the macro. |
| `secrets.rs` | The OS credential store, and the three `secrets_*` commands. Keyed by an arbitrary id, so any module can keep something in it. |
| `ssh/mod.rs` | russh-based local port forward, `test_connection`, and the `SshConfig`/`SshAuth` those take. Shared because a terminal will want it and `known_hosts.json` is the app's, not the database's. |
| `modules/mod.rs` | `handler()` — every command of every module. |

The database module, under `modules/db/`:

| File | Role |
| --- | --- |
| `mod.rs` | `register(builder)`: puts `DbState` in the app. |
| `commands/mod.rs` | Connecting, disconnecting, and the private helpers the rest are built on: `handle`, `mysql_pool`, `postgres_pool`, `mongo_client`, `redis_connection`, `sql_endpoint`, `in_background`, `app_data_dir`. |
| `commands/{mysql,postgres,mongo,redis,tools}.rs` | The `#[tauri::command]` functions. Thin: look the handle up, delegate to `drivers/`. |
| `models.rs` | `DbKind`, `ConnectionConfig` — the serde types crossing the boundary. |
| `state.rs` | `DbState { connections: Mutex<HashMap<String, ActiveConnection>> }`, `DbHandle`. |
| `drivers/mysql.rs` | Connect, query, row/value conversion, table data, CRUD. |
| `drivers/mysql_structure.rs` | Columns and indexes: read, ADD/CHANGE/DROP. |
| `drivers/mysql_script.rs` | Splits user SQL into statements and runs them one by one. |
| `drivers/mongo.rs` | Connect, list, find, paging, document CRUD. |
| `drivers/redis.rs` | Connect, SCAN paging, typed value reads, delete. |
| `drivers/filters.rs` | Shared filter-value parsing (`split_list` etc.). |

## State belongs to the module

`lib.rs` calls `modules::db::register(builder)`, which is a `.manage(DbState::default())`. Tauri
keys managed state by type, so a second module manages its own struct through a call of its own and
never meets `DbState`. No struct at app level knows what a connection is.

## One command list, in blocks

`modules::handler()` holds every command. It is one list because Tauri takes exactly one
`invoke_handler` and `generate_handler!` needs its paths written out rather than collected — but it
is split into a block per module, and **each block is that module's own to edit**. A command
missing from it does not exist at runtime, and nothing at build time says so.

It is fixed to `tauri::Wry` rather than generic over the runtime: a command taking an `AppHandle`
takes `AppHandle<Wry>`, which satisfies `CommandArg` for that one runtime and not for an unknown
`R`. `lib.rs` builds on `Wry` regardless.

## Command shape

Every command follows the same skeleton:

```rust
#[tauri::command]
pub async fn mysql_list_tables(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<String>, String> {
    let pool = mysql_pool(&state, &id).await?;
    mysql::list_tables(&pool, &database).await
}
```

Conventions baked into that shape:

- **Errors are `AppError`**, a translation key plus its parameters — see
  [error.rs](../../src-tauri/src/error.rs). Write `err!("error.tableNameRequired")`, or
  `err!("error.cannotWriteFile", path = path.display(), message = e)`, and add the key under
  `error.*` in **both** halves of whichever dictionary owns it: `src/modules/db/i18n/{en,vi}.ts`
  for a module's failures, `src/i18n/{en,vi}.ts` for the shared layers' — see
  [i18n](../conventions/i18n.md). A driver's own words are not translated: they ride
  along as `message` under a code like `error.mysql`. Wrapping one failure in another
  (`err!("error.rowFailed", index = i).caused_by(inner)`) gives the outer message a `{{cause}}`.
- **The connection map is never locked across a query.** `mysql_pool` / `mongo_client` /
  `redis_connection` look the connection up, clone the handle — a pool, a driver client, or an
  `Arc` — and drop the guard before returning it. One lock covers every connection in the app, so
  awaiting under it would make one slow query stop every tab.
- **Connect paths get `with_timeout`** (10s, `DB_CONNECT_TIMEOUT`) so a wrong host fails fast
  instead of hanging the UI.

## Values crossing the boundary

MySQL rows become `serde_json::Map<String, Value>` via `row_to_json`, which reads each column by
its `TypeInfo` — decimals, dates, blobs and JSON all have to be handled explicitly. Write-side
arguments arrive as `Option<String>`: text, or `null` for a real SQL NULL, with an absent key
meaning "leave the column out so its default applies". Keep that three-state distinction when
adding write commands.

The Query tab is different: `MysqlStatementResult.rows` is **positional** (`Vec<Vec<Value>>`), not
keyed, because an arbitrary `SELECT` can return the same column name twice.

## Identifier quoting

Database, table and column names the app interpolates go through `quote_ident` (backtick-quoting,
doubling embedded backticks). Values go through bind parameters. The only text that bypasses both is
SQL the user typed, wrapped in `sqlx::AssertSqlSafe` on purpose.

## Adding a dependency

`src-tauri/Cargo.toml`. Tauri plugins also need their permission added to
`src-tauri/capabilities/default.json` (currently `core`, `opener`, `dialog`, `store`) — a plugin
without its capability entry fails at call time, not at build time.
