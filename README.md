# MixDB

MixDB là ứng dụng desktop (Tauri 2 + React 19 + TypeScript). Cửa sổ app là một thanh tab, mỗi tab thuộc về một **module**:

- **Database** — client cho MySQL, PostgreSQL, MongoDB và Redis.
- **REST** — soạn và gửi HTTP request, đọc response, giữ lịch sử và biến theo environment.
- **Terminal** — mở shell ngay trên máy hoặc trên server qua SSH.

Các loại database đều có workspace riêng:

- **MySQL** — duyệt/sửa dữ liệu, xem và chỉnh cấu trúc bảng, dump/restore, menu chuột phải trên từng dòng (copy ô, copy dòng ra `INSERT`/TSV/CSV, đi theo foreign key), và một trình soạn SQL đầy đủ (tô màu cú pháp, gợi ý tên bảng/cột lấy từ chính database, kiểm lỗi khi gõ, History và Snippets).
- **PostgreSQL** — dùng chung workspace SQL với MySQL: duyệt/sửa dữ liệu, sửa bảng và index, chạy query có gợi ý, dump/restore bằng `pg_dump` và `psql`.
- **MongoDB** — duyệt collection, xem/sửa document theo dạng cây hoặc JSON, thêm document, lọc theo điều kiện.
- **Redis** — cây key theo ký tự phân nhóm, xem/sửa value theo từng kiểu, chọn hàng loạt key theo prefix để xoá, giới hạn số key quét được nhớ theo từng kết nối.

Ứng dụng hỗ trợ kết nối qua **SSH tunnel**, lưu lại thông tin đã dùng (saved connections, saved hosts, REST environment) với mật khẩu và giá trị bí mật cất trong kho credential của hệ điều hành, và **tự cập nhật** (tải bản mới ở nền, hỏi, cài rồi khởi động lại — mỗi bản cập nhật đều được kiểm chữ ký trước).

## Tính năng

Phiên bản mới nhất: **0.0.18** (2026-08-27). Phần dưới mô tả app hiện làm được những gì —
*không* phải danh sách thay đổi: **cái gì đổi ở bản nào thì đọc [CHANGELOG.md](CHANGELOG.md)**,
nơi duy nhất ghi điều đó.

**Toàn app**

- App đã tách thành shell + module: shell giữ thanh tab, phím tắt và Settings, mỗi module là một thư mục trong `src/modules/`.
- `Ctrl/Cmd+T` mở tab mặc định (Database), `Ctrl/Cmd+1` / `2` / `3` mở thẳng tab Database / REST / Terminal, `Ctrl+Tab` và `Ctrl+Shift+Tab` chuyển tab vòng qua hai đầu.
- Mở lại app là thanh tab của lần đóng trước quay về; chỉ tab đang active tự mở lại, số còn lại chờ tới khi được chọn.
- Settings có pane Appearance, Shortcuts, một pane cho mỗi module (Database, REST, Terminal) và Update. Shortcuts liệt kê mọi phím tắt Ctrl/Cmd trong app.
- Appearance có tuỳ chọn **liquid glass** cho các lớp nổi (menu, dropdown, tooltip, dialog), mặc định tắt.
- Giao diện song ngữ **Việt / Anh** (`src/i18n/` cho phần dùng chung, `src/modules/<id>/i18n/` cho từng module).

**Database**

- Query tab là một trình soạn SQL thật: format (`Ctrl+Shift+F`), tìm/thay thế (`Ctrl+F`), `F8` duyệt lỗi, `Ctrl+Click` tên bảng để mở dữ liệu.
- Câu lệnh nguy hiểm (`UPDATE`/`DELETE`/`TRUNCATE` không có điều kiện, `DROP`, `ALTER` làm mất dữ liệu) sẽ hỏi lại; `SELECT` không có `LIMIT` được tự thêm trần 10.000 dòng.
- Mở lại một tab trả về đúng chỗ đã rời đi — trang, sắp xếp, filter, scroll — chỉ `Ctrl+R` hoặc thay đổi của chính bạn mới hỏi lại server.
- Bàn phím đi hết sidebar: mở database là con trỏ nằm sẵn ở ô tìm kiếm, `↓` chuyển quyền cho danh sách bảng/collection.
- Kết nối có thể đánh dấu **read-only** (áp dụng cho mọi loại DB) hoặc **ghim** lên đầu danh sách qua menu chuột phải ở sidebar.
- SSH tunnel tự hồi phục: tunnel giữ session sống và mở lại sau cùng một cổng local khi rớt; tab đang rớt tự giữ chỗ và cho thử lại, còn một lệnh đọc chết theo kết nối được chạy lại đúng một lần (lệnh ghi thì không bao giờ).

**REST**

- Soạn request rồi gửi (`Ctrl/Cmd+Enter` hoặc `Ctrl/Cmd+R`), đọc response theo dạng preview, cây hoặc raw bytes.
- Dán một lệnh cURL vào tab là điền sẵn method, URL, header và body; chuột phải vào request để copy ngược lại thành cURL.
- Body có thể là form, multipart kèm file trên máy, hoặc một file gửi nguyên trạng; auth có bearer token, basic auth và API key (header hoặc query).
- `{{variables}}` lấy từ environment chọn ở cuối thanh tab, giá trị đánh dấu secret cất trong kho credential thay vì trên đĩa.
- Lịch sử giữ lại mọi thứ đã gửi; timeout, redirect và chứng chỉ chỉnh trong pane riêng.

**Terminal**

- Mở shell trên máy — PowerShell, Command Prompt, Git Bash, WSL, login shell — hoặc trên server qua SSH, với saved host mà mật khẩu nằm trong kho credential của hệ điều hành.
- Tìm trong scrollback, menu chuột phải riêng, và font/cỡ chữ chỉnh ở pane Terminal trong Settings.

## Kiến trúc

- `src/` — Frontend React + TypeScript.
  - `src/shell/` — thanh tab, menu `[+]`, phím tắt, Settings. Shell không biết gì về module; `src/shell/registry.ts` là file duy nhất ngoài `src/modules/` gọi tên module.
  - `src/modules/` — từng module (`db`, `rest`, `terminal`) mang theo component, store, phím tắt và i18n của chính nó. Trong `db`, `sql/` là workspace dùng chung cho các engine SQL (MySQL, PostgreSQL) cùng lớp `SqlApi`/`SqlDialect`, code riêng nằm ở `mysql/`, `postgres/`, `mongo/`, `redis/`.
  - `src/core/`, `src/components/`, `src/icons/`, `src/i18n/` — helper, primitive UI, icon và chuỗi dùng chung.
- `src-tauri/` — Backend Rust (Tauri). Mỗi module có phần backend riêng trong `src-tauri/src/modules/` (`db`, `rest`, `terminal`), dùng chung `error.rs`, `secrets.rs` và `ssh/`. Kết nối tới MySQL và PostgreSQL đi qua `sqlx`, MongoDB qua `mongodb`, Redis qua `redis`, HTTP qua `reqwest`, pty qua `portable-pty`, SSH qua `russh`. Frontend không nói chuyện trực tiếp với database hay mạng, mọi thứ đi qua `invoke(...)`.

Chi tiết cho người (hoặc agent) sửa code: [AGENT.md](AGENT.md) và [.agent/](.agent/).

## Yêu cầu môi trường

Trước khi chạy, cần cài:

- [Node.js](https://nodejs.org/) (khuyến nghị LTS mới nhất) và npm
- [Rust](https://www.rust-lang.org/tools/install) (bản ổn định, cài qua `rustup`)
- Các dependency hệ thống cho Tauri theo hướng dẫn chính thức: [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)
- Trên Linux: `libsecret` (ví dụ `libsecret-1-dev` trên Debian/Ubuntu) — mật khẩu của các kết nối
  đã lưu được cất trong kho credential của hệ điều hành. Windows và macOS dùng Credential Manager
  và Keychain sẵn có, không cần cài thêm.

Công cụ dump/restore (`mysqldump`, `mysql`, `pg_dump`, `psql`) không cần cài trước: app tìm bản đã
có trên máy, và trên Windows/macOS (cùng Linux x86-64 với MySQL) có thể tự tải về từ trong app.

## Hướng dẫn chạy khi mới clone về

```bash
# 1. Cài dependency frontend
npm install

# 2. Chạy ứng dụng ở chế độ dev (mở cửa sổ Tauri, hot reload)
npm run dev:app
```

Lệnh `dev:app` sẽ tự động khởi chạy Vite dev server (`npm run dev`) và build Rust backend rồi mở app.

Nếu chỉ muốn chạy phần frontend trong trình duyệt (không có backend Tauri, phục vụ chỉnh sửa UI nhanh):

```bash
npm run dev
```

## Build production

```bash
npm run build:app
```

Lệnh này sẽ build frontend (`tsc && vite build`) rồi đóng gói thành installer/app native cho hệ điều hành hiện tại (thông qua `tauri build`). File output nằm trong `src-tauri/target/release/bundle/`.

## Scripts khác

| Script | Mô tả |
| --- | --- |
| `npm run build` | Build riêng phần frontend (TypeScript + Vite), không đóng gói app native — cũng là bước typecheck nhanh nhất |
| `npm run test` | Chạy test (Vitest) |
| `npm run preview` | Preview bản build frontend |
| `npm run tauri` | Gọi trực tiếp Tauri CLI |
| `npm run notes` | Liệt kê commit kể từ tag gần nhất, gom nhóm — bản nháp cho `## [Unreleased]` |
| `npm run set-version <v>` | Bump version ở sáu file mang version (kể cả dòng version ngay trên README này) và cắt mục changelog cho bản phát hành |

Quy trình phát hành: [docs/RELEASING.md](docs/RELEASING.md).
