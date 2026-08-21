# Module Terminal — Plan đợt 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab Terminal mở được phiên shell trên một máy chủ qua SSH, không chỉ trên máy đang chạy app — host nhập một lần rồi lưu lại, mật khẩu và passphrase nằm trong kho thông tin đăng nhập của hệ điều hành chứ không trong file JSON, và một lần xác thực hỏng nói ra ngay tại form thay vì để lại một màn hình đen.

**Architecture:** `ssh/` mọc thêm đúng một hàm — `open_shell` — dựng trên `authenticate()` mà tunnel đã dùng từ trước, và trả về một tay cầm gồm phiên SSH cộng hai nửa của channel. Module terminal thêm `remote.rs`, hàm dựng phiên thứ hai, cùng hình dạng `Session` với `local::spawn`; từ `commands.rs` trở lên không có gì phải biết phiên này đi đường nào. Phía frontend, `TerminalTarget` thành union hai nhánh, `TargetForm` thành hai kiểu đích cộng một danh sách host đã lưu, và `savedHosts.ts` chia mỗi host làm hai — phần đọc được vào `terminal-hosts.json`, phần bí mật vào keyring qua ba lệnh `secrets_*` dùng chung.

**Tech Stack:** Rust + Tauri 2.11, `russh` 0.62 (`channel_open_session`, `request_pty`, `request_shell`, `ChannelReadHalf`/`ChannelWriteHalf`), `tokio` + `tokio-util`; TypeScript strict, React 19, CSS Modules, vitest, `@tauri-apps/plugin-store`, `@tauri-apps/plugin-dialog`.

**Spec:** [docs/superpowers/specs/2026-08-21-terminal-module-design.md](../specs/2026-08-21-terminal-module-design.md) — §1 (`ssh::open_shell`, `remote.rs`, `TerminalTarget::Ssh`), §2 (`savedHosts.ts`, `savedHostsStore.ts`, nhánh SSH của form), §4 (bảng lỗi, "không tự kết nối lại"), §5 (kiểm thử), giới hạn bởi §6: *"SSH — `ssh::open_shell`, `remote.rs`, nhánh SSH của form, host đã lưu + keyring"*.

## Global Constraints

- **Ranh giới module.** Không file nào ngoài `src/modules/terminal/` được biết khái niệm của terminal. Đúng hai ngoại lệ đã có từ đợt 1: một dòng trong `src/shell/registry.ts`, một khối trong `src/i18n/dicts.ts`. Kiểm bằng hai lệnh grep trong [adding-a-module.md](../../../.agent/conventions/adding-a-module.md) trước khi đóng đợt.
- **Chiều ngược lại cũng cấm.** `src/modules/terminal/` không được import từ `src/modules/db/` hay `src/modules/rest/`. `SshConfig` của db và của terminal là hai kiểu giống nhau ở hai module, đúng như spec §"Không dùng chung host SSH với module db" đã chốt.
- **`ssh/` không biết module nào.** `open_shell` nhận `SshConfig`, đường dẫn app data và hai số cols/rows — không nhận kiểu nào của `modules::terminal`.
- **Khoá dịch của `err!` trong `ssh/` đi vào từ điển chung**, không vào từ điển module: `src/i18n/{en,vi}.ts`. Khoá của `err!` trong `src-tauri/src/modules/terminal/` đi vào `src/modules/terminal/i18n/{en,vi}.ts`. Đây là luật của [i18n.md](../../../.agent/conventions/i18n.md), và nó có răng: `error` là nhóm duy nhất được gộp tay trong `dicts.ts`.
- **Mọi chuỗi hiển thị đi qua `t()`**, thêm vào **cả** `en.ts` và `vi.ts`. Ký tự ngoài ASCII viết dạng escape (`"\u2026"`).
- **Không tự kết nối lại.** Phiên chết thì nói là chết, kèm nút bấm tay — spec §4.
- **Không đọc `~/.ssh/config`**, không dùng chung host với module db, không SFTP, không session restore — spec §"Phi mục tiêu".
- **TypeScript strict**, không `any`, không `!` để bịt kiểu.
- **Một task là một commit**, tiền tố theo [Git Commit Rules]: `feat(terminal): ...`. Không có trailer `Co-Authored-By`.
- **Test trước, code sau** ở mọi chỗ có logic thuần. Repo cố ý không có jsdom, nên component không có test — cái được test là hàm.

---

## Phạm vi: chỉ đợt 2

Đợt này làm **SSH**. Không làm:

- `Ctrl+W`/`Ctrl+R` về đầu xa, copy/paste, `Ctrl+F`, menu chuột phải — đợt 3.
- Settings pane, font, scrollback, kiểu con trỏ, shell mặc định — đợt 4.
- Split pane, SFTP, session restore, tự kết nối lại — không bao giờ, spec §"Phi mục tiêu".

Sáu quyết định dưới đây là chỗ plan này đi xa hơn spec, hoặc chệch khỏi nó. Đọc trước khi vào task.

### 1. `open_shell` trả một tay cầm chia đôi, không trả `Channel`

Spec viết `ssh::open_shell(...) -> Result<russh::Channel<client::Msg>, AppError>`. Không đủ: `client::Handle` mới là thứ chạy vòng lặp sự kiện của russh, và bỏ nó là channel chết theo trong vài mili giây. Hàm phải trả về **cả hai**, và phiên phải sống đúng bằng phiên terminal.

Thêm nữa, phiên cần hai task chạy song song — một đọc, một ghi — nên tay cầm phải tách được làm hai nửa mà phiên SSH vẫn có chỗ bám. `russh::Channel::split()` cho đúng thứ đó, và nửa ghi là nơi giữ `client::Handle`:

```rust
pub struct RemoteShell { session, read, write }      // cái open_shell trả về
pub fn split(self) -> (russh::ChannelReadHalf, RemoteWriter)
pub struct RemoteWriter { _session, write }          // ghi, đổi kích thước, đóng
```

`TunnelHandler` vẫn private: nó chỉ xuất hiện trong field private của hai struct trên, nên không rò ra ngoài `ssh/`.

`authenticate()` giữ nguyên private — `open_shell` nằm cùng file nên không cần nâng lên `pub(crate)` như spec §1 dự tính. Ít bề mặt hơn thì giữ ít.

### 2. Nửa ghi là nơi phiên SSH sống, và là nơi nó chết

Ba đường vào của một phiên — byte gõ, đổi kích thước, đóng tab — đều đi qua nửa ghi, nên cả ba nằm trong **một** task. Task đó giữ `RemoteWriter`, và `RemoteWriter` giữ `client::Handle`. Task về là handle rơi là kết nối đóng: không có đường nào bỏ sót một phiên SSH, đúng như `Drop for Session` không bỏ sót một tiến trình con.

Task ấy thoát khi `input_rx` đóng (tức `Session` bị bỏ) **hoặc** khi `kill` bị huỷ. Hai đường vì `Session::drop` huỷ token, còn `terminal_close` bỏ `Session` khỏi map — trong thực tế cả hai xảy ra cùng lúc, và cả hai dẫn tới cùng một chỗ.

### 3. `Exit` vẫn đi sau byte cuối, bằng đúng cấu trúc của đợt 1

`local::spawn` phát `Exit` từ task gom lô, sau khi `coalesce` trả về — tức sau khi mọi byte đã ra khỏi đệm. `remote::spawn` làm y hệt: task đọc là chỗ duy nhất giữ `raw_tx`, nó kết thúc thì `coalesce` trả về, rồi mới `out(Output::Exit { .. })`. Mã thoát đi từ task đọc sang task gom lô bằng một `oneshot`.

Không có đường tắt nào ở đây. Một `out(Exit)` gọi thẳng trong task đọc sẽ vượt lên trước những byte còn nằm trong đệm 5ms — và dòng `logout` sẽ hiện ra sau khi tab đã báo phiên đóng.

### 4. `message` của `Exit` vẫn luôn `None`

Bảng lỗi ở spec §4 xếp "mất mạng giữa phiên" vào `TerminalEvent::Exit`. Không thêm chuỗi nào cho nó: đầu xa mất đường và shell thoát bình thường **nhìn giống hệt nhau từ phía này** — channel đóng, có thể có `ExitStatus`, có thể không. Bịa ra hai câu khác nhau cho hai thứ không phân biệt được là nói dối người dùng.

Nên `Exit { code: Some(n) }` khi máy chủ có gửi `ExitStatus`, `Exit { code: None }` khi không — và frontend hiện đúng hai câu nó đã có từ đợt 1. Trường `message` ở lại trong model cho đợt nào thật sự cần nó.

### 5. Xác thực hỏng phải trả tab về form

Đợt 1, `TerminalView` báo lỗi qua `onError` rồi ở lại — với shell cục bộ thì lỗi hiếm và tức thì. Với SSH thì không: sai mật khẩu là chuyện thường ngày, và spec §4 nói rõ *"`ErrorBanner` ngay tại form, phiên không mở"*. Nên `TerminalView` nhận thêm `onFailed`, và `TerminalTab` xoá `choice` khi nghe thấy — banner ở lại, form quay về **với giá trị người dùng vừa nhập còn nguyên**.

Giữ nguyên giá trị là lý do `TargetForm` phải nhận `initial`: một form bị reset sau mỗi lần gõ sai mật khẩu là một form không ai dùng nổi.

### 6. Danh sách host tự vẽ, không dùng `ItemList`

`ItemList` nhận `items: string[]` và nói lại bằng tên. Hai host trùng tên — chuyện bình thường với "prod" — thì không có gì phân biệt được chúng. Danh sách ở đây đi theo `id`, nên nó là `<ul>` của riêng module, đúng như `saved-list` của module db là của riêng module db.

Đây là chỗ thứ hai chép một hình dạng của db (chỗ thứ nhất là `savedHostsStore.ts`). Cả hai đều có chủ đích và cả hai đều được ghi lại ở đây; chỗ thứ ba thì tách ra `core/`, không sớm hơn — cùng lý lẽ spec §2 đã dùng.

---

## Cây file

**Tạo mới — frontend**

| File | Giữ gì |
| --- | --- |
| `src/modules/terminal/savedHosts.ts` | Tách/ghép secret, đọc ghi `terminal-hosts.json` |
| `src/modules/terminal/savedHosts.test.ts` | Vòng tròn tách rồi ghép |
| `src/modules/terminal/savedHostsStore.ts` | Danh sách dùng chung giữa mọi tab |
| `src/modules/terminal/components/TargetForm/SavedHostList.tsx` | Cột trái: host đã lưu, chọn và xoá |
| `src/modules/terminal/components/TargetForm/SavedHostList.module.css` | Style của cột đó |

**Tạo mới — Rust**

| File | Giữ gì |
| --- | --- |
| `src-tauri/src/modules/terminal/remote.rs` | `spawn()` — phiên shell qua SSH |

**Sửa**

| File | Sửa gì |
| --- | --- |
| `src-tauri/src/ssh/mod.rs` | `open_shell`, `RemoteShell`, `RemoteWriter` |
| `src-tauri/src/modules/terminal/mod.rs` | `pub mod remote;` |
| `src-tauri/src/modules/terminal/models.rs` | Nhánh `TerminalTarget::Ssh` |
| `src-tauri/src/modules/terminal/commands.rs` | `AppHandle`, `app_data_dir`, nhánh SSH của `terminal_open` |
| `src/i18n/en.ts`, `src/i18n/vi.ts` | `error.sshShellFailed` |
| `src/modules/terminal/types.ts` | `SshAuth`, `SshConfig`, `SavedHost`, `TerminalTarget` union, `TerminalChoice` |
| `src/modules/terminal/session.ts` | `terminalTarget`, `terminalTitle`, `terminalBadgeMarks` nhận union |
| `src/modules/terminal/session.test.ts` | Ca SSH cho cả ba hàm |
| `src/modules/terminal/TerminalTab.tsx` | Badge SSH, "đang kết nối", lỗi trả về form |
| `src/modules/terminal/components/TargetForm/TargetForm.tsx` | Hai kiểu đích, form SSH, lưu host |
| `src/modules/terminal/components/TargetForm/TargetForm.module.css` | Bố cục hai cột, hàng nhiều ô |
| `src/modules/terminal/components/TerminalView/TerminalView.tsx` | `onFailed`, `onOpened` |
| `src/modules/terminal/terminal.css` | Dải "đang kết nối" |
| `src/modules/terminal/i18n/en.ts`, `vi.ts` | Chuỗi của form SSH và của host đã lưu |
| `CHANGELOG.md` | Một dòng dưới `## [Unreleased]` |

---

## Task 1: Một phiên shell trên máy chủ

**Files:**
- Modify: `src-tauri/src/ssh/mod.rs` (thêm vào cuối, cạnh `test_connection`)
- Create: `src-tauri/src/modules/terminal/remote.rs`
- Modify: `src-tauri/src/modules/terminal/mod.rs`
- Modify: `src-tauri/src/modules/terminal/models.rs`
- Modify: `src-tauri/src/modules/terminal/commands.rs`
- Modify: `src/i18n/en.ts`, `src/i18n/vi.ts`

**Interfaces:**
- Consumes: `authenticate()`, `SshConfig`, `CHANNEL_OPEN_TIMEOUT` — đã có trong `ssh/mod.rs`; `Session`, `OutputSink`, `Output`, `TerminalSize`, `coalesce` — đã có từ đợt 1.
- Produces:
  - `crate::ssh::open_shell(ssh: &SshConfig, app_data: &Path, cols: u16, rows: u16) -> Result<RemoteShell, AppError>`
  - `crate::ssh::RemoteShell::split(self) -> (russh::ChannelReadHalf, crate::ssh::RemoteWriter)`
  - `crate::ssh::RemoteWriter::{write, resize, close}`
  - `terminal::remote::spawn(ssh: &SshConfig, app_data: &Path, size: TerminalSize, out: OutputSink) -> Result<Session, AppError>`
  - `TerminalTarget::Ssh(crate::ssh::SshConfig)` — nhánh thứ hai, serde `{"type":"ssh","host":…,"port":…,"username":…,"auth":{…}}`

- [ ] **Step 1: `open_shell` trong `ssh/mod.rs`**

Thêm vào cuối file, ngay sau `test_connection` (khoảng dòng 411). Không đụng `authenticate` — nó ở cùng file nên vẫn gọi được khi đang là private.

```rust
/// Một shell đang chạy trên máy chủ, cộng phiên SSH giữ nó sống.
///
/// Phiên đi cùng channel chứ không ở lại trong hàm: `client::Handle` là thứ chạy vòng lặp sự kiện
/// của russh, và bỏ nó là channel chết theo trong vài mili giây. Người gọi phải giữ cả hai sống
/// đúng bằng nhau, nên hàm này trao cả hai cùng lúc.
pub struct RemoteShell {
    session: client::Handle<TunnelHandler>,
    read: russh::ChannelReadHalf,
    write: russh::ChannelWriteHalf<client::Msg>,
}

impl RemoteShell {
    /// Tách làm hai nửa cho hai task: một đọc, một ghi. Phiên SSH ở lại với nửa ghi — đó là nửa
    /// sống đúng bằng phiên terminal, còn nửa đọc kết thúc ngay khi đầu xa im.
    pub fn split(self) -> (russh::ChannelReadHalf, RemoteWriter) {
        (
            self.read,
            RemoteWriter {
                session: self.session,
                write: self.write,
            },
        )
    }
}

/// Nửa ghi của một phiên shell: byte gõ, đổi kích thước, và đóng.
///
/// Giữ luôn `client::Handle` vì cả ba đường ra vào của một phiên đều đi qua đây — nên bỏ cái này
/// là đóng cả kết nối, và không có đường nào để sót một phiên SSH đang mở.
pub struct RemoteWriter {
    session: client::Handle<TunnelHandler>,
    write: russh::ChannelWriteHalf<client::Msg>,
}

impl RemoteWriter {
    /// Byte người dùng gõ. Hỏng là đường đã đứt — người gọi dừng, không thử lại.
    pub async fn write(&self, bytes: Vec<u8>) -> Result<(), AppError> {
        self.write
            .data_bytes(bytes)
            .await
            .map_err(|e| err!("error.sshShellFailed", message = e))
    }

    /// Khung đổi kích thước. `pix_width`/`pix_height` để 0: đầu xa dùng cols/rows, và số pixel
    /// của một webview không nói gì về ô chữ của nó.
    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        self.write
            .window_change(cols as u32, rows as u32, 0, 0)
            .await
            .map_err(|e| err!("error.sshShellFailed", message = e))
    }

    /// Đóng cho gọn: hết đầu vào, đóng channel, rồi chào máy chủ. Bỏ `RemoteWriter` cũng đóng
    /// được, nhưng bằng cách rơi handle mà không nói lời nào — và một sshd đang ghi log thì đáng
    /// được nói.
    pub async fn close(self) {
        let _ = self.write.eof().await;
        let _ = self.write.close().await;
        let _ = self
            .session
            .disconnect(russh::Disconnect::ByApplication, "", "English")
            .await;
    }
}

/// Mở một shell trên máy chủ: kết nối, xác thực, xin pty, xin shell.
///
/// Dùng chung `authenticate()` với tunnel — cùng kiểm vân tay theo `known_hosts.json`, cùng hai
/// cách xác thực — nhưng **kết nối là riêng**: vòng đời một terminal là vòng đời cái tab, còn vòng
/// đời một tunnel là vòng đời một kết nối database. Gộp lại thì đóng tab terminal làm rụng kết nối
/// database.
pub async fn open_shell(
    ssh: &SshConfig,
    app_data: &Path,
    cols: u16,
    rows: u16,
) -> Result<RemoteShell, AppError> {
    let session = authenticate(ssh, app_data).await?;

    let channel = match timeout(CHANNEL_OPEN_TIMEOUT, session.channel_open_session()).await {
        Ok(Ok(channel)) => channel,
        Ok(Err(e)) => return Err(err!("error.sshShellFailed", message = e)),
        Err(_) => {
            return Err(err!(
                "error.sshTimeout",
                host = &ssh.host,
                port = ssh.port,
                seconds = CHANNEL_OPEN_TIMEOUT.as_secs(),
            ))
        }
    };

    /* `want_reply: true` cho cả hai: một máy chủ từ chối cấp pty phải nói ra, và câu trả lời của
       nó tới dưới dạng `ChannelMsg::Success`/`Failure` trong hàng đợi của channel. Bộ đọc bỏ qua
       cả hai — cái nó chờ là byte — nhưng một `Failure` bao giờ cũng kéo theo channel đóng, và
       phiên kết thúc ngay thay vì treo trên một terminal câm. */
    channel
        .request_pty(true, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
        .await
        .map_err(|e| err!("error.sshShellFailed", message = e))?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| err!("error.sshShellFailed", message = e))?;

    let (read, write) = channel.split();
    Ok(RemoteShell {
        session,
        read,
        write,
    })
}
```

- [ ] **Step 2: `remote.rs`**

```rust
use std::path::Path;

use russh::ChannelMsg;
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use super::models::{Output, OutputSink, TerminalSize};
use super::state::Session;
use super::stream::coalesce;
use crate::error::AppError;
use crate::ssh::SshConfig;

/// Mở một shell trên máy chủ và trả về tay cầm của nó.
///
/// Cùng hình dạng `Session` với `local::spawn`, nên `commands.rs` không phân biệt được hai loại
/// phiên — và không cần phân biệt. Chỗ khác nhau nằm gọn trong hàm này: hai task tokio thay cho
/// bốn thread, một channel SSH thay cho một pty.
pub async fn spawn(
    ssh: &SshConfig,
    app_data: &Path,
    size: TerminalSize,
    out: OutputSink,
) -> Result<Session, AppError> {
    let (mut read, writer) = crate::ssh::open_shell(ssh, app_data, size.cols, size.rows)
        .await?
        .split();

    let (raw_tx, raw_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<TerminalSize>();
    let (exit_tx, exit_rx) = oneshot::channel::<Option<i32>>();
    let kill = CancellationToken::new();

    // Đọc đầu xa. Đây là chỗ duy nhất giữ `raw_tx`, nên task này kết thúc là bộ gom lô biết đã
    // hết byte — và chỉ khi đó `Exit` mới được phát.
    tokio::spawn(async move {
        let mut code = None;
        while let Some(msg) = read.wait().await {
            match msg {
                ChannelMsg::Data { data } => {
                    if raw_tx.send(data.to_vec()).is_err() {
                        break;
                    }
                }
                /* Một phiên có pty thường trộn stderr vào stdout, nhưng máy chủ vẫn được phép
                   tách ra — và một dòng lỗi không hiện lên màn hình thì tệ hơn là hiện lẫn vào
                   dòng khác. */
                ChannelMsg::ExtendedData { data, .. } => {
                    if raw_tx.send(data.to_vec()).is_err() {
                        break;
                    }
                }
                // Mã thoát tới trước khi channel đóng. Giữ lại, không phát ngay: đệm gom lô có
                // thể còn byte.
                ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status as i32),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                // `Success`/`Failure` của hai `request_*`, `WindowAdjusted` của điều khiển luồng.
                // Không có gì để làm với chúng.
                _ => {}
            }
        }
        let _ = exit_tx.send(code);
    });

    /* Ghi, đổi kích thước, đóng — một task, vì cả ba đi qua cùng một nửa ghi, và vì đây là chỗ
       giữ phiên SSH sống. Task này về là kết nối đóng. */
    tokio::spawn({
        let kill = kill.clone();
        async move {
            loop {
                tokio::select! {
                    bytes = input_rx.recv() => match bytes {
                        Some(bytes) => {
                            if writer.write(bytes).await.is_err() {
                                break;
                            }
                        }
                        // `Session` đã bị bỏ: đóng tab, hoặc app thoát.
                        None => break,
                    },
                    size = resize_rx.recv() => match size {
                        // Hỏng thì bỏ qua: một khung window_change trượt không làm phiên sai, và
                        // khung sau sẽ nói lại kích thước mới nhất.
                        Some(size) => { let _ = writer.resize(size.cols, size.rows).await; }
                        None => break,
                    },
                    _ = kill.cancelled() => break,
                }
            }
            writer.close().await;
        }
    });

    // Một đường ra, một thứ tự: hết byte → hết đệm → mới tới `Exit`. Giống hệt `local::spawn`,
    // và vì cùng lý do.
    tokio::spawn(async move {
        coalesce(raw_rx, |chunk| out(Output::Data(chunk))).await;
        let code = exit_rx.await.ok().flatten();
        out(Output::Exit {
            code,
            message: None,
        });
    });

    Ok(Session {
        input: input_tx,
        resize: resize_tx,
        kill,
    })
}
```

- [ ] **Step 3: Khai báo module và nhánh đích**

`src-tauri/src/modules/terminal/mod.rs` — thêm một dòng, giữ thứ tự chữ cái:

```rust
pub mod commands;
pub mod local;
pub mod models;
pub mod remote;
pub mod state;
pub mod stream;
```

Và sửa dòng đầu của doc comment — "từ đợt 2" không còn là lời hứa nữa:

```rust
//! Terminal: một phiên shell, trên máy này hoặc trên một máy chủ qua SSH.
```

`src-tauri/src/modules/terminal/models.rs` — nhánh thứ hai. Bỏ luôn câu "Đợt 2 thêm…":

```rust
/// Phiên mở đi đâu.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TerminalTarget {
    Local {
        /// `None` là "shell mặc định của máy".
        shell: Option<String>,
        #[serde(default)]
        args: Vec<String>,
        cwd: Option<String>,
    },
    /// Máy chủ mở phiên. Đúng `SshConfig` mà tunnel dùng — bốn trường ấy là bốn trường của một
    /// máy chủ SSH, không của thứ nằm ở đầu kia.
    Ssh(crate::ssh::SshConfig),
}
```

Nhánh newtype trong một enum có `tag`: serde trải các trường của `SshConfig` ra cạnh `"type": "ssh"`, nên JSON là `{"type":"ssh","host":"…","port":22,"username":"…","auth":{"type":"password","password":"…"}}`. Frontend ở Task 2 dựng đúng hình dạng đó.

- [ ] **Step 4: Nối vào `terminal_open`**

`commands.rs` — ba chỗ. Đầu file:

```rust
use std::path::PathBuf;
use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};

use super::models::{LocalShell, Output, OutputSink, TerminalEvent, TerminalSize, TerminalTarget};
use super::state::TerminalState;
use super::{local, remote};
use crate::error::AppError;
```

Cuối file, trước `#[cfg(test)]` nếu có (đợt 1 không có), thêm helper — module này không được gọi helper cùng tên của module db, ranh giới cấm:

```rust
/// Nơi MixDB nhớ những gì nó thấy giữa các lần chạy. Ở đây chỉ cần một thứ trong đó:
/// `known_hosts.json`, tức vân tay của mọi máy chủ SSH đã kết nối.
fn app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| err!("error.noAppDataDir", message = e))
}
```

Và `terminal_open` nhận `AppHandle`, rồi rẽ nhánh:

```rust
#[tauri::command]
pub async fn terminal_open(
    app: AppHandle,
    id: String,
    target: TerminalTarget,
    size: TerminalSize,
    on_event: Channel<InvokeResponseBody>,
    state: State<'_, TerminalState>,
) -> Result<(), AppError> {
    let sink: OutputSink = Arc::new(move |output| match output {
        Output::Data(bytes) => {
            let _ = on_event.send(InvokeResponseBody::Raw(bytes));
        }
        Output::Exit { code, message } => {
            if let Ok(json) = serde_json::to_string(&TerminalEvent::Exit { code, message }) {
                let _ = on_event.send(InvokeResponseBody::Json(json));
            }
        }
    });

    let session = match target {
        TerminalTarget::Local { shell, args, cwd } => local::spawn(shell, args, cwd, size, sink)?,
        // Xác thực hỏng, vân tay đổi, máy chủ không tới được — tất cả hỏng ở đây, trước khi có
        // phiên nào để đưa vào map. Đó là thứ frontend đưa về `ErrorBanner` ngay tại form.
        TerminalTarget::Ssh(ssh) => remote::spawn(&ssh, &app_data_dir(&app)?, size, sink).await?,
    };

    // Cùng một id mở hai lần thì phiên cũ bị thay và `Drop` của nó dọn phần còn lại.
    state.sessions.lock().unwrap().insert(id, session);
    Ok(())
}
```

`error.noAppDataDir` đã có trong từ điển chung — module db raise nó từ trước.

- [ ] **Step 5: Khoá dịch cho lỗi mới**

`err!("error.sshShellFailed", …)` nằm trong `src-tauri/src/ssh/`, tức lớp dùng chung, nên khoá đi vào **từ điển chung**, không vào từ điển module — [i18n.md](../../../.agent/conventions/i18n.md).

`src/i18n/en.ts`, trong nhóm `error`, cạnh `sshAuthFailed`:

```ts
    sshShellFailed: "Could not open a shell on the SSH server: {{message}}",
```

`src/i18n/vi.ts`, cùng chỗ:

```ts
    sshShellFailed: "Kh\u00f4ng m\u1edf \u0111\u01b0\u1ee3c shell tr\u00ean m\u00e1y ch\u1ee7 SSH: {{message}}",
```

Viết đúng chính tả tiếng Việt trong file: `"Không mở được shell trên máy chủ SSH: {{message}}"` — dùng escape như quy ước của repo nếu các dòng lân cận đang dùng escape, còn nếu chúng viết thẳng chữ có dấu thì viết thẳng cho khớp. Đọc hai dòng trên và dưới rồi làm theo.

- [ ] **Step 6: Biên dịch và chạy test Rust**

```bash
cd src-tauri && cargo test
```

Expected: PASS — bao gồm bốn test của `stream.rs`, bốn test `parse_wsl_list` và test vòng đời phiên cục bộ của đợt 1. Không có test mới: cái vừa viết cần một máy chủ SSH thật, và nó được kiểm ở Step 7.

```bash
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

Expected: sạch. `tokio::select!` với `input_rx.recv()` không cần nhánh `else` — hai nhánh đầu đã tự trả `None` khi kênh đóng.

- [ ] **Step 7: Kiểm tay — một phiên SSH thật**

Chưa có form SSH, nên gọi thẳng lệnh từ devtools của app:

```bash
npm run dev:app
```

Trong console của webview (mở tab Terminal bất kỳ để module đã nạp):

```js
const { Channel, invoke } = window.__TAURI__.core;
const ch = new Channel();
ch.onmessage = (m) => console.log(m instanceof ArrayBuffer ? new TextDecoder().decode(m) : m);
await invoke("terminal_open", {
  id: "probe",
  target: {
    type: "ssh",
    host: "<host>",
    port: 22,
    username: "<user>",
    auth: { type: "password", password: "<password>" },
  },
  size: { cols: 80, rows: 24 },
  onEvent: ch,
});
await invoke("terminal_write", { id: "probe", data: "echo hello\n" });
```

Expected: prompt của máy chủ hiện trong console, rồi `hello`. Sau đó:

```js
await invoke("terminal_write", { id: "probe", data: "exit\n" });
```

Expected: một khung `{type: "exit", code: 0, message: null}`, và nó tới **sau** dòng `logout`.

Rồi mở lại `probe` và thử `await invoke("terminal_close", { id: "probe" })` — trên máy chủ, `who` không còn phiên nào của lần thử này.

Nếu chưa có máy chủ SSH nào để thử: `ssh` vào chính máy này cũng được (`localhost`), miễn là có sshd chạy. Ghi lại trong báo cáo cuối đợt nếu bước này không chạy được.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/ssh/mod.rs src-tauri/src/modules/terminal/ src/i18n/en.ts src/i18n/vi.ts
git commit -m "feat(terminal): open a shell on an SSH server"
```

---

## Task 2: Đích SSH ở phía frontend

**Files:**
- Modify: `src/modules/terminal/types.ts`
- Modify: `src/modules/terminal/session.ts`
- Modify: `src/modules/terminal/session.test.ts`
- Modify: `src/modules/terminal/TerminalTab.tsx`
- Modify: `src/modules/terminal/components/TargetForm/TargetForm.tsx`
- Modify: `src/modules/terminal/i18n/en.ts`, `src/modules/terminal/i18n/vi.ts`

**Interfaces:**
- Consumes: `TerminalTarget` bên Rust (Task 1, Step 3) — nhánh `ssh` trải phẳng bốn trường của `SshConfig`.
- Produces:
  - `TerminalChoice = { kind: "local"; shell: LocalShell; cwd: string | null } | { kind: "ssh"; config: SshConfig; hostId: string | null }`
  - `terminalTarget(choice: TerminalChoice): TerminalTarget`
  - `terminalTitle(choice: TerminalChoice): string`
  - `terminalBadgeMarks(choice: TerminalChoice | null, ended: boolean): TerminalBadgeMark[]`
  - `SshAuth`, `SshConfig`, `SavedHost` — Task 3 và 4 dùng lại

- [ ] **Step 1: Viết test cho ba hàm, ca SSH**

`src/modules/terminal/session.test.ts` — đọc file hiện có trước, giữ nguyên phần local rồi thêm. Bản đầy đủ sau khi sửa:

```ts
import { describe, expect, it } from "vitest";
import { terminalBadgeMarks, terminalTarget, terminalTitle } from "./session";
import type { LocalShell, SshConfig, TerminalChoice } from "./types";

const bash: LocalShell = { name: "bash", path: "/bin/bash", args: [] };
const local: TerminalChoice = { kind: "local", shell: bash, cwd: null };

const config: SshConfig = {
  host: "example.com",
  port: 22,
  username: "deploy",
  auth: { type: "password", password: "hunter2" },
};
const ssh: TerminalChoice = { kind: "ssh", config, hostId: null };

describe("terminalTarget", () => {
  it("rút một shell cục bộ thành đường dẫn và tham số", () => {
    expect(terminalTarget({ kind: "local", shell: bash, cwd: "/tmp" })).toEqual({
      type: "local",
      shell: "/bin/bash",
      args: [],
      cwd: "/tmp",
    });
  });

  /* Nhánh `Ssh(SshConfig)` bên Rust là newtype trong một enum có `tag`, nên bốn trường của nó nằm
     phẳng cạnh `type` chứ không lồng trong một object con. Sai chỗ này thì serde từ chối, và lỗi
     hiện ra ở runtime chứ không ở lúc build. */
  it("trải phẳng cấu hình SSH cạnh nhãn đích", () => {
    expect(terminalTarget(ssh)).toEqual({
      type: "ssh",
      host: "example.com",
      port: 22,
      username: "deploy",
      auth: { type: "password", password: "hunter2" },
    });
  });
});

describe("terminalTitle", () => {
  it("gọi shell cục bộ bằng nhãn của nó", () => {
    expect(terminalTitle(local)).toBe("bash");
  });

  /* `user@host`, không phải tên host đã lưu: tab bar rộng vài chữ, và cái người dùng cần đọc ở đó
     là mình đang gõ vào máy nào chứ không phải mình đã đặt tên nó là gì. */
  it("gọi phiên SSH bằng user@host", () => {
    expect(terminalTitle(ssh)).toBe("deploy@example.com");
  });
});

describe("terminalBadgeMarks", () => {
  it("không đánh dấu một tab còn đang ở form", () => {
    expect(terminalBadgeMarks(null, false)).toEqual([]);
  });

  it("đánh dấu phiên cục bộ", () => {
    expect(terminalBadgeMarks(local, false)).toEqual([{ type: "local" }]);
  });

  it("đánh dấu phiên SSH", () => {
    expect(terminalBadgeMarks(ssh, false)).toEqual([{ type: "ssh" }]);
  });

  it("thêm dấu kết thúc mà không bỏ dấu loại phiên", () => {
    expect(terminalBadgeMarks(ssh, true)).toEqual([{ type: "ssh" }, { type: "ended" }]);
  });
});
```

- [ ] **Step 2: Chạy test, chắc chắn nó đỏ**

```bash
npm test -- session
```

Expected: FAIL — `terminalTarget` chưa tồn tại (đợt 1 gọi nó là `localTarget`), và `TerminalChoice` chưa có trong `types.ts`.

- [ ] **Step 3: Kiểu**

`src/modules/terminal/types.ts` — giữ `LocalShell`, `TerminalSize` như cũ, thay phần đích:

```ts
/** Cách chứng minh mình là ai với máy chủ SSH. Gương của `SshAuth` bên Rust. */
export type SshAuth =
  | { type: "password"; password: string }
  | { type: "privatekey"; key_path: string; passphrase?: string };

/** Máy chủ SSH mở phiên. Cùng bốn trường mà module db dùng cho tunnel của nó, và cố ý là một kiểu
 *  khác: hai module không dùng chung host, nên chúng không dùng chung kiểu. */
export interface SshConfig {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
}

/** Một máy chủ người dùng đã lưu lại. `config` ở đây luôn đầy đủ — phần bí mật được `savedHosts.ts`
 *  ghép lại từ keyring trước khi tới tay ai. */
export interface SavedHost {
  id: string;
  name: string;
  config: SshConfig;
}

/** Đích của một phiên, đúng hình dạng `TerminalTarget` bên Rust. Nhánh `ssh` trải phẳng bốn trường
 *  của `SshConfig` vì bên Rust nó là một nhánh newtype trong enum có `tag`. */
export type TerminalTarget =
  | { type: "local"; shell: string; args: string[]; cwd: string | null }
  | ({ type: "ssh" } & SshConfig);

/**
 * Cái người dùng chọn trong form. Rộng hơn `TerminalTarget`: giữ cả `LocalShell` để đặt tên tab và
 * `hostId` để biết phiên này đến từ host đã lưu nào — hai thứ Rust không cần biết.
 */
export type TerminalChoice =
  | { kind: "local"; shell: LocalShell; cwd: string | null }
  | { kind: "ssh"; config: SshConfig; hostId: string | null };
```

`LocalChoice` biến mất. Nó chỉ có hai chỗ dùng (`session.ts`, `TerminalTab.tsx`, `TargetForm.tsx`) và cả ba được sửa trong task này.

- [ ] **Step 4: `session.ts`**

```ts
import { shellLabel } from "./shells";
import type { TerminalChoice, TerminalTarget } from "./types";

/** Một dấu tab này nên mang. `TerminalTab` biến nó thành `TabBadge` vì nó là chỗ có `t`. */
export type TerminalBadgeMark = { type: "local" } | { type: "ssh" } | { type: "ended" };

/** Cái người dùng chọn, rút gọn thành cái Rust cần. Nhãn hiển thị ở lại đây. */
export function terminalTarget(choice: TerminalChoice): TerminalTarget {
  if (choice.kind === "local") {
    return { type: "local", shell: choice.shell.path, args: choice.shell.args, cwd: choice.cwd };
  }
  return { type: "ssh", ...choice.config };
}

/** Tên tab: tên shell, hoặc `user@host` — không phải đường dẫn và không phải tên host đã lưu, vì
 *  tab bar chỉ rộng vài chữ. */
export function terminalTitle(choice: TerminalChoice): string {
  return choice.kind === "local"
    ? shellLabel(choice.shell.name)
    : `${choice.config.username}@${choice.config.host}`;
}

/**
 * Tab bar nên hiện dấu gì.
 *
 * Chưa mở phiên thì không dấu nào: form trên màn hình có thể đang chọn một đích khác hẳn cái tab
 * sẽ chạy, đúng như `dbBadgeMarks` không đánh dấu một tab còn đang ở form kết nối.
 */
export function terminalBadgeMarks(
  choice: TerminalChoice | null,
  ended: boolean,
): TerminalBadgeMark[] {
  if (!choice) return [];
  const marks: TerminalBadgeMark[] = [{ type: choice.kind === "local" ? "local" : "ssh" }];
  if (ended) marks.push({ type: "ended" });
  return marks;
}
```

- [ ] **Step 5: Chạy lại test, phải xanh**

```bash
npm test -- session
```

Expected: PASS, chín ca.

- [ ] **Step 6: Chuỗi cho badge SSH**

`src/modules/terminal/i18n/en.ts`, trong nhóm `terminal`, ngay sau `badgeLocal`:

```ts
    badgeSsh: "SSH session",
```

`vi.ts`, cùng chỗ:

```ts
    badgeSsh: "Phi\u00ean SSH",
```

(tức `"Phiên SSH"` — theo cách viết mà các dòng lân cận đang dùng.)

- [ ] **Step 7: `TerminalTab` và `TargetForm` theo kiểu mới**

`TerminalTab.tsx` — ba chỗ. Import:

```tsx
import { terminalBadgeMarks, terminalTarget, terminalTitle } from "./session";
import type { TerminalChoice } from "./types";
```

State:

```tsx
  const [choice, setChoice] = useState<TerminalChoice | null>(null);
```

Badge — bảng ba dấu thay cho hai:

```tsx
  useEffect(() => {
    onBadgesChange(
      terminalBadgeMarks(choice, exit !== null).map((mark) => {
        if (mark.type === "ended") {
          return {
            id: "ended",
            icon: <TerminalIcon />,
            label: t("terminal.badgeEnded"),
            tabClassName: "terminal-tab-ended",
          };
        }
        return mark.type === "local"
          ? { id: "local", icon: <TerminalIcon />, label: t("terminal.badgeLocal") }
          : { id: "ssh", icon: <TerminalIcon />, label: t("terminal.badgeSsh") };
      }),
    );
  }, [choice, exit, onBadgesChange, t]);
```

Và đích:

```tsx
  const target = useMemo(() => (choice ? terminalTarget(choice) : null), [choice]);
```

`TargetForm.tsx` — đổi kiểu callback, chưa đổi giao diện (đó là Task 4):

```tsx
import type { LocalShell, TerminalChoice } from "../../types";

interface Props {
  onOpen: (choice: TerminalChoice) => void;
  onError: (message: string) => void;
}
```

và nút Mở:

```tsx
        onClick={() => chosen && onOpen({ kind: "local", shell: chosen, cwd: cwd.trim() || null })}
```

- [ ] **Step 8: Build và test toàn bộ**

```bash
npm test
npm run build
```

Expected: cả hai xanh. `npm run build` chạy `tsc` nên nó là chỗ bắt được bất kỳ chỗ nào còn dùng `LocalChoice` hay `localTarget`.

- [ ] **Step 9: Commit**

```bash
git add src/modules/terminal
git commit -m "feat(terminal): describe an SSH target on the frontend side"
```

---

## Task 3: Host đã lưu, và chỗ cất mật khẩu

**Files:**
- Create: `src/modules/terminal/savedHosts.ts`
- Create: `src/modules/terminal/savedHosts.test.ts`
- Create: `src/modules/terminal/savedHostsStore.ts`

**Interfaces:**
- Consumes: `SavedHost`, `SshConfig`, `SshAuth` (Task 2, Step 3); ba lệnh `secrets_save` / `secrets_load` / `secrets_delete` — đã có trong `src-tauri/src/secrets.rs`, dùng chung, không sửa gì.
- Produces:
  - `splitSecrets(config: SshConfig): { config: SshConfig; secrets: HostSecrets }`
  - `mergeSecrets(config: SshConfig, secrets: HostSecrets): SshConfig`
  - `loadSavedHosts(): Promise<SavedHost[]>`, `addSavedHost`, `updateSavedHost`, `removeSavedHost`
  - `useSavedHosts(): SavedHost[]`, `addHost`, `updateHost`, `removeHost` — Task 4 dùng bốn cái này

- [ ] **Step 1: Viết test cho vòng tròn tách/ghép**

`src/modules/terminal/savedHosts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeSecrets, splitSecrets } from "./savedHosts";
import type { SshConfig } from "./types";

const withPassword: SshConfig = {
  host: "example.com",
  port: 22,
  username: "deploy",
  auth: { type: "password", password: "hunter2" },
};

const withKey: SshConfig = {
  host: "example.com",
  port: 2222,
  username: "deploy",
  auth: { type: "privatekey", key_path: "/home/me/.ssh/id_ed25519", passphrase: "let me in" },
};

describe("splitSecrets", () => {
  it("lấy mật khẩu ra khỏi phần sẽ ghi vào file", () => {
    const { config, secrets } = splitSecrets(withPassword);
    expect(secrets).toEqual({ sshPassword: "hunter2" });
    expect(config.auth).toEqual({ type: "password", password: "" });
  });

  it("giữ đường dẫn khoá lại và chỉ lấy passphrase", () => {
    const { config, secrets } = splitSecrets(withKey);
    expect(secrets).toEqual({ sshPassphrase: "let me in" });
    expect(config.auth).toEqual({
      type: "privatekey",
      key_path: "/home/me/.ssh/id_ed25519",
      passphrase: undefined,
    });
  });

  /* Một khoá không đặt passphrase không được để lại khoá rỗng trong keyring: `secrets_save` với
     một tập rỗng xoá hẳn entry, và đó đúng là điều nên xảy ra. */
  it("không tạo ra bí mật rỗng khi không có gì để giấu", () => {
    const noPassphrase: SshConfig = {
      ...withKey,
      auth: { type: "privatekey", key_path: "/k", passphrase: "" },
    };
    expect(splitSecrets(noPassphrase).secrets).toEqual({});
  });

  it("không đụng vào host, port, user", () => {
    const { config } = splitSecrets(withKey);
    expect(config.host).toBe("example.com");
    expect(config.port).toBe(2222);
    expect(config.username).toBe("deploy");
  });
});

describe("mergeSecrets", () => {
  it("ghép mật khẩu trở lại đúng chỗ", () => {
    const { config, secrets } = splitSecrets(withPassword);
    expect(mergeSecrets(config, secrets)).toEqual(withPassword);
  });

  it("ghép passphrase trở lại đúng chỗ", () => {
    const { config, secrets } = splitSecrets(withKey);
    expect(mergeSecrets(config, secrets)).toEqual(withKey);
  });

  /* Người dùng xoá entry trong Credential Manager, hoặc chép `terminal-hosts.json` sang máy khác:
     host vẫn phải mở form được, chỉ là ô mật khẩu trống. */
  it("để trống khi keyring không còn gì", () => {
    const { config } = splitSecrets(withPassword);
    expect(mergeSecrets(config, {})).toEqual({
      ...withPassword,
      auth: { type: "password", password: "" },
    });
  });
});
```

- [ ] **Step 2: Chạy test, chắc chắn nó đỏ**

```bash
npm test -- savedHosts
```

Expected: FAIL — không resolve được `./savedHosts`.

- [ ] **Step 3: `savedHosts.ts`**

```ts
import { Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import type { SavedHost, SshConfig } from "./types";

/**
 * Danh sách host đã lưu, chia làm hai chỗ.
 *
 * `terminal-hosts.json` giữ cái một host *là* — tên, địa chỉ, cổng, người dùng, đường dẫn khoá —
 * và nó là văn bản thường có chủ đích: đó là danh sách những máy mình hay vào, đọc và chép được
 * thì tiện. Cái mở được cửa thì đi vào kho thông tin đăng nhập của hệ điều hành, qua ba lệnh
 * `secrets_*` mà module db cũng dùng.
 *
 * Id là uuid do module này sinh, nên nó không bao giờ đụng id của một kết nối database — hai bên
 * chia nhau một kho nhưng không chia nhau một khoá nào.
 *
 * Chỗ chia là chuyện riêng của file này: cái đi vào và đi ra là một `SavedHost` đầy đủ.
 */

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load("terminal-hosts.json");
  }
  return storePromise;
}

/** Những gì không được nằm trong `terminal-hosts.json`. Tên khoá đi vào keyring cùng id của host. */
export interface HostSecrets {
  sshPassword?: string;
  sshPassphrase?: string;
}

/** Cấu hình chẻ làm đôi: phần ghi được xuống file, và phần đi vào keyring. */
export function splitSecrets(config: SshConfig): { config: SshConfig; secrets: HostSecrets } {
  if (config.auth.type === "password") {
    const password = config.auth.password;
    return {
      config: { ...config, auth: { type: "password", password: "" } },
      // Một tập rỗng làm `secrets_save` xoá hẳn entry, nên một host không có gì để giấu cũng
      // không để lại gì.
      secrets: password ? { sshPassword: password } : {},
    };
  }
  const { key_path, passphrase } = config.auth;
  return {
    // Đường dẫn khoá ở lại trong file: nó là chỗ để tìm khoá, không phải chính khoá.
    config: { ...config, auth: { type: "privatekey", key_path, passphrase: undefined } },
    secrets: passphrase ? { sshPassphrase: passphrase } : {},
  };
}

/** Cấu hình như form cần: cái đã ở trên đĩa, với phần bí mật đặt lại vào. */
export function mergeSecrets(config: SshConfig, secrets: HostSecrets): SshConfig {
  if (config.auth.type === "password") {
    return {
      ...config,
      auth: { type: "password", password: secrets.sshPassword ?? config.auth.password },
    };
  }
  return {
    ...config,
    auth: {
      type: "privatekey",
      key_path: config.auth.key_path,
      passphrase: secrets.sshPassphrase ?? config.auth.passphrase,
    },
  };
}

function saveSecrets(id: string, secrets: HostSecrets): Promise<void> {
  return invoke<void>("secrets_save", { id, secrets });
}

function loadSecrets(id: string): Promise<HostSecrets> {
  return invoke<HostSecrets>("secrets_load", { id });
}

/** Cái thật sự nằm trên đĩa, phần bí mật đã bị lấy ra từ trước. */
async function loadStored(): Promise<SavedHost[]> {
  const store = await getStore();
  return (await store.get<SavedHost[]>("hosts")) ?? [];
}

async function persist(list: SavedHost[]): Promise<void> {
  const store = await getStore();
  await store.set(
    "hosts",
    list.map((host) => ({ ...host, config: splitSecrets(host.config).config })),
  );
  await store.save();
}

/** Mọi host đã lưu, phần bí mật đã ghép lại. Một host mà keyring không còn gì cho nó vẫn về đây
 *  — chỉ là ô mật khẩu trống, và đó là điều đúng để hiện. */
export async function loadSavedHosts(): Promise<SavedHost[]> {
  const stored = await loadStored();
  return Promise.all(
    stored.map(async (host) => ({
      ...host,
      config: mergeSecrets(host.config, await loadSecrets(host.id)),
    })),
  );
}

/** Ghi bí mật của `host` vào kho của hệ điều hành, rồi cả danh sách — không bí mật nào — xuống
 *  file. Những host khác cũng bị lược: chúng vừa được trao đi với phần bí mật đã ghép vào. */
async function persistHost(list: SavedHost[], host: SavedHost): Promise<void> {
  await saveSecrets(host.id, splitSecrets(host.config).secrets);
  await persist(list);
}

export async function addSavedHost(host: SavedHost): Promise<SavedHost[]> {
  const list = await loadSavedHosts();
  const next = [...list, host];
  await persistHost(next, host);
  return next;
}

export async function updateSavedHost(host: SavedHost): Promise<SavedHost[]> {
  const list = await loadSavedHosts();
  const next = list.map((h) => (h.id === host.id ? host : h));
  await persistHost(next, host);
  return next;
}

export async function removeSavedHost(id: string): Promise<SavedHost[]> {
  const list = await loadSavedHosts();
  const next = list.filter((h) => h.id !== id);
  // Bí mật đi theo host nó thuộc về; để lại là để một entry trong kho của hệ điều hành mà không
  // còn gì gọi tên nó nữa.
  await invoke<void>("secrets_delete", { id });
  await persist(next);
  return next;
}
```

- [ ] **Step 4: Chạy lại test, phải xanh**

```bash
npm test -- savedHosts
```

Expected: PASS, bảy ca.

- [ ] **Step 5: `savedHostsStore.ts`**

Bản sao có chủ đích của `savedConnectionsStore.ts` — chỗ thứ hai, chưa tách.

```ts
import { useEffect, useSyncExternalStore } from "react";
import {
  addSavedHost,
  loadSavedHosts,
  removeSavedHost,
  updateSavedHost,
} from "./savedHosts";
import type { SavedHost } from "./types";

/**
 * Danh sách host đã lưu, dùng chung bởi mọi tab.
 *
 * Đọc một lần: mỗi tab tự đọc thì mỗi tab tốn một lượt đọc file cộng một lượt hỏi keyring cho mỗi
 * host, và một host lưu ở tab này sẽ không thấy ở tab kia cho tới lần mở app sau. Danh sách là một
 * thứ trên đĩa, nên nó là một thứ trong bộ nhớ.
 *
 * Đây là bản sao khoảng 60 dòng của `savedConnectionsStore.ts` trong module db, chép có chủ đích:
 * ranh giới module cấm dùng chung, và đây mới là chỗ thứ hai. Chỗ thứ ba thì tách ra `core/`.
 */

/** Cái mọi người đăng ký đang thấy. Thay cả cụm, không sửa tại chỗ: `useSyncExternalStore` quyết
 *  định có render lại hay không bằng cách so tham chiếu này với tham chiếu lần trước. */
let snapshot: SavedHost[] = [];
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(list: SavedHost[]) {
  snapshot = list;
  loaded = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SavedHost[] {
  return snapshot;
}

/** Đọc một lần. Tab nào hỏi trước thì bắt đầu, tab nào mount trong lúc đó thì đi cùng một promise
 *  chứ không mở lượt đọc thứ hai. Đọc hỏng thì `loaded` ở lại `false` — tab sau thử lại. */
function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = loadSavedHosts()
      .then(publish)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Danh sách dùng chung, giữ đồng bộ giữa mọi tab gọi nó. */
export function useSavedHosts(): SavedHost[] {
  useEffect(() => {
    // Không có chỗ nào ở đây báo được lỗi đọc — cột host chỉ đơn giản là trống, và tab sau thử
    // lại. Nuốt chứ không để reject, để nó không nổi lên thành unhandled promise.
    ensureLoaded().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/* Ghi thì đi qua module vẫn ghi từ trước — nó là chỗ giữ ranh giới giữa `terminal-hosts.json` và
   kho thông tin đăng nhập — và danh sách nó trả về thành ảnh chụp mới. */

export async function addHost(host: SavedHost): Promise<void> {
  publish(await addSavedHost(host));
}

export async function updateHost(host: SavedHost): Promise<void> {
  publish(await updateSavedHost(host));
}

export async function removeHost(id: string): Promise<void> {
  publish(await removeSavedHost(id));
}
```

- [ ] **Step 6: Build**

```bash
npm test
npm run build
```

Expected: cả hai xanh. `savedHostsStore.ts` chưa có ai gọi ở bước này — `tsc` không phàn nàn vì nó export.

- [ ] **Step 7: Commit**

```bash
git add src/modules/terminal
git commit -m "feat(terminal): remember SSH hosts with their secrets in the OS store"
```

---

## Task 4: Form chọn đích, hai kiểu và một cột host

**Files:**
- Modify: `src/modules/terminal/components/TargetForm/TargetForm.tsx`
- Modify: `src/modules/terminal/components/TargetForm/TargetForm.module.css`
- Create: `src/modules/terminal/components/TargetForm/SavedHostList.tsx`
- Create: `src/modules/terminal/components/TargetForm/SavedHostList.module.css`
- Modify: `src/modules/terminal/i18n/en.ts`, `src/modules/terminal/i18n/vi.ts`

**Interfaces:**
- Consumes: `useSavedHosts`, `addHost`, `updateHost`, `removeHost` (Task 3); `TerminalChoice`, `SshConfig`, `SavedHost` (Task 2); `Button`, `Input`, `Select`, `ContextMenu`, `ConfirmDialog` — components dùng chung.
- Produces: `TargetForm` với props `{ onOpen: (choice: TerminalChoice) => void; onError: (message: string) => void; initial: TerminalChoice | null }`.

- [ ] **Step 1: Chuỗi**

`src/modules/terminal/i18n/en.ts` — nhóm `terminal` đầy đủ sau khi thêm (giữ nguyên những khoá đã có, thêm phần dưới `badgeSsh`):

```ts
const terminalEn = {
  terminal: {
    newTabTitle: "New terminal",
    localTitle: "Local shell",
    shell: "Shell",
    startIn: "Start in",
    startInPlaceholder: "Home directory",
    browse: "Browse\u2026",
    open: "Open",
    noShells: "No shell was found on this machine.",
    screen: "Terminal screen",
    badgeLocal: "Local shell",
    badgeSsh: "SSH session",
    badgeEnded: "Session ended",
    sessionEnded: "The session has ended.",
    sessionEndedCode: "The session has ended (exit code {{code}}).",
    reconnect: "Reconnect",
    targetLocal: "This machine",
    targetSsh: "SSH",
    savedHosts: "Hosts",
    noHosts: "No host saved yet.",
    newHost: "New host",
    hostName: "Name",
    hostNamePlaceholder: "Production web server",
    host: "Host",
    port: "Port",
    username: "User",
    authMethod: "Authenticate with",
    authPassword: "Password",
    authPrivateKey: "Private key",
    password: "Password",
    privateKeyFile: "Private key file",
    keyPassphrase: "Key passphrase",
    saveHost: "Save host",
    updateHost: "Update host",
    deleteHost: "Delete",
    deleteHostTitle: "Delete host",
    deleteHostMessage: "Delete \u201c{{name}}\u201d? Its password is removed from the credential store too.",
    connect: "Connect",
    connecting: "Connecting\u2026",
  },
  error: {
    terminalSpawnFailed: "Could not start the shell: {{message}}",
    terminalShellNotFound: "There is no shell at {{path}}.",
    terminalUnknownSession: "That terminal session is no longer open.",
  },
};
```

`vi.ts` — cùng khoá, cùng thứ tự:

```ts
    targetLocal: "Máy này",
    targetSsh: "SSH",
    savedHosts: "Máy chủ",
    noHosts: "Chưa lưu máy chủ nào.",
    newHost: "Máy chủ mới",
    hostName: "Tên",
    hostNamePlaceholder: "Máy chủ web production",
    host: "Địa chỉ",
    port: "Cổng",
    username: "Người dùng",
    authMethod: "Xác thực bằng",
    authPassword: "Mật khẩu",
    authPrivateKey: "Khoá riêng",
    password: "Mật khẩu",
    privateKeyFile: "File khoá riêng",
    keyPassphrase: "Passphrase của khoá",
    saveHost: "Lưu máy chủ",
    updateHost: "Cập nhật",
    deleteHost: "Xoá",
    deleteHostTitle: "Xoá máy chủ",
    deleteHostMessage: "Xoá \u201c{{name}}\u201d? Mật khẩu của nó cũng bị xoá khỏi kho thông tin đăng nhập.",
    connect: "Kết nối",
    connecting: "Đang kết nối\u2026",
```

Viết chữ có dấu theo đúng cách các dòng lân cận trong `vi.ts` đang viết — nếu chúng dùng escape `\uXXXX` thì dùng escape, nếu viết thẳng thì viết thẳng. Dấu ngoặc kép cong (`\u201c`, `\u201d`) thì luôn dùng escape, như dòng `browse` đã làm với `\u2026`.

- [ ] **Step 2: `SavedHostList`**

`src/modules/terminal/components/TargetForm/SavedHostList.tsx`:

```tsx
import { useState } from "react";
import ConfirmDialog from "../../../../components/ConfirmDialog";
import ContextMenu from "../../../../components/ContextMenu";
import { useTranslation } from "../../../../i18n";
import type { SavedHost } from "../../types";
import styles from "./SavedHostList.module.css";

interface Props {
  hosts: SavedHost[];
  /** Host đang được nạp trong form, để tô sáng đúng dòng. */
  selectedId: string | null;
  onSelect: (host: SavedHost) => void;
  onDelete: (id: string) => void;
  /** Bỏ form về trắng — cùng chỗ với danh sách vì nó là hành động trên danh sách, không phải trên
   *  một dòng nào của nó. */
  onNew: () => void;
}

/** Nơi mở menu, và mở trên host nào. */
interface MenuState {
  host: SavedHost;
  x: number;
  y: number;
}

/**
 * Cột host đã lưu.
 *
 * Tự vẽ chứ không dùng `ItemList`: cái đó nói lại bằng tên, và hai host trùng tên — chuyện thường
 * với "prod" — thì không phân biệt được. Danh sách này đi theo `id`.
 */
function SavedHostList({ hosts, selectedId, onSelect, onDelete, onNew }: Props) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirming, setConfirming] = useState<SavedHost | null>(null);

  return (
    <aside className={styles.list}>
      <div className={styles.header}>
        <h3>{t("terminal.savedHosts")}</h3>
        <button
          type="button"
          className={styles.new}
          onClick={onNew}
          title={t("terminal.newHost")}
        >
          +<span className="visually-hidden">{t("terminal.newHost")}</span>
        </button>
      </div>

      {hosts.length === 0 ? (
        <p className={styles.empty}>{t("terminal.noHosts")}</p>
      ) : (
        <ul>
          {hosts.map((host) => (
            <li key={host.id}>
              <button
                type="button"
                className={`${styles.item}${host.id === selectedId ? ` ${styles.itemActive}` : ""}`}
                onClick={() => onSelect(host)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ host, x: e.clientX, y: e.clientY });
                }}
              >
                <strong>{host.name}</strong>
                <span className={styles.endpoint}>
                  {host.config.username}@{host.config.host}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            type="button"
            onClick={() => {
              setConfirming(menu.host);
              setMenu(null);
            }}
          >
            {t("terminal.deleteHost")}
          </button>
        </ContextMenu>
      )}

      {confirming && (
        <ConfirmDialog
          title={t("terminal.deleteHostTitle")}
          message={t("terminal.deleteHostMessage", { name: confirming.name })}
          confirmLabel={t("terminal.deleteHost")}
          danger
          onConfirm={() => {
            onDelete(confirming.id);
            setConfirming(null);
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
    </aside>
  );
}

export default SavedHostList;
```

Kiểm tra `src/components/ConfirmDialog/index.ts` và `src/components/ContextMenu.tsx` xem chúng export mặc định như trên (ConfirmDialog qua thư mục, ContextMenu qua file). Nếu đường import khác, sửa theo cái có thật.

`SavedHostList.module.css`:

```css
.list {
  display: flex;
  flex-direction: column;
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  overflow-y: auto;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.header h3 {
  margin: 0;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.7;
}

.new {
  width: 22px;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  line-height: 1;
}

.new:hover {
  background: var(--hover-bg);
}

.empty {
  margin: 0;
  padding: 12px;
  font-size: 0.85rem;
  opacity: 0.7;
}

.list ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.item:hover {
  background: var(--hover-bg);
}

.itemActive {
  background: var(--selection-bg);
}

.item strong {
  font-weight: 600;
  font-size: 0.9rem;
}

.endpoint {
  font-size: 0.78rem;
  opacity: 0.7;
}
```

Kiểm tra tên biến CSS có thật trong `src/shell/App.css` (`--border`, `--hover-bg`, `--selection-bg`, `--page-bg`). Nếu tên khác, dùng tên có thật — [css-modules.md](../../../.agent/conventions/css-modules.md) là chỗ tra.

- [ ] **Step 3: `TargetForm` hai kiểu**

Viết lại cả file:

```tsx
import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { localShells } from "../../api";
import { addHost, removeHost, updateHost, useSavedHosts } from "../../savedHostsStore";
import { shellLabel } from "../../shells";
import type { LocalShell, SavedHost, SshAuth, SshConfig, TerminalChoice } from "../../types";
import SavedHostList from "./SavedHostList";
import styles from "./TargetForm.module.css";

/** Đường dẫn khoá riêng trông như thế nào trên máy đang chạy — một gợi ý, không phải một chuỗi
 *  dịch được: một đường dẫn không có bản tiếng Việt. */
const PRIVATE_KEY_PLACEHOLDER = navigator.userAgent.includes("Windows")
  ? "C:\\Users\\you\\.ssh\\id_ed25519"
  : navigator.userAgent.includes("Mac")
    ? "/Users/you/.ssh/id_ed25519"
    : "/home/you/.ssh/id_ed25519";

const DEFAULT_SSH_PORT = 22;

interface Props {
  onOpen: (choice: TerminalChoice) => void;
  onError: (message: string) => void;
  /** Cái tab vừa thử mở và hỏng. Form dựng lại đúng những gì người dùng đã gõ — một form bị xoá
   *  trắng sau mỗi lần sai mật khẩu là một form không ai dùng nổi. */
  initial: TerminalChoice | null;
}

/** Màn hình một tab terminal hiện trước khi có phiên: chọn máy này hay một máy chủ. */
function TargetForm({ onOpen, onError, initial }: Props) {
  const { t } = useTranslation();
  const hosts = useSavedHosts();

  const [kind, setKind] = useState<"local" | "ssh">(initial?.kind ?? "local");

  // Local
  const [shells, setShells] = useState<LocalShell[]>([]);
  const [path, setPath] = useState(initial?.kind === "local" ? initial.shell.path : "");
  const [cwd, setCwd] = useState(initial?.kind === "local" ? (initial.cwd ?? "") : "");

  // SSH
  const [hostId, setHostId] = useState<string | null>(
    initial?.kind === "ssh" ? initial.hostId : null,
  );
  const [name, setName] = useState("");
  const [host, setHost] = useState(initial?.kind === "ssh" ? initial.config.host : "");
  const [port, setPort] = useState(
    initial?.kind === "ssh" ? initial.config.port : DEFAULT_SSH_PORT,
  );
  const [username, setUsername] = useState(
    initial?.kind === "ssh" ? initial.config.username : "",
  );
  const [authType, setAuthType] = useState<"password" | "privatekey">(
    initial?.kind === "ssh" ? initial.config.auth.type : "password",
  );
  const [password, setPassword] = useState(
    initial?.kind === "ssh" && initial.config.auth.type === "password"
      ? initial.config.auth.password
      : "",
  );
  const [keyPath, setKeyPath] = useState(
    initial?.kind === "ssh" && initial.config.auth.type === "privatekey"
      ? initial.config.auth.key_path
      : "",
  );
  const [passphrase, setPassphrase] = useState(
    initial?.kind === "ssh" && initial.config.auth.type === "privatekey"
      ? (initial.config.auth.passphrase ?? "")
      : "",
  );

  useEffect(() => {
    localShells()
      .then((found) => {
        setShells(found);
        // Cái đầu tiên là cái Rust gợi ý, và cũng là cái `default_shell()` sẽ chọn.
        setPath((current) => current || (found[0]?.path ?? ""));
      })
      .catch((e) => onError(errorMessage(t, e)));
    // Chỉ chạy một lần: danh sách shell của một máy không đổi giữa chừng.
  }, []);

  const chosenShell = shells.find((shell) => shell.path === path);

  async function browseDirectory() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setCwd(picked);
  }

  async function browseKeyFile() {
    const picked = await openDialog({ directory: false, multiple: false });
    if (typeof picked === "string") setKeyPath(picked);
  }

  function buildAuth(): SshAuth {
    return authType === "password"
      ? { type: "password", password }
      : { type: "privatekey", key_path: keyPath, passphrase: passphrase || undefined };
  }

  function buildConfig(): SshConfig {
    return { host: host.trim(), port, username: username.trim(), auth: buildAuth() };
  }

  /** Đủ để một lần thử có nghĩa: địa chỉ, người dùng, và cái mà cách xác thực đang chọn cần. */
  const sshReady =
    host.trim() !== "" &&
    username.trim() !== "" &&
    (authType === "password" ? password !== "" : keyPath.trim() !== "");

  function applyHost(entry: SavedHost) {
    setHostId(entry.id);
    setName(entry.name);
    setHost(entry.config.host);
    setPort(entry.config.port);
    setUsername(entry.config.username);
    setAuthType(entry.config.auth.type);
    setPassword(entry.config.auth.type === "password" ? entry.config.auth.password : "");
    setKeyPath(entry.config.auth.type === "privatekey" ? entry.config.auth.key_path : "");
    setPassphrase(
      entry.config.auth.type === "privatekey" ? (entry.config.auth.passphrase ?? "") : "",
    );
  }

  function clearHostForm() {
    setHostId(null);
    setName("");
    setHost("");
    setPort(DEFAULT_SSH_PORT);
    setUsername("");
    setAuthType("password");
    setPassword("");
    setKeyPath("");
    setPassphrase("");
  }

  async function saveHost() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (hostId) {
        await updateHost({ id: hostId, name: trimmed, config: buildConfig() });
      } else {
        const entry: SavedHost = {
          id: crypto.randomUUID(),
          name: trimmed,
          config: buildConfig(),
        };
        await addHost(entry);
        setHostId(entry.id);
      }
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }

  async function deleteHost(id: string) {
    try {
      await removeHost(id);
      if (hostId === id) clearHostForm();
    } catch (e) {
      onError(errorMessage(t, e));
    }
  }

  return (
    <div className={styles.layout}>
      {kind === "ssh" && (
        <SavedHostList
          hosts={hosts}
          selectedId={hostId}
          onSelect={applyHost}
          onDelete={(id) => void deleteHost(id)}
          onNew={clearHostForm}
        />
      )}

      <div className={styles.form}>
        {/* Hai kiểu đích. Nút chứ không phải `Select`: chỉ có hai, và cái đang chọn quyết định cả
            phần còn lại của form — đáng để thấy được cả hai cùng lúc. */}
        <div className={styles.kinds} role="tablist" aria-label={t("terminal.newTabTitle")}>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "local"}
            className={`${styles.kind}${kind === "local" ? ` ${styles.kindActive}` : ""}`}
            onClick={() => setKind("local")}
          >
            {t("terminal.targetLocal")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "ssh"}
            className={`${styles.kind}${kind === "ssh" ? ` ${styles.kindActive}` : ""}`}
            onClick={() => setKind("ssh")}
          >
            {t("terminal.targetSsh")}
          </button>
        </div>

        {kind === "local" ? (
          <>
            <div className={styles.row}>
              {/* `Select` không nhận `id`, nên nhãn của nó là `ariaLabel` chứ không phải `htmlFor` */}
              <span>{t("terminal.shell")}</span>
              <Select
                value={path}
                options={shells.map((shell) => ({
                  value: shell.path,
                  label: shellLabel(shell.name),
                }))}
                onChange={setPath}
                ariaLabel={t("terminal.shell")}
                placeholder={t("terminal.noShells")}
              />
            </div>

            <div className={styles.row}>
              <label htmlFor="terminal-cwd">{t("terminal.startIn")}</label>
              <div className={styles.withButton}>
                <Input
                  id="terminal-cwd"
                  value={cwd}
                  placeholder={t("terminal.startInPlaceholder")}
                  onChange={(e) => setCwd(e.target.value)}
                />
                <Button onClick={() => void browseDirectory()}>{t("terminal.browse")}</Button>
              </div>
            </div>

            <Button
              variant="primary"
              disabled={!chosenShell}
              onClick={() =>
                chosenShell &&
                onOpen({ kind: "local", shell: chosenShell, cwd: cwd.trim() || null })
              }
            >
              {t("terminal.open")}
            </Button>
          </>
        ) : (
          <>
            <div className={styles.row}>
              <label htmlFor="terminal-host-name">{t("terminal.hostName")}</label>
              <Input
                id="terminal-host-name"
                value={name}
                placeholder={t("terminal.hostNamePlaceholder")}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className={styles.columns}>
              <div className={styles.row}>
                <label htmlFor="terminal-host">{t("terminal.host")}</label>
                <Input
                  id="terminal-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </div>
              <div className={`${styles.row} ${styles.narrow}`}>
                <label htmlFor="terminal-port">{t("terminal.port")}</label>
                <Input
                  id="terminal-port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.row}>
              <label htmlFor="terminal-user">{t("terminal.username")}</label>
              <Input
                id="terminal-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className={styles.row}>
              <span>{t("terminal.authMethod")}</span>
              <Select
                value={authType}
                options={[
                  { value: "password", label: t("terminal.authPassword") },
                  { value: "privatekey", label: t("terminal.authPrivateKey") },
                ]}
                onChange={(value) => setAuthType(value as "password" | "privatekey")}
                ariaLabel={t("terminal.authMethod")}
              />
            </div>

            {authType === "password" ? (
              <div className={styles.row}>
                <label htmlFor="terminal-password">{t("terminal.password")}</label>
                <Input
                  id="terminal-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className={styles.row}>
                  <label htmlFor="terminal-key">{t("terminal.privateKeyFile")}</label>
                  <div className={styles.withButton}>
                    <Input
                      id="terminal-key"
                      value={keyPath}
                      placeholder={PRIVATE_KEY_PLACEHOLDER}
                      onChange={(e) => setKeyPath(e.target.value)}
                    />
                    <Button onClick={() => void browseKeyFile()}>{t("terminal.browse")}</Button>
                  </div>
                </div>
                <div className={styles.row}>
                  <label htmlFor="terminal-passphrase">{t("terminal.keyPassphrase")}</label>
                  <Input
                    id="terminal-passphrase"
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className={styles.actions}>
              <Button disabled={!name.trim()} onClick={() => void saveHost()}>
                {hostId ? t("terminal.updateHost") : t("terminal.saveHost")}
              </Button>
              <Button
                variant="primary"
                disabled={!sshReady}
                onClick={() => onOpen({ kind: "ssh", config: buildConfig(), hostId })}
              >
                {t("terminal.connect")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TargetForm;
```

- [ ] **Step 4: CSS của form**

`TargetForm.module.css` — thay cả file:

```css
.layout {
  display: flex;
  height: 100%;
  min-height: 0;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(480px, 100%);
  margin: 48px auto;
  padding: 0 16px;
}

.kinds {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}

.kind {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.kind:hover {
  background: var(--hover-bg);
}

.kindActive {
  border-color: var(--accent);
  background: var(--selection-bg);
}

.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.columns {
  display: flex;
  gap: 8px;
}

.columns .row {
  flex: 1;
}

.narrow {
  flex: 0 0 90px;
}

.withButton {
  display: flex;
  gap: 8px;
}

.withButton input {
  flex: 1;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 5: Truyền `initial` từ tab**

`TerminalTab.tsx` — giữ lại cái vừa thử để form dựng lại. Thêm state và truyền xuống:

```tsx
  /* Cái tab vừa thử mở. Khác `choice` ở chỗ nó không bị xoá khi phiên hỏng — form cần nó để dựng
     lại đúng những gì người dùng đã gõ. */
  const [lastTried, setLastTried] = useState<TerminalChoice | null>(null);

  function start(next: TerminalChoice) {
    setLastTried(next);
    setChoice(next);
  }
```

và:

```tsx
        <TargetForm onOpen={start} onError={showError} initial={lastTried} />
```

- [ ] **Step 6: Build**

```bash
npm test
npm run build
```

Expected: cả hai xanh.

- [ ] **Step 7: Kiểm tay**

```bash
npm run dev:app
```

- Mở tab Terminal → kiểu "Máy này" là mặc định, form giống hệt đợt 1, mở được shell.
- Đổi sang "SSH" → cột host bên trái hiện ra, rỗng, có câu "Chưa lưu máy chủ nào."
- Nhập tên + host + user + mật khẩu, bấm "Lưu máy chủ" → dòng mới hiện trong cột trái ngay lập tức.
- Mở một tab Terminal thứ hai, chuyển sang SSH → host vừa lưu đã có sẵn ở đó (đó là điểm của `savedHostsStore`).
- Đóng app, mở lại, vào SSH → host còn đó, mật khẩu vẫn được điền sẵn.
- Mở Credential Manager (Windows) / Keychain (macOS) → có một entry `MixDB` mang id của host; mở `%APPDATA%/<app>/terminal-hosts.json` → **không** có mật khẩu trong đó. Đây là bước kiểm quan trọng nhất của task này.
- Chuột phải một host → "Xoá" → hỏi lại → xoá xong thì dòng biến mất và entry trong kho thông tin đăng nhập cũng biến mất.

- [ ] **Step 8: Commit**

```bash
git add src/modules/terminal
git commit -m "feat(terminal): choose between this machine and a saved SSH host"
```

---

## Task 5: Vòng đời một phiên SSH trong tab

**Files:**
- Modify: `src/modules/terminal/components/TerminalView/TerminalView.tsx`
- Modify: `src/modules/terminal/TerminalTab.tsx`
- Modify: `src/modules/terminal/terminal.css`

**Interfaces:**
- Consumes: `TerminalChoice`, `terminalTarget` (Task 2); `TargetForm` với `initial` (Task 4).
- Produces: `TerminalView` với props `{ target, active, onOpened, onExit, onFailed, onError }`.

- [ ] **Step 1: `TerminalView` nói ra hai chuyện mới**

Sửa `Props` và chỗ mở phiên. Phần còn lại của file giữ nguyên:

```tsx
interface Props {
  target: TerminalTarget;
  /** Tab nằm sau vẫn mounted và vẫn nhận byte — cái này chỉ quyết định focus và lúc nào đo lại. */
  active: boolean;
  /** Phiên đã mở xong. Với SSH thì đây là lúc kết nối, xác thực và xin pty đều đã qua — vài giây
   *  sau khi bấm nút, nên tab có gì đó để nói trong lúc chờ. */
  onOpened: () => void;
  onExit: (exit: SessionExit) => void;
  /** Phiên không mở được: sai mật khẩu, vân tay đổi, máy chủ không tới được. Khác `onError` ở chỗ
   *  nó nói rằng *không có phiên nào cả*, nên tab trả màn hình về form. */
  onFailed: () => void;
  onError: (message: string) => void;
}
```

Trong body, thêm hai ref cạnh những cái đã có:

```tsx
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;
```

Và chỗ gọi `openSession`:

```tsx
    void openSession(id, target, { cols: term.cols, rows: term.rows }, (message) => {
      if (message instanceof ArrayBuffer) {
        term.write(new Uint8Array(message));
        return;
      }
      ended = true;
      onExitRef.current(message);
    })
      .then(() => onOpenedRef.current())
      .catch((e) => {
        // Không có phiên nào để đóng: `terminal_open` hỏng trước khi đưa được gì vào map.
        ended = true;
        onErrorRef.current(errorMessage(tRef.current, e));
        onFailedRef.current();
      });
```

`ended = true` trong nhánh hỏng là điều phải làm: nếu không, cleanup sẽ gọi `terminal_close` cho một id chưa từng tồn tại. Lệnh ấy tha thứ cho id lạ, nhưng gọi nó vẫn là nói dối về cái đã xảy ra.

- [ ] **Step 2: Tab hiện "đang kết nối" và trả về form khi hỏng**

`TerminalTab.tsx` — thêm state, hai callback, và một dải:

```tsx
  const [opening, setOpening] = useState(false);
```

`start` đặt cờ:

```tsx
  function start(next: TerminalChoice) {
    setLastTried(next);
    setExit(null);
    setOpening(true);
    setChoice(next);
  }
```

Hai callback ổn định — `TerminalView` giữ chúng trong ref nên tham chiếu không cần ổn định, nhưng `useCallback` giữ cho `onBadgesChange` và bạn bè không phải nghĩ:

```tsx
  const opened = useCallback(() => setOpening(false), []);

  /* Phiên không mở được. `choice` bị xoá nên form quay lại — với `lastTried` còn nguyên, nên
     người dùng sửa mật khẩu rồi bấm lại chứ không gõ lại từ đầu. Banner do `onError` đặt vẫn ở
     trên đó. */
  const failed = useCallback(() => {
    setOpening(false);
    setChoice(null);
  }, []);
```

`reconnect` cũng phải bật lại cờ:

```tsx
  function reconnect() {
    setExit(null);
    setOpening(true);
    setGeneration((n) => n + 1);
  }
```

JSX:

```tsx
      {target ? (
        <>
          <TerminalView
            key={generation}
            target={target}
            active={active}
            onOpened={opened}
            onExit={setExit}
            onFailed={failed}
            onError={showError}
          />
          {opening && <div className="terminal-connecting">{t("terminal.connecting")}</div>}
          {exit && (
            <div className="terminal-ended">
              <span>
                {exit.code === null
                  ? t("terminal.sessionEnded")
                  : t("terminal.sessionEndedCode", { code: exit.code })}
              </span>
              <Button onClick={reconnect}>{t("terminal.reconnect")}</Button>
            </div>
          )}
        </>
      ) : (
        <TargetForm onOpen={start} onError={showError} initial={lastTried} />
      )}
```

- [ ] **Step 3: Dải "đang kết nối"**

`terminal.css`, sau `.terminal-ended`:

```css
.terminal-connecting {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--page-bg);
  font-size: 0.85rem;
  opacity: 0.8;
}
```

Dải dưới màn hình chứ không phải overlay phủ lên: xterm đã ở đó, đã đo xong kích thước, và một lớp phủ trong lúc đó chỉ để lại một khung đen. Điều cần nói là "đang chờ máy chủ", và một dòng chữ nói được điều đó.

- [ ] **Step 4: Build**

```bash
npm test
npm run build
```

Expected: cả hai xanh.

- [ ] **Step 5: Kiểm tay — cái đợt này thật sự làm ra**

```bash
npm run dev:app
```

Với một máy chủ SSH thật:

- Kết nối bằng mật khẩu → dải "Đang kết nối…" hiện lên, rồi biến mất khi prompt tới. Tab đổi tên thành `user@host`.
- **Sai mật khẩu** → `ErrorBanner` hiện câu của `error.sshAuthFailed`/`sshAuthRejected`, màn hình quay về form, mọi ô còn nguyên chữ đã gõ.
- Kết nối bằng khoá riêng, cả khoá có passphrase và khoá không.
- `vim` và `top` qua SSH; kéo cửa sổ trong lúc `top` đang chạy → vẽ lại đúng kích thước mới.
- `yes` vài giây rồi `Ctrl+C` → UI không nghẹt, ngắt được.
- `exit` → dải kết thúc hiện **sau** dòng `logout`, kèm mã thoát. Bấm "Kết nối lại" → phiên mới, cùng máy chủ.
- Đóng tab trong lúc phiên đang chạy → trên máy chủ, `who` không còn phiên đó (kiểm từ một phiên ssh khác).
- Thoát hẳn app trong lúc hai tab SSH đang mở → cả hai phiên biến mất khỏi `who`.
- Mở một tab Database dùng tunnel SSH tới cùng máy chủ đó, rồi đóng tab terminal → kết nối database **không** rụng. Đây là chỗ chứng minh "kết nối riêng" ở Task 1 là thật.

- [ ] **Step 6: Commit**

```bash
git add src/modules/terminal
git commit -m "feat(terminal): say when a session is still connecting and hand failures back to the form"
```

---

## Task 6: Đóng đợt

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Kiểm ranh giới module**

Hai lệnh của [adding-a-module.md](../../../.agent/conventions/adding-a-module.md), chạy trong PowerShell:

```powershell
Get-ChildItem -Recurse src/components,src/core,src/icons -Include *.ts,*.tsx |
  Select-String "modules/"
```
Expected: không có gì.

```powershell
Get-ChildItem -Recurse src/shell,src/i18n -Include *.ts,*.tsx | Select-String "modules/"
```
Expected: chỉ `src/shell/registry.ts` và `src/i18n/dicts.ts`.

Và một lệnh nữa cho chiều ngược lại — module terminal không được biết module nào khác:

```powershell
Get-ChildItem -Recurse src/modules/terminal -Include *.ts,*.tsx |
  Select-String "modules/db|modules/rest"
```
Expected: không có gì.

- [ ] **Step 2: Chạy hết**

```bash
npm test
npm run build
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

Expected: tất cả xanh. Nếu có gì đỏ, sửa ở đây chứ không ghi vào changelog trước.

- [ ] **Step 3: Một dòng trong CHANGELOG**

Đọc [.agent/conventions/changelog.md](../../../.agent/conventions/changelog.md) trước khi viết. Một dòng ngắn dưới `### Added` trong `## [Unreleased]`, tiếng Anh, viết cho người dùng:

```markdown
- Terminal tabs can open a shell on a remote server over SSH, with saved hosts whose passwords live in the OS credential store.
```

Nếu `## [Unreleased]` chưa có `### Added`, thêm heading đó theo đúng thứ tự `Added` → `Changed` → `Fixed`. Nếu dòng của đợt 1 đã ở đó và nói về terminal, cân nhắc **sửa dòng ấy** thay vì thêm dòng thứ hai — đợt 1 chưa phát hành, và người đọc changelog quan tâm module terminal làm được gì, không quan tâm nó được làm trong mấy đợt.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(terminal): note remote SSH sessions in the changelog"
```

---

## Những gì đợt này để lại cho đợt 3

Ghi ra để không ai tưởng là bỏ sót:

- `Ctrl+W`, `Ctrl+R` vẫn là đóng tab và reload pane, kể cả khi con trỏ đang ở trong terminal. Spec §3.
- Không copy/paste bằng phím, không `Ctrl+F`, không menu chuột phải trong màn hình phiên.
- Không có Settings pane: font, cỡ chữ, scrollback, kiểu con trỏ vẫn là hằng số trong `TerminalView`. Spec §6 đợt 4.
- `TerminalEvent::Exit.message` vẫn luôn `None` — xem Quyết định 4.
