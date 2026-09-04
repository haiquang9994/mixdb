# ClickHouse: Dump/restore

Ngày: 2026-09-04

Trạng thái: sơ khai — chưa brainstorm, chưa có quyết định thiết kế nào.

## Phạm vi (dự kiến)

Xuất/nhập dữ liệu cho ClickHouse — D10 của plan v1
([`docs/superpowers/plans/2026-09-04-clickhouse-db-kind.md`](../plans/2026-09-04-clickhouse-db-kind.md),
gitignored) vẫn còn nguyên, chưa có công cụ tương đương `pg_dump` chính thức.

Nguồn: D10 của plan v1 —

> **Dump/restore ngoài phạm vi v1.** `dump`/`restore` reject phía client như D3, cùng lý do SQLite
> từng hoãn dump data: ClickHouse không có công cụ kiểu `pg_dump` đi kèm chính thức —
> `clickhouse-client --query "... FORMAT Native"` hay binary `clickhouse-backup` riêng đều là việc
> của một task khác, sau khi kind đã chạy ổn.

Nguồn: mục "Những gì để lại" của spec row-writes —

> **Dump/restore** — phase riêng, D10 của plan v1 vẫn còn nguyên.

## Kế tiếp

Brainstorm riêng để lên quyết định thiết kế thật, thay nội dung file này.
