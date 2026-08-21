# Module Terminal — Plan đợt 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menu `[+]` mở được tab Terminal thứ ba bên cạnh Database và REST; tab hỏi mở shell nào trên chính máy đang chạy app, rồi giao cả tab cho một phiên gõ được — `vim`, `top`, prompt màu, đổi kích thước, `yes` bắn chữ đầy màn hình đều đúng.

**Architecture:** Rust có một module mới với một tay cầm phiên duy nhất (`Session`) và một đường ra duy nhất (`OutputSink`); đợt này chỉ có một hàm dựng phiên là `local::spawn` qua `portable-pty`, đợt 2 thêm `remote::spawn` mà không đụng gì phía trên. Byte đọc được từ pty đi qua bộ gom lô rồi qua `tauri::ipc::Channel` của riêng phiên đó. Phía frontend là một module đúng khuôn `adding-a-module.md`: một thư mục, một dòng trong registry, một dòng trong dicts — cộng một instance xterm.js gói trong `TerminalView`.

**Tech Stack:** Rust + Tauri 2.11 (`tauri::ipc::Channel`, `InvokeResponseBody`), `portable-pty` 0.9, `tokio` + `tokio-util` (`CancellationToken`); TypeScript strict, React 19, CSS Modules, vitest, `@xterm/xterm` 6 + `@xterm/addon-fit` 0.11.

**Spec:** [docs/superpowers/specs/2026-08-21-terminal-module-design.md](../specs/2026-08-21-terminal-module-design.md) — §1 (backend, `Session`, năm lệnh, `Channel`, gom lô), §2 (cây frontend, `TerminalTab`, `TerminalView`), §4 (bảng lỗi), §5 (kiểm thử), giới hạn bởi §6: *"Khung + shell cục bộ"*.

## Global Constraints

- **Ranh giới module.** Không file nào ngoài `src/modules/terminal/` được biết khái niệm của terminal. Đúng hai ngoại lệ: một dòng trong `src/shell/registry.ts`, một khối import trong `src/i18n/dicts.ts`. Kiểm bằng hai lệnh grep trong [adding-a-module.md](../../../.agent/conventions/adding-a-module.md) trước khi đóng đợt.
- **Chỉ test logic thuần.** Repo không có jsdom và đợt này không thêm. Cái gì sai được thì tách thành hàm thuần: bảng nhãn shell, hình dạng target gửi xuống Rust, badge, bộ gom lô (test bên Rust).
- **Chuỗi nằm ở hai từ điển.** `src/modules/terminal/i18n/en.ts` và `vi.ts`, nhóm phẳng ở tầng ngoài cùng, ký hiệu viết dạng escape (`\u2026`) còn chữ tiếng Việt để nguyên — theo [i18n.md](../../../.agent/conventions/i18n.md). Không có tiếng Anh chết trong JSX.
- **Component nằm trong thư mục riêng** kèm `index.ts`, theo [component-structure.md](../../../.agent/conventions/component-structure.md). Đợt này: `TerminalView`, `TargetForm`.
- **Một lệnh Rust mới phải có mặt ở năm chỗ**: hàm trong `commands.rs`, dòng trong `modules::handler()`, hàm gọi trong `api.ts`, kiểu trong `types.ts`, và khoá `error.*` cho mọi `err!` nó sinh ra. Thiếu dòng trong `handler()` thì lệnh không tồn tại lúc chạy và không có gì báo lúc build.
- **Nhận xét trong code viết tiếng Việt**, theo `src-tauri/src/ssh/mod.rs` — phần Rust mới nhất của repo.
- **Chỉ commit khi được yêu cầu.** Bước commit của mỗi việc ghi sẵn câu message để dùng *khi* được yêu cầu. Message có prefix và scope: `feat(terminal): …`. Không có trailer `Co-Authored-By`.
- Kiểm bằng `npm test`, `npm run build` (là `tsc && vite build`, nên cũng là bước typecheck) và `cd src-tauri && cargo test`.

---

## Phạm vi: chỉ đợt 1

Bảy điều đã chốt ở đây để không việc nào phải cãi lại.

### 1. Kênh chở byte thô, không base64 — đã kiểm được từ mã nguồn

Spec để ngỏ câu hỏi này cho việc đầu tiên của đợt 1. Câu trả lời đọc được trong
`tauri-2.11.5/src/ipc/channel.rs`:

- `JavaScriptChannelId::channel_on` đánh số thứ tự (`index`) cho **mọi** khung gửi đi, và
  `Channel` phía JS (`node_modules/@tauri-apps/api/core.js`) giữ hàng đợi `pendingMessages`, chỉ
  gọi `onmessage` đúng theo số thứ tự đó. **Thứ tự được framework bảo đảm**, kể cả khi khung to đi
  đường `fetch` còn khung nhỏ đi đường `eval`.
- `InvokeResponseBody::Raw(Vec<u8>)` cài `IpcResponse`, nên gửi thẳng được. Khung dưới 1024 byte
  tới JS thành `ArrayBuffer` dựng tại chỗ; khung lớn hơn đi qua `fetch` và
  `scripts/ipc-protocol.js` trả `response.arrayBuffer()` — **cả hai đường đều ra `ArrayBuffer`**.

Nên: `Data` là `InvokeResponseBody::Raw`, `Exit` là `InvokeResponseBody::Json` trên **cùng một
kênh**. Bỏ base64 ở cả hai chiều. Chiều lên (`terminal_write`) nhận thẳng `String` — cái xterm sinh
ra ở `onData` luôn là chuỗi hợp lệ, và `as_bytes()` cho ra đúng UTF-8 cần ghi vào pty.

### 2. `Session` nói chuyện với đường ra qua `OutputSink`, không qua `Channel`

`local::spawn` nhận `Arc<dyn Fn(Output) + Send + Sync>` chứ không nhận `Channel`. Hai cái lợi:
`commands.rs` là chỗ duy nhất biết tới IPC, và cả lớp phiên test được bằng `cargo test` mà không
cần webview.

### 3. `Exit` đi sau byte cuối, bằng cấu trúc chứ không bằng may mắn

Thread đọc pty là chỗ duy nhất giữ đầu gửi của kênh byte thô. Nó kết thúc → kênh đóng → bộ gom lô
đẩy nốt phần còn lại rồi trả về → **lúc đó** task mới đọc mã thoát từ `oneshot` và phát `Exit`. Một
đường thẳng, không có chỗ cho `logout` hiện sau khi tab đã báo phiên đóng.

### 4. Bộ gom lô tính hạn từ byte đầu tiên, không từ byte gần nhất

Đặt lại hạn 5ms mỗi lần nhận thêm byte là lỗi kiểu Nagle: một dòng chảy đều 1 byte mỗi 3ms sẽ
không bao giờ được đẩy. Hạn tính từ lúc đệm chuyển từ rỗng sang không rỗng, và có một test riêng
canh đúng chuyện đó.

### 5. `TerminalView` tự sinh id phiên của nó

`main.tsx` bật `React.StrictMode`, nên trong dev mọi effect chạy mount → cleanup → mount. Nếu id
phiên do tab cấp thì lần cleanup thứ nhất có thể đóng đúng phiên mà lần mount thứ hai vừa mở. Id
sinh trong chính effect (`crypto.randomUUID()`), cleanup đóng đúng id nó đã mở, nên hai vòng đời
không giẫm lên nhau. Bấm *Kết nối lại* là đổi `key` của `TerminalView` cho nó mount lại.

### 6. Nhãn shell là tên riêng, không dịch

`shellLabel("git-bash")` trả `"Git Bash"` trong cả hai ngôn ngữ, vì đó là tên sản phẩm. Cái được
dịch là nhãn của ô chọn (`terminal.shell`), không phải nội dung của nó.

### 7. Sai khác so với cây thư mục trong spec

Ba file spec không nêu tên, ghi ra đây để khỏi bị coi là phát sinh:

| File | Vì sao |
| --- | --- |
| `src-tauri/src/modules/terminal/stream.rs` | Bộ gom lô tách khỏi `local.rs` để test được, và để `remote.rs` đợt 2 dùng lại nguyên |
| `src/modules/terminal/shells.ts` | Bản đồ tên shell → nhãn, là một trong bốn mục test của spec §5 |
| `src/modules/terminal/session.ts` | Tiêu đề tab và badge, thuần và test được — đúng vai `db/badges.ts` |

Và hai thứ **không** làm ở đợt này dù spec có nhắc: `onBinary` của xterm (chỉ chạy khi bật giao
thức chuột dạng nhị phân) và mọi thứ dính SSH.

---

## Cây file

**Tạo mới — Rust**

| File | Việc của nó |
| --- | --- |
| `src-tauri/src/modules/terminal/mod.rs` | `register()` — `manage(TerminalState)` |
| `src-tauri/src/modules/terminal/models.rs` | `TerminalTarget`, `TerminalSize`, `LocalShell`, `TerminalEvent`, `Output`, `OutputSink` |
| `src-tauri/src/modules/terminal/state.rs` | `Session`, `TerminalState` |
| `src-tauri/src/modules/terminal/commands.rs` | Năm lệnh, và chỗ duy nhất biết tới `Channel` |
| `src-tauri/src/modules/terminal/stream.rs` | `coalesce()` — 64KB hoặc 5ms |
| `src-tauri/src/modules/terminal/local.rs` | Dò shell trên máy, và `spawn()` qua `portable-pty` |

**Tạo mới — frontend**

| File | Việc của nó |
| --- | --- |
| `src/modules/terminal/index.ts` | `terminalModule` |
| `src/modules/terminal/types.ts` | Gương của `models.rs` |
| `src/modules/terminal/api.ts` | `invoke(...)` — chỗ duy nhất gọi backend |
| `src/modules/terminal/shells.ts` (+ `.test.ts`) | `shellLabel()` |
| `src/modules/terminal/session.ts` (+ `.test.ts`) | `localTarget()`, `terminalTitle()`, `terminalBadgeMarks()` |
| `src/modules/terminal/TerminalTab.tsx` | Form → một phiên |
| `src/modules/terminal/terminal.css` | CSS của xterm và khung chứa nó |
| `src/modules/terminal/i18n/en.ts`, `i18n/vi.ts` | Chuỗi |
| `src/modules/terminal/components/TerminalView/` | Instance xterm |
| `src/modules/terminal/components/TargetForm/` | Chọn shell và thư mục bắt đầu |

**Sửa**

| File | Sửa gì |
| --- | --- |
| `src-tauri/Cargo.toml` | `portable-pty`, và `[dev-dependencies]` cho `tokio` `test-util` |
| `src-tauri/src/lib.rs` | Một dòng `register` |
| `src-tauri/src/modules/mod.rs` | `pub mod terminal;` và khối `── terminal ──` |
| `package.json` | `@xterm/xterm`, `@xterm/addon-fit` |
| `src/shell/registry.ts` | Một dòng trong `MODULES` |
| `src/i18n/dicts.ts` | Import, spread, gộp `error`, ba vế `Collision` |
| `src/i18n/en.ts`, `src/i18n/vi.ts` | `app.moduleTerminal` |
| `CHANGELOG.md` | Một dòng dưới `### Added` |

---

## Task 1: Chốt định dạng kênh và ghi lại vào spec

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-terminal-module-design.md` (mục "Byte chảy về UI", và bảng ở mục 7)

Spec nói câu hỏi byte thô hay base64 được trả lời ở việc đầu tiên của đợt 1. Trả lời được từ mã
nguồn của `tauri` 2.11.5 và của `@tauri-apps/api` đang nằm sẵn trong máy — rẻ hơn dựng một phiên
thử, và chắc chắn hơn vì nó nói cả về đường `fetch` mà một phiên thử với vài byte sẽ không đi qua.

- [ ] **Step 1: Đọc đường gửi bên Rust**

```bash
R=~/.cargo/registry/src/index.crates.io-*/tauri-2.11.5
sed -n '132,190p' $R/src/ipc/channel.rs
```

Cần thấy: `channel_on` cấp `current_index` cho mọi khung; `InvokeResponseBody::Raw` dưới 1024 byte
đi thẳng bằng `eval` thành `new Uint8Array([...]).buffer`; khung lớn hơn đi đường
`__TAURI_INTERNALS__.invoke('<fetch>')` nhưng **vẫn kèm `index`**.

- [ ] **Step 2: Đọc đường nhận bên JS**

```bash
sed -n '74,120p' node_modules/@tauri-apps/api/core.js
sed -n '40,60p' ~/.cargo/registry/src/index.crates.io-*/tauri-2.11.5/scripts/ipc-protocol.js
```

Cần thấy: `Channel` giữ `#nextMessageIndex` và `#pendingMessages`, xếp lại khung tới sai thứ tự
trước khi gọi `onmessage`; và `ipc-protocol.js` trả `response.arrayBuffer()` cho mọi thứ không phải
`application/json`.

- [ ] **Step 3: Sửa mục "Byte chảy về UI" trong spec**

Thay đoạn nói về base64 bằng kết luận. Giữ nguyên phần còn lại của mục:

````markdown
Kênh chở hai loại khung, và cùng một kênh nên **thứ tự được giữ**: `Exit` chắc chắn tới sau byte
cuối cùng.

- `Data` là `InvokeResponseBody::Raw` — byte thô, tới JS thành `ArrayBuffer`.
- `Exit` là `InvokeResponseBody::Json`:

```rust
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TerminalEvent {
    Exit { code: Option<i32>, message: Option<String> },
}
```

Base64 từng là đường lui phòng khi `Channel` không nhận byte thô. Không cần nữa:
`JavaScriptChannelId::channel_on` đánh số thứ tự cho mọi khung và `Channel` phía JS xếp lại theo
số đó, nên đường `fetch` mà khung lớn phải đi không làm sai thứ tự. Chiều lên cũng bỏ base64:
`terminal_write` nhận `String`.
````

- [ ] **Step 4: Sửa dòng đầu bảng rủi ro ở mục 7**

```markdown
| ~~`Channel` không nhận byte thô~~ | Đã kiểm trong mã nguồn tauri 2.11.5: nhận, và giữ thứ tự bằng `index`. Bỏ base64 |
```

- [ ] **Step 5: Sửa bảng lệnh ở mục 1**

Ô `terminal_write` đang ghi `data` (base64) — đổi thành `data` (chuỗi).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-21-terminal-module-design.md
git commit -m "docs(terminal): settle the session channel on raw bytes"
```

---

## Task 2: Khung module frontend và một dòng trong registry

**Files:**
- Create: `src/modules/terminal/index.ts`, `TerminalTab.tsx`, `types.ts`, `terminal.css`, `i18n/en.ts`, `i18n/vi.ts`
- Modify: `src/shell/registry.ts`, `src/i18n/dicts.ts`, `src/i18n/en.ts`, `src/i18n/vi.ts`

**Interfaces:**
- Consumes: `ModuleDefinition`, `ModuleTabProps` từ `src/shell/module.ts`; `TerminalIcon` từ `src/icons`.
- Produces: `terminalModule`; `types.ts` xuất `LocalShell`, `TerminalSize`, `TerminalTarget`, `LocalChoice` cho mọi việc sau.

Việc này chưa có test đơn vị: nó là khung, và repo cố ý không có test component. Cái thay nó là ba
lệnh kiểm ở Step 6–7 — build, hai lệnh grep ranh giới, và menu `[+]` mở ra ba mục.

- [ ] **Step 1: Kiểu, gương của `models.rs`**

`src/modules/terminal/types.ts`:

```ts
/** Một shell dò được trên máy này. `name` là định danh bền — `shells.ts` biến nó thành nhãn. */
export interface LocalShell {
  /** `powershell`, `pwsh`, `cmd`, `git-bash`, `wsl:<distro>`, `zsh`, `bash`, `sh`. */
  name: string;
  path: string;
  /** Tham số cố định của shell đó; rỗng với hầu hết, `["-d", "<distro>"]` với WSL. */
  args: string[];
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** Đích của một phiên, đúng hình dạng `TerminalTarget` bên Rust. Đợt 2 thêm nhánh `ssh`. */
export type TerminalTarget = {
  type: "local";
  shell: string;
  args: string[];
  cwd: string | null;
};

/** Cái người dùng chọn trong form. Rộng hơn `TerminalTarget` một chút: giữ cả `LocalShell` để
 *  đặt tên tab, thứ Rust không cần biết. */
export interface LocalChoice {
  shell: LocalShell;
  cwd: string | null;
}
```

- [ ] **Step 2: Chuỗi**

`src/modules/terminal/i18n/en.ts`:

```ts
/**
 * What the terminal module calls things.
 *
 * Plain data, importing nothing from `src/i18n/`: `dicts.ts` imports this file, so anything
 * imported back out of there would close the circle.
 */
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
    badgeEnded: "Session ended",
    sessionEnded: "The session has ended.",
    sessionEndedCode: "The session has ended (exit code {{code}}).",
    reconnect: "Reconnect",
  },
  error: {
    terminalSpawnFailed: "Could not start the shell: {{message}}",
    terminalShellNotFound: "There is no shell at {{path}}.",
    terminalUnknownSession: "That terminal session is no longer open.",
  },
};

export default terminalEn;
```

`src/modules/terminal/i18n/vi.ts` — cùng khoá, cùng thứ tự:

```ts
const terminalVi = {
  terminal: {
    newTabTitle: "Terminal mới",
    localTitle: "Shell cục bộ",
    shell: "Shell",
    startIn: "Bắt đầu tại",
    startInPlaceholder: "Thư mục nhà",
    browse: "Chọn\u2026",
    open: "Mở",
    noShells: "Không tìm thấy shell nào trên máy này.",
    screen: "Màn hình terminal",
    badgeLocal: "Shell cục bộ",
    badgeEnded: "Phiên đã kết thúc",
    sessionEnded: "Phiên đã kết thúc.",
    sessionEndedCode: "Phiên đã kết thúc (mã thoát {{code}}).",
    reconnect: "Kết nối lại",
  },
  error: {
    terminalSpawnFailed: "Không khởi động được shell: {{message}}",
    terminalShellNotFound: "Không có shell nào tại {{path}}.",
    terminalUnknownSession: "Phiên terminal đó không còn mở.",
  },
};

export default terminalVi;
```

- [ ] **Step 3: Tên module trong menu `[+]`**

Trong `src/i18n/en.ts`, nhóm `app`, ngay dưới `moduleRest`: `moduleTerminal: "Terminal",`.
Trong `src/i18n/vi.ts`, cùng chỗ: `moduleTerminal: "Terminal",`.

- [ ] **Step 4: Gộp từ điển**

`src/i18n/dicts.ts` — thêm import, thêm vào cả hai spread và cả hai lần gộp `error`, rồi thêm **ba**
vế `Collision` (một module thứ ba thêm ba cặp, đúng như ghi chú trong file đã nói):

```ts
import terminalEn from "../modules/terminal/i18n/en";
import terminalVi from "../modules/terminal/i18n/vi";

export const EN = {
  ...shared,
  ...dbEn,
  ...restEn,
  ...terminalEn,
  error: { ...shared.error, ...dbEn.error, ...restEn.error, ...terminalEn.error },
};

export const VI = {
  ...sharedVi,
  ...dbVi,
  ...restVi,
  ...terminalVi,
  error: { ...sharedVi.error, ...dbVi.error, ...restVi.error, ...terminalVi.error },
};

type Collision =
  | Exclude<Extract<keyof typeof shared, keyof typeof dbEn>, "error">
  | Exclude<Extract<keyof typeof shared, keyof typeof restEn>, "error">
  | Exclude<Extract<keyof typeof dbEn, keyof typeof restEn>, "error">
  | Exclude<Extract<keyof typeof shared, keyof typeof terminalEn>, "error">
  | Exclude<Extract<keyof typeof dbEn, keyof typeof terminalEn>, "error">
  | Exclude<Extract<keyof typeof restEn, keyof typeof terminalEn>, "error">;
```

- [ ] **Step 5: Tab tạm và định nghĩa module**

`src/modules/terminal/terminal.css` — đợt này mới chỉ cần khung:

```css
.terminal-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
```

`src/modules/terminal/TerminalTab.tsx`:

```tsx
import { useEffect } from "react";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import "./terminal.css";

/** Terminal: một tab, một phiên. Việc 7 thay chỗ giữ chỗ này bằng form chọn đích. */
function TerminalTab({ onTitleChange }: ModuleTabProps) {
  const { t } = useTranslation();

  useEffect(() => {
    onTitleChange(t("terminal.newTabTitle"));
  }, [onTitleChange, t]);

  return <div className="terminal-tab">{t("terminal.localTitle")}</div>;
}

export default TerminalTab;
```

`src/modules/terminal/index.ts`:

```ts
import type { ModuleDefinition } from "../../shell/module";
import { TerminalIcon } from "../../icons";
import TerminalTab from "./TerminalTab";

/** Terminal: một phiên shell trên máy này, hoặc — từ đợt 2 — trên một máy chủ qua SSH. */
export const terminalModule: ModuleDefinition = {
  id: "terminal",
  labelKey: "app.moduleTerminal",
  Icon: TerminalIcon,
  defaultTitleKey: "terminal.newTabTitle",
  Tab: TerminalTab,
};
```

`src/shell/registry.ts` — một dòng import và một phần tử:

```ts
import { terminalModule } from "../modules/terminal";

export const MODULES: ModuleDefinition[] = [dbModule, restModule, terminalModule];
```

- [ ] **Step 6: Build và kiểm ranh giới**

```bash
npm run build
```
Kỳ vọng: pass. Rồi hai lệnh grep của `adding-a-module.md`:

```powershell
Get-ChildItem -Recurse src/components,src/core,src/icons -Include *.ts,*.tsx | Select-String "modules/"
Get-ChildItem -Recurse src/shell,src/i18n -Include *.ts,*.tsx | Select-String "modules/"
```
Kỳ vọng: lệnh đầu không ra gì; lệnh sau chỉ ra `src/shell/registry.ts` và `src/i18n/dicts.ts`.

- [ ] **Step 7: Kiểm tay**

```bash
npm run dev:app
```
Kỳ vọng: bấm `[+]` ra **menu ba mục** (Database, REST, Terminal) chứ không mở thẳng tab — đây là
nhánh menu mà `adding-a-module.md` nói là chưa từng chạy với một module. Chọn Terminal ra một tab
tên "Terminal mới". `Ctrl+3` mở đúng tab đó.

- [ ] **Step 8: Commit**

```bash
git add src/modules/terminal src/shell/registry.ts src/i18n
git commit -m "feat(terminal): add the module skeleton and register it"
```

---

## Task 3: Dò shell trên máy và trả về cho form

**Files:**
- Create: `src-tauri/src/modules/terminal/mod.rs`, `models.rs`, `state.rs`, `commands.rs`, `local.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/modules/mod.rs`
- Create: `src/modules/terminal/api.ts`, `shells.ts`, `shells.test.ts`
- Modify: `src/modules/terminal/TerminalTab.tsx`
- Test: `src/modules/terminal/shells.test.ts`, và `#[cfg(test)] mod tests` trong `local.rs`

**Interfaces:**
- Consumes: `LocalShell` từ `types.ts`; `AppError` và `err!` từ `src-tauri/src/error.rs`.
- Produces: lệnh `terminal_local_shells() -> Vec<LocalShell>`; `localShells()` trong `api.ts`;
  `shellLabel(name: string): string` trong `shells.ts`; `models::TerminalSize`,
  `models::TerminalTarget`, `models::Output`, `models::OutputSink`, `state::TerminalState` cho
  việc 5.

- [ ] **Step 1: Viết test cho bản đồ nhãn shell**

`src/modules/terminal/shells.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shellLabel } from "./shells";

describe("shellLabel", () => {
  it("gives the two PowerShells names that tell them apart", () => {
    expect(shellLabel("powershell")).toBe("Windows PowerShell");
    expect(shellLabel("pwsh")).toBe("PowerShell 7");
  });

  it("spells out the ones whose name is not the label", () => {
    expect(shellLabel("cmd")).toBe("Command Prompt");
    expect(shellLabel("git-bash")).toBe("Git Bash");
  });

  it("leaves a unix shell as it is", () => {
    expect(shellLabel("zsh")).toBe("zsh");
    expect(shellLabel("bash")).toBe("bash");
  });

  it("reads the distribution out of a WSL name", () => {
    expect(shellLabel("wsl:Ubuntu")).toBe("WSL: Ubuntu");
    expect(shellLabel("wsl:Ubuntu 22.04")).toBe("WSL: Ubuntu 22.04");
  });

  // Rust dò được cái gì thì frontend hiện cái đó — một shell chưa có trong bảng vẫn phải chọn được.
  it("falls back to the name for anything it has never heard of", () => {
    expect(shellLabel("fish")).toBe("fish");
  });
});
```

- [ ] **Step 2: Chạy test, chắc chắn nó đỏ**

Run: `npx vitest run src/modules/terminal/shells.test.ts`
Kỳ vọng: FAIL — không resolve được `./shells`.

- [ ] **Step 3: Viết `shells.ts`**

```ts
/** Tiền tố Rust dùng cho một bản phân phối WSL: `wsl:Ubuntu`. */
const WSL_PREFIX = "wsl:";

/** Tên riêng, nên không dịch — cái được dịch là nhãn của ô chọn, không phải nội dung của nó. */
const LABELS: Record<string, string> = {
  powershell: "Windows PowerShell",
  pwsh: "PowerShell 7",
  cmd: "Command Prompt",
  "git-bash": "Git Bash",
};

/** Nhãn hiển thị cho một shell dò được. Tên lạ trả về chính nó: bảng này là chỗ làm đẹp, không
 *  phải chỗ lọc. */
export function shellLabel(name: string): string {
  if (name.startsWith(WSL_PREFIX)) return `WSL: ${name.slice(WSL_PREFIX.length)}`;
  return LABELS[name] ?? name;
}
```

- [ ] **Step 4: Chạy lại, phải xanh**

Run: `npx vitest run src/modules/terminal/shells.test.ts`
Kỳ vọng: PASS, 5 test.

- [ ] **Step 5: Viết test cho bộ đọc danh sách WSL**

Trong `src-tauri/src/modules/terminal/local.rs`, cuối file:

```rust
#[cfg(test)]
mod tests {
    use super::parse_wsl_list;

    /// `wsl.exe -l -q` in ra UTF-16LE với CRLF — dựng lại đúng thế để test.
    fn utf16le(text: &str) -> Vec<u8> {
        text.encode_utf16().flat_map(|unit| unit.to_le_bytes()).collect()
    }

    #[test]
    fn reads_one_name_per_line() {
        let bytes = utf16le("Ubuntu\r\nDebian\r\n");
        assert_eq!(parse_wsl_list(&bytes), vec!["Ubuntu".to_string(), "Debian".to_string()]);
    }

    /// Tên có khoảng trắng là chuyện thường — `Ubuntu 22.04` không được cắt làm đôi.
    #[test]
    fn keeps_a_name_with_a_space_in_it() {
        let bytes = utf16le("Ubuntu 22.04\r\n");
        assert_eq!(parse_wsl_list(&bytes), vec!["Ubuntu 22.04".to_string()]);
    }

    #[test]
    fn drops_the_bom_and_the_blank_lines() {
        let bytes = utf16le("\u{feff}Ubuntu\r\n\r\n");
        assert_eq!(parse_wsl_list(&bytes), vec!["Ubuntu".to_string()]);
    }

    /// Máy không có bản phân phối nào thì `wsl.exe` in một câu tiếng Anh chứ không in danh sách
    /// rỗng. Câu đó không phải tên distro.
    #[test]
    fn is_not_fooled_by_the_no_distributions_message() {
        let bytes = utf16le("Windows Subsystem for Linux has no installed distributions.\r\n");
        assert!(parse_wsl_list(&bytes).is_empty());
    }
}
```

- [ ] **Step 6: Chạy test, chắc chắn nó đỏ**

Run: `cd src-tauri && cargo test terminal`
Kỳ vọng: FAIL lúc biên dịch — chưa có module `terminal`.

- [ ] **Step 7: Dựng module Rust**

`src-tauri/src/modules/terminal/models.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Kích thước khung, tính bằng ô chữ.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

/// Một shell dò được trên máy này.
#[derive(Debug, Clone, Serialize)]
pub struct LocalShell {
    /// Định danh bền — `shells.ts` biến nó thành nhãn hiển thị.
    pub name: String,
    pub path: String,
    /// Tham số cố định; rỗng với hầu hết, `["-d", "<distro>"]` với WSL.
    pub args: Vec<String>,
}

/// Phiên mở đi đâu. Đợt 2 thêm nhánh `Ssh(crate::ssh::SshConfig)`.
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
}

/// Thứ duy nhất phiên gửi ngược lên UI dưới dạng JSON. Byte thì đi thẳng, không bọc.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TerminalEvent {
    Exit {
        code: Option<i32>,
        message: Option<String>,
    },
}

/// Đầu xa nói gì. `commands.rs` là chỗ duy nhất biến cái này thành khung IPC — nhờ vậy cả lớp
/// phiên chạy được trong `cargo test` mà không cần webview.
#[derive(Debug, Clone)]
pub enum Output {
    Data(Vec<u8>),
    Exit { code: Option<i32>, message: Option<String> },
}

pub type OutputSink = Arc<dyn Fn(Output) + Send + Sync>;
```

`src-tauri/src/modules/terminal/state.rs`:

```rust
use std::collections::HashMap;
use std::sync::Mutex;

use tokio::sync::mpsc::UnboundedSender;
use tokio_util::sync::CancellationToken;

use super::models::TerminalSize;

/// Tay cầm một phiên. Local hay SSH khác nhau ở chỗ ai dựng nó, không ở chỗ dùng nó.
pub struct Session {
    /// Byte người dùng gõ, chảy tới đầu xa.
    pub input: UnboundedSender<Vec<u8>>,
    /// cols/rows mỗi khi khung đổi kích thước.
    pub resize: UnboundedSender<TerminalSize>,
    /// Đóng tab, hoặc app thoát.
    pub kill: CancellationToken,
}

impl Drop for Session {
    /// Bỏ tay cầm là giết phiên: tiến trình con bị kill, thread ghi và thread resize thấy kênh
    /// đóng rồi tự thoát. Nên không có đường nào bỏ sót một phiên.
    fn drop(&mut self) {
        self.kill.cancel();
    }
}

/// Mọi phiên đang mở, theo id frontend cấp. Khoá thường chứ không phải khoá async: không có gì
/// được await khi đang giữ nó.
#[derive(Default)]
pub struct TerminalState {
    pub sessions: Mutex<HashMap<String, Session>>,
}
```

`src-tauri/src/modules/terminal/local.rs` — đợt này mới chỉ phần dò shell (phần `spawn` là việc 5):

```rust
use std::path::PathBuf;

use super::models::LocalShell;

/// Danh sách shell mở được trên máy này, thứ tự là thứ tự gợi ý — cái đầu tiên là mặc định.
pub fn detect() -> Vec<LocalShell> {
    let mut found = Vec::new();
    #[cfg(windows)]
    detect_windows(&mut found);
    #[cfg(not(windows))]
    detect_unix(&mut found);
    found
}

/// Đường dẫn của shell mặc định, cho một `TerminalTarget::Local { shell: None, .. }`.
pub fn default_shell() -> String {
    detect().into_iter().next().map(|shell| shell.path).unwrap_or_else(|| {
        if cfg!(windows) { "cmd.exe".to_string() } else { "/bin/sh".to_string() }
    })
}

/// Thêm một mục nếu file có thật và đường dẫn đó chưa nằm trong danh sách.
fn push_if_present(found: &mut Vec<LocalShell>, name: &str, path: PathBuf, args: Vec<String>) {
    if !path.is_file() {
        return;
    }
    let path = path.display().to_string();
    if found.iter().any(|shell| shell.path == path) {
        return;
    }
    found.push(LocalShell { name: name.to_string(), path, args });
}

/// Tìm một chương trình trong `PATH`. Dùng cho `pwsh` và `wsl.exe`, hai thứ không có đường dẫn
/// cố định.
#[cfg(windows)]
fn on_path(exe: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|dir| dir.join(exe)).find(|candidate| candidate.is_file())
}

#[cfg(windows)]
fn detect_windows(found: &mut Vec<LocalShell>) {
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    let system32 = PathBuf::from(&system_root).join("System32");

    push_if_present(
        found,
        "powershell",
        system32.join("WindowsPowerShell").join("v1.0").join("powershell.exe"),
        Vec::new(),
    );
    if let Some(pwsh) = on_path("pwsh.exe") {
        push_if_present(found, "pwsh", pwsh, Vec::new());
    }
    push_if_present(found, "cmd", system32.join("cmd.exe"), Vec::new());

    for base in ["ProgramFiles", "ProgramW6432", "LOCALAPPDATA"] {
        if let Ok(dir) = std::env::var(base) {
            let git_bash = PathBuf::from(&dir).join("Git").join("bin").join("bash.exe");
            push_if_present(found, "git-bash", git_bash, Vec::new());
        }
    }

    if let Some(wsl) = on_path("wsl.exe") {
        for distro in wsl_distros() {
            found.push(LocalShell {
                name: format!("wsl:{distro}"),
                path: wsl.display().to_string(),
                args: vec!["-d".to_string(), distro],
            });
        }
    }
}

/// Các bản phân phối WSL đã cài. Máy không có WSL thì `wsl.exe` thất bại và danh sách rỗng —
/// không phải lỗi để báo cho ai.
#[cfg(windows)]
fn wsl_distros() -> Vec<String> {
    let output = match std::process::Command::new("wsl.exe").args(["-l", "-q"]).output() {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };
    parse_wsl_list(&output.stdout)
}

/// `wsl.exe -l -q` in UTF-16LE, có BOM, xuống dòng CRLF, và khi không có bản nào thì in một câu
/// tiếng Anh thay vì in rỗng.
///
/// Không gắn `#[cfg(windows)]` để test của nó chạy được ở mọi nơi — cái nó đọc là byte, không
/// phải là hệ điều hành.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_wsl_list(bytes: &[u8]) -> Vec<String> {
    let units: Vec<u16> =
        bytes.chunks_exact(2).map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect();
    String::from_utf16_lossy(&units)
        .lines()
        .map(|line| line.trim_matches(|c: char| c == '\u{feff}' || c.is_whitespace()).to_string())
        .filter(|line| !line.is_empty() && !line.starts_with("Windows Subsystem for Linux"))
        .collect()
}

#[cfg(not(windows))]
fn detect_unix(found: &mut Vec<LocalShell>) {
    if let Ok(shell) = std::env::var("SHELL") {
        let path = PathBuf::from(&shell);
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("sh").to_string();
        push_if_present(found, &name, path, Vec::new());
    }
    for candidate in ["/bin/zsh", "/bin/bash", "/bin/sh"] {
        let path = PathBuf::from(candidate);
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("sh").to_string();
        push_if_present(found, &name, path, Vec::new());
    }
}
```

`src-tauri/src/modules/terminal/commands.rs` — đợt này mới một lệnh:

```rust
use super::local;
use super::models::LocalShell;
use crate::error::AppError;

/// Máy này mở được shell nào. Dò bằng cách nhìn đĩa và — trên Windows — hỏi `wsl.exe`, nên chạy
/// trên thread blocking chứ không giữ vòng lặp async.
#[tauri::command]
pub async fn terminal_local_shells() -> Result<Vec<LocalShell>, AppError> {
    tokio::task::spawn_blocking(local::detect)
        .await
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))
}
```

`src-tauri/src/modules/terminal/mod.rs`:

```rust
//! Terminal: một phiên shell, trên máy này hoặc — từ đợt 2 — trên một máy chủ qua SSH.
//!
//! Chỗ khác nhau giữa hai loại phiên nằm gọn trong hàm dựng phiên; từ `commands.rs` trở lên chỉ
//! còn một `Session` và một đường ra.

pub mod commands;
pub mod local;
pub mod models;
pub mod state;

/// Đặt state của module vào app. Gọi một lần, từ `lib.rs`.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.manage(state::TerminalState::default())
}
```

`src-tauri/src/modules/mod.rs` — `pub mod terminal;` cạnh hai module kia, và một khối cuối danh sách:

```rust
        // ── terminal ──
        terminal::commands::terminal_local_shells,
```

`src-tauri/src/lib.rs` — một dòng cạnh hai dòng `register` đã có:

```rust
    let builder = modules::terminal::register(builder);
```

- [ ] **Step 8: Chạy lại test Rust, phải xanh**

Run: `cd src-tauri && cargo test terminal`
Kỳ vọng: PASS, 4 test trong `local::tests`.

- [ ] **Step 9: Gọi được từ frontend**

`src/modules/terminal/api.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { LocalShell } from "./types";

/**
 * Chỗ duy nhất trong module này nói chuyện với native.
 *
 * Mọi lệnh reject bằng `AppError` — `{ code, params }` — và người gọi đưa qua `errorMessage(t, e)`
 * chứ không hiện thẳng.
 */

/** Máy này mở được shell nào; thứ tự là thứ tự gợi ý, cái đầu tiên là mặc định. */
export function localShells(): Promise<LocalShell[]> {
  return invoke<LocalShell[]>("terminal_local_shells");
}
```

`TerminalTab.tsx` — tạm liệt kê ra để thấy đường dây đã thông:

```tsx
const [shells, setShells] = useState<LocalShell[]>([]);

useEffect(() => {
  localShells().then(setShells).catch(() => setShells([]));
}, []);

return (
  <div className="terminal-tab">
    <ul>
      {shells.map((shell) => (
        <li key={shell.path}>{shellLabel(shell.name)} — {shell.path}</li>
      ))}
    </ul>
  </div>
);
```

- [ ] **Step 10: Kiểm tay**

```bash
npm run dev:app
```
Kỳ vọng trên Windows: danh sách có Windows PowerShell và Command Prompt, có Git Bash nếu máy cài
Git, có `WSL: <tên>` cho mỗi bản phân phối. Trên macOS/Linux: shell đăng nhập đứng đầu, không có
mục nào trùng đường dẫn.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src src/modules/terminal
git commit -m "feat(terminal): list the shells this machine can open"
```

---

## Task 4: Bộ gom lô

**Files:**
- Create: `src-tauri/src/modules/terminal/stream.rs`
- Modify: `src-tauri/src/modules/terminal/mod.rs` (`pub mod stream;`), `src-tauri/Cargo.toml`
- Test: `#[cfg(test)] mod tests` trong `stream.rs`

**Interfaces:**
- Consumes: `tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>`.
- Produces: `pub async fn coalesce<F: FnMut(Vec<u8>)>(rx, emit)`, `pub const MAX_CHUNK`,
  `pub const FLUSH_AFTER` — việc 5 gọi.

Không có bộ này thì `cat` một file log là treo app: mỗi lần `read` trả về một nhúm byte là một
khung IPC. Đây là thứ phải có ngay, không phải tối ưu để dành.

- [ ] **Step 1: Mở đường cho `tokio::time::pause` trong test**

`src-tauri/Cargo.toml`, thêm mục mới ở cuối phần dependencies chung:

```toml
# `test-util` không nằm trong feature `full`, mà bộ gom lô chỉ test được khi tua nhanh được đồng
# hồ — 5ms thật thì test nào cũng thành test đo thời gian.
[dev-dependencies]
tokio = { version = "1.53.1", features = ["full", "test-util"] }
```

- [ ] **Step 2: Viết test**

`src-tauri/src/modules/terminal/stream.rs`, phần test:

```rust
#[cfg(test)]
mod tests {
    use super::{coalesce, FLUSH_AFTER, MAX_CHUNK};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::sync::mpsc;

    type Emitted = Arc<Mutex<Vec<Vec<u8>>>>;

    fn sink() -> (Emitted, impl FnMut(Vec<u8>)) {
        let seen: Emitted = Arc::new(Mutex::new(Vec::new()));
        let handle = seen.clone();
        (seen, move |chunk: Vec<u8>| handle.lock().unwrap().push(chunk))
    }

    #[tokio::test(start_paused = true)]
    async fn flushes_a_small_write_after_the_idle_window() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tx.send(b"hi".to_vec()).unwrap();
        tokio::time::sleep(FLUSH_AFTER * 2).await;
        assert_eq!(*seen.lock().unwrap(), vec![b"hi".to_vec()]);

        drop(tx);
        task.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn flushes_a_full_chunk_without_waiting() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tx.send(vec![b'x'; MAX_CHUNK]).unwrap();
        // Nhường cho task chạy, nhưng không tiến đồng hồ: đủ 64KB là đẩy ngay.
        tokio::task::yield_now().await;
        assert_eq!(seen.lock().unwrap().len(), 1);
        assert_eq!(seen.lock().unwrap()[0].len(), MAX_CHUNK);

        drop(tx);
        task.await.unwrap();
    }

    /// Hạn 5ms tính từ byte đầu tiên, không từ byte gần nhất. Một dòng chảy đều mà đặt lại hạn
    /// mỗi lần nhận thì sẽ không bao giờ được đẩy.
    #[tokio::test(start_paused = true)]
    async fn keeps_the_deadline_from_the_first_byte() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        for _ in 0..6 {
            tx.send(b"a".to_vec()).unwrap();
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        assert!(!seen.lock().unwrap().is_empty(), "12ms trôi qua mà chưa đẩy lần nào");

        drop(tx);
        task.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn never_emits_an_empty_chunk() {
        let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tokio::time::sleep(FLUSH_AFTER * 10).await;
        drop(tx);
        task.await.unwrap();

        assert!(seen.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn flushes_what_is_left_when_the_source_ends() {
        let (tx, rx) = mpsc::unbounded_channel();
        let (seen, emit) = sink();
        let task = tokio::spawn(coalesce(rx, emit));

        tx.send(b"bye".to_vec()).unwrap();
        drop(tx);
        task.await.unwrap();

        assert_eq!(*seen.lock().unwrap(), vec![b"bye".to_vec()]);
    }
}
```

- [ ] **Step 3: Chạy test, chắc chắn nó đỏ**

Run: `cd src-tauri && cargo test terminal::stream`
Kỳ vọng: FAIL lúc biên dịch — chưa có `coalesce`.

- [ ] **Step 4: Viết bộ gom lô**

`src-tauri/src/modules/terminal/stream.rs`, phần trên file:

```rust
use std::time::Duration;

use tokio::sync::mpsc::UnboundedReceiver;
use tokio::time::Instant;

/// Khung lớn nhất gửi qua IPC một lần.
pub const MAX_CHUNK: usize = 64 * 1024;

/// Đệm chờ lâu nhất bao lâu trước khi đẩy. Đủ ngắn để gõ phím không thấy trễ, đủ dài để `yes`
/// không sinh ra hàng nghìn khung một giây.
pub const FLUSH_AFTER: Duration = Duration::from_millis(5);

/// Gom byte đọc được thành khung rồi đưa cho `emit`: đủ `MAX_CHUNK` thì đẩy ngay, không thì đẩy
/// khi đệm đã nằm đó `FLUSH_AFTER`.
///
/// Hạn tính từ lúc đệm chuyển từ rỗng sang không rỗng. Đặt lại hạn mỗi lần nhận thêm byte là lỗi
/// kiểu Nagle: một dòng chảy đều, chậm, sẽ không bao giờ tới hạn.
///
/// Trả về khi `rx` đóng — tức khi đầu đọc đã xong — sau khi đẩy nốt phần còn lại. Đó là thứ khiến
/// `Exit` phát sau byte cuối cùng chứ không phải trước.
pub async fn coalesce<F>(mut rx: UnboundedReceiver<Vec<u8>>, mut emit: F)
where
    F: FnMut(Vec<u8>),
{
    let mut buffer: Vec<u8> = Vec::new();
    let mut deadline = Instant::now();

    loop {
        if buffer.is_empty() {
            match rx.recv().await {
                Some(chunk) => {
                    deadline = Instant::now() + FLUSH_AFTER;
                    buffer.extend_from_slice(&chunk);
                }
                None => break,
            }
        } else {
            tokio::select! {
                received = rx.recv() => match received {
                    Some(chunk) => buffer.extend_from_slice(&chunk),
                    None => break,
                },
                _ = tokio::time::sleep_until(deadline) => {
                    emit(std::mem::take(&mut buffer));
                    continue;
                }
            }
        }

        while buffer.len() >= MAX_CHUNK {
            let rest = buffer.split_off(MAX_CHUNK);
            emit(std::mem::replace(&mut buffer, rest));
        }
    }

    if !buffer.is_empty() {
        emit(buffer);
    }
}
```

Và `pub mod stream;` vào `mod.rs`.

- [ ] **Step 5: Chạy lại, phải xanh**

Run: `cd src-tauri && cargo test terminal::stream`
Kỳ vọng: PASS, 5 test.

- [ ] **Step 6: Commit**

```bash
git add src-tauri
git commit -m "feat(terminal): coalesce session output before it crosses the IPC"
```

---

## Task 5: Mở một phiên shell cục bộ

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/modules/terminal/local.rs`, `commands.rs`, `models.rs`, `src-tauri/src/modules/mod.rs`
- Test: `#[cfg(test)] mod tests` trong `local.rs`

**Interfaces:**
- Consumes: `stream::coalesce`, `state::Session`, `models::{Output, OutputSink, TerminalSize, TerminalTarget}`.
- Produces: `local::spawn(shell: Option<String>, args: Vec<String>, cwd: Option<String>, size: TerminalSize, out: OutputSink) -> Result<Session, AppError>`; và bốn lệnh `terminal_open`, `terminal_write`, `terminal_resize`, `terminal_close` cho việc 6.

- [ ] **Step 1: Thêm `portable-pty`**

`src-tauri/Cargo.toml`, cạnh các dependency chung:

```toml
# Pty cho phiên terminal cục bộ. Dùng ConPTY trên Windows và forkpty ở nơi khác, nên không phải
# viết một nhánh cho mỗi hệ điều hành. Đây là thư viện WezTerm chạy thật.
portable-pty = "0.9"
```

Run: `cd src-tauri && cargo fetch`
Kỳ vọng: `portable-pty v0.9.0` được thêm.

- [ ] **Step 2: Viết test vòng đời phiên**

Thêm vào `mod tests` sẵn có trong `local.rs`:

```rust
    use super::spawn;
    use crate::modules::terminal::models::{Output, OutputSink, TerminalSize};
    use std::sync::{Arc, Mutex};

    /// Mở shell mặc định của máy rồi bỏ tay cầm. Phiên phải chết và phải báo `Exit` — đây là
    /// đường mà "đóng tab" đi, nên nó không được im lặng.
    #[tokio::test]
    async fn dropping_the_session_ends_it_and_says_so() {
        let seen: Arc<Mutex<Vec<Output>>> = Arc::new(Mutex::new(Vec::new()));
        let handle = seen.clone();
        let sink: OutputSink = Arc::new(move |output| handle.lock().unwrap().push(output));

        let session = spawn(None, Vec::new(), None, TerminalSize { cols: 80, rows: 24 }, sink)
            .expect("shell mặc định phải mở được");
        drop(session);

        // Giết tiến trình, đọc hết pty, đẩy nốt đệm rồi mới phát Exit — vài trăm ms là dư.
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

        let seen = seen.lock().unwrap();
        assert!(
            matches!(seen.last(), Some(Output::Exit { .. })),
            "khung cuối cùng phải là Exit, thấy: {seen:?}",
        );
    }
```

- [ ] **Step 3: Chạy test, chắc chắn nó đỏ**

Run: `cd src-tauri && cargo test terminal::local`
Kỳ vọng: FAIL lúc biên dịch — chưa có `spawn`.

- [ ] **Step 4: Viết `local::spawn`**

Thêm vào `local.rs`:

```rust
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use super::models::{Output, OutputSink, TerminalSize};
use super::state::Session;
use super::stream::coalesce;
use crate::error::AppError;

/// Đệm đọc một lần từ pty. Nhỏ hơn khung IPC nhiều — bộ gom lô mới là chỗ quyết định khung to
/// bằng nào.
const READ_BUFFER: usize = 8 * 1024;

fn pty_size(size: TerminalSize) -> PtySize {
    PtySize { rows: size.rows, cols: size.cols, pixel_width: 0, pixel_height: 0 }
}

/// Mở một shell trên máy này và trả về tay cầm của nó.
///
/// Ba luồng chạy song song sau khi hàm này trả về: một thread đọc pty, một thread ghi vào pty, một
/// thread đợi tiến trình con. Đường ra chỉ có một, và thứ tự trên đó là thứ tự thật — xem chỗ
/// `exit_rx` được await bên dưới.
pub fn spawn(
    shell: Option<String>,
    args: Vec<String>,
    cwd: Option<String>,
    size: TerminalSize,
    out: OutputSink,
) -> Result<Session, AppError> {
    let program = shell.unwrap_or_else(default_shell);

    /* Một đường dẫn tuyệt đối không còn tồn tại — Git bị gỡ, bản WSL bị xoá — đáng được nói thẳng
       thay vì để pty trả về một lỗi hệ điều hành không ai đọc. Tên trần như `cmd.exe` thì bỏ qua:
       nó được tra trong `PATH`, không phải trên đĩa. */
    if (program.contains('/') || program.contains('\\')) && !Path::new(&program).is_file() {
        return Err(err!("error.terminalShellNotFound", path = program));
    }

    let pair = native_pty_system()
        .openpty(pty_size(size))
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))?;

    let mut command = CommandBuilder::new(&program);
    for arg in &args {
        command.arg(arg);
    }
    if let Some(dir) = cwd.as_deref().filter(|dir| Path::new(dir).is_dir()) {
        command.cwd(dir);
    }
    // Cái xterm.js vẽ được. Không đặt thì shell trên Unix coi như terminal câm và tắt cả màu.
    command.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))?;
    // Đầu slave phải buông ngay, nếu không đầu đọc sẽ không bao giờ thấy EOF.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| err!("error.terminalSpawnFailed", message = e))?;
    let master = Arc::new(StdMutex::new(pair.master));
    let killer = child.clone_killer();

    let (raw_tx, raw_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<TerminalSize>();
    let (exit_tx, exit_rx) = oneshot::channel::<Option<i32>>();
    let kill = CancellationToken::new();

    // Đọc pty. Đây là chỗ duy nhất giữ `raw_tx`, nên thread này kết thúc là bộ gom lô biết hết
    // byte — và chỉ khi đó `Exit` mới được phát.
    std::thread::spawn(move || {
        let mut buffer = vec![0u8; READ_BUFFER];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if raw_tx.send(buffer[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Ghi cái người dùng gõ. Kết thúc khi `Session` bị bỏ, vì lúc đó `input_tx` không còn ai giữ.
    std::thread::spawn(move || {
        while let Some(bytes) = input_rx.blocking_recv() {
            if writer.write_all(&bytes).is_err() || writer.flush().is_err() {
                break;
            }
        }
    });

    // Đổi kích thước. Giữ `master` sống chừng nào phiên còn sống: buông nó là đầu đọc thấy EOF.
    std::thread::spawn(move || {
        while let Some(size) = resize_rx.blocking_recv() {
            let _ = master.lock().unwrap().resize(pty_size(size));
        }
    });

    // Đợi tiến trình con, rồi đưa mã thoát cho đường ra — không tự phát, vì lúc này đệm có thể
    // còn byte chưa đẩy.
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code() as i32);
        let _ = exit_tx.send(code);
    });

    // Đóng tab, hoặc app thoát.
    tokio::spawn({
        let kill = kill.clone();
        async move {
            kill.cancelled().await;
            let mut killer = killer;
            let _ = killer.kill();
        }
    });

    // Một đường ra, một thứ tự: hết byte → hết đệm → mới tới `Exit`.
    tokio::spawn({
        let out = out.clone();
        async move {
            coalesce(raw_rx, |chunk| out(Output::Data(chunk))).await;
            let code = exit_rx.await.ok().flatten();
            out(Output::Exit { code, message: None });
        }
    });

    Ok(Session { input: input_tx, resize: resize_tx, kill })
}
```

- [ ] **Step 5: Chạy lại, phải xanh**

Run: `cd src-tauri && cargo test terminal`
Kỳ vọng: PASS — 4 test WSL, 5 test gom lô, 1 test vòng đời.

- [ ] **Step 6: Bốn lệnh còn lại**

`commands.rs`:

```rust
use std::sync::Arc;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::models::{LocalShell, Output, OutputSink, TerminalEvent, TerminalSize, TerminalTarget};
use super::state::TerminalState;
use super::local;
use crate::error::AppError;

/// Mở một phiên và nối nó với `on_event`.
///
/// `Data` đi dạng byte thô, `Exit` đi dạng JSON, trên cùng một kênh — `Channel` đánh số thứ tự cho
/// mọi khung và phía JS xếp lại theo số đó, nên `Exit` không thể vượt lên trước byte cuối.
#[tauri::command]
pub async fn terminal_open(
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
    };

    // Cùng một id mở hai lần thì phiên cũ bị thay và `Drop` của nó dọn phần còn lại.
    state.sessions.lock().unwrap().insert(id, session);
    Ok(())
}

/// Byte người dùng gõ. `data` là chuỗi chứ không phải base64: cái `onData` của xterm sinh ra luôn
/// là chuỗi hợp lệ, và UTF-8 của nó đúng là thứ cần ghi vào pty.
#[tauri::command]
pub async fn terminal_write(
    id: String,
    data: String,
    state: State<'_, TerminalState>,
) -> Result<(), AppError> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or_else(|| err!("error.terminalUnknownSession"))?;
    session
        .input
        .send(data.into_bytes())
        .map_err(|_| err!("error.terminalUnknownSession"))
}

#[tauri::command]
pub async fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
) -> Result<(), AppError> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or_else(|| err!("error.terminalUnknownSession"))?;
    session
        .resize
        .send(TerminalSize { cols, rows })
        .map_err(|_| err!("error.terminalUnknownSession"))
}

/// Đóng phiên. Bỏ khỏi map là `Drop` chạy, là tiến trình bị giết — không có bước nào khác.
/// Một id không có trong map không phải lỗi: tab đóng sau khi phiên đã tự chết là chuyện thường.
#[tauri::command]
pub async fn terminal_close(id: String, state: State<'_, TerminalState>) -> Result<(), AppError> {
    state.sessions.lock().unwrap().remove(&id);
    Ok(())
}
```

Và bốn dòng nữa vào khối `── terminal ──` trong `src-tauri/src/modules/mod.rs`:

```rust
        terminal::commands::terminal_open,
        terminal::commands::terminal_write,
        terminal::commands::terminal_resize,
        terminal::commands::terminal_close,
```

- [ ] **Step 7: Biên dịch cả app**

Run: `cd src-tauri && cargo check`
Kỳ vọng: pass, không cảnh báo mới.

- [ ] **Step 8: Commit**

```bash
git add src-tauri
git commit -m "feat(terminal): open a local shell session over a per-session channel"
```

---

## Task 6: Vẽ phiên bằng xterm

**Files:**
- Modify: `package.json`, `src/modules/terminal/api.ts`, `terminal.css`, `TerminalTab.tsx`
- Create: `src/modules/terminal/components/TerminalView/TerminalView.tsx`, `TerminalView.module.css`, `index.ts`

**Interfaces:**
- Consumes: `openSession`, `writeSession`, `resizeSession`, `closeSession` từ `api.ts`; `TerminalTarget` từ `types.ts`.
- Produces: `<TerminalView target active onExit onError />` — component tự sinh và tự đóng id phiên của nó.

- [ ] **Step 1: Thêm xterm**

```bash
npm install @xterm/xterm@^6.0.0 @xterm/addon-fit@^0.11.0
```
(`@xterm/addon-search` là việc của đợt 3, chưa cài.)

- [ ] **Step 2: Bốn hàm còn lại trong `api.ts`**

```ts
import { Channel, invoke } from "@tauri-apps/api/core";
import type { LocalShell, TerminalSize, TerminalTarget } from "./types";

/** Phiên kết thúc: shell thoát bình thường, hoặc đường đứt. Đợt 1 `message` luôn null. */
export interface SessionExit {
  type: "exit";
  code: number | null;
  message: string | null;
}

/** Một kênh chở hai thứ: `ArrayBuffer` là byte đầu xa in ra, object là phiên đã kết thúc. Cùng
 *  một kênh nên thứ tự là thật — `exit` không thể tới trước byte cuối cùng. */
export type SessionMessage = ArrayBuffer | SessionExit;

export function openSession(
  id: string,
  target: TerminalTarget,
  size: TerminalSize,
  onEvent: (message: SessionMessage) => void,
): Promise<void> {
  const channel = new Channel<SessionMessage>();
  channel.onmessage = onEvent;
  return invoke("terminal_open", { id, target, size, onEvent: channel });
}

export function writeSession(id: string, data: string): Promise<void> {
  return invoke("terminal_write", { id, data });
}

export function resizeSession(id: string, cols: number, rows: number): Promise<void> {
  return invoke("terminal_resize", { id, cols, rows });
}

export function closeSession(id: string): Promise<void> {
  return invoke("terminal_close", { id });
}
```

- [ ] **Step 3: `TerminalView`**

`src/modules/terminal/components/TerminalView/TerminalView.module.css`:

```css
/* Nền đen là nền mặc định của theme xterm; khung chứa lấy đúng màu đó để phần đệm không thành
   một viền sáng quanh màn hình. Đợt 4 mở cái này ra cho pane Cài đặt. */
.host {
  flex: 1;
  min-height: 0;
  padding: 8px;
  background: #000000;
}
```

`src/modules/terminal/components/TerminalView/TerminalView.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { closeSession, openSession, resizeSession, writeSession, type SessionExit } from "../../api";
import type { TerminalTarget } from "../../types";
import styles from "./TerminalView.module.css";

/** Kéo cửa sổ sinh ra hàng chục sự kiện một giây; đầu xa chỉ cần biết kích thước cuối cùng. */
const RESIZE_DEBOUNCE = 100;

interface Props {
  target: TerminalTarget;
  /** Tab nằm sau vẫn mounted và vẫn nhận byte — cái này chỉ quyết định focus và lúc nào đo lại. */
  active: boolean;
  onExit: (exit: SessionExit) => void;
  onError: (message: string) => void;
}

function TerminalView({ target, active, onExit, onError }: Props) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);

  // Callback đi qua ref: effect mở phiên chỉ được chạy lại khi `target` đổi, không phải mỗi lần
  // cha render lại.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: '"Fira Code", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    /* Id sinh ở đây chứ không do tab cấp: `StrictMode` chạy effect hai vòng trong dev, và cleanup
       của vòng đầu phải đóng đúng phiên của vòng đầu. */
    const id = crypto.randomUUID();
    sessionRef.current = id;
    let ended = false;

    const typed = term.onData((data) => {
      void writeSession(id, data).catch(() => {});
    });

    void openSession(id, target, { cols: term.cols, rows: term.rows }, (message) => {
      if (message instanceof ArrayBuffer) {
        term.write(new Uint8Array(message));
        return;
      }
      ended = true;
      onExitRef.current(message);
    }).catch((e) => onErrorRef.current(errorMessage(tRef.current, e)));

    return () => {
      typed.dispose();
      // Chỉ khi unmount, không phải khi mất `active`: tab nằm sau vẫn phải cuộn tiếp.
      if (!ended) void closeSession(id).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sessionRef.current = null;
    };
  }, [target]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let timer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        /* Khung ẩn có kích thước 0, và `fit()` lúc đó tính ra cols/rows rác rồi bắn xuống server. */
        if (host.clientWidth === 0 || host.clientHeight === 0) return;
        fitRef.current?.fit();
        const term = termRef.current;
        const id = sessionRef.current;
        if (term && id) void resizeSession(id, term.cols, term.rows).catch(() => {});
      }, RESIZE_DEBOUNCE);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  // Tab quay lại: cửa sổ có thể đã đổi kích thước trong lúc khung này ẩn, và `ResizeObserver`
  // không bắn cho một khung đang `display: none`.
  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    const term = termRef.current;
    if (!host || !term || host.clientWidth === 0) return;
    fitRef.current?.fit();
    term.focus();
    const id = sessionRef.current;
    if (id) void resizeSession(id, term.cols, term.rows).catch(() => {});
  }, [active]);

  return <div ref={hostRef} className={styles.host} role="application" aria-label={t("terminal.screen")} />;
}

export default TerminalView;
```

`index.ts`: `export { default } from "./TerminalView";`

- [ ] **Step 4: CSS của xterm**

`src/modules/terminal/terminal.css`, thêm ở đầu file:

```css
@import "@xterm/xterm/css/xterm.css";
```

- [ ] **Step 5: Tab mở thẳng shell mặc định — tạm, để chạy thử đầu cuối**

`TerminalTab.tsx` thay danh sách bằng:

```tsx
const [target, setTarget] = useState<TerminalTarget | null>(null);

useEffect(() => {
  localShells()
    .then((shells) => {
      const first = shells[0];
      if (first) setTarget({ type: "local", shell: first.path, args: first.args, cwd: null });
    })
    .catch(() => {});
}, []);

return (
  <div className="terminal-tab">
    {target && <TerminalView target={target} active={active} onExit={() => {}} onError={() => {}} />}
  </div>
);
```

- [ ] **Step 6: Build**

Run: `npm run build`
Kỳ vọng: pass.

- [ ] **Step 7: Kiểm tay — đây là lần đầu có gì để gõ vào**

```bash
npm run dev:app
```

| Thử | Kỳ vọng |
| --- | --- |
| Gõ `dir` / `ls` rồi Enter | Kết quả hiện ra, prompt có màu |
| `vim` (hoặc `notepad` không tính) | Vào toàn màn hình, thoát ra màn hình cũ nguyên vẹn |
| `top` / `htop` rồi kéo cửa sổ | Vẽ lại vừa khung, không lệch cột |
| `yes` chạy ~5 giây rồi `Ctrl+C` | Chữ chảy, cửa sổ vẫn kéo được, không đơ |
| Mở tab khác rồi quay lại | Nội dung còn nguyên, con trỏ vẫn nhấp nháy, kích thước đúng |
| Đóng tab, xem Task Manager / `ps` | Tiến trình shell biến mất |
| Thoát app khi tab đang mở | Không còn tiến trình shell nào sót |

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/modules/terminal
git commit -m "feat(terminal): draw the session with xterm"
```

---

## Task 7: Chọn shell trước khi phiên bắt đầu

**Files:**
- Create: `src/modules/terminal/session.ts`, `session.test.ts`
- Create: `src/modules/terminal/components/TargetForm/TargetForm.tsx`, `TargetForm.module.css`, `index.ts`
- Modify: `src/modules/terminal/TerminalTab.tsx`, `terminal.css`
- Test: `src/modules/terminal/session.test.ts`

**Interfaces:**
- Consumes: `shellLabel` từ `shells.ts`; `LocalChoice`, `LocalShell`, `TerminalTarget` từ `types.ts`; `Button`, `Input`, `Select`, `ErrorBanner` từ `src/components/`.
- Produces: `localTarget(choice)`, `terminalTitle(choice)`, `terminalBadgeMarks(started, ended)`, kiểu `TerminalBadgeMark`.

- [ ] **Step 1: Viết test**

`src/modules/terminal/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { localTarget, terminalBadgeMarks, terminalTitle } from "./session";
import type { LocalChoice } from "./types";

const bash: LocalChoice = {
  shell: { name: "git-bash", path: "C:\\Program Files\\Git\\bin\\bash.exe", args: [] },
  cwd: null,
};

const ubuntu: LocalChoice = {
  shell: { name: "wsl:Ubuntu", path: "C:\\Windows\\System32\\wsl.exe", args: ["-d", "Ubuntu"] },
  cwd: "D:\\work",
};

describe("localTarget", () => {
  it("sends the path and the args, not the display name", () => {
    expect(localTarget(bash)).toEqual({
      type: "local",
      shell: "C:\\Program Files\\Git\\bin\\bash.exe",
      args: [],
      cwd: null,
    });
  });

  it("carries a WSL distribution through as arguments", () => {
    expect(localTarget(ubuntu)).toEqual({
      type: "local",
      shell: "C:\\Windows\\System32\\wsl.exe",
      args: ["-d", "Ubuntu"],
      cwd: "D:\\work",
    });
  });
});

describe("terminalTitle", () => {
  it("names the tab after the shell, not after its path", () => {
    expect(terminalTitle(bash)).toBe("Git Bash");
    expect(terminalTitle(ubuntu)).toBe("WSL: Ubuntu");
  });
});

describe("terminalBadgeMarks", () => {
  // Chưa có phiên thì form đang hiện, và form có thể là của một shell khác cái tab sẽ mở.
  it("marks nothing while the tab is still on the form", () => {
    expect(terminalBadgeMarks(false, false)).toEqual([]);
  });

  it("marks the session while it is running", () => {
    expect(terminalBadgeMarks(true, false)).toEqual([{ type: "local" }]);
  });

  it("puts the ended mark after the kind, never before it", () => {
    expect(terminalBadgeMarks(true, true)).toEqual([{ type: "local" }, { type: "ended" }]);
  });
});
```

- [ ] **Step 2: Chạy test, chắc chắn nó đỏ**

Run: `npx vitest run src/modules/terminal/session.test.ts`
Kỳ vọng: FAIL — không resolve được `./session`.

- [ ] **Step 3: Viết `session.ts`**

```ts
import { shellLabel } from "./shells";
import type { LocalChoice, TerminalTarget } from "./types";

/** Một dấu tab này nên mang. `TerminalTab` biến nó thành `TabBadge` vì nó là chỗ có `t`. */
export type TerminalBadgeMark = { type: "local" } | { type: "ended" };

/** Cái người dùng chọn, rút gọn thành cái Rust cần. Nhãn hiển thị ở lại đây. */
export function localTarget(choice: LocalChoice): TerminalTarget {
  return { type: "local", shell: choice.shell.path, args: choice.shell.args, cwd: choice.cwd };
}

/** Tên tab: tên shell, không phải đường dẫn — tab bar chỉ rộng vài chữ. */
export function terminalTitle(choice: LocalChoice): string {
  return shellLabel(choice.shell.name);
}

/**
 * Tab bar nên hiện dấu gì.
 *
 * Chưa mở phiên thì không dấu nào: form trên màn hình có thể đang chọn một shell khác hẳn cái tab
 * sẽ chạy, đúng như `dbBadgeMarks` không đánh dấu một tab còn đang ở form kết nối.
 */
export function terminalBadgeMarks(started: boolean, ended: boolean): TerminalBadgeMark[] {
  if (!started) return [];
  const marks: TerminalBadgeMark[] = [{ type: "local" }];
  if (ended) marks.push({ type: "ended" });
  return marks;
}
```

- [ ] **Step 4: Chạy lại, phải xanh**

Run: `npx vitest run src/modules/terminal/session.test.ts`
Kỳ vọng: PASS, 6 test.

- [ ] **Step 5: `TargetForm`**

`src/modules/terminal/components/TargetForm/TargetForm.module.css`:

```css
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(480px, 100%);
  margin: 48px auto;
}

.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cwd {
  display: flex;
  gap: 8px;
}

.cwd input {
  flex: 1;
}
```

`src/modules/terminal/components/TargetForm/TargetForm.tsx`:

```tsx
import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import Button from "../../../../components/Button";
import Input from "../../../../components/Input";
import Select from "../../../../components/Select";
import { errorMessage } from "../../../../core/errors";
import { useTranslation } from "../../../../i18n";
import { localShells } from "../../api";
import { shellLabel } from "../../shells";
import type { LocalChoice, LocalShell } from "../../types";
import styles from "./TargetForm.module.css";

interface Props {
  onOpen: (choice: LocalChoice) => void;
  onError: (message: string) => void;
}

/** Màn hình một tab terminal hiện trước khi có phiên. Đợt 2 thêm nhánh SSH bên cạnh nhánh này. */
function TargetForm({ onOpen, onError }: Props) {
  const { t } = useTranslation();
  const [shells, setShells] = useState<LocalShell[]>([]);
  const [path, setPath] = useState("");
  const [cwd, setCwd] = useState("");

  useEffect(() => {
    localShells()
      .then((found) => {
        setShells(found);
        // Cái đầu tiên là cái Rust gợi ý, và cũng là cái `default_shell()` sẽ chọn.
        if (found[0]) setPath(found[0].path);
      })
      .catch((e) => onError(errorMessage(t, e)));
    // Chỉ chạy một lần: danh sách shell của một máy không đổi giữa chừng.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chosen = shells.find((shell) => shell.path === path);

  async function browse() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setCwd(picked);
  }

  return (
    <div className={styles.form}>
      <div className={styles.row}>
        {/* `Select` không nhận `id`, nên nhãn của nó là `ariaLabel` chứ không phải `htmlFor` */}
        <span>{t("terminal.shell")}</span>
        <Select
          value={path}
          options={shells.map((shell) => ({ value: shell.path, label: shellLabel(shell.name) }))}
          onChange={setPath}
          ariaLabel={t("terminal.shell")}
          placeholder={t("terminal.noShells")}
        />
      </div>

      <div className={styles.row}>
        <label htmlFor="terminal-cwd">{t("terminal.startIn")}</label>
        <div className={styles.cwd}>
          <Input
            id="terminal-cwd"
            value={cwd}
            placeholder={t("terminal.startInPlaceholder")}
            onChange={(e) => setCwd(e.target.value)}
          />
          <Button onClick={() => void browse()}>{t("terminal.browse")}</Button>
        </div>
      </div>

      <Button
        variant="primary"
        disabled={!chosen}
        onClick={() => chosen && onOpen({ shell: chosen, cwd: cwd.trim() || null })}
      >
        {t("terminal.open")}
      </Button>
    </div>
  );
}

export default TargetForm;
```

`index.ts`: `export { default } from "./TargetForm";`

- [ ] **Step 6: `TerminalTab` nối form với phiên**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import ErrorBanner from "../../components/ErrorBanner";
import { TerminalIcon } from "../../icons";
import type { ModuleTabProps } from "../../shell/module";
import { useTranslation } from "../../i18n";
import TargetForm from "./components/TargetForm";
import TerminalView from "./components/TerminalView";
import { localTarget, terminalBadgeMarks, terminalTitle } from "./session";
import type { LocalChoice } from "./types";
import "./terminal.css";

function TerminalTab({ active, onTitleChange, onBadgesChange }: ModuleTabProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<LocalChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onTitleChange(choice ? terminalTitle(choice) : t("terminal.newTabTitle"));
  }, [choice, onTitleChange, t]);

  useEffect(() => {
    onBadgesChange(
      terminalBadgeMarks(choice !== null, false).map((mark) => ({
        id: mark.type,
        icon: <TerminalIcon />,
        label: t("terminal.badgeLocal"),
      })),
    );
  }, [choice, onBadgesChange, t]);

  const showError = useCallback((message: string) => setError(message), []);

  /* `useMemo` chứ không gọi thẳng trong JSX: `target` là dependency của effect mở phiên trong
     `TerminalView`, nên một object mới mỗi lần cha render là một phiên mới mỗi lần cha render. */
  const target = useMemo(() => (choice ? localTarget(choice) : null), [choice]);

  return (
    <div className="terminal-tab">
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {target ? (
        <TerminalView target={target} active={active} onExit={() => {}} onError={showError} />
      ) : (
        <TargetForm onOpen={setChoice} onError={showError} />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Build và test**

Run: `npm run build && npm test`
Kỳ vọng: cả hai pass; vitest có thêm 11 test của module này.

- [ ] **Step 8: Kiểm tay**

```bash
npm run dev:app
```
Kỳ vọng: tab mới hiện form; ô Shell liệt kê đúng những gì việc 3 dò được; chọn thư mục bằng nút
Chọn rồi mở — shell bắt đầu đúng ở thư mục đó; tiêu đề tab đổi thành tên shell; tab mang một badge.
Gõ một đường dẫn không tồn tại vào ô thư mục thì shell vẫn mở (ở thư mục nhà) chứ không văng lỗi.

- [ ] **Step 9: Commit**

```bash
git add src/modules/terminal
git commit -m "feat(terminal): pick a shell and a directory before the session starts"
```

---

## Task 8: Nói khi phiên đã kết thúc, rồi đóng đợt

**Files:**
- Modify: `src/modules/terminal/TerminalTab.tsx`, `terminal.css`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `SessionExit` từ `api.ts`; `terminalBadgeMarks` từ `session.ts`.
- Produces: không có gì cho việc sau — đây là việc cuối của đợt.

Phiên terminal **không tự kết nối lại**. Một shell mang trạng thái — thư mục hiện tại, biến môi
trường, chương trình đang chạy dở — nên mở lại lặng lẽ sẽ cho ra một shell mới trông y hệt shell cũ
và người dùng gõ tiếp vào một chỗ không phải chỗ họ nghĩ. Phiên chết thì nói là chết.

- [ ] **Step 1: Dải kết thúc phiên**

`terminal.css`:

```css
.terminal-ended {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--page-bg);
}
```

`TerminalTab.tsx` — hai import nữa (`Button` từ `../../components/Button`, `type SessionExit` từ
`./api`), một state, một `key` để mount lại, và dải ở chân màn hình:

```tsx
const [exit, setExit] = useState<SessionExit | null>(null);
/* Bấm "Kết nối lại" là bơm số này lên: `TerminalView` mount lại, sinh id mới, mở phiên mới. Nội
   dung cũ đi theo instance cũ — đúng thế, vì nó là màn hình của một shell không còn nữa. */
const [generation, setGeneration] = useState(0);

function reconnect() {
  setExit(null);
  setGeneration((n) => n + 1);
}
```

```tsx
{target && (
  <>
    <TerminalView
      key={generation}
      target={target}
      active={active}
      onExit={setExit}
      onError={showError}
    />
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
)}
```

Và badge lấy thêm trạng thái kết thúc — `terminalBadgeMarks(choice !== null, exit !== null)`, với
mark `ended` mang nhãn `t("terminal.badgeEnded")` và làm nhạt tab:

```tsx
terminalBadgeMarks(choice !== null, exit !== null).map((mark) =>
  mark.type === "ended"
    ? {
        id: "ended",
        icon: <TerminalIcon />,
        label: t("terminal.badgeEnded"),
        tabClassName: "terminal-tab-ended",
      }
    : { id: "local", icon: <TerminalIcon />, label: t("terminal.badgeLocal") },
)
```

```css
.terminal-tab-ended {
  opacity: 0.6;
}
```

- [ ] **Step 2: Kiểm tay dải kết thúc**

```bash
npm run dev:app
```
Kỳ vọng: gõ `exit` → dải hiện ra kèm mã thoát, tab nhạt đi, chữ đã cuộn vẫn còn đọc được; bấm *Kết
nối lại* → màn hình mới, prompt mới, dải biến mất, tab hết nhạt.

- [ ] **Step 3: Dòng changelog**

`CHANGELOG.md`, **đầu** mục `### Added` của `## [Unreleased]` — một module mới là đầu đề của bản
phát hành này:

```markdown
- A Terminal tab opens a shell on this machine: PowerShell, Command Prompt, Git Bash, a WSL distribution, or your login shell.
```

- [ ] **Step 4: Quét toàn bộ**

```bash
npm run build
npm test
cd src-tauri && cargo test && cargo check
```
Kỳ vọng: tất cả pass.

```powershell
Get-ChildItem -Recurse src/components,src/core,src/icons -Include *.ts,*.tsx | Select-String "modules/"
Get-ChildItem -Recurse src/shell,src/i18n -Include *.ts,*.tsx | Select-String "modules/"
```
Kỳ vọng: lệnh đầu không ra gì; lệnh sau chỉ ra `registry.ts` và `dicts.ts`.

- [ ] **Step 5: Kiểm tay lần cuối, cả ba module**

| Thử | Kỳ vọng |
| --- | --- |
| `[+]` → cả ba mục | Database, REST, Terminal đều mở được tab |
| `Ctrl+1/2/3` | Mở đúng tab của module thứ nhất/hai/ba |
| Mở hai tab terminal cạnh nhau | Hai phiên độc lập, gõ vào tab này không hiện ở tab kia |
| Đổi ngôn ngữ trong Settings | Form và dải kết thúc đổi theo, không còn chuỗi tiếng Anh chết |
| Đóng cả hai tab, xem tiến trình | Không còn shell nào chạy |

- [ ] **Step 6: Kích thước bundle sau khi thêm `portable-pty`**

```bash
npm run build:app
```
Ghi lại kích thước bộ cài so với bản trước — bảng rủi ro của spec có một dòng về chuyện này. Nếu
tăng đáng kể thì ghi con số vào spec, không xử lý gì thêm ở đợt này.

- [ ] **Step 7: Commit**

```bash
git add src/modules/terminal CHANGELOG.md
git commit -m "feat(terminal): say when a session has ended and offer to start another"
```

---

## Đợt 1 xong khi

- `[+]` mở được tab Terminal, tab hỏi shell rồi giao cả tab cho một phiên gõ được.
- `vim`, `top`, màu, chuột, đổi kích thước đều đúng; `yes` không làm nghẹt UI.
- Đóng tab hay thoát app đều không để lại tiến trình shell nào.
- `npm run build`, `npm test`, `cargo test` xanh; hai lệnh grep ranh giới sạch.
- Còn lại cho đợt 2: `ssh::open_shell`, `remote.rs`, nhánh SSH của form, host đã lưu và keyring.
