# MixDB

MixDB là ứng dụng desktop (Tauri 2 + React 19 + TypeScript) đóng vai trò client quản lý nhiều loại database. Cả ba loại DB đều đã có workspace riêng ở giao diện:

- **MySQL** — duyệt/sửa dữ liệu, xem và chỉnh cấu trúc bảng, dump/restore, và một trình soạn SQL đầy đủ (tô màu cú pháp, gợi ý tên bảng/cột lấy từ chính database, kiểm lỗi khi gõ, `Ctrl+R` chạy script, History và Snippets).
- **MongoDB** — duyệt collection, xem/sửa document theo dạng cây hoặc JSON, thêm document, lọc theo điều kiện.
- **Redis** — cây key theo ký tự phân nhóm, xem/sửa value theo từng kiểu, chọn hàng loạt key theo prefix để xoá, giới hạn số key quét được nhớ theo từng kết nối.

Ứng dụng hỗ trợ kết nối qua **SSH tunnel**, lưu lại thông tin kết nối đã dùng (saved connections) với mật khẩu cất trong kho credential của hệ điều hành, và **tự cập nhật** (tải bản mới ở nền, hỏi, cài rồi khởi động lại — mỗi bản cập nhật đều được kiểm chữ ký trước).

## Trạng thái hiện tại

Phiên bản mới nhất: **0.0.6** (2026-08-11). Xem [CHANGELOG.md](CHANGELOG.md) để biết chi tiết từng bản; những điểm đáng chú ý gần đây:

- Query tab được xây lại trên CodeMirror: format (`Ctrl+Shift+F`), tìm/thay thế (`Ctrl+F`), `F8` duyệt lỗi, `Ctrl+Click` tên bảng để mở dữ liệu.
- Câu lệnh nguy hiểm (`UPDATE`/`DELETE`/`TRUNCATE` không có điều kiện, `DROP`, `ALTER` làm mất dữ liệu) sẽ hỏi lại; `SELECT` không có `LIMIT` được tự thêm giới hạn (mặc định 500 dòng, đổi được trong Settings).
- Kết nối có thể đánh dấu **read-only** hoặc **ghim** lên đầu danh sách qua menu chuột phải ở sidebar.
- Giao diện song ngữ **Việt / Anh** (`src/i18n/`).

## Kiến trúc

- `src/` — Frontend React + TypeScript. `App.tsx` là tab bar, mỗi tab là một `ConnectionTab` (form kết nối → kết nối → render workspace tương ứng). Code theo từng DB nằm trong `src/mysql/`, `src/mongo/`, `src/redis/`; UI dùng chung ở `src/components/`; chuỗi hiển thị ở `src/i18n/`.
- `src-tauri/` — Backend Rust (Tauri), xử lý kết nối tới MySQL (`sqlx`), MongoDB (`mongodb`), Redis (`redis`), và SSH tunnel (`russh`). Frontend không nói chuyện trực tiếp với database, mọi thứ đi qua `invoke(...)`.

Chi tiết cho người (hoặc agent) sửa code: [AGENT.md](AGENT.md) và [.agent/](.agent/).

## Yêu cầu môi trường

Trước khi chạy, cần cài:

- [Node.js](https://nodejs.org/) (khuyến nghị LTS mới nhất) và npm
- [Rust](https://www.rust-lang.org/tools/install) (bản ổn định, cài qua `rustup`)
- Các dependency hệ thống cho Tauri theo hướng dẫn chính thức: [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)
- Trên Linux: `libsecret` (ví dụ `libsecret-1-dev` trên Debian/Ubuntu) — mật khẩu của các kết nối
  đã lưu được cất trong kho credential của hệ điều hành. Windows và macOS dùng Credential Manager
  và Keychain sẵn có, không cần cài thêm.

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
| `npm run set-version <v>` | Bump version ở các file liên quan và cắt mục changelog cho bản phát hành |

Quy trình phát hành: [docs/RELEASING.md](docs/RELEASING.md).
