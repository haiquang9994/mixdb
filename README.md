# MixDB

MixDB là ứng dụng desktop (Tauri + React + TypeScript) đóng vai trò client quản lý nhiều loại database. Hiện tại đang tập trung phát triển cho:

- **MySQL** (đã có giao diện quản lý)
- **MongoDB** (đã hỗ trợ ở backend)
- **Redis** (đã hỗ trợ ở backend)

Ứng dụng hỗ trợ kết nối qua **SSH tunnel** và lưu lại thông tin kết nối đã dùng (saved connections).

## Kiến trúc

- `src/` — Frontend React + TypeScript (UI kết nối, workspace cho từng loại DB).
- `src-tauri/` — Backend Rust (Tauri), xử lý kết nối tới MySQL (`sqlx`), MongoDB (`mongodb`), Redis (`redis`), và SSH tunnel (`russh`).

## Yêu cầu môi trường

Trước khi chạy, cần cài:

- [Node.js](https://nodejs.org/) (khuyến nghị LTS mới nhất) và npm
- [Rust](https://www.rust-lang.org/tools/install) (bản ổn định, cài qua `rustup`)
- Các dependency hệ thống cho Tauri theo hướng dẫn chính thức: [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

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
| `npm run build` | Build riêng phần frontend (TypeScript + Vite), không đóng gói app native |
| `npm run preview` | Preview bản build frontend |
| `npm run tauri` | Gọi trực tiếp Tauri CLI |
