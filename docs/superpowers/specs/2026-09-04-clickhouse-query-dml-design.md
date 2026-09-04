# ClickHouse: mở Query tab cho DML

Ngày: 2026-09-04

Trạng thái: sơ khai — chưa brainstorm, chưa có quyết định thiết kế nào.

## Phạm vi (dự kiến)

Cho phép gõ tay `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` trong Query tab trên kết nối ClickHouse —
hiện `guard.ts::writingStatements` vẫn chặn toàn bộ vì `QueryEditor` nhận `readOnly` từ
`dialect.writable = false` (xem D6 của
[`2026-09-04-clickhouse-row-writes-design.md`](2026-09-04-clickhouse-row-writes-design.md)).

Nguồn: mục "Những gì để lại" của spec row-writes —

> **Mở Query tab cho DML** (`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` gõ tay) — nếu làm, đây là lúc
> `guard.ts::writingStatements` mới thật sự cần tổng quát hoá sang tập verb thay vì boolean, đúng
> như bản phân tích ban đầu đã cân nhắc rồi bỏ ở D6. Không làm trước khi có nhu cầu thật.

## Kế tiếp

Brainstorm riêng để lên quyết định thiết kế thật, thay nội dung file này.
