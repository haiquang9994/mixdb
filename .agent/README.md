# .agent

Nơi lưu ghi chú, quy ước và quyết định dành cho agent (Claude Code) khi làm việc trên dự án này. Đọc các file liên quan trước khi thực hiện thay đổi thuộc chủ đề tương ứng.

## Cấu trúc

- `conventions/` — quy ước code cụ thể, lặp lại (naming, cấu trúc file/thư mục, pattern component...). Mỗi chủ đề một file, đặt tên theo chủ đề (vd: `css-naming.md`).
- `decisions/` — quyết định kiến trúc/kỹ thuật quan trọng, kèm lý do (vd: chọn thư viện, đổi cấu trúc dữ liệu). Đặt tên theo dạng `YYYY-MM-DD-slug.md`.
- `notes/` — ghi chú ngắn hạn, bối cảnh công việc đang diễn ra, việc cần theo dõi. Không phải nơi lưu quy ước lâu dài.

## Khi thêm file mới

- Chọn đúng thư mục theo bản chất nội dung (quy ước lâu dài vs quyết định một lần vs ghi chú tạm thời).
- Tên file ngắn gọn, kebab-case, mô tả đúng nội dung.
- Nội dung cô đọng: quy tắc + lý do (nếu cần) + ví dụ, tránh lan man.
