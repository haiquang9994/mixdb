# ClickHouse: DDL (Structure tab)

Ngày: 2026-09-04

Trạng thái: sơ khai — chưa brainstorm, chưa có quyết định thiết kế nào.

## Phạm vi (dự kiến)

Tạo/sửa/xoá bảng, cột, index, database cho ClickHouse — mảng lớn nhất còn lại trong ba mảng
CHANGELOG còn ghi nợ ("no editing, no DDL, no dump/restore"; editing đã xong ở
[`2026-09-04-clickhouse-row-writes-design.md`](2026-09-04-clickhouse-row-writes-design.md)).

Nguồn: mục "Những gì để lại" của spec row-writes —

> **DDL** (create/rename/drop table, column, index, database) — phase riêng, cần
> `clickhouse/editing.ts` thật, dialog Structure tab, và một câu trả lời cho "ALTER TABLE của
> ClickHouse xoay quanh table engine chứ không đơn giản như MySQL" mà plan v1 đã né.

`clickhouse/editing.ts` hiện là shape rỗng ([`src/modules/db/clickhouse/editing.ts`](../../../src/modules/db/clickhouse/editing.ts)); `dialect.writable = false` vẫn khoá toàn bộ Structure tab, "Add table", `DatabaseActions`.

## Kế tiếp

Brainstorm riêng để lên quyết định thiết kế thật, thay nội dung file này.
