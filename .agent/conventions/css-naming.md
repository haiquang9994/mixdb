# CSS class naming convention

Mỗi component UI dùng tiền tố `ui-<ten-component-kebab-case>` cho toàn bộ class trong file CSS của nó.

- Component `Select` → tiền tố `ui-select` (vd: `ui-select`, `ui-select-trigger`, `ui-select-option`).
- Component `Pagination` → tiền tố `ui-pagination` (vd: `ui-pagination`, `ui-pagination-btn`, `ui-pagination-page-size-select`).

Quy tắc:
- Tên component chuyển sang kebab-case, luôn có tiền tố `ui-` cho các component dùng chung, tái sử dụng được (đặt trong `src/components/`).
- Class con nối thêm hậu tố mô tả phần tử/trạng thái, cách nhau bằng dấu `-` (vd: `ui-select-option-selected`, `ui-pagination-btn`).
- Không dùng tiền tố gắn với ngữ cảnh sử dụng cụ thể (vd: không đặt `sql-pagination` cho component `Pagination` dùng chung ở nhiều nơi) — chỉ những class thật sự đặc thù cho một feature/domain (vd bảng SQL) mới giữ tiền tố riêng của feature đó (vd `sql-table-view`, `sql-cell-editing`).
