# Tách MixDB thành shell + module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến MixDB từ "app database" thành một shell không biết database, với database là module đầu tiên trong `src/modules/db/` và `src-tauri/src/modules/db/`.

**Architecture:** Shell giữ tab bar, phím tắt và Settings; nó chỉ biết `ModuleDefinition` (id, icon, component tab, badge). Module database giữ nguyên toàn bộ logic hôm nay, chỉ đổi chỗ ở và đổi hai callback thành một `onBadgesChange`. Bên Rust, `AppState` thành `modules::db::state::DbState` do module tự `.manage()`; `ssh/`, `secrets.rs`, `error.rs` lên tầng dùng chung.

**Tech Stack:** Tauri 2 + Rust (sqlx, mongodb, redis, russh, keyring) · React 19 + TypeScript strict + Vite 7 · vitest 4 · CSS Modules + một stylesheet toàn cục mỗi bên.

**Spec:** [docs/superpowers/specs/2026-08-18-module-architecture-design.md](../specs/2026-08-18-module-architecture-design.md)

## Global Constraints

Áp cho **mọi** task bên dưới:

- **Người dùng không được nhận ra gì đã đổi.** Không đổi hành vi, không đổi giao diện, không đổi phím tắt.
- **Không đổi tên command Tauri.** `mysql_query` vẫn là `mysql_query`. Không file `api.ts` nào phải sửa chuỗi `invoke`.
- **Không đổi service name keychain.** `const SERVICE: &str = "MixDB"` trong `secrets.rs` giữ nguyên từng ký tự.
- **Không đổi tên file store:** `connections.json`, `query-history.json`, `query-drafts.json`, `query-snippets.json`, `known_hosts.json`.
- **Không đổi khoá `localStorage`:** `mixdb-lang`, và các khoá theme/accent/glass trong `theme.ts`.
- **Không có entry CHANGELOG.** Theo [.agent/conventions/changelog.md](../../../.agent/conventions/changelog.md): người dùng không thấy gì thì không có dòng nào. Nếu bạn thấy mình muốn viết một dòng, tức là đã làm sai.
- **Không bump version.** Không chạy `npm run set-version`.
- **Không viết REST client hay terminal.** Kể cả skeleton.
- **Không thêm dependency mới**, frontend hay Rust.
- **Không sửa nội dung logic** khi di chuyển file: chỉ đổi đường dẫn import, tên module Rust, và những chỗ plan nói rõ. Mọi thay đổi khác là ngoài phạm vi.
- **Commit prefix bắt buộc:** `<type>(<scope>): <message>`, tiếng Anh, không có trailer `Co-Authored-By`.
- Mỗi task phải xanh trước khi commit. Không commit dở.

**Lệnh kiểm chứng** (chạy từ gốc repo, PowerShell):

| Lệnh | Dùng khi |
| --- | --- |
| `cargo check --manifest-path src-tauri/Cargo.toml` | mọi task backend |
| `npm run build` | mọi task frontend (`tsc` strict + `vite build`) |
| `npm test` | mọi task frontend (vitest) |
| `npm run dev:app` | smoke test thủ công, task 2, 5, 6, 9 |

**Smoke test thủ công** — dùng nguyên văn ở mọi task yêu cầu nó:

1. `npm run dev:app`, đợi cửa sổ mở.
2. Kết nối MySQL: `192.168.50.86` cổng `3307`, user `root`, password rỗng. Chỉ được chạm database `mixdb_agent_test`.
3. Mở một bảng trong `mixdb_agent_test`, xem có hàng.
4. Sang tab Query, chạy `SELECT 1`, xem có kết quả.
5. `Ctrl+T` mở tab thứ hai, kết nối PostgreSQL: `192.168.50.86` cổng `5432`, user `demo`, password `demo`, database `demo`.
6. Quay lại tab 1, kiểm tab bar: logo MySQL trên tab 1, logo PostgreSQL trên tab 2.
7. `Ctrl+W` đóng tab 2.
8. Ở tab 1 bấm Disconnect, kiểm danh sách saved connection còn nguyên.
9. Mở Settings (bấm chữ MixDB), xem đủ ba mục: Appearance, Tools, Update.
10. Đổi theme sang dark rồi về lại, xem màu đổi đúng.

---

## Task 1: Backend — tầng SSH dùng chung, command `secrets_*` về đúng nhà

Dọn tầng dùng chung trước khi động vào database: sau task này `ssh` và `secrets` không còn phụ thuộc vào bất cứ thứ gì của database, nên task 2 chỉ còn việc di chuyển.

**Files:**
- Create: `src-tauri/src/ssh/mod.rs` (nội dung `ssh_tunnel.rs` + `SshAuth` + `SshConfig`)
- Delete: `src-tauri/src/ssh_tunnel.rs`
- Modify: `src-tauri/src/models.rs` (bỏ `SshAuth`/`SshConfig`), `src-tauri/src/secrets.rs` (nhận 3 command), `src-tauri/src/commands.rs` (bỏ 3 command secrets, `ssh_tunnel::` → `ssh::`), `src-tauri/src/state.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `crate::ssh::{SshAuth, SshConfig, Tunnel, test_connection, open_tunnel}` — task 2 dùng lại y hệt, chỉ khác nó gọi từ `crate::modules::db`.
- Produces: `crate::secrets::{secrets_save, secrets_load, secrets_delete}` — ba `#[tauri::command]`, chữ ký không đổi so với bản trong `commands.rs`.

**Lý do lệch spec (bổ sung 1/3):** spec đặt `SshConfig`/`SshAuth` trong `modules/db/models.rs`. Không được: `ssh/` là tầng dùng chung mà `ssh_tunnel.rs:2` đang `use crate::models::{SshAuth, SshConfig}` — để nguyên thì tầng chung phụ thuộc vào module, đúng cái mà refactor này muốn bỏ. Hai kiểu đó là config của chính tầng SSH, nên chúng ở `ssh/`. `ConnectionConfig` trong `modules/db/models.rs` `use crate::ssh::SshConfig`. Serde shape không đổi một byte, nên IPC và `connections.json` không đổi.

- [ ] **Step 1: Dựng `ssh/mod.rs`**

```powershell
New-Item -ItemType Directory src-tauri/src/ssh
git mv src-tauri/src/ssh_tunnel.rs src-tauri/src/ssh/mod.rs
```

- [ ] **Step 2: Chuyển `SshAuth` + `SshConfig` vào `ssh/mod.rs`**

Cắt hai khối này khỏi `src-tauri/src/models.rs` và dán vào đầu `src-tauri/src/ssh/mod.rs`, ngay dưới khối `use`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SshAuth {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}
```

Trong `ssh/mod.rs`, xoá dòng `use crate::models::{SshAuth, SshConfig};` và thêm `use serde::{Deserialize, Serialize};`.

Trong `models.rs`, thêm `use crate::ssh::SshConfig;` (giữ `use serde::{Deserialize, Serialize};` cho `DbKind` và `ConnectionConfig`).

- [ ] **Step 3: Đổi tên module trong `lib.rs`**

```rust
mod commands;
mod db;
mod models;
mod secrets;
mod ssh;
mod state;
```

- [ ] **Step 4: Sửa các chỗ gọi `ssh_tunnel::`**

`src-tauri/src/state.rs:2` → `use crate::ssh::Tunnel;`

`src-tauri/src/commands.rs`: dòng 16 → `use crate::models::{ConnectionConfig, DbKind};` cộng `use crate::ssh::{self, SshConfig};` thay cho dòng 18 `use crate::ssh_tunnel;`. Rồi đổi bốn chỗ gọi: `ssh_tunnel::test_connection` → `ssh::test_connection`, `ssh_tunnel::Tunnel` → `ssh::Tunnel`, hai chỗ `ssh_tunnel::open_tunnel` → `ssh::open_tunnel`.

- [ ] **Step 5: `cargo check`**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS. Nếu báo `unresolved import`, còn chỗ gọi `ssh_tunnel::` chưa đổi — thông báo lỗi chỉ đúng file và dòng.

- [ ] **Step 6: Chuyển ba command `secrets_*` vào `secrets.rs`**

Cắt ba hàm này khỏi `commands.rs` (chúng ở quanh dòng 481–500, kèm doc comment của từng hàm) và dán vào cuối `src-tauri/src/secrets.rs`, đổi `secrets::Secrets` thành `Secrets` và `secrets::save/load/delete` thành `save/load/delete`:

```rust
/// Writes a saved connection's secrets to the OS credential store, replacing what was there.
///
/// Off the async runtime: the credential stores are blocking, and on macOS opening one may put a
/// prompt on screen — which is not something to hold a runtime worker for.
#[tauri::command]
pub async fn secrets_save(id: String, secrets: Secrets) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || save(&id, &secrets)).await.map_err(|e| err!("error.taskFailed", message = e))?
}
```

Giữ nguyên thân hàm đang có — chỉ đổi đường dẫn tên, không viết lại logic. Làm y vậy cho `secrets_load` và `secrets_delete`.

Trong `commands.rs` xoá `use crate::secrets;` nếu không còn chỗ dùng.

- [ ] **Step 7: Sửa danh sách handler trong `lib.rs`**

```rust
            secrets::secrets_save,
            secrets::secrets_load,
            secrets::secrets_delete,
```

thay cho ba dòng `commands::secrets_*`. Vị trí trong danh sách không quan trọng.

- [ ] **Step 8: `cargo check`**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS, không warning `unused import`.

- [ ] **Step 9: Commit**

```powershell
git add -A src-tauri/src
git commit -m "refactor(backend): lift ssh and secrets to the shared layer"
```

---

## Task 2: Backend — `modules/db/`, `DbState`, `modules::handler()`

Đây là task có rủi ro kỹ thuật duy nhất của cả plan: chữ ký trả về của `tauri::generate_handler!`. Làm sớm để nếu phải lùi thì lùi rẻ.

**Files:**
- Create: `src-tauri/src/modules/mod.rs`, `src-tauri/src/modules/db/mod.rs`
- Move: `src-tauri/src/db/` → `src-tauri/src/modules/db/drivers/`; `src-tauri/src/commands.rs` → `src-tauri/src/modules/db/commands.rs`; `src-tauri/src/models.rs` → `src-tauri/src/modules/db/models.rs`; `src-tauri/src/state.rs` → `src-tauri/src/modules/db/state.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `crate::ssh::{SshConfig, Tunnel, test_connection, open_tunnel}`, `crate::secrets::{secrets_save, secrets_load, secrets_delete}` từ task 1.
- Produces: `crate::modules::db::state::DbState` — đúng các field của `AppState` cũ (`connections`, `running_queries`), `#[derive(Default)]`.
- Produces: `crate::modules::db::register(builder) -> builder` và `crate::modules::handler()` — task 3 sửa danh sách trong `handler()`, không sửa chữ ký.

- [ ] **Step 1: Di chuyển file**

```powershell
New-Item -ItemType Directory src-tauri/src/modules/db
git mv src-tauri/src/db src-tauri/src/modules/db/drivers
git mv src-tauri/src/commands.rs src-tauri/src/modules/db/commands.rs
git mv src-tauri/src/models.rs src-tauri/src/modules/db/models.rs
git mv src-tauri/src/state.rs src-tauri/src/modules/db/state.rs
```

- [ ] **Step 2: Viết `src-tauri/src/modules/db/mod.rs`**

```rust
//! Database: the module MixDB started as.
//!
//! Everything about connecting to a server, browsing it and writing to it lives under here. The
//! app above knows only `register` and the command list in `super::handler` — no type in this
//! module reaches the shell.

pub mod commands;
pub mod drivers;
pub mod models;
pub mod state;

/// Puts this module's own state in the app. Called once, from `lib.rs`.
///
/// Tauri keys managed state by type, so a second module manages its own struct here without ever
/// meeting `DbState`.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.manage(state::DbState::default())
}
```

- [ ] **Step 3: Viết `src-tauri/src/modules/mod.rs` với danh sách command**

```rust
//! The modules MixDB is made of. One folder each, and one block each in the list below.

pub mod db;

/// Every command of every module.
///
/// One list, because Tauri takes exactly one `invoke_handler` and `generate_handler!` needs its
/// paths written out — but split into blocks by owner, and each block is that module's to edit.
pub fn handler<R: tauri::Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        // ── shared ──
        crate::secrets::secrets_save,
        crate::secrets::secrets_load,
        crate::secrets::secrets_delete,
        // ── db ──
        db::commands::connect_db,
        db::commands::disconnect_db,
        db::commands::test_ssh_tunnel,
        db::commands::mysql_query,
        db::commands::mysql_list_databases,
        db::commands::mysql_server_info,
        db::commands::mysql_list_tables,
        db::commands::mysql_table_stats,
        db::commands::mysql_table_data,
        db::commands::mysql_update_row,
        db::commands::mysql_insert_rows,
        db::commands::mysql_delete_rows,
        db::commands::mysql_table_structure,
        db::commands::mysql_schema_outline,
        db::commands::mysql_collations,
        db::commands::mysql_dump,
        db::commands::mysql_restore,
        db::commands::mysql_drop_database,
        db::commands::mysql_create_database,
        db::commands::mysql_create_table,
        db::commands::mysql_rename_table,
        db::commands::mysql_drop_table,
        db::commands::mysql_add_column,
        db::commands::mysql_modify_column,
        db::commands::mysql_drop_column,
        db::commands::mysql_add_index,
        db::commands::mysql_modify_index,
        db::commands::mysql_drop_index,
        db::commands::mysql_run_script,
        db::commands::mysql_cancel_query,
        db::commands::mysql_validate_sql,
        db::commands::postgres_query,
        db::commands::postgres_list_databases,
        db::commands::postgres_server_info,
        db::commands::postgres_list_tables,
        db::commands::postgres_table_stats,
        db::commands::postgres_table_data,
        db::commands::postgres_update_row,
        db::commands::postgres_insert_rows,
        db::commands::postgres_delete_rows,
        db::commands::postgres_table_structure,
        db::commands::postgres_collations,
        db::commands::postgres_schema_outline,
        db::commands::postgres_run_script,
        db::commands::postgres_validate_sql,
        db::commands::postgres_cancel_query,
        db::commands::postgres_create_database,
        db::commands::postgres_drop_database,
        db::commands::postgres_create_table,
        db::commands::postgres_rename_table,
        db::commands::postgres_drop_table,
        db::commands::postgres_add_column,
        db::commands::postgres_modify_column,
        db::commands::postgres_drop_column,
        db::commands::postgres_add_index,
        db::commands::postgres_modify_index,
        db::commands::postgres_drop_index,
        db::commands::postgres_dump,
        db::commands::postgres_restore,
        db::commands::mongo_list_databases,
        db::commands::mongo_server_info,
        db::commands::mongo_list_collections,
        db::commands::mongo_collection_stats,
        db::commands::mongo_dump,
        db::commands::mongo_restore,
        db::commands::mongo_drop_database,
        db::commands::mongo_create_collection,
        db::commands::mongo_rename_collection,
        db::commands::mongo_drop_collection,
        db::commands::mongo_find,
        db::commands::mongo_collection_page,
        db::commands::mongo_next_ids,
        db::commands::mongo_insert_documents,
        db::commands::mongo_update_document,
        db::commands::mongo_delete_document,
        db::commands::redis_command,
        db::commands::redis_server_info,
        db::commands::redis_list_databases,
        db::commands::redis_select_db,
        db::commands::redis_scan_keys,
        db::commands::redis_key_value,
        db::commands::redis_delete_keys,
        db::commands::tools_status,
        db::commands::tools_ready,
        db::commands::tools_downloadable,
        db::commands::tools_install,
        db::commands::tools_uninstall,
        db::commands::tools_set_path,
    ]
}
```

**91 dòng** cả thảy: 3 secrets + 88 của db. Danh sách trên là đủ và đã đối chiếu với `lib.rs` hôm nay; thứ tự trong khối db được xếp lại theo engine cho dễ đọc, việc Tauri không quan tâm.

- [ ] **Step 4: Đổi `AppState` thành `DbState`**

Trong `src-tauri/src/modules/db/state.rs`: `pub struct AppState` → `pub struct DbState`. Doc comment của struct giữ nguyên. Hai dòng `use` ở đầu file đổi thành:

```rust
use crate::modules::db::models::ConnectionConfig;
use crate::ssh::Tunnel;
```

và hai chỗ trong `DbHandle` đổi `crate::db::postgres::Pools` → `crate::modules::db::drivers::postgres::Pools`, `crate::db::redis::Connection` → `crate::modules::db::drivers::redis::Connection`.

- [ ] **Step 5: Đổi đường dẫn trong `commands.rs` và `drivers/`**

Trong `src-tauri/src/modules/db/commands.rs`:

```rust
use crate::modules::db::drivers::{ /* nguyên danh sách cũ */ };
use crate::modules::db::models::{ConnectionConfig, DbKind};
use crate::modules::db::state::{ActiveConnection, DbState, DbHandle};
use crate::ssh::{self, SshConfig};
```

Rồi thay **mọi** `State<'_, AppState>` thành `State<'_, DbState>` (khoảng 80 chỗ — dùng replace-all trên chuỗi `AppState` trong file này).

Trong `src-tauri/src/modules/db/drivers/*.rs`, đổi mọi `crate::db::` thành `crate::modules::db::drivers::`, `crate::models::` thành `crate::modules::db::models::`, `crate::state::` thành `crate::modules::db::state::`, `crate::ssh_tunnel::` thành `crate::ssh::`. Tìm chúng bằng:

```powershell
Get-ChildItem -Recurse src-tauri/src/modules -Include *.rs | Select-String "crate::(db|models|state|ssh_tunnel)::"
```

- [ ] **Step 6: Viết lại `lib.rs`**

```rust
// First, and with `macro_use`: the `err!` macro it defines is used by every module below it.
#[macro_use]
mod error;

mod modules;
mod secrets;
mod ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init());

    // Self-update: fetching the release, checking its minisign signature and running the installer
    // all happen here, in Rust, which is why the front end needs no network permission for it.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Only the maximized flag is persisted: leave the window maximized and it comes back
        // maximized, restore it down and the next launch uses the default size from the config.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::MAXIMIZED)
                .build(),
        );

    // Each module puts its own state in; the list of commands is `modules::handler`.
    let builder = modules::db::register(builder);

    builder
        .invoke_handler(modules::handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 7: `cargo check`**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

**Nếu `modules::handler()` không biên dịch** (chữ ký `impl Fn(tauri::ipc::Invoke<R>) -> bool` không khớp phiên bản Tauri đang dùng): đọc kiểu thật mà `cargo check` báo và sửa chữ ký cho khớp. Nếu vẫn không được, phương án lùi: bỏ `modules/mod.rs::handler()`, để `tauri::generate_handler![…]` nguyên trong `lib.rs` với đúng các khối và tiền tố `modules::db::commands::` như trên. Mọi phần khác của task giữ nguyên. Ghi lại lựa chọn này trong commit message.

- [ ] **Step 8: Smoke test**

Run: `npm run dev:app`, làm đủ 10 bước smoke test ở đầu plan.
Expected: app chạy y hệt. Đây là chỗ duy nhất phát hiện được một command bị bỏ sót khỏi danh sách — `tsc` không biết, `cargo check` cũng không.

- [ ] **Step 9: Commit**

```powershell
git add -A src-tauri/src
git commit -m "refactor(backend): move database code under modules/db"
```

---

## Task 3: Backend — chia `commands.rs` thành `commands/`

1557 dòng, mọi command của mọi driver trong một file. Đây là lần duy nhất phải mở nó ra.

**Files:**
- Create: `src-tauri/src/modules/db/commands/mod.rs`, `mysql.rs`, `postgres.rs`, `mongo.rs`, `redis.rs`, `tools.rs`
- Delete: `src-tauri/src/modules/db/commands.rs`
- Modify: `src-tauri/src/modules/mod.rs` (đường dẫn trong `generate_handler!`)

**Interfaces:**
- Produces: mọi command giữ nguyên tên hàm, nhưng đường dẫn đổi từ `db::commands::mysql_query` thành `db::commands::mysql::mysql_query`. Tên command Tauri **không** đổi — `#[tauri::command]` lấy tên từ tên hàm, và tên hàm không đổi.

- [ ] **Step 1: Chia file**

`commands/mod.rs` giữ: khối `use`, `TOOLS_PROGRESS_EVENT`, `TRANSFER_PROGRESS_EVENT`, `TransferProgress`, `reporter`, `with_timeout`, `test_ssh_tunnel`, `resolve_endpoint`, `connect_db`, `disconnect_db`, `handle`, `mysql_pool`, `mysql_connection`, `postgres_pool`, `postgres_pools`, `mongo_client`, `redis_connection`, `sql_endpoint`, `mongo_endpoint`, `in_background`, `app_data_dir`, `tools_dir`, cộng phần khai báo module:

```rust
pub mod mongo;
pub mod mysql;
pub mod postgres;
pub mod redis;
pub mod tools;
```

Chia phần còn lại theo tiền tố tên hàm:

| File | Nhận | Số hàm |
| --- | --- | --- |
| `mysql.rs` | mọi `pub async fn mysql_*`, kể cả `mysql_dump` và `mysql_restore` | 28 |
| `postgres.rs` | mọi `pub async fn postgres_*` | 28 |
| `mongo.rs` | mọi `pub async fn mongo_*` | 16 |
| `redis.rs` | mọi `pub async fn redis_*` | 7 |
| `tools.rs` | `tools_status`, `tools_ready`, `tools_downloadable`, `tools_set_path`, `tools_uninstall`, `tools_install` | 6 |

85 hàm trong năm file con, cộng 3 ở `mod.rs` (`connect_db`, `disconnect_db`, `test_ssh_tunnel`) là 88 — đúng số command của db.

Doc comment của từng hàm đi cùng hàm đó. Comment mốc `// --- PostgreSQL ---` ở dòng 1161–1167 của file cũ chuyển lên đầu `postgres.rs` thành doc comment `//!` của module.

- [ ] **Step 2: Cho mỗi file con khối `use` của nó**

Mỗi file con mở đầu bằng:

```rust
use super::{handle, in_background, with_timeout};
use crate::error::AppError;
use crate::modules::db::drivers::{ /* chỉ những gì file này dùng */ };
use crate::modules::db::state::DbState;
use tauri::State;
```

Không đoán: viết khối `use` tối thiểu, chạy `cargo check`, và thêm đúng những gì nó báo thiếu. `noUnusedImports` không bật ở Rust nhưng warning `unused_imports` có — dọn cho sạch.

Hàm helper trong `mod.rs` (`handle`, `mysql_pool`, `sql_endpoint`, `app_data_dir`, …) đang là private. Module con thấy được item private của module cha trong Rust, nên chỉ cần `use super::…`, không phải đổi thành `pub`.

- [ ] **Step 3: Sửa đường dẫn trong `modules/mod.rs`**

Mỗi dòng `db::commands::mysql_query,` thành `db::commands::mysql::mysql_query,`, và tương tự cho `postgres::`, `mongo::`, `redis::`, `tools::`. Ba command ở `commands/mod.rs` (`connect_db`, `disconnect_db`, `test_ssh_tunnel`) không đổi.

- [ ] **Step 4: `cargo check`**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: PASS, không warning.

- [ ] **Step 5: Đếm lại danh sách command**

```powershell
(Get-Content src-tauri/src/modules/mod.rs | Select-String "^\s+(crate::|db::)").Count
```
Expected: `91`. Khác con số này là đã mất hoặc nhân đôi một command.

- [ ] **Step 6: Commit**

```powershell
git add -A src-tauri/src
git commit -m "refactor(backend): split db commands by engine"
```

---

## Task 4: Frontend — dựng `src/shell/`, chuyển file của shell vào

Task này chỉ di chuyển file. Không đổi một dòng logic nào, nên nếu `npm run build` xanh thì nó đúng.

**Files:**
- Move: `src/App.tsx` → `src/shell/App.tsx`; `src/theme.ts` → `src/shell/theme.ts`; `src/update.ts` → `src/shell/update.ts`; `src/components/GlassFilter/` → `src/shell/components/GlassFilter/`; `src/components/SettingsModal/` → `src/shell/components/SettingsModal/`; `src/components/UpdateToast/` → `src/shell/components/UpdateToast/`
- Modify: `src/main.tsx`, và mọi file import các thứ trên

**Interfaces:**
- Produces: `src/shell/App.tsx` default export `App` — `main.tsx` import từ `./shell/App`.
- Produces: `src/shell/theme.ts` exports `useTheme`, `useAccent`, `useGlass`, `ACCENT_COLORS`, `type ThemeMode`, `type AccentColor` (không đổi). `src/shell/update.ts` exports `useUpdateCheck`, `type UpdateCheck` (không đổi).

- [ ] **Step 1: Di chuyển**

```powershell
New-Item -ItemType Directory src/shell/components
git mv src/App.tsx src/shell/App.tsx
git mv src/theme.ts src/shell/theme.ts
git mv src/update.ts src/shell/update.ts
git mv src/components/GlassFilter src/shell/components/GlassFilter
git mv src/components/SettingsModal src/shell/components/SettingsModal
git mv src/components/UpdateToast src/shell/components/UpdateToast
```

- [ ] **Step 2: Sửa import trong `main.tsx`**

```ts
import App from "./shell/App";
```

- [ ] **Step 3: Sửa import trong các file đã di chuyển**

`src/shell/App.tsx`: mọi `"./x"` thành `"../x"` — `../ConnectionTab`, `../icons`, `../types`, `../platform`, `../reload`, `../scroll`, `../textEntry`, `../i18n`, `../App.css`, `../glass.css`; `"./components/GlassFilter"` thành `"./components/GlassFilter"` (không đổi, đã cùng cây), `"./theme"` và `"./update"` không đổi.

`src/shell/components/*/`: mọi `"../../x"` thành `"../../../x"` cho những gì còn ở `src/` (`i18n`, `icons`, `errors`, `tools`), còn `"../../theme"` và `"../../update"` thành `"../../theme"` / `"../../update"` (không đổi — `theme.ts` cũng đã vào `shell/`). `"../dialogMotion"` thành `"../../../components/dialogMotion"`.

- [ ] **Step 4: `npm run build` và sửa cho tới khi xanh**

Run: `npm run build`
Expected: lần đầu FAIL với một loạt `TS2307: Cannot find module`. Mỗi dòng lỗi chỉ đúng file và đường dẫn sai — sửa, chạy lại, lặp cho tới PASS. Đây là oracle đầy đủ cho task này: `tsc` không bỏ sót một import nào.

- [ ] **Step 5: `npm test`**

Run: `npm test`
Expected: PASS, cùng số test như trước task này.

- [ ] **Step 6: Commit**

```powershell
git add -A src
git commit -m "refactor(shell): move the shell's own files under src/shell"
```

---

## Task 5: Frontend — contract shell ↔ module, và badge

Task duy nhất của frontend có logic mới. `App.tsx` thôi biết `DbKind` và `readOnly`.

**Files:**
- Create: `src/shell/module.ts`, `src/shell/registry.ts`, `src/modules/db/index.ts`, `src/modules/db/badges.ts`, `src/modules/db/badges.test.ts`, `src/modules/db/components/ToolsSection/ToolsSection.module.css`
- Move: `src/ConnectionTab.tsx` → `src/modules/db/DbTab.tsx`; `src/shell/components/SettingsModal/ToolsSection.tsx` → `src/modules/db/components/ToolsSection/ToolsSection.tsx`
- Create: `src/modules/db/components/ToolsSection/index.ts`
- Modify: `src/shell/App.tsx`, `src/shell/components/SettingsModal/SettingsModal.tsx`, `src/shell/components/SettingsModal/SettingsModal.module.css`, `src/icons/icons.tsx`, `src/icons/index.ts`, `src/i18n/en.ts`, `src/i18n/vi.ts`, `src/App.css`

**Interfaces:**
- Produces: `src/shell/module.ts` exports `TabBadge`, `ModuleTabProps`, `ModuleSettingsSection`, `ModuleDefinition` (đúng như code ở Step 1).
- Produces: `src/shell/registry.ts` exports `MODULES: ModuleDefinition[]`, `DEFAULT_MODULE_ID: string`, `moduleById(id: string): ModuleDefinition`.
- Produces: `src/modules/db/index.ts` exports `dbModule: ModuleDefinition`.
- Produces: `src/modules/db/badges.ts` exports `type DbBadgeMark = { type: "kind"; kind: DbKind } | { type: "readOnly" }` và `dbBadgeMarks(kind: DbKind | undefined, readOnly: boolean): DbBadgeMark[]`.
- Consumes: `src/modules/db/DbTab.tsx` nhận `ModuleTabProps` — `active`, `onTitleChange`, `onBadgesChange`. Hai prop `onReadOnlyChange` và `onKindChange` biến mất.

**Lý do lệch spec (bổ sung 2/3):** `TabBadge` cần thêm `tabClassName`. `.tab-readonly.tab-active` trong `App.css:425` và `glass.css:251` tô **cả tab** màu hổ phách, không chỉ badge — một contract chỉ có class cho badge không nói được điều đó, và mất nó thì dấu "connection này read-only" biến khỏi giao diện. `TabBadge` cũng cần `title` tách khỏi `label`: hôm nay ổ khoá có tooltip `common.readOnlyConnection` còn logo engine không có tooltip nào, và gộp hai thứ lại sẽ thêm một tooltip chưa ai yêu cầu.

**Lý do lệch spec (bổ sung 3/3):** `ModuleDefinition` cần thêm `settings`. `SettingsModal` (của shell) đang render `ToolsSection`, mà `ToolsSection` là về `mysqldump`/`pg_dump`/`mongodump` — `ToolSuite = "mysql" | "postgres" | "mongo"`, tức khái niệm database thuần. Để nguyên thì shell import `modules/db/tools.ts` và biên giới thủng ngay ở task 8. Nên module góp một mục vào hộp Settings, shell dựng danh sách mục từ `MODULES`.

- [ ] **Step 1: Viết `src/shell/module.ts`**

```ts
import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "../icons";
import type { TranslationKey } from "../i18n";

/**
 * A mark a module wants on its own tab. The shell draws it and nothing more — it does not know
 * what a `kind-mysql` is, only that something asked for that class.
 */
export interface TabBadge {
  /** Distinct within one tab's badges; the shell keys on it. */
  id: string;
  icon: ReactNode;
  /** Read aloud. Already translated — the shell does not know the module's i18n namespace. */
  label: string;
  /** Shown on hover. Left out when the mark needs no tooltip. */
  title?: string;
  /** A class the module defines, e.g. `kind-mysql`, put on the badge. */
  className?: string;
  /** A class put on the whole tab rather than on this badge — for a mark that colours the tab
   *  itself, the way a read-only connection does. */
  tabClassName?: string;
}

export interface ModuleTabProps {
  /** Whether this is the tab on screen. Every other one stays mounted behind it, so a keyboard
   *  shortcut needs telling which of them it is meant for. */
  active: boolean;
  onTitleChange: (title: string) => void;
  onBadgesChange: (badges: TabBadge[]) => void;
}

/** A pane a module adds to the app's Settings dialog. */
export interface ModuleSettingsSection {
  labelKey: TranslationKey;
  Icon: ComponentType<IconProps>;
  Section: ComponentType;
}

/**
 * One thing MixDB can open a tab of.
 *
 * Deliberately without lifecycle hooks, a persistence API, or an event bus between modules: a
 * module cleans up in its own `useEffect` and saves through its own store, and inventing a need
 * nobody has yet is how a shell ends up harder to add to than the thing it was meant to simplify.
 */
export interface ModuleDefinition {
  id: string;
  /** The name in the `[+]` menu. */
  labelKey: TranslationKey;
  Icon: ComponentType<IconProps>;
  /** The tab's title when it is first opened, before the module names it. */
  defaultTitleKey: TranslationKey;
  Tab: ComponentType<ModuleTabProps>;
  settings?: ModuleSettingsSection;
}
```

- [ ] **Step 2: Viết bài test cho `dbBadgeMarks` (chưa có hàm)**

Create `src/modules/db/badges.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dbBadgeMarks } from "./badges";

describe("dbBadgeMarks", () => {
  it("marks nothing while the tab is not connected", () => {
    expect(dbBadgeMarks(undefined, false)).toEqual([]);
  });

  // `kind` is undefined exactly while there is no connection, and the lock belongs to a
  // connection — so a read-only saved row on a tab still showing the form marks nothing either.
  it("marks nothing when there is no connection even if read-only", () => {
    expect(dbBadgeMarks(undefined, true)).toEqual([]);
  });

  it("marks the engine once connected", () => {
    expect(dbBadgeMarks("mysql", false)).toEqual([{ type: "kind", kind: "mysql" }]);
  });

  it("puts the lock after the engine, never before it", () => {
    expect(dbBadgeMarks("postgres", true)).toEqual([
      { type: "kind", kind: "postgres" },
      { type: "readOnly" },
    ]);
  });
});
```

- [ ] **Step 3: Chạy test, xem nó fail**

Run: `npx vitest run src/modules/db/badges.test.ts`
Expected: FAIL — `Failed to resolve import "./badges"`.

- [ ] **Step 4: Viết `src/modules/db/badges.ts`**

```ts
import type { DbKind } from "../../types";

/** One mark this tab's state calls for. Turned into a `TabBadge` — icon and translated label — by
 *  `DbTab`, which is the only place that has a `t` to hand. */
export type DbBadgeMark = { type: "kind"; kind: DbKind } | { type: "readOnly" };

/**
 * Which marks the tab bar should be showing for this tab.
 *
 * `kind` is `undefined` until there is a connection, and that gates both marks: before then the
 * logo belongs to the row in the sidebar, and the form on screen may be for another connection
 * entirely. The engine comes first — which server a tab is on is what you are looking for when
 * five of them are open, and the shape answers it before the name does.
 */
export function dbBadgeMarks(kind: DbKind | undefined, readOnly: boolean): DbBadgeMark[] {
  if (!kind) return [];
  const marks: DbBadgeMark[] = [{ type: "kind", kind }];
  if (readOnly) marks.push({ type: "readOnly" });
  return marks;
}
```

- [ ] **Step 5: Chạy test, xem nó pass**

Run: `npx vitest run src/modules/db/badges.test.ts`
Expected: PASS, 4 test.

- [ ] **Step 6: Chuyển `ConnectionTab.tsx` thành `modules/db/DbTab.tsx`**

```powershell
git mv src/ConnectionTab.tsx src/modules/db/DbTab.tsx
```

Sửa mọi import trong file: `"./x"` thành `"../../x"` (`../../savedConnectionsStore`, `../../types`, `../../sql/SqlWorkspace`, `../../mysql/api`, `../../components/Select`, `../../icons`, `../../platform`, `../../i18n`, `../../errors`, …). Đổi tên hàm `ConnectionTab` thành `DbTab` và dòng cuối thành `export default DbTab;`.

- [ ] **Step 7: Đổi hai callback thành `onBadgesChange`**

Trong `src/modules/db/DbTab.tsx`, thay `interface Props` bằng:

```ts
import type { ModuleTabProps, TabBadge } from "../../shell/module";
import { dbBadgeMarks } from "./badges";
```

và dùng `ModuleTabProps` trực tiếp: `function DbTab({ active, onTitleChange, onBadgesChange }: ModuleTabProps) {`.

Thay hai khối `activeReadOnly` / `activeKind` (quanh dòng 236–254 của file cũ) bằng:

```ts
  /**
   * The marks the tab bar should be showing for this tab.
   *
   * Both are read off the store rather than remembered from the click, so clearing the read-only
   * flag in one tab takes the lock off this one too. Only once connected: see `dbBadgeMarks`.
   */
  const activeReadOnly = Boolean(
    connectionId && savedConnections.find((c) => c.id === editingId)?.readOnly,
  );
  const badges = useMemo<TabBadge[]>(
    () =>
      dbBadgeMarks(connectionId ? kind : undefined, activeReadOnly).map((mark) =>
        mark.type === "kind"
          ? {
              id: "kind",
              // The same logo the sidebar row carries, without the tinted tile around it.
              icon: <DatabaseIcon kind={mark.kind} size={14} />,
              label: t(KIND_LABEL[mark.kind]),
              className: `tab-kind kind-${mark.kind}`,
            }
          : {
              id: "readOnly",
              icon: <LockIcon size={12} />,
              label: t("common.readOnly"),
              title: t("common.readOnlyConnection"),
              className: "tab-lock",
              tabClassName: "tab-readonly",
            },
      ),
    [connectionId, kind, activeReadOnly, t],
  );
  useEffect(() => {
    onBadgesChange(badges);
  }, [badges]);
```

`useMemo` đã có trong khối import React của file; `DatabaseIcon` và `LockIcon` cũng đã được import.

- [ ] **Step 8: Chuyển `ToolsSection` sang module db**

```powershell
New-Item -ItemType Directory src/modules/db/components/ToolsSection
git mv src/shell/components/SettingsModal/ToolsSection.tsx src/modules/db/components/ToolsSection/ToolsSection.tsx
```

`src/modules/db/components/ToolsSection/index.ts`:

```ts
export { default } from "./ToolsSection";
```

Sửa import trong `ToolsSection.tsx` — file mới ở độ sâu 4, và `tools.ts` còn ở `src/` cho tới task 6:

```ts
import { useTranslation } from "../../../../i18n";
import type { TranslationKey } from "../../../../i18n";
import { CheckIcon } from "../../../../icons";
import { errorMessage } from "../../../../errors";
import { /* … nguyên danh sách cũ … */ } from "../../../../tools";
import type { ToolStage, ToolStatus, ToolSuite } from "../../../../tools";
import styles from "./ToolsSection.module.css";
```

Task 6 chuyển `tools.ts` vào `src/modules/db/`, và hai dòng `"../../../../tools"` thành `"../../tools"`.

- [ ] **Step 9: Dựng `ToolsSection.module.css`**

Cắt khỏi `src/shell/components/SettingsModal/SettingsModal.module.css` mọi class chỉ `ToolsSection` dùng — `.tool`, `.toolSuite`, `.toolSuiteHeader`, `.toolSuiteName`, `.toolName`, `.toolPath`, `.toolText`, `.toolBadge`, `.toolBadgeMissing`, `.toolButtonDanger`, `.toolDone`, `.toolError`, `.progress`, `.progressHead`, `.progressCount`, `.progressTrack`, `.progressFill`, `.progressSweep` — và dán vào file mới. Bốn class dưới đây `SettingsModal` cũng dùng, nên **sao chép** (không cắt) vào đầu file mới, với ghi chú:

```css
/* Bốn class dưới đây có bản y hệt trong `SettingsModal.module.css`: hộp Settings là của shell, mục
   Tools là của module database, và một CSS Module không đọc được của file khác. Vài dòng trùng
   rẻ hơn một import xuyên biên giới. */
.section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.hint {
  margin: 0;
  font-size: 0.85em;
  line-height: 1.45;
  opacity: 0.65;
}

.toolSuiteActions {
  display: flex;
  flex: 0 0 auto;
  gap: 0.3rem;
}

.toolButton {
  border: 1px solid transparent;
  box-shadow: none;
  background: var(--hover-bg);
  padding: 0.3em 0.7em;
  border-radius: var(--radius-sm);
  font-size: 0.85em;
}
```

Giữ nguyên bốn class đó trong `SettingsModal.module.css` — `UpdateSection` dùng `.toolButton` và `.toolSuiteActions`, `AppearanceSection` dùng `.section` và `.hint`.

- [ ] **Step 10: Thêm một icon database trung lập**

`ModuleDefinition.Icon` là mác của cả module trong menu `[+]`, nên nó không được là logo của một engine nào. `DatabaseIcon` trong `src/icons/brands.tsx` bắt buộc có prop `kind` (nó *là* logo engine) nên không dùng được. Thêm vào `src/icons/icons.tsx`, ngay sau `CopyIcon`:

```tsx
/** A database, with no engine's brand on it — the module itself rather than any one connection.
 *  Three platters: the stack a database has been drawn as since disk packs. */
export function DatabaseGenericIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3c3.9 0 7 1.1 7 2.5S15.9 8 12 8 5 6.9 5 5.5 8.1 3 12 3z" />
      <path d="M19 5.5v13c0 1.4-3.1 2.5-7 2.5s-7-1.1-7-2.5v-13" />
      <path d="M19 12c0 1.4-3.1 2.5-7 2.5S5 13.4 5 12" />
    </Icon>
  );
}
```

và một dòng `DatabaseGenericIcon,` vào danh sách export trong `src/icons/index.ts`, giữ thứ tự chữ cái (sau `CopyIcon`, trước `DotIcon`).

Icon này chưa hiện ở đâu khi chỉ có một module — menu `[+]` không mở. Nó có ở đây vì kiểu đòi, và vì module thứ hai sẽ cần nó ngay.

- [ ] **Step 11: Viết `src/modules/db/index.ts`**

```ts
import type { ModuleDefinition } from "../../shell/module";
import { DatabaseGenericIcon, WrenchIcon } from "../../icons";
import DbTab from "./DbTab";
import ToolsSection from "./components/ToolsSection";

/** Database: the module MixDB started as. */
export const dbModule: ModuleDefinition = {
  id: "db",
  labelKey: "app.moduleDatabase",
  Icon: DatabaseGenericIcon,
  defaultTitleKey: "app.newConnectionTitle",
  Tab: DbTab,
  /* The dump tools are `mysqldump`, `pg_dump`, `mongodump` — this module's business, shown in the
     app's Settings because that is where a download belongs, not because the shell owns it. */
  settings: { labelKey: "tools.title", Icon: WrenchIcon, Section: ToolsSection },
};
```

Thêm một key vào nhóm `app` của **cả hai** từ điển — `src/i18n/en.ts` và `src/i18n/vi.ts`, cùng một giá trị vì tiếng Việt cũng gọi nó là Database:

```ts
    moduleDatabase: "Database",
```

- [ ] **Step 12: Viết `src/shell/registry.ts`**

```ts
import type { ModuleDefinition } from "./module";
import { dbModule } from "../modules/db";

/** Every module the app can open a tab of. Adding one is a line here. */
export const MODULES: ModuleDefinition[] = [dbModule];

/** What `Ctrl+T` and a plain click on `[+]` open. */
export const DEFAULT_MODULE_ID = "db";

export function moduleById(id: string): ModuleDefinition {
  const found = MODULES.find((m) => m.id === id);
  // A tab's `moduleId` only ever comes from this list, so this is a programming error rather than
  // something to show the user.
  if (!found) throw new Error(`Unknown module: ${id}`);
  return found;
}
```

- [ ] **Step 13: Viết lại `src/shell/App.tsx`**

`TabInfo` thành:

```ts
interface TabInfo {
  id: string;
  moduleId: string;
  title: string;
  /** What the module asked the tab bar to show for it. Reported rather than worked out up here:
   *  only the module knows what its own state means. */
  badges: TabBadge[];
}
```

`newTab` nhận module:

```ts
  function newTab(moduleId: string = DEFAULT_MODULE_ID): TabInfo {
    const def = moduleById(moduleId);
    return { id: crypto.randomUUID(), moduleId, title: t(def.defaultTitleKey), badges: [] };
  }
```

`markTabReadOnly` và `markTabKind` biến mất, thay bằng một hàm:

```ts
  function setTabBadges(id: string, badges: TabBadge[]) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, badges } : t)));
  }
```

`openTab` nhận `moduleId?: string` và truyền xuống `newTab`. Phím `Ctrl+T` gọi `openTab()` như cũ.

Phần render tab đổi thành:

```tsx
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={["tab", tab.id === activeId && "tab-active", ...tab.badges.map((b) => b.tabClassName)]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setActiveId(tab.id)}
          >
            {/* Ahead of the name, where the eye lands first: a mark is meant to be seen before a
                statement is typed, not after the connection has been identified. What each one
                means is the module's business — the shell only puts it where it goes. */}
            {tab.badges.map((badge) => (
              <span
                key={badge.id}
                className={badge.className ? `tab-badge ${badge.className}` : "tab-badge"}
                title={badge.title}
              >
                {badge.icon}
                <span className="visually-hidden">{badge.label}</span>
              </span>
            ))}
            <span className="tab-title">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title={t("app.closeTab")}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
```

Nút `[+]`:

```tsx
        <button
          className="tab-new"
          onClick={(e) => {
            // One module and the menu would be a list of one, so the button just opens it — which
            // is exactly what it did before there was a registry at all.
            if (MODULES.length < 2) return openTab();
            const rect = e.currentTarget.getBoundingClientRect();
            setModuleMenu({ x: rect.left, y: rect.bottom });
          }}
          title={t("app.newConnectionTab")}
        >
          <PlusIcon />
        </button>
```

với `const [moduleMenu, setModuleMenu] = useState<{ x: number; y: number } | null>(null);` và, ngay sau `</div>` đóng `.tab-bar`:

```tsx
      {/* `ContextMenu` takes its entries as children — plain `<button>`s that `.context-menu` in
          App.css styles. It hangs at a point in the window and closes itself on Escape, a press
          outside, a scroll or a resize, so there is nothing to wire up here beyond `onClose`. */}
      {moduleMenu && (
        <ContextMenu x={moduleMenu.x} y={moduleMenu.y} onClose={() => setModuleMenu(null)}>
          {MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setModuleMenu(null);
                openTab(m.id);
              }}
            >
              <m.Icon size={14} />
              {t(m.labelKey)}
            </button>
          ))}
        </ContextMenu>
      )}
```

`import ContextMenu from "../components/ContextMenu";`.

Nhánh này **không chạy được** khi chỉ có một module — `MODULES.length < 2` chặn trước. Nó có ở đây để thêm module thứ hai chỉ là một dòng ở `registry.ts`, đúng lời hứa của spec; và vì chưa chạy lần nào, module thứ hai phải kiểm nó (đã ghi vào `.agent/conventions/adding-a-module.md` ở task 11).

Phần `.tab-content` đổi thành:

```tsx
        {tabs.map((tab) => {
          const { Tab } = moduleById(tab.moduleId);
          return (
            <div
              key={tab.id}
              className="tab-panel"
              style={{ display: tab.id === activeId ? "flex" : "none" }}
            >
              <Tab
                active={tab.id === activeId}
                onTitleChange={(title) => renameTab(tab.id, title)}
                onBadgesChange={(badges) => setTabBadges(tab.id, badges)}
              />
            </div>
          );
        })}
```

Xoá `import ConnectionTab`, `import type { DbKind }`, và `DatabaseIcon`/`LockIcon` khỏi khối import icons — `noUnusedLocals` sẽ báo nếu bỏ sót.

- [ ] **Step 13: `SettingsModal` dựng danh sách mục từ registry**

Trong `src/shell/components/SettingsModal/SettingsModal.tsx`:

Xoá `import ToolsSection from "./ToolsSection";` và `WrenchIcon` khỏi khối import icons. Thêm `import { MODULES } from "../../registry";`.

`SECTIONS` chỉ còn là metadata cho thanh nav — `AppearanceSection` và `UpdateSection` cần props riêng, còn `ModuleSettingsSection["Section"]` không nhận props, nên ba thứ đó không gộp được vào một danh sách có `Section`:

```ts
type SectionId = string;

/** The panes, in the order they are listed: the app's own settings first, then whatever each
 *  module contributes, then the errands. A module names its own pane — the shell does not know
 *  that "Tools" means `mysqldump`. */
const SECTIONS: { id: SectionId; labelKey: TranslationKey; icon: ComponentType<IconProps> }[] = [
  { id: "appearance", labelKey: "settings.appearance", icon: PaletteIcon },
  ...MODULES.flatMap((m) => (m.settings ? [{ id: m.id, labelKey: m.settings.labelKey, icon: m.settings.Icon }] : [])),
  { id: "update", labelKey: "update.title", icon: DownloadIcon },
];
```

Thanh nav (`SECTIONS.map(...)`) không đổi một dòng. Chỗ nó kiểm `id === "update"` để vẽ dấu chấm cũng không đổi.

Phần panel: giữ nguyên khối `appearance` và khối `update` như hôm nay, và thay khối `tools` giữa chúng bằng:

```tsx
          {MODULES.map((m) =>
            m.settings ? (
              <div
                key={m.id}
                className={styles.panel}
                role="tabpanel"
                id={`settings-panel-${m.id}`}
                aria-labelledby={`settings-tab-${m.id}`}
                hidden={section !== m.id}
              >
                <m.settings.Section />
              </div>
            ) : null,
          )}
```

Đặt đúng giữa hai khối kia thì thứ tự DOM cũng không đổi. Comment "Hidden rather than unmounted: a download started under Tools carries on…" ở trên khối `appearance` giữ nguyên — nó nói về đúng cơ chế này.

- [ ] **Step 15: Tách `.tab-badge` khỏi `.tab-kind` / `.tab-lock`**

Trong `src/App.css`, thay hai rule `.tab-kind` (406) và `.tab-lock` (415) bằng:

```css
/* Ahead of the name: the layout every mark shares. What colour it takes, and whether it takes one
   at all, is the module's own class beside this one. */
.tab-badge {
  display: inline-flex;
  align-items: center;
  flex: none;
}

/* The engine's logo, without the tinted tile the sidebar row puts around it: a tab has no room for
   a badge, and the mark alone is what has to be recognised. The brand colour comes from the
   `.kind-*` class beside this one, so the two places read as one mark. */
.tab-kind {
  color: var(--kind);
}

/* Marked in its own colour rather than the engine's: the lock is about what this tab will let you
   do, which has nothing to do with which server it is on. */
.tab-lock {
  color: var(--readonly);
}
```

`.tab-kind`, `.tab-lock` và `.tab-readonly.tab-active` sẽ chuyển sang `db.css` ở task 9; ở task này chúng ở lại `App.css`.

- [ ] **Step 16: `npm run build` + `npm test`**

Run: `npm run build`
Expected: PASS. Lỗi hay gặp: `TS2322` ở `dbModule.Icon` (kiểu icon không khớp `ComponentType<IconProps>`) và `TS2739` ở `<Tab …>` (thiếu prop). Cả hai đều nói đúng chỗ phải sửa.

Run: `npm test`
Expected: PASS, nhiều hơn trước 4 test (`badges.test.ts`).

- [ ] **Step 17: Smoke test**

Run: `npm run dev:app`, làm đủ 10 bước.
Expected: y hệt. Kiểm thêm ba việc mà chỉ mắt thấy được:
- Tab của một connection read-only có vạch hổ phách trên cùng và ổ khoá cạnh logo.
- Hover ổ khoá hiện tooltip "This connection is marked read-only…".
- Hover logo engine **không** hiện tooltip nào.

- [ ] **Step 18: Commit**

```powershell
git add -A src
git commit -m "refactor(shell): make the tab bar module-agnostic"
```

---

## Task 6: Frontend — gom phần còn lại của module database

**Files:**
- Move vào `src/modules/db/`: `sql/`, `mysql/`, `postgres/`, `mongo/`, `redis/`, `types.ts`, `filters.ts`, `tools.ts`, `transfer.ts`, `savedConnections.ts`, `savedConnectionsStore.ts`, `queryHistory.ts`, `queryDrafts.ts`, `querySnippets.ts`
- Move: `src/icons/brands.tsx` → `src/modules/db/icons.tsx`
- Modify: `src/icons/index.ts` (bỏ dòng re-export `DatabaseIcon`), `src/modules/db/index.ts` (import `DatabaseIcon` từ `./icons`), và mọi file import những thứ trên

**Interfaces:**
- Produces: `src/modules/db/icons.tsx` exports `DatabaseIcon`, `type DatabaseIconProps` — cùng chữ ký như `src/icons/brands.tsx`, chỉ khác chỗ ở. `src/icons/index.ts` không còn export chúng.
- Produces: đường dẫn mới cho 14 module đã kể; mọi export bên trong không đổi tên.

- [ ] **Step 1: Di chuyển**

```powershell
git mv src/sql src/modules/db/sql
git mv src/mysql src/modules/db/mysql
git mv src/postgres src/modules/db/postgres
git mv src/mongo src/modules/db/mongo
git mv src/redis src/modules/db/redis
git mv src/types.ts src/modules/db/types.ts
git mv src/filters.ts src/modules/db/filters.ts
git mv src/tools.ts src/modules/db/tools.ts
git mv src/transfer.ts src/modules/db/transfer.ts
git mv src/savedConnections.ts src/modules/db/savedConnections.ts
git mv src/savedConnectionsStore.ts src/modules/db/savedConnectionsStore.ts
git mv src/queryHistory.ts src/modules/db/queryHistory.ts
git mv src/queryDrafts.ts src/modules/db/queryDrafts.ts
git mv src/querySnippets.ts src/modules/db/querySnippets.ts
git mv src/icons/brands.tsx src/modules/db/icons.tsx
```

- [ ] **Step 2: Bỏ `DatabaseIcon` khỏi barrel dùng chung**

Trong `src/icons/index.ts` xoá dòng:

```ts
export { DatabaseIcon, type DatabaseIconProps } from "./brands";
```

- [ ] **Step 3: Sửa import theo hai quy tắc**

Quy tắc đủ cho cả task: một file đã chuyển vào `src/modules/db/` thì
- import trỏ tới thứ **cũng đã chuyển** → không đổi (cùng độ sâu tương đối);
- import trỏ tới thứ **còn ở tầng chung** → sâu thêm hai bậc: `"../i18n"` thành `"../../../i18n"` với file trong `modules/db/sql/`, `"./i18n"` thành `"../../i18n"` với file ngay trong `modules/db/`.

Các đích còn ở tầng chung mà đám file này hay trỏ tới: `components/`, `icons`, `i18n`, `errors`, `platform`, `reload`, `clipboard`, `textEntry`, `paneCache`, `sidebarKeyboard`, `virtualRows`, `nativeContextMenu`, `shell/module`.

Ngoài ra `src/components/` (23 folder chưa chuyển) đang import `"../../types"`, `"../../filters"`, `"../../sql/…"`, `"../../mysql/…"` — chúng thành `"../../modules/db/types"` v.v. Task 8 sẽ đưa chúng vào `modules/db/components/` và các đường dẫn này ngắn lại; ở task này cứ để dài.

Đừng dò tay: chạy `npm run build`, `tsc` liệt kê từng import sai kèm file và dòng.

- [ ] **Step 4: `npm run build` cho tới khi xanh**

Run: `npm run build`
Expected: lần đầu FAIL với nhiều `TS2307`. Sửa theo từng dòng lỗi, lặp cho tới PASS.

Hai lỗi đáng nói riêng:

- `TS2305: Module '"../../icons"' has no exported member 'DatabaseIcon'` ở `src/modules/db/DbTab.tsx` — đổi thành `import { DatabaseIcon } from "./icons";`. `src/modules/db/index.ts` vẫn lấy `DatabaseGenericIcon` và `WrenchIcon` từ `"../../icons"`: chúng là icon dùng chung, không phải logo engine.
- `src/modules/db/badges.ts` đang `import type { DbKind } from "../../types";` — đổi thành `"./types"`.

- [ ] **Step 5: `npm test`**

Run: `npm test`
Expected: PASS. Các test đã chuyển chỗ (`mysql/columns.test.ts`, `sql/guard.test.ts`, `sql/statements.test.ts`) vẫn chạy — vitest tìm theo glob, không theo danh sách.

- [ ] **Step 6: Smoke test**

Run: `npm run dev:app`, làm đủ 10 bước.
Expected: y hệt. Kiểm thêm: mở tab Query, chạy một câu, mở History và Snippets — ba store `query-*.json` là chỗ dễ vỡ nhất nếu một đường dẫn `Store.load` bị sửa nhầm.

- [ ] **Step 7: Commit**

```powershell
git add -A src
git commit -m "refactor(db): gather the database module"
```

---

## Task 7: Frontend — `src/core/`

Mười module không biết gì về database và module nào cũng dùng được.

**Files:**
- Move vào `src/core/`: `platform.ts`, `reload.ts`, `scroll.ts`, `clipboard.ts`, `textEntry.ts`, `errors.ts`, `nativeContextMenu.ts`, `paneCache.ts`, `sidebarKeyboard.ts`, `virtualRows.ts`, `virtualRows.test.ts`
- Modify: `src/core/sidebarKeyboard.ts` (đổi tên tham số), `src/modules/db/sql/SqlWorkspace.tsx`, `src/modules/db/mongo/MongoWorkspace.tsx` (không đổi gì ngoài đường dẫn — tên biến chỗ gọi vẫn là `selectedDb`, đó là tên của **chúng**), và mọi file import những thứ trên

**Interfaces:**
- Produces: `src/core/sidebarKeyboard.ts` exports `useSidebarKeyboard(active: boolean, selectedGroup: string): SidebarKeyboard` — tham số thứ hai đổi tên, kiểu và thứ tự không đổi, nên chỗ gọi không phải sửa gì ngoài đường dẫn.
- Produces: chín module còn lại giữ nguyên mọi export.

- [ ] **Step 1: Di chuyển**

```powershell
New-Item -ItemType Directory src/core
git mv src/platform.ts src/core/platform.ts
git mv src/reload.ts src/core/reload.ts
git mv src/scroll.ts src/core/scroll.ts
git mv src/clipboard.ts src/core/clipboard.ts
git mv src/textEntry.ts src/core/textEntry.ts
git mv src/errors.ts src/core/errors.ts
git mv src/nativeContextMenu.ts src/core/nativeContextMenu.ts
git mv src/paneCache.ts src/core/paneCache.ts
git mv src/sidebarKeyboard.ts src/core/sidebarKeyboard.ts
git mv src/virtualRows.ts src/core/virtualRows.ts
git mv src/virtualRows.test.ts src/core/virtualRows.test.ts
```

- [ ] **Step 2: Đổi tên `selectedDb` trong `sidebarKeyboard.ts`**

Đây là chỗ duy nhất của cả plan mà `core/` mang một từ của database trong chữ ký công khai. Sửa cả năm chỗ dùng và hai chỗ trong doc comment:

```ts
/**
 * Wires that keyboard up for a sidebar whose picker currently reads `selectedGroup` — a database
 * for the SQL and Mongo workspaces, and whatever a later module's sidebar groups its list by.
 *
 * `active` is what keeps the focus-taking to the tab being looked at: a group can be chosen — or
 * arrive with the connection — while this tab is behind another, and every background tab would
 * otherwise pull the keyboard off whatever the user was actually typing into.
 */
export function useSidebarKeyboard(active: boolean, selectedGroup: string): SidebarKeyboard {
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<ItemListHandle>(null);

  /**
   * The group the search box was last focused for — what keeps the focus to the one moment a group
   * is opened, rather than to every render or every return to the tab.
   */
  const focusedGroup = useRef<string | null>(null);

  // A group opened leaves the keyboard in the search box, which is where the next thing the user
  // does with this sidebar starts: type a few letters, then `ArrowDown` into the list.
  useEffect(() => {
    if (selectedGroup === "") {
      // The picker is empty again — a group dropped, or one that stopped being listed. Coming back
      // to the same name later is opening it afresh, and the box is due the keyboard again.
      focusedGroup.current = null;
      return;
    }
    if (!active || focusedGroup.current === selectedGroup) return;
    focusedGroup.current = selectedGroup;
    searchRef.current?.focus();
  }, [active, selectedGroup]);
```

Cũng sửa doc comment của `SidebarKeyboard`: "the list of tables or collections under it" thành "the list under it", và bỏ "Both workspaces want the same thing of it — open a database and…" thành "Callers want the same thing of it — open a group and…".

Chỗ gọi (`SqlWorkspace.tsx`, `MongoWorkspace.tsx`) **không** đổi: `useSidebarKeyboard(active, selectedDb)` vẫn đúng, vì `selectedDb` là tên biến của chúng.

- [ ] **Step 3: Sửa import**

`src/main.tsx` → `"./core/nativeContextMenu"`. `src/shell/App.tsx` → `"../core/platform"`, `"../core/reload"`, `"../core/scroll"`, `"../core/textEntry"`. Các file khác: `tsc` chỉ đường. `errors.ts` có 19 chỗ import — nhiều nhất trong nhóm này.

- [ ] **Step 4: `npm run build` cho tới khi xanh**

Run: `npm run build`
Expected: FAIL rồi PASS sau khi sửa hết `TS2307`.

- [ ] **Step 5: `npm test`**

Run: `npm test`
Expected: PASS, cùng số test.

- [ ] **Step 6: Commit**

```powershell
git add -A src
git commit -m "refactor(core): gather the module-agnostic helpers"
```

---

## Task 8: Frontend — `components/` chỉ còn primitive

**Files:**
- Move vào `src/modules/db/components/`: `CollationSelect`, `ColumnDialog`, `DatabaseActions`, `DatabaseDialog`, `DatabaseStats`, `Document`, `DocumentNode`, `DumpDialog`, `FilterBar`, `IndexDialog`, `InsertDocumentsDialog`, `InsertRowsDialog`, `NoSqlTable`, `QueryEditor`, `RedisGroupKeys`, `RedisKeyList`, `RedisTypeBadge`, `RedisValue`, `SqlEditor`, `SqlTable`, `TableDialog`, `TableStructure`, `TransferOverlay` (23 folder)
- Ở lại `src/components/`: `ActionBar`, `Button`, `ConfirmDialog`, `ContextMenu.tsx`, `ErrorBanner`, `Input`, `ItemList`, `JsonView`, `LoadingOverlay`, `NameDialog`, `Pagination`, `Select`, `Tooltip`, `contextMenuPosition.ts`, `contextMenuPosition.test.ts`, `dialogMotion.ts`, `dialogMotion.module.css`

**Interfaces:**
- Consumes: 13 primitive ở lại — đã kiểm: không một cái nào import `types.ts`, `filters.ts`, `sql/`, `mysql/`, `postgres/`, `mongo/`, `redis/` hay `modules/db/`. Chúng chỉ import lẫn nhau và `icons`, `i18n`, `core/errors`, `dialogMotion`.
- Produces: 23 folder db giữ nguyên mọi export và mọi tên file; chỉ đường dẫn đổi.

- [ ] **Step 1: Di chuyển**

```powershell
$db = @("CollationSelect","ColumnDialog","DatabaseActions","DatabaseDialog","DatabaseStats","Document","DocumentNode","DumpDialog","FilterBar","IndexDialog","InsertDocumentsDialog","InsertRowsDialog","NoSqlTable","QueryEditor","RedisGroupKeys","RedisKeyList","RedisTypeBadge","RedisValue","SqlEditor","SqlTable","TableDialog","TableStructure","TransferOverlay")
foreach ($d in $db) { git mv "src/components/$d" "src/modules/db/components/$d" }
```

- [ ] **Step 2: Sửa import**

Trong 23 folder vừa chuyển: `"../../types"` thành `"../../types"` (đúng luôn — `types.ts` đã ở `modules/db/`), `"../../modules/db/x"` thành `"../../x"`, `"../../i18n"` thành `"../../../../i18n"`, `"../../icons"` thành `"../../../../icons"`, `"../../core/errors"` thành `"../../../../core/errors"`, `"../Button"` thành `"../../../../components/Button"` (và tương tự cho mọi primitive), `"../dialogMotion"` thành `"../../../../components/dialogMotion"`.

Trong `modules/db/DbTab.tsx`, `sql/`, `mongo/`, `redis/`: các import trỏ tới 23 folder này rút ngắn, ví dụ `"../../components/SqlTable"` thành `"./components/SqlTable"` trong `DbTab.tsx` và `"../components/SqlTable"` trong `sql/SqlWorkspace.tsx`.

- [ ] **Step 3: `npm run build` cho tới khi xanh**

Run: `npm run build`
Expected: FAIL rồi PASS. Đây là task nhiều đường dẫn nhất; đi theo lỗi, đừng đoán trước.

- [ ] **Step 4: `npm test`**

Run: `npm test`
Expected: PASS. Bốn test đã chuyển chỗ: `ColumnDialog.test.ts`, `NoSqlTable/request.test.ts`, `SqlTable/request.test.ts`, `SqlTable/rowText.test.ts`.

- [ ] **Step 5: Kiểm biên giới**

```powershell
Get-ChildItem -Recurse src/components,src/core,src/icons,src/i18n -Include *.ts,*.tsx | Select-String "modules/db"
```
Expected: **không dòng nào**. Một dòng nào cũng là biên đã thủng — `tsc` biên dịch bình thường, nên đây là chỗ duy nhất phát hiện được.

```powershell
Get-ChildItem -Recurse src/shell -Include *.ts,*.tsx | Select-String "modules/db"
```
Expected: đúng **một** dòng, `src/shell/registry.ts`.

- [ ] **Step 6: Commit**

```powershell
git add -A src
git commit -m "refactor(components): keep only shared primitives"
```

---

## Task 9: CSS — chia `App.css` theo chủ sở hữu

1715 dòng, một file. Không phải "từ dòng 481 trở đi là db": các rule chung và khối token dark nằm rải, kể cả ở cuối file.

**Lệch spec (thứ tự CSS):** spec đề phương án lùi là `shell/App.css` `@import` `db.css`. Không dùng được: CSS bắt `@import` phải đứng trước mọi rule, nên nó đặt `db.css` *trước* App.css — ngược hẳn cái đang cần. Thứ tự thật do đồ thị import của Vite quyết: `shell/App.tsx` import `registry` (kéo theo `db.css`) ở đầu file, rồi mới import stylesheet của chính nó, nên `db.css` được nạp **trước**. Chỗ nào thật sự xung đột thì chữa bằng độ đặc hiệu, không bằng thứ tự — xem Step 9. Đã kiểm: hai rule glass và rule `.tab-readonly.tab-active` đều thắng nhờ đặc hiệu, nên không phụ thuộc thứ tự.

**Files:**
- Move: `src/App.css` → `src/shell/App.css`; `src/glass.css` → `src/shell/glass.css`
- Create: `src/modules/db/db.css`
- Modify: `src/shell/App.tsx` (đường dẫn import), `src/modules/db/DbTab.tsx` (thêm `import "./db.css"`)

- [ ] **Step 1: Di chuyển hai file vào `shell/`**

```powershell
git mv src/App.css src/shell/App.css
git mv src/glass.css src/shell/glass.css
```

Trong `src/shell/App.tsx` sửa hai dòng import cuối thành `"./App.css"` và `"./glass.css"` — giữ nguyên thứ tự và giữ nguyên comment giải thích thứ tự.

- [ ] **Step 2: Cắt các rule của database ra `src/modules/db/db.css`**

Chuyển đúng các selector dưới đây, theo thứ tự chúng đang có trong `App.css`, kèm doc comment của từng rule:

| Nhóm | Selector |
| --- | --- |
| Form kết nối + danh sách đã lưu | `.login-view`, `.saved-list`, `.saved-list-header`, `.saved-list-new`, `.saved-list-new:hover`, `.saved-list-header h3`, `.saved-list ul`, `.saved-list li`, `.saved-item`, `.saved-item strong`, `.saved-item-pin`, `.saved-item:hover .saved-item-pin`, `.saved-item-active .saved-item-pin`, `.saved-item-readonly`, `.saved-item-readonly-badge`, `.saved-item-icon`, `.saved-item-active` |
| Logo engine | `.kind-mysql`, `.kind-postgres`, `.kind-mongo`, `.kind-redis`, bốn bản `:root[data-theme="dark"] .kind-*`, khối `@media (prefers-color-scheme: dark)` chứa `.kind-*` (dòng 701–724), `.kind-new` |
| Dấu trên tab | `.tab-kind`, `.tab-lock`, `.tab-readonly.tab-active` |
| Form | `.login-form`, `.workspace`, `.field-warning`, khối `@media (max-width: 980px)` (937), `.method-tabs`, `.method-tab`, `.method-tab-icon`, `.method-tab:hover`, `.method-tab-active`, `.row-name`, `.field-name`, `.field-name input`, `.field-connection-string input`, `.field-connection-string input[readonly]`, `.field-connection-string .reveal-toggle`, `.tunnel-status`, `.tunnel-status-pending`, `.tunnel-status-ok`, `.tunnel-status-error`, `:root[data-theme="dark"] .tunnel-status-error`, khối `@media dark` của nó (1071) |
| Workspace | mọi `.sql-*` (1084–1218), mọi `.mongo-*` (1219–1350), mọi `.redis-*` (1351–1482) |
| Tàn dư template | `.result`, `.row`, `.row-actions`, `.row-actions-left, .row-actions-right` |

Rule ở dòng 619–620 gộp hai chủ:

```css
.saved-item-readonly-badge svg,
.tab-lock svg {
  transform: translateY(-1px);
}
```

Cả hai class đều là của db, nên chuyển **cả rule** sang `db.css`, giữ nguyên doc comment ở trên nó.

- [ ] **Step 3: Xác nhận những gì ở lại `shell/App.css`**

`:root` và chín `:root[data-accent=*]`; `html, body`; `*::-webkit-scrollbar*`; `.app`, `.tab-bar`, `.brand*`, hai khối `@media (prefers-reduced-motion)`, `.tab`, `.tab:hover:not(.tab-active)`, `.tab-title`, `.tab-badge`, `.tab-active`, `.tab-close`, `.tab-new`, `.tab-content`, `.tab-panel`; `.visually-hidden`; `.select-new-option`, `.select-reload-option`, `.select-reload-option-spinning`; `.context-menu*`; `.muted`; `a`, `a:hover`, `input, button, textarea` và toàn bộ khối focus (1518–1592); `:root[data-theme="dark"]` (1593) và `@media (prefers-color-scheme: dark)` (1657).

`.muted` ở lại vì `components/ItemList` dùng nó. `.select-*` ở lại vì chúng là phụ kiện của primitive `Select`, dù hôm nay chỉ database dùng.

- [ ] **Step 4: Chuyển hai rule glass của database**

Cắt khỏi `src/shell/glass.css` hai rule `:root[data-glass="on"] .tab-readonly.tab-active` (dòng 251) và `:root[data-glass="on"] .saved-list-header` (dòng 260), kèm comment của chúng, và dán vào cuối `db.css` trong một khối `@supports` mới:

```css
/* Chỉ hai rule, nên khối `@supports` được viết lại ở đây thay vì để chúng trong `glass.css` của
   shell — cái giá của việc không có class nào của database ngoài file này. */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  /* … hai rule, nguyên văn … */
}
```

Thứ tự file không thành vấn đề ở đây: `:root[data-glass="on"] .tab-readonly.tab-active` đặc hiệu hơn `:root[data-glass="on"] .tab-active` mà nó phải thắng, và `.tab-readonly.tab-active` đặc hiệu hơn `.tab-active` — nên cả hai thắng bất kể ai được nạp trước.

- [ ] **Step 5: Import `db.css` từ module**

Ở cuối khối import của `src/modules/db/DbTab.tsx`:

```ts
import "./db.css";
```

- [ ] **Step 6: Đối chiếu số dòng**

```powershell
$before = (git show HEAD:src/App.css | Measure-Object -Line).Lines + (git show HEAD:src/glass.css | Measure-Object -Line).Lines
$after = (Get-Content src/shell/App.css | Measure-Object -Line).Lines + (Get-Content src/shell/glass.css | Measure-Object -Line).Lines + (Get-Content src/modules/db/db.css | Measure-Object -Line).Lines
"$before -> $after"
```
Expected: `after` lớn hơn `before` khoảng 10–25 dòng — đúng bằng phần thêm: `.tab-badge`, khối `@supports` viết lại trong `db.css`, và các dòng trắng ngăn nhóm. Chênh lệch âm hoặc lớn hơn 40 là đã mất hoặc nhân đôi rule.

- [ ] **Step 7: Kiểm biên giới CSS**

```powershell
Select-String -Path src/shell/App.css,src/shell/glass.css -Pattern "saved-|kind-|login-|workspace|sql-|mongo-|redis-|tunnel-|method-tab|field-"
```
Expected: **không dòng nào**.

- [ ] **Step 8: `npm run build`**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 9: Smoke test, và lần này nhìn kỹ**

Run: `npm run dev:app`, làm đủ 10 bước, rồi soi từng chỗ:
- Danh sách saved connection: khoảng cách, logo có tile màu, huy hiệu read-only.
- Form kết nối: bốn method tab, cảnh báo field, trạng thái tunnel.
- Workspace SQL: header, sidebar, thanh kéo, các tab nội dung.
- Workspace Mongo và Redis: y vậy.
- Bật/tắt Glass trong Settings ở cả light và dark: vạch trên tab đang mở, tiêu đề danh sách connection.
- Đổi accent sang vài màu: tab đang mở đổi màu, tab read-only vẫn hổ phách.

Expected: không lệch một pixel nào so với trước. Nếu lệch, nguyên nhân gần như chắc chắn là thứ tự nạp CSS — Vite quyết theo đồ thị import, và `db.css` bị nạp trước `App.css` vì `App.tsx` import `registry` trước khi import stylesheet của nó. Cách chữa: tăng độ đặc hiệu của rule db bị mất (thêm một class cha mà nó đã có trong DOM), **không** đảo thứ tự import — thứ tự đó là hệ quả của đồ thị, sửa nó ở đây sẽ vỡ lại lần sau.

- [ ] **Step 10: Commit**

```powershell
git add -A src
git commit -m "refactor(styles): split App.css by owner"
```

---

## Task 10: i18n — mỗi module giữ chữ của nó

**Files:**
- Create: `src/modules/db/i18n/en.ts`, `src/modules/db/i18n/vi.ts`, `src/i18n/dicts.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/vi.ts` (bỏ 24 nhóm), `src/i18n/index.tsx` (đọc từ `dicts.ts`)

**Interfaces:**
- Produces: `src/modules/db/i18n/en.ts` default export một object phẳng gồm 24 nhóm + nhóm `error` chỉ chứa key của database. `vi.ts` y hệt.
- Produces: `src/i18n/dicts.ts` exports `EN` và `VI` — hai từ điển đã ghép, hình dạng giống hệt `en` hôm nay.
- Produces: `TranslationKey` không đổi giá trị. **Không một chỗ gọi `t()` nào phải sửa.**

**Lưu ý về hình dạng export:** `src/i18n/en.ts` hôm nay là `const en = { … }; export default en;` (không phải named export như đoạn mã minh hoạ trong spec). `dicts.ts` phải import default cho khớp.

- [ ] **Step 1: Cắt 24 nhóm sang `modules/db/i18n/en.ts`**

Ở lại `src/i18n/en.ts`: `common`, `app`, `pagination`, `select`, `errorBanner`, `settings`, `update`, `error`.
Sang `src/modules/db/i18n/en.ts`: `connection`, `sql`, `structure`, `dbStats`, `renameDialog`, `collation`, `databaseDialog`, `tableDialog`, `columnDialog`, `indexDialog`, `query`, `lint`, `filterBar`, `sqlTable`, `insertRows`, `insertDocuments`, `mongo`, `collectionDialog`, `noSqlTable`, `redis`, `redisValue`, `redisGroup`, `tools`, `dump`.

```ts
/** What the database module calls things. Plain data, importing nothing — `src/i18n/dicts.ts`
 *  imports this, so anything imported back from `i18n/` would close a cycle. */
const dbEn = {
  connection: { /* … */ },
  // …
};

export default dbEn;
```

`src/i18n/en.ts` giữ `const en = { … }; export default en;` với tám nhóm còn lại.

- [ ] **Step 2: Chia nhóm `error`**

Nhóm `error` (dòng 897 của `en.ts`) là chỗ hai bên cùng đòi. Ở lại `i18n/en.ts`: `unknown`, `taskFailed`, `credentialStoreUnreachable`, và **mọi** key về SSH (`ssh*`, `knownHosts*`, `hostKey*` — `ssh/` là tầng chung). Sang `modules/db/i18n/en.ts` trong một nhóm `error` riêng: mọi key còn lại (driver, hàng, document, filter, dump, tools).

Cách chia không đoán: mỗi key `error.*` đối chiếu 1-1 với một `err!("error.x", …)` bên Rust. Với từng key, tìm nó:

```powershell
Select-String -Path src-tauri/src -Include *.rs -Recurse -Pattern 'error\.<key>'
```

`err!` ở `src-tauri/src/ssh/`, `secrets.rs` hay `error.rs` → key ở lại `i18n/`. `err!` ở `src-tauri/src/modules/db/` → key sang `modules/db/i18n/`. Key không thấy ở đâu (do frontend tự phát, ví dụ `error.unknown` trong `core/errors.ts`) → ở lại `i18n/`.

- [ ] **Step 3: Làm y vậy cho `vi.ts`**

`src/modules/db/i18n/vi.ts` phải có **đúng** tập key của `en.ts`, và `src/i18n/vi.ts` đúng tập key của `src/i18n/en.ts`. Hai nhóm phải khớp từng key: `TranslationKey` suy ra từ `en`, nên một key thiếu ở `vi` không phải lỗi biên dịch mà là một chuỗi hiện ra dưới dạng chính cái key của nó lúc chạy.

- [ ] **Step 4: Viết `src/i18n/dicts.ts`**

```ts
import shared from "./en";
import sharedVi from "./vi";
import dbEn from "../modules/db/i18n/en";
import dbVi from "../modules/db/i18n/vi";

/* The error catalogue is the one group more than one module contributes to — it matches 1-1 the
   keys `err!` emits on the Rust side, and Rust fails everywhere. Merged by hand, one line, so the
   type is still inferred. A flat spread would let the later `error` swallow the earlier one and
   lose a dozen keys without a word from anyone. */
export const EN = {
  ...shared,
  ...dbEn,
  error: { ...shared.error, ...dbEn.error },
};

export const VI = {
  ...sharedVi,
  ...dbVi,
  error: { ...sharedVi.error, ...dbVi.error },
};

/* Outside `error`, the two dictionaries must not name the same group twice — a clash loses keys
   with nobody the wiser. This is the net: clash and it does not compile. */
type Collision = Exclude<Extract<keyof typeof shared, keyof typeof dbEn>, "error">;
const _noCollision: [Collision] extends [never] ? true : never = true;
void _noCollision;
```

`void _noCollision;` là cần: `noUnusedLocals` sẽ báo lỗi biến không dùng nếu không có nó.

- [ ] **Step 5: Cho `index.tsx` đọc từ `dicts.ts`**

```ts
import { EN, VI } from "./dicts";

export type TranslationDict = typeof EN;
export type Language = "en" | "vi";

const DICTS: Record<Language, TranslationDict> = { en: EN, vi: VI };
```

Xoá hai dòng `import en from "./en"` / `import vi from "./vi"`.

- [ ] **Step 6: Thử lưới chặn**

Thêm tạm một nhóm trùng vào `src/modules/db/i18n/en.ts`:

```ts
  app: { closeTab: "x" },
```

Run: `npm run build`
Expected: FAIL, lỗi ở `src/i18n/dicts.ts` tại dòng `const _noCollision` — `Type 'boolean' is not assignable to type 'never'` hoặc tương đương. Xoá nhóm vừa thêm.

Đây là bước duy nhất chứng minh lưới chặn hoạt động; bỏ nó thì `Collision` chỉ là một dòng chưa ai thử.

- [ ] **Step 7: `npm run build` + `npm test`**

Run: `npm run build`
Expected: PASS. Bất kỳ `TS2345: Argument of type '"x.y"' is not assignable to parameter of type 'TranslationKey'` nghĩa là một key bị mất trong lúc cắt — tìm nó ở `git show HEAD:src/i18n/en.ts`.

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Đếm lại key**

```powershell
$old = (git show HEAD:src/i18n/en.ts | Select-String '^\s+\w+:' ).Count
$new = (Get-Content src/i18n/en.ts,src/modules/db/i18n/en.ts | Select-String '^\s+\w+:').Count
"$old -> $new"
```
Expected: `new` bằng `old` cộng 1 (nhóm `error` bị khai báo hai lần) cộng 24 nếu cách đếm này bắt cả dòng mở nhóm. Con số chính xác không quan trọng bằng việc **không nhỏ hơn** `old`; nhỏ hơn là đã mất key.

- [ ] **Step 9: Smoke test ngôn ngữ**

Run: `npm run dev:app`
Đổi sang tiếng Việt trong Settings, rồi đi qua: form kết nối, workspace SQL, tab Query, Structure, Statistics, Settings → Tools, và một thông báo lỗi (kết nối tới cổng sai để lấy một `AppError`).
Expected: không chỗ nào hiện ra một chuỗi dạng `connection.host` — đó là dấu hiệu key bị mất.

- [ ] **Step 10: Commit**

```powershell
git add -A src
git commit -m "refactor(i18n): let each module own its strings"
```

---

## Task 11: Tài liệu

Tài liệu hôm nay nói về một app database. Sau mười task trước nó nói sai về mọi thứ.

**Files:**
- Modify: `AGENT.md`, `.agent/architecture/overview.md`, `.agent/architecture/frontend.md`, `.agent/architecture/backend.md`, `.agent/conventions/adding-a-command.md`, `.agent/conventions/i18n.md`, `.agent/conventions/component-structure.md`
- Create: `.agent/conventions/adding-a-module.md`

- [ ] **Step 1: `AGENT.md`**

Sửa mục **Layout** thành cây thật:

```
src/
  main.tsx           Entry point
  shell/             Tab bar, [+] menu, shortcuts, Settings — knows no module
    module.ts        ModuleDefinition, ModuleTabProps, TabBadge
    registry.ts      MODULES, DEFAULT_MODULE_ID
  core/              Helpers no module owns and any module may use
  components/        Shared primitives only, one folder each
  icons/  i18n/      Shared icons and the dictionaries + dicts.ts
  modules/db/        The database module: DbTab, sql/, mysql/, postgres/,
                     mongo/, redis/, its own components/ and i18n/
src-tauri/src/
  lib.rs             Tauri builder; each module registers its own state
  error.rs  secrets.rs  ssh/    Shared
  modules/
    mod.rs           `handler()` — every command, one block per module
    db/              commands/, drivers/, models.rs, state.rs
```

Sửa câu **"There is no test suite and no linter config"** — nó đã sai từ trước lần refactor này. Thay bằng:

> `npm run build` là bước kiểm chứng nhanh nhất; TypeScript chạy `strict`, `noUnusedLocals` và `noUnusedParameters`, nên nó bắt phần lớn lỗi. `npm test` chạy vitest trên các module logic thuần. Không có cấu hình linter.

Thêm `| npm test | Run the vitest suite |` vào bảng Commands.

Thêm vào mục **Rules that matter most**:

> - **Không file nào ngoài `src/modules/<id>/` được biết khái niệm của module đó.** Thêm một module là [.agent/conventions/adding-a-module.md](.agent/conventions/adding-a-module.md).

- [ ] **Step 2: `.agent/architecture/overview.md`**

Đọc file, rồi sửa mọi chỗ nói `AppState` thành `modules::db::state::DbState`, mọi `commands.rs` thành `modules/db/commands/`, mọi `src-tauri/src/db/` thành `src-tauri/src/modules/db/drivers/`, `ssh_tunnel.rs` thành `ssh/mod.rs`. Thêm một đoạn ngắn ở đầu: app là một shell cộng các module, hôm nay có một module.

- [ ] **Step 3: `.agent/architecture/frontend.md`**

Viết lại mục cấu trúc theo cây mới, và thêm một mục về contract: `ModuleDefinition`, `ModuleTabProps`, `TabBadge`, và ba điều contract **cố tình không có** (lifecycle hook, persistence API, event bus) kèm lý do.

- [ ] **Step 4: `.agent/architecture/backend.md`**

Sửa cây, và thêm: state thuộc module (`register` gọi `.manage`), danh sách command là một vì Tauri chỉ nhận một `invoke_handler`, và mỗi khối của danh sách chỉ module đó sửa.

- [ ] **Step 5: `.agent/conventions/adding-a-command.md`**

"Năm chỗ" đã đổi chỗ. Sửa thành: `modules/db/commands/<engine>.rs` → một dòng ở `modules/mod.rs::handler()` → `modules/db/<engine>/api.ts` → chỗ gọi → key `error.*` ở `modules/db/i18n/`.

- [ ] **Step 6: `.agent/conventions/i18n.md`**

Thêm ràng buộc mới, nói rõ hậu quả:

> Từ điển của một module (`src/modules/<id>/i18n/`) phải là dữ liệu thuần và **không import gì từ `src/i18n/`**. `src/i18n/dicts.ts` import ngược từ `modules/`, nên vòng chỉ khép lại một cách vô hại khi điều này được giữ. Phá nó thì hậu quả là `undefined` lúc chạy, không phải lỗi biên dịch.
>
> Nhóm ở tầng trên cùng là phẳng và không được trùng giữa hai từ điển — trừ `error`, thứ duy nhất nhiều module cùng góp vào, và nó được ghép tay trong `dicts.ts`. `type Collision` ở cuối file đó là lưới chặn: trùng thì không biên dịch được.

- [ ] **Step 7: `.agent/conventions/component-structure.md`**

Thêm quy tắc phân loại: một component vào `src/components/` khi trong nó không có khái niệm của module nào **và** một module khác có lý do thật để dùng; nếu không, nó vào `src/modules/<id>/components/`. Nêu hai ví dụ đã quyết: `JsonView` qua được (REST client sẽ cần cho response body), `FilterBar` không (nó dựng từ danh sách toán tử của SQL và Mongo).

- [ ] **Step 8: Viết `.agent/conventions/adding-a-module.md`**

Một trang, nêu đúng các bước:

1. `src/modules/<id>/` với `index.ts` export một `ModuleDefinition`, và một component nhận `ModuleTabProps`.
2. Một dòng trong `MODULES` ở `src/shell/registry.ts`.
3. `src/modules/<id>/i18n/en.ts` + `vi.ts`, thêm vào `src/i18n/dicts.ts` (và vào phần ghép `error` nếu module phát lỗi).
4. Nếu cần state hay command bên Rust: `src-tauri/src/modules/<id>/` với `pub fn register`, một dòng `modules::<id>::register(builder)` trong `lib.rs`, và một khối trong `modules::handler()`.
5. Nếu cần một mục trong Settings: `settings` trong `ModuleDefinition`.
6. CSS toàn cục của module vào `src/modules/<id>/<id>.css`, import từ component tab của nó.
7. `[+]` tự thành menu khi `MODULES.length > 1` — nhánh đó chưa từng chạy, nên module thứ hai là lần đầu nó được thử. Kiểm nó.

- [ ] **Step 9: Đọc lại**

Đi qua từng file đã sửa, kiểm mọi đường dẫn nó nhắc có thật:

```powershell
Select-String -Path AGENT.md,.agent/**/*.md -Pattern "src/[a-zA-Z/.]*" -AllMatches | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
```
Rồi kiểm tay từng đường dẫn trong danh sách đó có tồn tại.

- [ ] **Step 10: Commit**

```powershell
git add -A AGENT.md .agent
git commit -m "docs(agent): describe the module layout"
```

---

## Xong rồi thì kiểm nốt

Sau task 11, chạy một lượt cuối:

- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` — PASS
- [ ] `npm run build` — PASS
- [ ] `npm test` — PASS
- [ ] `npm run build:app` — PASS (chỉ ở đây mới biết bundle production còn dựng được)
- [ ] Cài bản vừa build lên đè bản cũ, mở app, kiểm mọi saved connection còn nguyên **kể cả password**. Đây là bước duy nhất chứng minh không có migration nào bị bỏ sót.
- [ ] `git diff --stat 36bd5c9..HEAD -- CHANGELOG.md` — rỗng. Có dòng nào tức là đã làm sai gì đó.
