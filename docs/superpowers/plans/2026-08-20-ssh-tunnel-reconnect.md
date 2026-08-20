# SSH tunnel tự phục hồi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một connection đi qua SSH tunnel, để yên hàng giờ rồi quay lại, vẫn dùng được tiếp — tunnel tự mở phiên SSH mới sau lưng đúng cổng local cũ, người dùng thấy một banner nói rõ chuyện gì đang xảy ra, và lệnh đọc gặp đúng lúc đứt được chạy lại một lần.

**Architecture:** `TcpListener` và cổng nó bind không bao giờ bị thay; chỉ phiên SSH phía sau được mở lại. Nhờ vậy pool của sqlx, `ConnectionManager` của Redis và client của Mongo tự khỏi mà không cần biết gì — `state.rs`, `connect_db` và các file lệnh không đổi một dòng nào cho việc hồi phục. `Tunnel` đổi từ một `JoinHandle` trần thành `Arc<TunnelInner>` + hai task (accept và watch); mọi chỗ cần phiên đi qua một hàm `session()` duy nhất, có khoá và có cooldown. Sự kiện đi lên frontend qua callback + `app.emit`, đúng lối `transfer://progress` đã có.

**Tech Stack:** Rust (russh 0.62.5, sqlx 0.9.0, tokio, Tauri 2), TypeScript strict + React 19 + CSS Modules, vitest.

**Spec:** [docs/superpowers/specs/2026-08-20-ssh-tunnel-reconnect-design.md](../specs/2026-08-20-ssh-tunnel-reconnect-design.md) — kế hoạch này thực hiện toàn bộ spec, mục 1 đến mục 7.

---

## Global Constraints

- **Cổng local không bao giờ thay.** Đây là quyết định nền của spec. Không có task nào được bind lại `TcpListener`, và không task nào được sửa `state.rs` ngoài việc bỏ một dòng `#[allow(dead_code)]`.
- **Không tự chạy lại lệnh ghi.** `retry_read!` chỉ được đặt lên đúng 16 lệnh đọc liệt kê ở Task 3. Không `query`, không `run_script`, không `update_row`/`insert_rows`/`delete_rows`, không DDL, không `dump`/`restore`, không `validate_sql`.
- **Không đụng pool.** `MySqlPoolOptions`/`PgPoolOptions` giữ nguyên `max_connections(5)` và không thêm dòng nào — mặc định sqlx 0.9 đã là `test_before_acquire: true`, `acquire_timeout` 30s, `idle_timeout` 10 phút, `max_lifetime` 30 phút. Xem mục 4 của spec.
- **Không đụng known-hosts / TOFU.** Phiên mở lại đi qua `authenticate` cũ, dựng `TunnelHandler` mới mỗi lần — máy chủ đổi khoá giữa chừng vẫn bị từ chối như thường.
- **Mongo và Redis không cần gì thêm ở tầng driver.** Chúng đã tự thử lại lệnh đọc. Task 5 vẫn gắn banner cho cả hai workspace, vì chúng vẫn đi qua tunnel.
- **Mỗi chuỗi hiển thị nằm ở cả `en.ts` và `vi.ts`.** Khoá `error.*` do `src-tauri/src/ssh/` phát ra đi vào `src/i18n/`; khoá do `src-tauri/src/modules/db/` phát ra đi vào `src/modules/db/i18n/`. Ký tự không phải ASCII viết dưới dạng escape trong tiếng Anh (`—`, `…`), chữ tiếng Việt viết thẳng. Xem [.agent/conventions/i18n.md](../../../.agent/conventions/i18n.md).
- **Lệnh backend mới phải được đăng ký** trong `modules::handler()` ở `src-tauri/src/modules/mod.rs`. Không có gì ở build time nhắc bước này. Xem [.agent/conventions/adding-a-command.md](../../../.agent/conventions/adding-a-command.md).
- **Component ở thư mục riêng** kèm `index.ts`, theo [.agent/conventions/component-structure.md](../../../.agent/conventions/component-structure.md).
- **Mỗi task một dòng CHANGELOG** dưới `## [Unreleased]`, `### Added` — bản có lỗi này chưa phát hành nên không dùng `### Fixed`. Xem [.agent/conventions/changelog.md](../../../.agent/conventions/changelog.md).
- **Chỉ commit khi được yêu cầu.** Người dùng có chỉ thị thường trực: không commit khi chưa được bảo, và một lần yêu cầu chỉ cho phép một commit. Bước "Commit" trong mỗi task ghi sẵn câu commit **để dùng khi được yêu cầu**, không phải để tự chạy.
- Commit message có prefix và scope, không có trailer `Co-Authored-By`.
- Kiểm tra: `cargo check --manifest-path src-tauri/Cargo.toml`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm test`, `npm run build`.

---

## Hằng số và tên dùng chung

Bốn task backend dùng chung bộ tên này. Chúng được định nghĩa ở Task 1; các task sau chỉ đọc.

| Tên | Giá trị | Ở đâu | Nghĩa |
| --- | --- | --- | --- |
| `KEEPALIVE_INTERVAL` | 15s | `ssh/mod.rs` | Nhịp russh gửi gói giữ phiên |
| `KEEPALIVE_MAX` | 3 | `ssh/mod.rs` | Số lần không trả lời trước khi russh kết thúc phiên (~45s) |
| `RETRY_COOLDOWN` | 3s | `ssh/mod.rs` | Khoảng nghỉ tối thiểu giữa hai lần xác thực |
| `WATCH_IDLE` | 15s | `ssh/mod.rs` | Nhịp watcher khi mọi thứ đang ổn |
| `WATCH_MIN` | 5s | `ssh/mod.rs` | Nhịp ngay sau lần hỏng đầu tiên |
| `WATCH_MAX` | 60s | `ssh/mod.rs` | Trần của backoff |
| `TUNNEL_STATE_EVENT` | `"tunnel://state"` | `commands/mod.rs`, `tunnel.ts` | Tên sự kiện |
| `error.sshUnavailable` | — | `src/i18n/` | Tunnel đang không mở, đang trong cooldown |
| `error.connectionLost` | — | `src/modules/db/i18n/` | Đường ống đứt, không phải máy chủ từ chối |
| `error.noTunnel` | — | `src/modules/db/i18n/` | Connection này không đi qua tunnel |

---

## Task 1: Tunnel giữ phiên sống và tự mở lại phiên mới

**Files:**
- Modify: `src-tauri/src/ssh/mod.rs` (imports, hằng số, `client::Config`, `Tunnel`, `open_tunnel`, `bridge_connection`, `mod tests`)
- Modify: `src-tauri/src/modules/db/commands/mod.rs:82-94` (`resolve_endpoint`), `:96-198` (`connect_db`), và thêm `TUNNEL_STATE_EVENT` + `tunnel_notify`
- Modify: `src/i18n/en.ts`, `src/i18n/vi.ts` (khoá `error.sshUnavailable`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces:
  - `pub enum ssh::TunnelEvent { Reconnecting, Reconnected, Failed(AppError) }`
  - `pub type ssh::TunnelNotify = Arc<dyn Fn(TunnelEvent) + Send + Sync>`
  - `pub struct ssh::TunnelSession` với `pub async fn reconnect(&self) -> Result<(), AppError>`
  - `impl ssh::Tunnel { pub fn session_handle(&self) -> TunnelSession }`
  - `ssh::open_tunnel(ssh, remote_host, remote_port, app_data, notify: TunnelNotify) -> Result<(u16, Tunnel), AppError>` — thêm tham số thứ năm
  - `fn ssh::next_backoff(current: Duration, ok: bool) -> Duration` (private, có test)
  - `commands::TUNNEL_STATE_EVENT: &str`, `commands::tunnel_notify(app: &AppHandle, id: &str) -> ssh::TunnelNotify`

---

- [ ] **Step 1: Viết test thất bại cho `next_backoff`**

Thêm vào cuối `mod tests` trong `src-tauri/src/ssh/mod.rs` (ngay sau `an_unreadable_store_is_treated_as_empty`), và sửa dòng `use super::...` ở đầu `mod tests` thành:

```rust
    use super::{known_hosts_file, load_known_hosts, next_backoff, remember_host};
    use super::{WATCH_IDLE, WATCH_MAX, WATCH_MIN};
    use std::time::Duration;
```

Test:

```rust
    /// Nhịp của watcher. Thành công thì về nhịp nghỉ; hỏng lần đầu xuống nhịp nhanh nhất rồi giãn
    /// dần gấp đôi tới trần — và ở lại trần thay vì quay về nhịp nhanh.
    #[test]
    fn the_watcher_backs_off_while_the_tunnel_stays_down() {
        // Đang ổn thì mỗi nhịp là WATCH_IDLE, dù trước đó vừa hỏng ở nhịp nào.
        assert_eq!(next_backoff(WATCH_IDLE, true), WATCH_IDLE);
        assert_eq!(next_backoff(WATCH_MIN, true), WATCH_IDLE);
        assert_eq!(next_backoff(WATCH_MAX, true), WATCH_IDLE);

        // Lần hỏng đầu tiên — nhịp hiện tại đang là nhịp nghỉ — thử lại nhanh.
        assert_eq!(next_backoff(WATCH_IDLE, false), WATCH_MIN);

        // Rồi gấp đôi.
        assert_eq!(next_backoff(WATCH_MIN, false), Duration::from_secs(10));
        assert_eq!(next_backoff(Duration::from_secs(10), false), Duration::from_secs(20));

        // Chạm trần thì dừng ở trần, không vượt và không quay về WATCH_MIN.
        assert_eq!(next_backoff(Duration::from_secs(40), false), WATCH_MAX);
        assert_eq!(next_backoff(WATCH_MAX, false), WATCH_MAX);
    }
```

- [ ] **Step 2: Chạy test để chắc nó hỏng**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml the_watcher_backs_off
```

Kỳ vọng: **không biên dịch được** — `cannot find function next_backoff in module super`, và ba hằng số cũng chưa có.

- [ ] **Step 3: Thêm imports và hằng số vào `ssh/mod.rs`**

Sửa khối `use` ở đầu file (dòng 1-10) — thêm `Instant` và một alias cho `Mutex` bất đồng bộ, giữ nguyên `std::sync::Mutex` mà `TunnelHandler.refused` đang dùng:

```rust
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;
```

Thêm ngay sau `const CHANNEL_OPEN_TIMEOUT` (dòng 32):

```rust
/// Nhịp russh gửi một gói giữ phiên khi đường đang im.
///
/// 15 giây: đủ ngắn để đi trước idle timeout của một NAT gia đình (thường 300 giây) và trước
/// `ClientAliveInterval` của sshd; đủ dài để một phiên để không cả ngày cũng chỉ tốn vài trăm byte.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);

/// Số lần liên tiếp không được trả lời trước khi russh kết thúc phiên — cũng là mặc định của nó.
/// Nhân với nhịp trên, một đường chết bị phát hiện trong khoảng 45 giây.
const KEEPALIVE_MAX: usize = 3;

/// Khoảng nghỉ tối thiểu sau một lần xác thực hỏng.
///
/// Không có nó, một pool đang cố mở kết nối trong lúc mạng chết sẽ bắn hàng chục lần xác thực mỗi
/// phút vào một sshd có `MaxAuthTries` — và có thể có fail2ban.
const RETRY_COOLDOWN: Duration = Duration::from_secs(3);

/// Nhịp watcher kiểm tra phiên khi mọi thứ đang ổn.
const WATCH_IDLE: Duration = Duration::from_secs(15);

/// Nhịp ngay sau lần hỏng đầu tiên, trước khi giãn dần.
const WATCH_MIN: Duration = Duration::from_secs(5);

/// Trần của backoff: máy chủ SSH thật sự không tới được thì thử một phút một lần, không hơn.
const WATCH_MAX: Duration = Duration::from_secs(60);
```

- [ ] **Step 4: Viết `next_backoff`**

Thêm ngay sau các hằng số:

```rust
/// Nhịp chờ kế tiếp của watcher.
///
/// So sánh bằng `==` chứ không phải `>=`: `WATCH_MAX` lớn hơn `WATCH_IDLE`, nên một điều kiện
/// "lớn hơn hoặc bằng nhịp nghỉ" sẽ kéo cả nhịp trần về `WATCH_MIN` và biến backoff thành một vòng
/// lặp. `WATCH_IDLE` chỉ được đặt khi thành công, nên so bằng là chính xác.
fn next_backoff(current: Duration, ok: bool) -> Duration {
    if ok {
        return WATCH_IDLE;
    }
    if current == WATCH_IDLE {
        return WATCH_MIN;
    }
    (current * 2).min(WATCH_MAX)
}
```

- [ ] **Step 5: Chạy test để chắc nó qua**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml the_watcher_backs_off
```

Kỳ vọng: PASS.

- [ ] **Step 6: Bật keepalive trong `authenticate_inner`**

Sửa `client::Config` (dòng 163-170) thành:

```rust
    let config = Arc::new(client::Config {
        // Nagle's algorithm holds a small write back waiting for more to go with it, which is
        // exactly wrong under a forward: what is being delayed is usually a database's reply, and
        // nothing else is coming until the client has seen it. russh leaves it on by default.
        nodelay: true,
        window_size: WINDOW_SIZE,
        // russh mặc định không gửi gì cả (`keepalive_interval: None`), nên một phiên để không sẽ
        // bị NAT hoặc sshd bỏ rơi mà không ai biết — và `is_closed()` không bao giờ thành `true`.
        // Bật lên vừa giữ phiên sống, vừa là thứ duy nhất phát hiện được đường đã chết.
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: KEEPALIVE_MAX,
        // `inactivity_timeout` giữ nguyên `None`: nó đóng phiên khi không có traffic, đúng thứ
        // đang muốn tránh.
        ..client::Config::default()
    });
```

- [ ] **Step 7: Thay `Tunnel` bằng phiên có thể mở lại**

Thay toàn bộ khối `pub struct Tunnel { task: JoinHandle<()> }` và `impl Drop for Tunnel` (dòng 77-91) bằng:

```rust
/// Chuyện đang xảy ra với một tunnel, cho ai muốn nói lại với người dùng.
///
/// `ssh/` không biết gì về Tauri — nó nhận một callback và gọi, còn việc biến thành sự kiện của
/// cửa sổ là việc của `commands/mod.rs`.
pub enum TunnelEvent {
    Reconnecting,
    Reconnected,
    Failed(AppError),
}

pub type TunnelNotify = Arc<dyn Fn(TunnelEvent) + Send + Sync>;

/// Phiên SSH đang dùng, và dấu vết của lần mở gần nhất.
struct SessionSlot {
    /// `None` nghĩa là chưa có phiên nào, hoặc lần mở lại gần nhất thất bại.
    handle: Option<Arc<client::Handle<TunnelHandler>>>,
    /// Khi phiên hiện tại được mở. Một phiên trẻ hơn `RETRY_COOLDOWN` không bị vứt đi vì một lần
    /// mở channel hỏng: máy chủ từ chối forward thẳng thừng (`PermitOpen`, `AllowTcpForwarding no`)
    /// thì mọi lần đều hỏng, và xác thực lại cho từng kết nối bị từ chối chỉ tổ nện máy chủ.
    opened_at: Option<Instant>,
    /// Lần thất bại gần nhất, để không nện máy chủ SSH bằng một chuỗi xác thực hỏng.
    failed_at: Option<Instant>,
}

/// Tất cả những gì cần để mở lại phiên, dùng chung bởi vòng accept, watcher, và mọi task bridge.
struct TunnelInner {
    ssh: SshConfig,
    remote_host: String,
    remote_port: u16,
    app_data: PathBuf,
    notify: TunnelNotify,
    session: AsyncMutex<SessionSlot>,
}

impl TunnelInner {
    /// Phiên đang dùng, mở lại nếu phiên cũ đã chết.
    ///
    /// Khoá giữ suốt lần xác thực là cố ý: pool mở năm kết nối cùng lúc thì cả năm dừng lại sau
    /// **một** lần `authenticate`, không phải năm lần. Cái giá là khi đang mở lại, mọi kết nối mới
    /// qua tunnel này chờ tối đa `CONNECT_TIMEOUT` (10 giây) — nằm gọn trong `acquire_timeout` 30
    /// giây mặc định của sqlx.
    async fn session(&self) -> Result<Arc<client::Handle<TunnelHandler>>, AppError> {
        let mut slot = self.session.lock().await;
        if let Some(handle) = slot.handle.as_ref().filter(|handle| !handle.is_closed()) {
            return Ok(Arc::clone(handle));
        }
        if let Some(at) = slot.failed_at {
            if at.elapsed() < RETRY_COOLDOWN {
                return Err(err!("error.sshUnavailable"));
            }
        }

        (self.notify)(TunnelEvent::Reconnecting);
        match authenticate(&self.ssh, &self.app_data).await {
            Ok(session) => {
                let handle = Arc::new(session);
                *slot = SessionSlot {
                    handle: Some(Arc::clone(&handle)),
                    opened_at: Some(Instant::now()),
                    failed_at: None,
                };
                (self.notify)(TunnelEvent::Reconnected);
                Ok(handle)
            }
            Err(e) => {
                *slot = SessionSlot {
                    handle: None,
                    opened_at: None,
                    failed_at: Some(Instant::now()),
                };
                (self.notify)(TunnelEvent::Failed(e.clone()));
                Err(e)
            }
        }
    }

    /// Vứt phiên hiện tại đi, để lần `session()` kế tiếp mở phiên mới.
    ///
    /// `is_closed()` là đường phát hiện nhanh, không phải đường duy nhất: một phiên vừa chết có thể
    /// chưa kịp báo, và cái hỏng đầu tiên là `channel_open_direct_tcpip`. Cooldown ở đây chặn
    /// trường hợp ngược lại — phiên còn sống nhưng máy chủ từ chối forward, khi đó mở phiên mới
    /// không giúp được gì và không được phép lặp lại cho từng kết nối.
    async fn forget_session(&self) {
        let mut slot = self.session.lock().await;
        if slot.opened_at.is_none_or(|at| at.elapsed() >= RETRY_COOLDOWN) {
            slot.handle = None;
            slot.opened_at = None;
        }
    }
}

/// A running port forward, torn down as soon as this is dropped.
///
/// The tasks cannot be held as bare `JoinHandle`s: dropping one of those detaches the task rather
/// than stopping it. Every connection attempt that failed *after* the tunnel came up — a mistyped
/// database password, say — would then leave an authenticated SSH session and a bound local port
/// running for the life of the process, with nothing left holding a handle to either.
pub struct Tunnel {
    inner: Arc<TunnelInner>,
    accept: JoinHandle<()>,
    watch: JoinHandle<()>,
}

impl Tunnel {
    /// Một tay cầm rẻ tới cùng phiên, để người gọi mở lại được mà không phải giữ cái khoá mà
    /// `Tunnel` đang nằm sau — xác thực mất tới 10 giây, và bản đồ connection không được khoá lâu
    /// như thế. Xem `commands::tunnel_reconnect`.
    pub fn session_handle(&self) -> TunnelSession {
        TunnelSession(Arc::clone(&self.inner))
    }
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        self.accept.abort();
        self.watch.abort();
    }
}

/// Mở lại phiên theo yêu cầu của người dùng, không chờ hết nhịp backoff.
pub struct TunnelSession(Arc<TunnelInner>);

impl TunnelSession {
    pub async fn reconnect(&self) -> Result<(), AppError> {
        // Xoá dấu thất bại trước, nếu không lần gọi ngay sau một lần hỏng sẽ rơi vào cooldown và
        // nút *Thử lại* không làm gì cả.
        {
            let mut slot = self.0.session.lock().await;
            slot.failed_at = None;
        }
        self.0.session().await.map(|_| ())
    }
}
```

- [ ] **Step 8: Viết lại `open_tunnel`**

Thay toàn bộ thân `open_tunnel` (dòng 248-287, kể cả chữ ký) bằng:

```rust
pub async fn open_tunnel(
    ssh: &SshConfig,
    remote_host: &str,
    remote_port: u16,
    app_data: &Path,
    notify: TunnelNotify,
) -> Result<(u16, Tunnel), AppError> {
    // Lần xác thực đầu đứng ngoài `session()`: nó phải hỏng ra ngoài cho `connect_db` thấy, và
    // không có gì để báo "đang kết nối lại" khi chưa từng có kết nối nào.
    let session = authenticate(ssh, app_data).await?;

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| err!("error.cannotBindTunnelPort", message = e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| err!("error.cannotBindTunnelPort", message = e))?
        .port();

    let inner = Arc::new(TunnelInner {
        ssh: ssh.clone(),
        remote_host: remote_host.to_string(),
        remote_port,
        app_data: app_data.to_path_buf(),
        notify,
        session: AsyncMutex::new(SessionSlot {
            handle: Some(Arc::new(session)),
            opened_at: Some(Instant::now()),
            failed_at: None,
        }),
    });

    let accept: JoinHandle<()> = tokio::spawn({
        let inner = Arc::clone(&inner);
        async move {
            loop {
                let (local_stream, _) = match listener.accept().await {
                    Ok(pair) => pair,
                    Err(_) => break,
                };
                // A DB connection pool (or multiple in-flight queries) can hold several physical
                // connections open at once, so each accepted local connection gets its own
                // bridging task instead of being handled inline — an inline loop would block
                // `accept()` for as long as that one connection stays open, starving every other
                // connection the pool tries to establish through this tunnel.
                let inner = Arc::clone(&inner);
                tokio::spawn(async move {
                    bridge_connection(&inner, local_stream).await;
                });
            }
        }
    });

    // Chỉ mở lại khi có ai đó gõ cửa thì banner chỉ hiện sau khi người dùng đã bấm vào một thứ và
    // chờ. Watcher làm tab tự lành: máy tính ngủ dậy, đường mạng về, và banner đã chuyển sang "đã
    // kết nối lại" trước khi người dùng chạm vào gì.
    let watch: JoinHandle<()> = tokio::spawn({
        let inner = Arc::clone(&inner);
        async move {
            let mut wait = WATCH_IDLE;
            loop {
                tokio::time::sleep(wait).await;
                let dead = {
                    let slot = inner.session.lock().await;
                    slot.handle.as_ref().is_none_or(|handle| handle.is_closed())
                };
                if !dead {
                    wait = WATCH_IDLE;
                    continue;
                }
                wait = next_backoff(wait, inner.session().await.is_ok());
            }
        }
    });

    Ok((local_port, Tunnel { inner, accept, watch }))
}
```

- [ ] **Step 9: Viết lại `bridge_connection`**

Thay toàn bộ `bridge_connection` (dòng 289-330) bằng:

```rust
async fn bridge_connection(inner: &Arc<TunnelInner>, mut local_stream: tokio::net::TcpStream) {
    let channel = match open_channel(inner).await {
        Some(channel) => channel,
        None => {
            // Phiên trông còn sống mà không phải. Vứt nó đi rồi thử đúng một lần nữa với phiên
            // mới, trước khi buông socket local.
            inner.forget_session().await;
            match open_channel(inner).await {
                Some(channel) => channel,
                // Either the SSH server rejected/never answered the forward request (e.g. it
                // can't reach remote_host:remote_port itself, or AllowTcpForwarding/PermitOpen
                // blocks it). Drop this local connection so the DB client sees a closed socket
                // instead of hanging indefinitely.
                None => return,
            }
        }
    };

    // The same reasoning as the SSH socket's `nodelay`, for the hop between the app and whatever
    // the local end of the forward is: a driver's query has nothing following it, so there is
    // never anything to be gained by holding it back.
    let _ = local_stream.set_nodelay(true);

    // Both directions at once, rather than a `select!` that could only ever be carrying one of
    // them: a dump is one long download whose acknowledgements travel the other way, and a restore
    // is the same in reverse. Copying them in turn made each wait on the other.
    //
    // The copy also ends the way the hand-written loop did — one side reaching EOF shuts the other
    // side's write half down, which is the SSH channel's EOF, and the transfer in the other
    // direction is allowed to finish before the channel is dropped.
    let mut remote_stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional_with_sizes(
        &mut local_stream,
        &mut remote_stream,
        BRIDGE_BUFFER,
        BRIDGE_BUFFER,
    )
    .await;
}

/// Một lần thử mở channel forward trên phiên hiện tại. `None` là hỏng, không nói vì sao — người
/// gọi chỉ có hai lựa chọn, thử lại hoặc buông.
async fn open_channel(inner: &Arc<TunnelInner>) -> Option<russh::Channel<client::Msg>> {
    let session = inner.session().await.ok()?;
    let opened = timeout(
        CHANNEL_OPEN_TIMEOUT,
        session.channel_open_direct_tcpip(
            inner.remote_host.clone(),
            inner.remote_port as u32,
            "127.0.0.1",
            0,
        ),
    )
    .await;
    match opened {
        Ok(Ok(channel)) => Some(channel),
        Ok(Err(_)) | Err(_) => None,
    }
}
```

- [ ] **Step 10: Dựng sự kiện `tunnel://state` ở `commands/mod.rs`**

Thêm sau `const TRANSFER_PROGRESS_EVENT` (dòng 38):

```rust
/// Where a workspace listens for its SSH tunnel dropping and coming back. Named here and in
/// `src/modules/db/tunnel.ts`.
const TUNNEL_STATE_EVENT: &str = "tunnel://state";
```

Thêm sau `struct TransferProgress` / `fn reporter` (sau dòng 62):

```rust
/// Một tin về tunnel của một connection, gửi lên cửa sổ.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TunnelState {
    id: String,
    /// `"reconnecting"`, `"reconnected"` hoặc `"failed"` — cùng bộ chữ với `TunnelState` bên
    /// TypeScript.
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<AppError>,
}

/// Hands every turn of one connection's tunnel to the window, on [`TUNNEL_STATE_EVENT`].
fn tunnel_notify(app: &AppHandle, id: &str) -> ssh::TunnelNotify {
    let app = app.clone();
    let id = id.to_string();
    Arc::new(move |event: ssh::TunnelEvent| {
        let (state, error) = match event {
            ssh::TunnelEvent::Reconnecting => ("reconnecting", None),
            ssh::TunnelEvent::Reconnected => ("reconnected", None),
            ssh::TunnelEvent::Failed(e) => ("failed", Some(e)),
        };
        // A dropped notice is not worth failing anything over: the watcher says it again on its
        // next round.
        let _ = app.emit(
            TUNNEL_STATE_EVENT,
            TunnelState { id: id.clone(), state, error },
        );
    })
}
```

- [ ] **Step 11: Cho `resolve_endpoint` và `connect_db` mang `notify`**

Sửa `resolve_endpoint` (dòng 82-94):

```rust
async fn resolve_endpoint(
    config: &ConnectionConfig,
    app_data: &std::path::Path,
    notify: ssh::TunnelNotify,
) -> Result<(String, u16, Option<ssh::Tunnel>), AppError> {
    match &config.ssh {
        Some(ssh) => {
            let (local_port, tunnel) =
                ssh::open_tunnel(ssh, &config.host, config.port, app_data, notify).await?;
            Ok(("127.0.0.1".to_string(), local_port, Some(tunnel)))
        }
        None => Ok((config.host.clone(), config.port, None)),
    }
}
```

Trong `connect_db`, thay dòng 102 (`let app_data = ...`) bằng:

```rust
    let app_data = app_data_dir(&app)?;
    // Id sinh ở đây chứ không phải sau khi đã kết nối: closure báo tin cần biết nó tên gì, và
    // tunnel bắt đầu báo tin ngay khi nó được mở.
    let id = Uuid::new_v4().to_string();
    let notify = tunnel_notify(&app, &id);
```

Thay bốn lời gọi trong `match config.kind` (số dòng bên dưới là của file **trước** khi chèn hai dòng trên, nên hãy tìm theo nhánh chứ đừng tìm theo số):

- nhánh `DbKind::Mysql` (dòng 105) → `let (host, port, tunnel) = resolve_endpoint(&config, &app_data, Arc::clone(&notify)).await?;`
- nhánh `DbKind::Postgres` (dòng 124) → `let (host, port, tunnel) = resolve_endpoint(&config, &app_data, Arc::clone(&notify)).await?;`
- nhánh `DbKind::Mongo` (dòng 156) → `let (local_port, task) = ssh::open_tunnel(ssh, &host, port, &app_data, Arc::clone(&notify)).await?;`
- nhánh `DbKind::Redis` (dòng 166) → `let (host, port, tunnel) = resolve_endpoint(&config, &app_data, Arc::clone(&notify)).await?;`

Và xoá dòng `let id = Uuid::new_v4().to_string();` đứng ngay sau khối `match` (dòng 187 của file cũ), vì id đã sinh ở đầu hàm.

- [ ] **Step 12: Thêm khoá `error.sshUnavailable` vào hai từ điển dùng chung**

`src/i18n/en.ts`, trong nhóm `error`, ngay sau `cannotSaveKnownHost`:

```ts
    sshUnavailable:
      "The SSH tunnel is not open at the moment — MixDB is trying to open it again.",
```

`src/i18n/vi.ts`, cùng chỗ:

```ts
    sshUnavailable: "Tunnel SSH hiện không mở — MixDB đang thử mở lại.",
```

- [ ] **Step 13: Kiểm tra**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

Kỳ vọng: `cargo test` PASS (gồm `the_watcher_backs_off_while_the_tunnel_stays_down` và hai test known-hosts cũ); `npm run build` PASS.

- [ ] **Step 14: Một dòng CHANGELOG**

Trong `CHANGELOG.md`, đặt lên **đầu** `### Added` của `## [Unreleased]` — dòng đầu là headline của bản phát hành, và đây là thay đổi lớn nhất trong đó:

```markdown
- A connection over an SSH tunnel now heals itself: the tunnel keeps its session alive and opens a new one behind the same local port when it drops.
```

- [ ] **Step 15: Commit** *(chỉ khi được yêu cầu)*

```bash
git add src-tauri/src/ssh/mod.rs src-tauri/src/modules/db/commands/mod.rs src/i18n/en.ts src/i18n/vi.ts CHANGELOG.md
git commit -m "feat(ssh): keep the tunnel alive and reopen its session"
```

---

## Task 2: Phân biệt mất kết nối với lỗi máy chủ

**Files:**
- Modify: `src-tauri/src/modules/db/drivers/mysql.rs` (thêm `lost_connection`/`map_error`, thay 31 chỗ), `mysql_structure.rs` (10 chỗ), `mysql_script.rs` (4 chỗ)
- Modify: `src-tauri/src/modules/db/drivers/postgres.rs` (thêm `map_error`, thay 26 chỗ), `postgres_ddl.rs` (8), `postgres_script.rs` (4), `postgres_structure.rs` (5)
- Modify: `src/modules/db/i18n/en.ts`, `src/modules/db/i18n/vi.ts` (khoá `error.connectionLost`)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: không gì từ Task 1.
- Produces:
  - `pub(super) fn drivers::mysql::map_error(e: sqlx::Error) -> AppError`
  - `pub(super) fn drivers::postgres::map_error(e: sqlx::Error) -> AppError`
  - mã lỗi `"error.connectionLost"`, thứ mà Task 3 so sánh chuỗi để quyết định chạy lại.

**Hai chỗ cố ý KHÔNG thay** — chúng *mở* kết nối chứ không dùng một kết nối đang mở, nên hỏng ở đó là "không kết nối được", không phải "mất kết nối", và nguyên văn của driver (`connection refused`, tên máy không phân giải được) chính là thứ đáng đọc:

1. `drivers/mysql.rs`, `connect()` — dòng 42, `.map_err(|e| err!("error.mysql", message = e))` giữ nguyên.
2. `drivers/postgres.rs`, `Pools::pool()` — chỗ `PgPoolOptions::new()...connect_with(...)`, giữ nguyên. Đây cũng là đường mà `connect()` đi qua (nó gọi `pools.pool(None)`), nên giữ nguyên chỗ này là giữ cả hai.

---

- [ ] **Step 1: Viết test thất bại cho `lost_connection` và `map_error` (MySQL)**

Thêm vào cuối `src-tauri/src/modules/db/drivers/mysql.rs` (file chưa có `mod tests`; nếu đã có thì thêm vào trong đó):

```rust
#[cfg(test)]
mod tests {
    use super::{lost_connection, map_error};

    /// `Database(_)` không dựng được ở đây — `sqlx::error::DatabaseError` là một trait và bản cài
    /// đặt của MySQL không public — nên hai biến thể "máy chủ đã trả lời" dùng để thay thế là
    /// `RowNotFound` và `Protocol`. Điều cần giữ vẫn là điều đó: một lỗi máy chủ đã trả lời thì
    /// không bao giờ được biến thành "mất kết nối", vì như thế lệnh đọc sẽ bị chạy lại vô ích và
    /// người dùng bị nói sai chuyện gì đã xảy ra.
    #[test]
    fn only_a_broken_pipe_counts_as_a_lost_connection() {
        let eof = sqlx::Error::Io(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "expected to read 4 bytes, got 0 bytes at EOF",
        ));
        assert!(lost_connection(&eof));
        assert!(lost_connection(&sqlx::Error::PoolTimedOut));
        assert!(lost_connection(&sqlx::Error::PoolClosed));

        assert!(!lost_connection(&sqlx::Error::RowNotFound));
        assert!(!lost_connection(&sqlx::Error::Protocol("unexpected packet".into())));
    }

    #[test]
    fn a_lost_connection_gets_its_own_code_and_carries_no_driver_text() {
        let eof = sqlx::Error::Io(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "expected to read 4 bytes, got 0 bytes at EOF",
        ));
        let error = map_error(eof);
        assert_eq!(error.code, "error.connectionLost");
        // Nguyên văn của sqlx ở đây là chuyện nội bộ của thư viện, không phải máy chủ nói — nên
        // nó không thuộc diện được giữ nguyên như quy ước ở `error.rs` mô tả.
        assert!(error.params.is_empty());

        let other = map_error(sqlx::Error::RowNotFound);
        assert_eq!(other.code, "error.mysql");
        assert!(other.params.contains_key("message"));
    }
}
```

- [ ] **Step 2: Chạy test để chắc nó hỏng**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib drivers::mysql
```

Kỳ vọng: **không biên dịch được** — `cannot find function lost_connection`.

- [ ] **Step 3: Viết `lost_connection` và `map_error` cho MySQL**

Thêm vào `src-tauri/src/modules/db/drivers/mysql.rs`, ngay sau khối `use` (sau dòng 7):

```rust
/// Lỗi này là đường ống đứt, không phải máy chủ từ chối.
///
/// `Io` là chỗ câu "expected to read N bytes, got 0 bytes at EOF" đi ra — sqlx dựng nó ở
/// `net/socket/buffered.rs` khi socket đóng giữa chừng. Hai biến thể pool đi kèm vì khi tunnel
/// đang được mở lại, cái người dùng gặp không phải là một socket đứt mà là một `acquire` không có
/// kết nối nào để trả.
pub(super) fn lost_connection(e: &sqlx::Error) -> bool {
    matches!(
        e,
        sqlx::Error::Io(_) | sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed
    )
}

/// Cái mà mọi lệnh MySQL đang dùng kết nối dùng thay cho `err!("error.mysql", message = e)`.
pub(super) fn map_error(e: sqlx::Error) -> AppError {
    if lost_connection(&e) {
        err!("error.connectionLost")
    } else {
        err!("error.mysql", message = e)
    }
}
```

- [ ] **Step 4: Chạy test để chắc nó qua**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib drivers::mysql
```

Kỳ vọng: PASS.

- [ ] **Step 5: Thay các chỗ gọi bên MySQL**

Trong `mysql.rs`, `mysql_structure.rs`, `mysql_script.rs`: thay mọi

```rust
.map_err(|e| err!("error.mysql", message = e))
```

bằng

```rust
.map_err(map_error)
```

**Trừ đúng một chỗ**: `mysql.rs`, trong `connect()` (dòng 42) — giữ nguyên, kèm comment:

```rust
        // Không đi qua `map_error`: hỏng ở đây là "không kết nối được", không phải "mất kết nối",
        // và lý do thật (connection refused, tên máy không phân giải được) nằm trong `message`.
        .map_err(|e| err!("error.mysql", message = e))
```

Đếm để tự kiểm: 32 chỗ trong `mysql.rs` → 31 thay, 1 giữ; 10 chỗ trong `mysql_structure.rs` → thay hết; 4 chỗ trong `mysql_script.rs` → thay hết.

Hai file kia cần import: thêm `map_error` vào dòng `use super::mysql::...` sẵn có —
`mysql_structure.rs` thành `use super::mysql::{map_error, quote_ident};`,
`mysql_script.rs` thành `use super::mysql::{column_value, map_error, quote_ident};`.

Chỗ nào `e` hoá ra không phải `sqlx::Error` thì trình biên dịch nói ngay ở bước sau — chỗ đó giữ nguyên `err!` cũ.

- [ ] **Step 6: Chạy `cargo check` để bắt các chỗ `e` không phải `sqlx::Error`**

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

Kỳ vọng: PASS. Nếu có lỗi `expected fn ... found ...` ở một `.map_err(map_error)`, trả đúng chỗ đó về `err!("error.mysql", message = e)`.

- [ ] **Step 7: Làm y hệt cho PostgreSQL**

Thêm vào `src-tauri/src/modules/db/drivers/postgres.rs`, ngay sau khối `use` (sau dòng 18):

```rust
/// Cái mà mọi lệnh PostgreSQL đang dùng kết nối dùng thay cho `err!("error.postgres", message = e)`
/// — cùng cách phân biệt như `mysql::map_error`, xem `mysql::lost_connection`.
pub(super) fn map_error(e: sqlx::Error) -> AppError {
    if super::mysql::lost_connection(&e) {
        err!("error.connectionLost")
    } else {
        err!("error.postgres", message = e)
    }
}
```

Thay mọi `.map_err(|e| err!("error.postgres", message = e))` thành `.map_err(map_error)` trong `postgres.rs` (27 chỗ → thay 26), `postgres_ddl.rs` (8), `postgres_script.rs` (4), `postgres_structure.rs` (5).

**Chỗ giữ nguyên**: trong `Pools::pool()`, lời gọi `PgPoolOptions::new().max_connections(5).connect_with(...)` — thêm comment giống MySQL:

```rust
            // Không đi qua `map_error`: đây là chỗ mở pool, kể cả pool đầu tiên mà `connect()` mở
            // — hỏng ở đây là "không kết nối được", và lý do thật nằm trong `message`.
            .map_err(|e| err!("error.postgres", message = e))?;
```

Ba file kia cần import `map_error`: thêm `use super::postgres::map_error;` (hoặc gộp vào dòng `use super::postgres::{...}` đã có).

- [ ] **Step 8: Test cho `postgres::map_error`**

Thêm vào cuối `src-tauri/src/modules/db/drivers/postgres.rs` (nếu file đã có `mod tests`, thêm vào trong đó):

```rust
#[cfg(test)]
mod tests {
    use super::map_error;

    #[test]
    fn postgres_tells_a_lost_connection_from_a_server_error() {
        let eof = sqlx::Error::Io(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "expected to read 4 bytes, got 0 bytes at EOF",
        ));
        assert_eq!(map_error(eof).code, "error.connectionLost");
        assert_eq!(map_error(sqlx::Error::PoolTimedOut).code, "error.connectionLost");
        assert_eq!(map_error(sqlx::Error::RowNotFound).code, "error.postgres");
    }
}
```

- [ ] **Step 9: Chạy toàn bộ test Rust**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

Kỳ vọng: PASS.

- [ ] **Step 10: Thêm khoá `error.connectionLost` vào từ điển của module db**

`src/modules/db/i18n/en.ts`, trong nhóm `error`, ngay sau `connectTimeout`:

```ts
    connectionLost:
      "The connection to the server was lost. If it goes through an SSH tunnel, MixDB is opening it again — try once more in a moment.",
```

`src/modules/db/i18n/vi.ts`, cùng chỗ:

```ts
    connectionLost:
      "Mất kết nối tới máy chủ. Nếu kết nối này đi qua SSH tunnel, MixDB đang mở lại — thử lại sau giây lát.",
```

- [ ] **Step 11: Kiểm tra**

```powershell
npm run build
```

Kỳ vọng: PASS.

- [ ] **Step 12: Một dòng CHANGELOG**

Thêm vào cuối `### Added` của `## [Unreleased]`:

```markdown
- A connection that dropped now says so plainly instead of repeating the driver's own words about bytes at EOF.
```

- [ ] **Step 13: Commit** *(chỉ khi được yêu cầu)*

```bash
git add src-tauri/src/modules/db/drivers src/modules/db/i18n CHANGELOG.md
git commit -m "feat(db): tell a lost connection from a server error"
```

---

## Task 3: Chạy lại một lệnh đọc sau khi tunnel về

**Files:**
- Modify: `src-tauri/src/modules/db/commands/mod.rs` (macro `retry_read!` + `mod tests`)
- Modify: `src-tauri/src/modules/db/commands/mysql.rs` (8 lệnh)
- Modify: `src-tauri/src/modules/db/commands/postgres.rs` (8 lệnh)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: mã lỗi `"error.connectionLost"` từ Task 2.
- Produces: `macro_rules! retry_read` trong `commands/mod.rs`, gọi được từ `commands/mysql.rs` và `commands/postgres.rs`.

**Hai điều về vị trí và cách gọi macro, cả hai đều có răng:**

1. Phạm vi của `macro_rules!` là **theo thứ tự chữ trong file**. Macro phải được định nghĩa **trước** các dòng `pub mod mysql;` / `pub mod postgres;` (dòng 23-27), nếu không hai file con không thấy nó.
2. Gọi bằng **ngoặc tròn bọc một block**: `retry_read!({ ... })`. Một lời gọi macro mở bằng ngoặc nhọn ở vị trí câu lệnh được phân tích như một *statement macro*, không phải một biểu thức có giá trị — dạng ngoặc tròn không có chỗ nào để hiểu nhầm.

---

- [ ] **Step 1: Viết test thất bại cho `retry_read!`**

Thêm vào **cuối** `src-tauri/src/modules/db/commands/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use crate::error::AppError;
    use std::cell::Cell;

    /// Đúng một lần chạy lại, và chỉ khi lần đầu chết cùng kết nối. Bộ đếm là thứ nói lên điều đó:
    /// một lệnh ghi lọt vào đây sẽ chạy hai lần, nên "chạy đúng mấy lần" là điều phải khoá lại.
    #[tokio::test]
    async fn a_read_runs_again_only_after_a_lost_connection() {
        let runs = Cell::new(0);
        let result: Result<u32, AppError> = retry_read!({
            runs.set(runs.get() + 1);
            if runs.get() == 1 {
                Err(err!("error.connectionLost"))
            } else {
                Ok(7)
            }
        });
        assert_eq!(result, Ok(7));
        assert_eq!(runs.get(), 2);

        // Lần đầu đã xong thì không có lần thứ hai.
        let runs = Cell::new(0);
        let result: Result<u32, AppError> = retry_read!({
            runs.set(runs.get() + 1);
            Ok(1)
        });
        assert_eq!(result, Ok(1));
        assert_eq!(runs.get(), 1);

        // Lỗi của máy chủ không phải lý do để hỏi lại: câu SQL sai lần hai vẫn sai.
        let runs = Cell::new(0);
        let result: Result<u32, AppError> = retry_read!({
            runs.set(runs.get() + 1);
            Err(err!("error.mysql", message = "syntax"))
        });
        assert_eq!(result, Err(err!("error.mysql", message = "syntax")));
        assert_eq!(runs.get(), 1);
    }
}
```

- [ ] **Step 2: Chạy test để chắc nó hỏng**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib commands::tests
```

Kỳ vọng: **không biên dịch được** — `cannot find macro retry_read`.

- [ ] **Step 3: Viết macro**

Thêm vào `src-tauri/src/modules/db/commands/mod.rs`, **giữa** khối `use` (kết thúc dòng 21) và các dòng `pub mod` (dòng 23):

```rust
/// Chạy lại một lệnh **đọc** đúng một lần, nếu lần đầu chết cùng kết nối.
///
/// Chỉ đọc. Một `INSERT` chạy lại sau khi mất kết nối có thể thành hai dòng — câu lệnh có thể đã
/// tới máy chủ và chỉ có câu trả lời là mất — nên lệnh ghi báo lỗi và để người dùng quyết định.
///
/// Là macro chứ không phải một hàm nhận closure: một `Fn() -> impl Future` mượn `State<'_, DbState>`
/// đưa lời gọi vào đúng loại rắc rối lifetime không đáng đánh nhau, còn macro thì chỉ là viết thân
/// lệnh hai lần.
///
/// Gọi bằng `retry_read!({ ... })` — ngoặc tròn bọc block, xem ghi chú trong plan.
macro_rules! retry_read {
    ($body:block) => {{
        match async { $body }.await {
            // Không ngủ giữa hai lần: lần thứ hai sẽ tự nằm chờ trong `acquire` của pool, sau
            // lần mở lại phiên đang diễn ra.
            Err(e) if e.code == "error.connectionLost" => async { $body }.await,
            first => first,
        }
    }};
}
```

- [ ] **Step 4: Chạy test để chắc nó qua**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib commands::tests
```

Kỳ vọng: PASS, cả ba khẳng định về bộ đếm.

- [ ] **Step 5: Bọc tám lệnh đọc của MySQL**

Trong `src-tauri/src/modules/db/commands/mysql.rs`, thay thân của đúng tám lệnh (dòng 23-139). Không đụng `mysql_query` ở trên và không đụng bất cứ gì từ `mysql_update_row` trở đi:

```rust
#[tauri::command]
pub async fn mysql_list_databases(state: State<'_, DbState>, id: String) -> Result<Vec<String>, AppError> {
    retry_read!({
        let pool = mysql_pool(&state, &id).await?;
        mysql::list_databases(&pool).await
    })
}

#[tauri::command]
pub async fn mysql_server_info(state: State<'_, DbState>, id: String) -> Result<mysql::ServerInfo, AppError> {
    retry_read!({
        let pool = mysql_pool(&state, &id).await?;
        mysql::server_info(&pool).await
    })
}

#[tauri::command]
pub async fn mysql_list_tables(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<String>, AppError> {
    retry_read!({
        let pool = mysql_pool(&state, &id).await?;
        mysql::list_tables(&pool, &database).await
    })
}

/// What every table in the database weighs, for the workspace's Statistics tab.
#[tauri::command]
pub async fn mysql_table_stats(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<mysql_structure::TableStats>, AppError> {
    retry_read!({
        let pool = mysql_pool(&state, &id).await?;
        mysql_structure::table_stats(&pool, &database).await
    })
}

#[tauri::command]
pub async fn mysql_table_data(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    query: mysql::PageQuery,
) -> Result<mysql::TablePage, AppError> {
    retry_read!({
        let (pool, mariadb) = mysql_connection(&state, &id).await?;
        mysql::table_data(&pool, mariadb, &database, &table, &query).await
    })
}
```

và, ở đúng chỗ cũ của chúng:

```rust
#[tauri::command]
pub async fn mysql_table_structure(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
) -> Result<mysql_structure::TableStructure, AppError> {
    retry_read!({
        let (pool, mariadb) = mysql_connection(&state, &id).await?;
        mysql_structure::table_structure(&pool, mariadb, &database, &table).await
    })
}

/// Every table and column of one database, for the Query tab's completion. One read covers the
/// whole database, so the editor never asks per table as the Structure tab does.
#[tauri::command]
pub async fn mysql_schema_outline(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<mysql_structure::SchemaOutline, AppError> {
    retry_read!({
        let pool = mysql_pool(&state, &id).await?;
        mysql_structure::schema_outline(&pool, &database).await
    })
}

/// The collations this server has, for the column editor's picker. A property of the server rather
/// than of any one table, so the frontend reads it once per connection.
#[tauri::command]
pub async fn mysql_collations(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<mysql_structure::Collation>, AppError> {
    retry_read!({
        let pool = mysql_pool(&state, &id).await?;
        mysql_structure::collations(&pool).await
    })
}
```

- [ ] **Step 6: Bọc tám lệnh đọc của PostgreSQL**

Trong `src-tauri/src/modules/db/commands/postgres.rs`, cùng cách, cho `postgres_list_databases`, `postgres_server_info`, `postgres_list_tables`, `postgres_table_stats`, `postgres_table_data`, `postgres_table_structure`, `postgres_collations`, `postgres_schema_outline`. Không đụng `postgres_query` (dòng 126-135) và không đụng gì từ `postgres_update_row`, `postgres_insert_rows`, `postgres_delete_rows`, `postgres_run_script` trở đi.

```rust
#[tauri::command]
pub async fn postgres_list_databases(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<String>, AppError> {
    retry_read!({
        let pool = postgres_pool(&state, &id, "").await?;
        postgres::list_databases(&pool).await
    })
}

#[tauri::command]
pub async fn postgres_server_info(
    state: State<'_, DbState>,
    id: String,
) -> Result<postgres::ServerInfo, AppError> {
    retry_read!({
        let pool = postgres_pool(&state, &id, "").await?;
        postgres::server_info(&pool).await
    })
}

#[tauri::command]
pub async fn postgres_list_tables(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<String>, AppError> {
    retry_read!({
        let pool = postgres_pool(&state, &id, &database).await?;
        postgres::list_tables(&pool).await
    })
}

#[tauri::command]
pub async fn postgres_table_stats(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<Vec<postgres_structure::TableStats>, AppError> {
    retry_read!({
        let pool = postgres_pool(&state, &id, &database).await?;
        postgres_structure::table_stats(&pool).await
    })
}

#[tauri::command]
pub async fn postgres_table_data(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
    query: postgres::PageQuery,
) -> Result<postgres::TablePage, AppError> {
    retry_read!({
        let pool = postgres_pool(&state, &id, &database).await?;
        postgres::table_data(&pool, &table, &query).await
    })
}

#[tauri::command]
pub async fn postgres_table_structure(
    state: State<'_, DbState>,
    id: String,
    database: String,
    table: String,
) -> Result<postgres_structure::TableStructure, AppError> {
    retry_read!({
        let pool = postgres_pool(&state, &id, &database).await?;
        postgres_structure::table_structure(&pool, &table).await
    })
}

#[tauri::command]
pub async fn postgres_collations(
    state: State<'_, DbState>,
    id: String,
) -> Result<Vec<postgres_structure::Collation>, AppError> {
    retry_read!({
        let pool = postgres_pool(&state, &id, "").await?;
        postgres_structure::collations(&pool).await
    })
}

#[tauri::command]
pub async fn postgres_schema_outline(
    state: State<'_, DbState>,
    id: String,
    database: String,
) -> Result<postgres_structure::SchemaOutline, AppError> {
    retry_read!({
        let pool = postgres_pool(&state, &id, &database).await?;
        postgres_structure::schema_outline(&pool, &database).await
    })
}
```

- [ ] **Step 7: Tự kiểm — đúng 16 chỗ, không hơn**

```powershell
Select-String -Path src-tauri/src/modules/db/commands/mysql.rs -Pattern 'retry_read!' | Measure-Object
Select-String -Path src-tauri/src/modules/db/commands/postgres.rs -Pattern 'retry_read!' | Measure-Object
```

Kỳ vọng: 8 và 8. (`mod.rs` không đếm ở đây — nó chứa định nghĩa và ba lời gọi trong `mod tests`.)

- [ ] **Step 8: Kiểm tra**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

Kỳ vọng: PASS.

- [ ] **Step 9: Một dòng CHANGELOG**

Thêm vào cuối `### Added`:

```markdown
- A read that died with the connection is run again once, after the tunnel has been opened back up. Writes are never repeated.
```

- [ ] **Step 10: Commit** *(chỉ khi được yêu cầu)*

```bash
git add src-tauri/src/modules/db/commands CHANGELOG.md
git commit -m "feat(db): retry a read after the tunnel comes back"
```

---

## Task 4: Lệnh `tunnel_reconnect`

**Files:**
- Modify: `src-tauri/src/modules/db/commands/mod.rs` (lệnh mới)
- Modify: `src-tauri/src/modules/db/state.rs:40-44` (bỏ `#[allow(dead_code)]`)
- Modify: `src-tauri/src/modules/mod.rs` (đăng ký lệnh)
- Modify: `src/modules/db/i18n/en.ts`, `src/modules/db/i18n/vi.ts` (khoá `error.noTunnel`)

**Interfaces:**
- Consumes: `ssh::Tunnel::session_handle()` và `ssh::TunnelSession::reconnect()` từ Task 1.
- Produces: lệnh Tauri `tunnel_reconnect(id: String) -> Result<(), AppError>`, thứ mà nút *Thử lại* của Task 5 gọi.

Không có test tự động cho task này: nó không có logic thuần nào — chỉ tra bản đồ connection rồi gọi một hàm đã có test ở tầng dưới. Cái duy nhất kiểm được là nó biên dịch và được đăng ký, và bước 3 chính là bước ấy.

---

- [ ] **Step 1: Viết lệnh**

Thêm vào `src-tauri/src/modules/db/commands/mod.rs`, ngay sau `disconnect_db` (sau dòng 204):

```rust
/// Mở lại phiên SSH của một connection ngay lập tức, thay vì chờ hết nhịp backoff của watcher.
/// Đây là cái nút *Thử lại* trên banner gọi.
#[tauri::command]
pub async fn tunnel_reconnect(state: State<'_, DbState>, id: String) -> Result<(), AppError> {
    // Tay cầm được sao ra và bản đồ được mở khoá **trước** khi chờ: xác thực mất tới
    // `CONNECT_TIMEOUT` (10 giây), và giữ bản đồ lâu như thế sẽ chặn mọi lệnh khác trong app.
    let session = {
        let connections = state.connections.lock().await;
        let connection = connections.get(&id).ok_or_else(|| err!("error.unknownConnection"))?;
        connection
            .tunnel
            .as_ref()
            .map(|tunnel| tunnel.session_handle())
            .ok_or_else(|| err!("error.noTunnel"))?
    };
    session.reconnect().await
}
```

- [ ] **Step 2: Bỏ `#[allow(dead_code)]` khỏi `ActiveConnection.tunnel`**

Trong `src-tauri/src/modules/db/state.rs`, sửa dòng 40-44 thành:

```rust
    /// Keeps the SSH port forward open, and is what the Retry button reaches through to open the
    /// session again — see `commands::tunnel_reconnect`. Dropping this connection drops the tunnel
    /// with it, and that is what tears the forward down — see {@link Tunnel}.
    pub tunnel: Option<Tunnel>,
```

- [ ] **Step 3: Đăng ký lệnh**

Trong `src-tauri/src/modules/mod.rs`, thêm ngay sau `db::commands::test_ssh_tunnel,` (dòng 24):

```rust
        db::commands::tunnel_reconnect,
```

Bước này không có gì ở build time nhắc; thiếu nó thì `invoke` trả "command not found" lúc chạy.

- [ ] **Step 4: Thêm khoá `error.noTunnel`**

`src/modules/db/i18n/en.ts`, nhóm `error`, ngay sau `connectionLost`:

```ts
    noTunnel: "This connection does not go through an SSH tunnel.",
```

`src/modules/db/i18n/vi.ts`:

```ts
    noTunnel: "Kết nối này không đi qua SSH tunnel.",
```

- [ ] **Step 5: Kiểm tra**

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

Kỳ vọng: cả hai PASS, và `cargo check` không còn cảnh báo `field tunnel is never read`.

- [ ] **Step 6: Commit** *(chỉ khi được yêu cầu)*

Không có dòng CHANGELOG cho task này: cái người dùng thấy là nút *Thử lại*, và nó tới ở Task 5.

```bash
git add src-tauri/src/modules/db/commands/mod.rs src-tauri/src/modules/db/state.rs src-tauri/src/modules/mod.rs src/modules/db/i18n
git commit -m "feat(db): reopen an SSH tunnel on request"
```

---

## Task 5: Banner nói tunnel đang được mở lại

**Files:**
- Create: `src/modules/db/tunnel.ts`
- Create: `src/modules/db/components/TunnelBanner/state.ts`
- Create: `src/modules/db/components/TunnelBanner/state.test.ts`
- Create: `src/modules/db/components/TunnelBanner/TunnelBanner.tsx`
- Create: `src/modules/db/components/TunnelBanner/TunnelBanner.module.css`
- Create: `src/modules/db/components/TunnelBanner/index.ts`
- Modify: `src/modules/db/i18n/en.ts`, `src/modules/db/i18n/vi.ts` (nhóm `tunnel`)
- Modify: `src/modules/db/sql/SqlWorkspace.tsx:694`, `src/modules/db/mongo/MongoWorkspace.tsx:595`, `src/modules/db/redis/RedisWorkspace.tsx:493`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: sự kiện `tunnel://state` với payload `{ id, state, error? }` (Task 1); lệnh `tunnel_reconnect` (Task 4); `errorMessage` từ `src/core/errors.ts`.
- Produces: `TunnelBanner` (default export của thư mục), `nextBannerState`, `HIDDEN`, kiểu `BannerState`.

Banner đặt trong **từng workspace** chứ không phải trong `DbTab`: `DbTab` trả workspace ra làm gốc của tab, bọc thêm một `div` sẽ phá layout flex của cả ba. Component tự trả `null` khi không có gì để nói, nên không cần điều kiện ở chỗ gọi.

---

- [ ] **Step 1: Viết test thất bại cho `nextBannerState`**

Tạo `src/modules/db/components/TunnelBanner/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HIDDEN, nextBannerState, type BannerState } from "./state";

const reconnecting = { id: "a", state: "reconnecting" } as const;
const reconnected = { id: "a", state: "reconnected" } as const;
const failed = { id: "a", state: "failed", error: { code: "error.sshAuthFailed" } } as const;

describe("nextBannerState", () => {
  it("shows the loss, then the recovery, and the recovery is what the component hides again", () => {
    const losing = nextBannerState(HIDDEN, reconnecting);
    expect(losing).toEqual({ kind: "reconnecting" });
    expect(nextBannerState(losing, reconnected)).toEqual({ kind: "reconnected" });
  });

  it("says nothing about a recovery nobody saw the loss of", () => {
    // Một tab mở ra sau khi tunnel đã tự lành thì không có gì để trấn an ai cả.
    expect(nextBannerState(HIDDEN, reconnected)).toBe(HIDDEN);
  });

  it("keeps the same failure rather than replacing it", () => {
    // Watcher giãn nhịp và báo lại cùng một lỗi; nếu mỗi lần là một object mới thì mọi thứ React
    // gắn với object đó sẽ bị dựng lại theo nhịp backoff.
    const first = nextBannerState(HIDDEN, failed);
    expect(first).toEqual({ kind: "failed", error: { code: "error.sshAuthFailed" } });
    expect(nextBannerState(first, failed)).toBe(first);
  });

  it("replaces a failure when the reason changed", () => {
    const first = nextBannerState(HIDDEN, failed);
    const other = { id: "a", state: "failed", error: { code: "error.sshTimeout" } } as const;
    expect(nextBannerState(first, other)).toEqual({
      kind: "failed",
      error: { code: "error.sshTimeout" },
    });
  });

  it("clears a failure when the tunnel comes back, and when it is being tried again", () => {
    const first: BannerState = nextBannerState(HIDDEN, failed);
    expect(nextBannerState(first, reconnected)).toEqual({ kind: "reconnected" });
    expect(nextBannerState(first, reconnecting)).toEqual({ kind: "reconnecting" });
  });

  it("does not restart a reconnection that is already on screen", () => {
    const busy = nextBannerState(HIDDEN, reconnecting);
    expect(nextBannerState(busy, reconnecting)).toBe(busy);
  });
});
```

- [ ] **Step 2: Chạy test để chắc nó hỏng**

```powershell
npx vitest run src/modules/db/components/TunnelBanner/state.test.ts
```

Kỳ vọng: FAIL — `Failed to resolve import "./state"`.

- [ ] **Step 3: Viết `src/modules/db/tunnel.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppError } from "../../core/errors";

/**
 * Chuyện đang xảy ra với SSH tunnel của một connection.
 *
 * Chỉ connection nào đi qua tunnel mới có sự kiện này — connection nối thẳng không phát gì cả, nên
 * không cần một cờ riêng để biết có nên vẽ banner hay không.
 */
export interface TunnelState {
  /** Connection này là của tab nào: hai tab có thể cùng đứt một lúc và mỗi tab chỉ nghe của mình. */
  id: string;
  state: "reconnecting" | "reconnected" | "failed";
  /** Chỉ có với `failed`: vì sao không mở lại được — khoá sai, host không tới được. */
  error?: AppError;
}

/** Nghe mọi tin về tunnel của `id` cho tới khi hàm trả về được gọi. */
export function onTunnelState(
  id: string,
  onState: (state: TunnelState) => void
): Promise<UnlistenFn> {
  return listen<TunnelState>("tunnel://state", ({ payload }) => {
    if (payload.id === id) onState(payload);
  });
}

/** Mở lại phiên SSH ngay, thay vì chờ hết nhịp backoff của watcher bên Rust. */
export function tunnelReconnect(id: string): Promise<void> {
  return invoke("tunnel_reconnect", { id });
}
```

- [ ] **Step 4: Viết `state.ts`**

Tạo `src/modules/db/components/TunnelBanner/state.ts`:

```ts
import type { AppError } from "../../../../core/errors";
import type { TunnelState } from "../../tunnel";

/**
 * Banner đang nói gì, nếu có nói gì.
 *
 * Tách khỏi component vì đây là chỗ duy nhất có gì để sai: thứ tự các sự kiện tới, và cái nào được
 * phép thay cái nào.
 */
export type BannerState =
  | { kind: "hidden" }
  | { kind: "reconnecting" }
  | { kind: "reconnected" }
  | { kind: "failed"; error: AppError };

export const HIDDEN: BannerState = { kind: "hidden" };

/** Trạng thái kế tiếp của banner. Trả lại chính `current` khi không có gì mới để nói. */
export function nextBannerState(current: BannerState, event: TunnelState): BannerState {
  switch (event.state) {
    case "reconnecting":
      return current.kind === "reconnecting" ? current : { kind: "reconnecting" };
    case "reconnected":
      // Chưa từng hiện gì thì không có gì để trấn an: một tab mở ra sau khi tunnel đã tự lành
      // không có lý do gì để báo "đã kết nối lại".
      return current.kind === "hidden" ? current : { kind: "reconnected" };
    case "failed": {
      const error = event.error ?? { code: "error.sshUnavailable" };
      // Cùng một lỗi lặp lại là nhịp backoff của watcher, không phải tin mới. Giữ nguyên object để
      // không có gì bên React bị dựng lại mỗi phút.
      if (current.kind === "failed" && current.error.code === error.code) return current;
      return { kind: "failed", error };
    }
  }
}
```

- [ ] **Step 5: Chạy test để chắc nó qua**

```powershell
npx vitest run src/modules/db/components/TunnelBanner/state.test.ts
```

Kỳ vọng: PASS, cả sáu.

- [ ] **Step 6: Thêm nhóm `tunnel` vào hai từ điển**

`src/modules/db/i18n/en.ts`, thêm một nhóm mới ở cấp cao nhất — đặt ngay trước nhóm `error` (dòng 809):

```ts
  tunnel: {
    reconnecting: "The SSH tunnel dropped — opening it again…",
    reconnected:
      "The tunnel is back. Anything the old connection held — temporary tables, an open transaction, a script that was running — went with it.",
    failed: "The SSH tunnel could not be opened again: {{message}}",
    retry: "Try again",
  },
```

`src/modules/db/i18n/vi.ts`, cùng chỗ:

```ts
  tunnel: {
    reconnecting: "Mất kết nối SSH — đang kết nối lại…",
    reconnected:
      "Đã kết nối lại. Những gì thuộc về kết nối cũ — bảng tạm, transaction đang mở, script đang chạy dở — đã mất theo nó.",
    failed: "Không mở lại được tunnel SSH: {{message}}",
    retry: "Thử lại",
  },
```

Không có nhóm `tunnel` nào ở `src/i18n/` nên không đụng luật "một tên nhóm chỉ được ở một từ điển" mà `dicts.ts` bắt bằng kiểu `Collision`.

- [ ] **Step 7: Viết component**

Tạo `src/modules/db/components/TunnelBanner/TunnelBanner.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { onTunnelState, tunnelReconnect } from "../../tunnel";
import { HIDDEN, nextBannerState, type BannerState } from "./state";
import styles from "./TunnelBanner.module.css";

/** "Đã kết nối lại" ở lại bao lâu trước khi tự biến mất. */
const REASSURED_MS = 3000;

interface Props {
  connectionId: string;
}

/**
 * Nói cho người dùng biết SSH tunnel của tab này vừa đứt, đang được mở lại, hay không mở lại được.
 *
 * Trả `null` khi không có gì để nói — kể cả với connection không đi qua tunnel, vì với chúng không
 * có sự kiện nào tới cả.
 */
function TunnelBanner({ connectionId }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<BannerState>(HIDDEN);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let stopped = false;
    void onTunnelState(connectionId, (event) =>
      setState((current) => nextBannerState(current, event))
    ).then((fn) => {
      // Tab có thể đã đóng trước khi `listen` kịp trả về: gỡ ngay thay vì để lại một người nghe
      // không ai gỡ.
      if (stopped) fn();
      else unlisten = fn;
    });
    return () => {
      stopped = true;
      unlisten?.();
      setState(HIDDEN);
    };
  }, [connectionId]);

  useEffect(() => {
    if (state.kind !== "reconnected") return;
    const timer = setTimeout(() => setState(HIDDEN), REASSURED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  if (state.kind === "hidden") return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await tunnelReconnect(connectionId);
    } catch {
      // Không cần bắt gì: dù mở lại được hay không, tunnel tự phát tin và banner đổi theo tin đó.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <p className={`${styles.banner} ${styles[state.kind]}`} role="status">
      {state.kind === "reconnecting" && <span className={styles.spinner} aria-hidden="true" />}
      <span className={styles.text}>
        {state.kind === "reconnecting" && t("tunnel.reconnecting")}
        {state.kind === "reconnected" && t("tunnel.reconnected")}
        {state.kind === "failed" && t("tunnel.failed", { message: errorMessage(t, state.error) })}
      </span>
      {state.kind === "failed" && (
        <button type="button" className={styles.retry} onClick={retry} disabled={retrying}>
          {t("tunnel.retry")}
        </button>
      )}
    </p>
  );
}

export default TunnelBanner;
```

- [ ] **Step 8: Viết CSS Module**

Tạo `src/modules/db/components/TunnelBanner/TunnelBanner.module.css`:

```css
/* Cùng chỗ đứng và cùng chiều cao với ErrorBanner ngay dưới nó, để một tab đang vừa mất tunnel vừa
   có lỗi không nhảy layout khi cái này biến mất. */
.banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  font-size: 0.92em;
}

.text {
  flex: 1 1 auto;
  min-width: 0;
}

.reconnecting {
  background-color: rgba(237, 162, 0, 0.15);
  color: #a86800;
}

.reconnected {
  background-color: rgba(46, 125, 50, 0.15);
  color: #2e7d32;
}

.failed {
  background-color: rgba(211, 47, 47, 0.15);
  color: #d32f2f;
}

/* Quay đều trong lúc chờ: trạng thái này không đóng được và có thể ở lại tới một phút, nên phải
   thấy được là nó vẫn đang làm gì đó. */
.spinner {
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: tunnel-spin 0.8s linear infinite;
}

@keyframes tunnel-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 2.4s;
  }
}

.retry {
  flex: none;
  padding: 1px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background-color: rgba(211, 47, 47, 0.15);
  box-shadow: none;
  color: inherit;
  font-size: 0.95em;
  cursor: pointer;
}

.retry:hover:not(:disabled) {
  background-color: rgba(211, 47, 47, 0.3);
  border-color: transparent;
}

.retry:disabled {
  opacity: 0.5;
  cursor: default;
}

:root[data-theme="dark"] .reconnecting {
  background-color: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}

:root[data-theme="dark"] .reconnected {
  background-color: rgba(102, 187, 106, 0.2);
  color: #66bb6a;
}

:root[data-theme="dark"] .failed {
  background-color: rgba(255, 99, 99, 0.2);
  color: #ff6b6b;
}

:root[data-theme="dark"] .retry {
  background-color: rgba(255, 99, 99, 0.2);
}

:root[data-theme="dark"] .retry:hover:not(:disabled) {
  background-color: rgba(255, 99, 99, 0.35);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) .reconnecting {
    background-color: rgba(255, 193, 7, 0.2);
    color: #ffc107;
  }

  :root:not([data-theme]) .reconnected {
    background-color: rgba(102, 187, 106, 0.2);
    color: #66bb6a;
  }

  :root:not([data-theme]) .failed {
    background-color: rgba(255, 99, 99, 0.2);
    color: #ff6b6b;
  }

  :root:not([data-theme]) .retry {
    background-color: rgba(255, 99, 99, 0.2);
  }

  :root:not([data-theme]) .retry:hover:not(:disabled) {
    background-color: rgba(255, 99, 99, 0.35);
  }
}
```

- [ ] **Step 9: Viết `index.ts`**

Tạo `src/modules/db/components/TunnelBanner/index.ts`:

```ts
export { default } from "./TunnelBanner";
```

- [ ] **Step 10: Gắn banner vào ba workspace**

Trong cả ba file, thêm import cạnh dòng `import ErrorBanner from "../../../components/ErrorBanner";`:

```tsx
import TunnelBanner from "../components/TunnelBanner";
```

Và thêm một dòng ngay **trên** khối `{(error || localError) && ...}`:

- `src/modules/db/sql/SqlWorkspace.tsx` — trên dòng 693
- `src/modules/db/mongo/MongoWorkspace.tsx` — trên dòng 594
- `src/modules/db/redis/RedisWorkspace.tsx` — trên dòng 492

```tsx
      <TunnelBanner connectionId={connectionId} />

      {(error || localError) && (
        <ErrorBanner message={error || localError} onDismiss={() => setLocalError("")} />
      )}
```

- [ ] **Step 11: Kiểm tra**

```powershell
npm test
npm run build
```

Kỳ vọng: cả hai PASS.

- [ ] **Step 12: Một dòng CHANGELOG**

Thêm vào cuối `### Added`:

```markdown
- A banner in the workspace says when an SSH tunnel dropped, when it came back, and offers to try again when it cannot be opened.
```

- [ ] **Step 13: Commit** *(chỉ khi được yêu cầu)*

```bash
git add src/modules/db/tunnel.ts src/modules/db/components/TunnelBanner src/modules/db/i18n src/modules/db/sql/SqlWorkspace.tsx src/modules/db/mongo/MongoWorkspace.tsx src/modules/db/redis/RedisWorkspace.tsx CHANGELOG.md
git commit -m "feat(db): say when the SSH tunnel is being reopened"
```

---

## Kiểm bằng tay

Không có cách nào khác cho đường đi thật của tunnel: nó cần một máy chủ SSH sống, và không test tự động nào trong repo này chạm tới được. Chạy `npm run dev:app` rồi:

1. Mở một connection MySQL qua SSH tunnel, xem được dữ liệu một bảng.
2. Trên máy chủ SSH, giết đúng phiên đó (`pkill -f "sshd: <user>"`), hoặc rút mạng máy client khoảng một phút.
3. Trong vòng ~45 giây banner phải **tự** hiện *đang kết nối lại* rồi *đã kết nối lại* — không cần bấm gì.
4. Bấm vào một bảng: dữ liệu về bình thường.
5. Lặp lại bước 2 nhưng chặn hẳn cổng SSH: banner ở trạng thái *thất bại*, nút *Thử lại* bấm được, và log của sshd không cho thấy một chuỗi xác thực dồn dập (không quá một lần mỗi 3 giây, giãn dần tới một phút).
6. Làm lại toàn bộ với một tab Redis và một tab Mongo qua tunnel — hai driver đó tự thử lại lệnh đọc, nên chúng phải khỏi mà không cần gì thêm.
7. Kiểm chỗ dễ hỏng nhất của Task 2: nhập sai host hoặc sai cổng cho một connection **không** qua tunnel và bấm Connect. Thông báo phải là lý do thật (connection refused / quá hạn), **không** phải "Mất kết nối tới máy chủ".

---

## Ghi chú về thứ tự commit

Spec (mục 8) liệt kê bốn commit. Plan này có năm: commit thứ tư của spec được tách làm hai — `feat(db): reopen an SSH tunnel on request` (lệnh backend, Task 4) và `feat(db): say when the SSH tunnel is being reopened` (banner, Task 5). Lý do: lệnh và banner là hai đơn vị soát riêng được, và tách ra giữ được nguyên tắc một task một commit. Nội dung không đổi so với spec.
