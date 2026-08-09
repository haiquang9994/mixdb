# Backend

Rust, crate `mixdb` (lib name `tauri_app_lib`), edition 2021, async on Tokio.

## Modules

| File | Role |
| --- | --- |
| `main.rs` | Six lines: calls `tauri_app_lib::run()`. |
| `lib.rs` | The Tauri builder: plugins, `AppState`, and the `generate_handler!` list. **Every command must be listed here or it doesn't exist at runtime.** |
| `commands.rs` | All `#[tauri::command]` functions. Thin: look the handle up, match the kind, delegate to `db/`. |
| `models.rs` | `DbKind`, `SshAuth`, `SshConfig`, `ConnectionConfig` — the serde types crossing the boundary. |
| `state.rs` | `AppState { connections: Mutex<HashMap<String, ActiveConnection>> }`, `DbHandle`. |
| `ssh_tunnel.rs` | russh-based local port forward + `test_connection`. |
| `db/mysql.rs` | Connect, query, row/value conversion, table data, CRUD. |
| `db/mysql_structure.rs` | Columns and indexes: read, ADD/CHANGE/DROP. |
| `db/mysql_script.rs` | Splits user SQL into statements and runs them one by one. |
| `db/mongo.rs` | Connect, list, find, paging, document CRUD. |
| `db/redis.rs` | Connect, SCAN paging, typed value reads, delete. |
| `db/filters.rs` | Shared filter-value parsing (`split_list` etc.). |

## Command shape

Every command follows the same skeleton:

```rust
#[tauri::command]
pub async fn mysql_list_tables(
    state: State<'_, AppState>,
    id: String,
    database: String,
) -> Result<Vec<String>, String> {
    let connections = state.connections.lock().await;
    match connections.get(&id).map(|c| &c.handle) {
        Some(DbHandle::Mysql(pool)) => mysql::list_tables(pool, &database).await,
        Some(_) => Err("Connection is not a MySQL connection".to_string()),
        None => Err("Unknown connection id".to_string()),
    }
}
```

Conventions baked into that shape:

- **Errors are `String`.** No custom error enum, no `anyhow`. Map driver errors with
  `.map_err(|e| e.to_string())` and prepend context when the raw message wouldn't be actionable
  (`"SSH connect failed: {e}"`). The string reaches the user in an `ErrorBanner` verbatim, so write
  it for a human.
- **The state lock is held across the await.** Fine at this scale (one user, few connections), but
  don't add long-running work inside the guard.
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
