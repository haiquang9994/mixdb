# ClickHouse: index DDL (data skipping index)

Ngày: 2026-09-04

Trạng thái: sơ khai — chưa brainstorm sâu, chưa có quyết định thiết kế nào. Làm **sau**
[`2026-09-04-clickhouse-ddl-design.md`](2026-09-04-clickhouse-ddl-design.md) (database + table + column).

## Vì sao tách riêng khỏi DDL chính

`SqlIndexKind` hiện có (`"index" | "unique" | "fulltext" | "spatial" | "primary"`) là mô hình MySQL/
Postgres: index tra cứu, có thể UNIQUE, có kiểu BTREE/HASH. ClickHouse không có gì tương đương —
chỉ có **data skipping index** (`ALTER TABLE ADD/DROP INDEX ... TYPE minmax/set/bloom_filter/
ngrambf_v1/tokenbf_v1/...`), một cơ chế lọc part gần đúng, không phải index tra cứu. Không có
UNIQUE (ClickHouse không enforce), không có FULLTEXT/SPATIAL kiểu MySQL.

"Primary key" thực chất là `ORDER BY` — quyết định lúc tạo bảng (xem
[`2026-09-04-clickhouse-ddl-design.md`](2026-09-04-clickhouse-ddl-design.md), phần Engine/ORDER BY
picker). Sau khi tạo, đổi sorting key là `ALTER TABLE ... MODIFY ORDER BY`, nặng — viết lại toàn
bộ part.

## Ba hướng đã nêu ra khi brainstorm DDL chính, chưa chọn

1. **Chỉ data skipping index** — add/drop `ALTER TABLE ADD/DROP INDEX ... TYPE ...`. Cần thêm giá
   trị mới vào `SqlIndexKind` (hoặc tách riêng khỏi enum đó) cho tên skip-index thay vì
   BTREE/HASH. Không đụng ORDER BY sau khi tạo bảng.
2. **Cả skip index lẫn sửa ORDER BY** — thêm khả năng sửa sorting key sau khi bảng đã tạo. Nặng
   hơn, rủi ro cao hơn (viết lại part), nhưng đầy đủ hơn.
3. **Bỏ hẳn index khỏi phạm vi ClickHouse DDL** — chỉ database + table + column, không có "Add
   index" nào trên Structure tab của ClickHouse.

## Kế tiếp

Brainstorm riêng sau khi spec DDL chính (database/table/column) xong, để chọn giữa ba hướng trên
(hoặc hướng khác nảy ra lúc đó) và thay nội dung file này.
