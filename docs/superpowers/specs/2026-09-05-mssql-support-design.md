# Hỗ trợ SQL Server (MSSQL)

Ngày: 2026-09-05

## Mục tiêu

Thêm SQL Server làm một `DbKind` đầy đủ trong MixDB, ngang hàng với MySQL/PostgreSQL/ClickHouse:
kết nối (kể cả qua SSH tunnel có sẵn), duyệt database/schema/table, đọc và sửa dữ liệu qua Data
tab, chạy script tay qua Query tab, sửa cấu trúc qua Structure tab, và dump/restore. Vì đây là một
engine hoàn toàn mới (không phải mở thêm một tính năng trên engine đã có, như các spec ClickHouse
trước), khối lượng việc tương đương với lúc PostgreSQL được thêm vào — spec này vì vậy chia thành
**7 kế hoạch (plan) làm tuần tự**, mỗi plan tự build/test được và đóng góp đúng một lát ngang của
`SqlApi`, giống cách ClickHouse được mở dần qua nhiều spec (`...-ddl-design.md`,
`...-row-writes-design.md`, `...-dump-restore-design.md`, `...-query-dml-design.md`).

Xong toàn bộ 7 plan: mở MixDB, thêm connection SQL Server (`192.168.50.86:1433`, user `sa`, pass
`admin` — server test hiện có), thấy sidebar liệt kê database/table, mở một bảng thấy dữ liệu phân
trang lọc được, sửa/thêm/xoá dòng, mở Query tab gõ T-SQL nhiều câu (kể cả nhiều batch ngăn bởi
`GO`), mở Structure tab thêm/sửa/xoá cột và index, và Dump/Restore ra file `.sql` chạy lại được.

## Phi mục tiêu (toàn bộ 7 plan)

- **Không Always On / replicas / linked servers / CLR / temporal tables / graph tables.** Đọc và
  ghi nhắm vào bảng thường (`rowstore`, `heap` hoặc có clustered index) trong một database — đúng
  tầm mà MySQL/PostgreSQL/ClickHouse đang phục vụ hôm nay.
- **Không Windows Authentication / Azure AD auth.** Chỉ SQL Server Authentication (user/password) —
  cùng một `ConnectionConfig` shape (`host`/`port`/`username`/`password`/`database`) các engine
  khác đang dùng, không thêm biến thể xác thực mới. [[connectionconfig_shape_decision]] — không phá
  vỡ quyết định giữ chung shape `ConnectionConfig` qua các loại DB.
- **Không hỗ trợ `sequence` (`NEXT VALUE FOR`) làm auto-increment.** Chỉ `IDENTITY(seed, increment)`
  — xem D7. Một cột dùng sequence làm default vẫn đọc/sửa được như cột thường, chỉ không được đánh
  dấu "auto increment" và không có nút reset counter.
- **Không computed column có `PERSISTED`/không PERSISTED khác nhau ở tầng ghi** — cả hai đọc như
  cột generated (giống MySQL's `STORED`/`VIRTUAL` gộp chung), không cho sửa trực tiếp, chỉ drop
  được.
- **Không cố chạy trên Azure SQL Database / Azure SQL Managed Instance trong v1** — nhắm SQL Server
  on-prem/container trước (test server hiện có là SQL Server thường). Azure SQL khác một số DMV và
  hành vi (không có `sys.dm_exec_sessions` đầy đủ quyền, không `KILL` được phiên của người khác trên
  một số gói) — để lại thành việc riêng nếu cần sau.
- **Không tự bundle driver ODBC hay cài đặt gì lên máy người dùng cho phần đọc/ghi/DDL** (D1) —
  chỉ Plan 6 (dump/restore) có thể cần một tool ngoài, và ngay cả đó cũng ưu tiên tự sinh SQL thay
  vì phụ thuộc tool (D10).

## Hiện trạng — khuôn mẫu đã có, kế thừa nguyên

| Chỗ | Điều spec dựa vào |
| --- | --- |
| [`src-tauri/src/modules/db/models.rs`](../../../src-tauri/src/modules/db/models.rs) | `DbKind` enum, `ConnectionConfig` (đã đủ field cho MSSQL: host/port/username/password/database/ssh/use_ssl — không cần field mới), `ServerInfo`, `StatementResult`, `SqlProblem` |
| [`src-tauri/src/modules/db/state.rs`](../../../src-tauri/src/modules/db/state.rs) | `DbHandle` enum (thêm biến thể `Mssql`), `ActiveConnection` |
| [`src-tauri/src/modules/db/commands/mod.rs`](../../../src-tauri/src/modules/db/commands/mod.rs) | `connect_db`/`disconnect_db` match theo `DbKind`, `resolve_endpoint` (SSH tunnel — dùng lại nguyên, không đổi), `sql_endpoint` (địa chỉ cho dump/restore), `retry_read!` macro |
| [`src-tauri/src/modules/db/drivers/postgres.rs`](../../../src-tauri/src/modules/db/drivers/postgres.rs) | Mẫu gần MSSQL nhất: `qualify`/`resolve`/`quote_ident` cho tên có schema, `build_where`, `column_value` (decode theo thứ tự thử kiểu), `update_row`/`insert_rows`/`delete_rows` với transaction + pre-check `matched=1` |
| [`src-tauri/src/modules/db/drivers/mysql.rs`](../../../src-tauri/src/modules/db/drivers/mysql.rs) | Mẫu gần MSSQL nhất cho **connection model**: một pool cho cả server (không phải một pool/database như Postgres), `thread_id`/`kill_query` cho cancel |
| [`src-tauri/src/modules/db/drivers/postgres_structure.rs`](../../../src-tauri/src/modules/db/drivers/postgres_structure.rs), `postgres_ddl.rs`, `postgres_script.rs` | Shape `TableStructure`/`StructureColumn`/`TableIndex`/`Collation`/`TableStats` dùng chung cho mọi engine — MSSQL điền vào, không đổi shape |
| [`src-tauri/src/modules/db/drivers/dump.rs`](../../../src-tauri/src/modules/db/drivers/dump.rs), `tools.rs` | Cơ chế tìm/tải tool ngoài (`Tool`/`Suite`) — xem D10 vì sao MSSQL đi khác |
| [`src/modules/db/sql/api.ts`](../../../src/modules/db/sql/api.ts), `sql/dialect.ts`, `types.ts` | `SqlApi`/`SqlDialect`/`SqlEditing` — hợp đồng chung mọi engine SQL phải điền vào, không đổi shape trừ D4 (mở rộng `identifierQuote`) |
| [`src/modules/db/postgres/`](../../../src/modules/db/postgres) (`api.ts`, `dialect.ts`, `columns.ts`, `editing.ts`, `system.ts`) | Bộ file mẫu để copy cấu trúc cho `src/modules/db/mssql/` |
| [`src/modules/db/engines.ts`](../../../src/modules/db/engines.ts), `connectionForm.ts`, `types.ts` | Nơi một `DbKind` mới phải đăng ký: `SQL_ENGINES`, `DEFAULT_PORTS`, `KIND_LABEL`, `hasTls` |
| [`src/modules/db/sql/syntax.ts`](../../../src/modules/db/sql/syntax.ts) | `SqlSyntax` — lexing rules dùng chung cho statement splitter (JS) và bộ tương đương phía Rust; xem D4/D9 vì sao MSSQL cần mở rộng shape này |
| `node_modules/@codemirror/lang-sql` | Đã có sẵn dialect `MSSQL` export riêng, và `SQLConfig.identifierQuotes` đã hỗ trợ `[` cho bracket identifier — không cần tự viết CodeMirror dialect |

## Quyết định kiến trúc chung (áp dụng mọi plan)

**D1 — Driver: [`tiberius`](https://github.com/prisma/tiberius), không phải ODBC.**
`sqlx` (đang dùng cho MySQL/PostgreSQL/SQLite) không có driver MSSQL. Hai lựa chọn thực tế: ODBC
(qua `odbc`/`odbc-api`, cần Driver Manager + Microsoft ODBC Driver cài trên máy người dùng) hoặc
`tiberius` (thuần Rust, tự nói giao thức TDS qua `tokio`, không cần cài gì thêm). Chọn `tiberius` vì
lý do đúng tinh thần app này: mọi driver khác đều không bắt người dùng cài driver hệ thống, và một
ứng dụng Tauri đóng gói sẵn không nên yêu cầu "cài Microsoft ODBC Driver 18 trước" chỉ để mở một kết
nối — đặc biệt trên Linux/macOS nơi driver đó không có sẵn theo mặc định. Cái giá: `tiberius` không
có connection pool tích hợp như `sqlx`, và API của nó là API riêng (không phải `sqlx::Row`) — mỗi
hàm đọc dữ liệu tự viết converter, giống cách `mongo.rs`/`clickhouse.rs` đã tự viết converter cho
driver không phải `sqlx` của chúng.

**D2 — Connection model: giống MySQL (một pool cho cả server), không giống PostgreSQL.**
Một kết nối SQL Server *có thể* đổi database đang dùng bằng `USE [db]` hoặc tham chiếu ba phần
`[db].[schema].[table]`, giống hệt MySQL và khác PostgreSQL (nơi một kết nối bị khoá cứng vào một
database). Vì vậy `DbHandle::Mssql` chỉ cần bọc một pool duy nhất — không cần `Pools`
(HashMap theo tên database) như `postgres::Pools`. `database` trong mọi lệnh MSSQL đóng vai trò y
hệt MySQL's `database`: tên để `USE` hoặc để ghép vào câu SQL, không phải để chọn pool.

Vì `tiberius` không có pool sẵn, `Pool` tự viết ở đây là một `deadpool` (crate `deadpool-tiberius`
nếu đủ ổn định tại thời điểm code, hoặc một pool tối giản tự viết bọc `Vec<Mutex<Option<Client>>>`
nếu không) thay vì `bb8`/`sqlx::Pool` — quyết định cụ thể để lúc code Plan 1, không chốt trước ở
đây vì phụ thuộc crate nào build sẵn cho `tokio` runtime app đang dùng.

**D3 — Schema mặc định là `dbo`, tái dùng nguyên khuôn `qualify`/`resolve` của PostgreSQL.**
SQL Server có `database > schema > table`, giống PostgreSQL và khác MySQL (chỉ có
`database > table`). `dbo` đóng đúng vai trò `public` bên Postgres: là schema mặc định của mọi user
mới, nên một bảng thuộc `dbo` hiển thị không tiền tố, bảng thuộc schema khác hiển thị
`schema.table`. Copy nguyên `postgres::qualify`/`resolve`/`split_qualified`/`needs_quoting` sang
`mssql.rs`, đổi hằng `DEFAULT_SCHEMA = "dbo"` và đổi `quote_ident` theo D4.

**D4 — Định danh dùng ngoặc vuông `[ ]`, không phải backtick hay `"`. Cần mở rộng `SqlSyntax`.**
`quote_ident` của MSSQL là `[name]` (đóng ngoặc `]` bên trong nhân đôi thành `]]`), không phải một
ký tự đối xứng như ba engine kia. `SqlSyntax.identifierQuote: string | null` hiện giả định ký tự mở
= ký tự đóng — đúng cho backtick và `"` nhưng sai cho `[`/`]`. Việc này ảnh hưởng bộ tách câu lệnh
(`src/modules/db/sql/statements.ts` và bản Rust tương đương) và bộ tô màu cú pháp trong
`SqlEditor`.

Chọn: đổi `identifierQuote` thành một cặp `{ open: string; close: string } | null` (khi
`open === close`, hành vi y hệt hôm nay — MySQL/SQLite `` ` ``/`` ` ``, Postgres/ClickHouse không có
biến thể này thay đổi vì chúng không dùng field này để mở/đóng khác ký tự). Đây là thay đổi *shape*
duy nhất chạm vào cả 4 engine cũ, nên nó đứng ở Plan 7 (không phải Plan 1) — Plan 1-6 code MSSQL mà
**chưa cắm vào statement splitter/editor cú pháp**, y hệt cách ClickHouse có `writable: false` một
thời gian trong khi phần đọc đã chạy.

CodeMirror không cần việc này: `@codemirror/lang-sql` đã có `MSSQL` dialect dựng sẵn và
`SQLConfig.identifierQuotes` nhận `"\"["` để hiểu cả `"` lẫn `[` — chỉ cần truyền đúng string đó khi
gọi `sql({ dialect: MSSQL, ... })`, không cần viết dialect mới.

**D5 — Việc đăng ký `DbKind::Mssql` mới, checklist dùng chung cho mọi plan bên dưới (mỗi plan chỉ
động tới phần của mình):**

Backend:
- `models.rs`: thêm `Mssql` vào `enum DbKind` (`#[serde(rename_all = "lowercase")]` → serialize
  thành `"mssql"`).
- `state.rs`: thêm biến thể `DbHandle::Mssql(Pool)` (kiểu `Pool` xem D2).
- `commands/mod.rs`: thêm nhánh `DbKind::Mssql` trong `connect_db` (Plan 1), `disconnect_db`
  (Plan 1), một hàm `mssql_pool(state, id)` cạnh `mysql_pool`/`postgres_pool` (Plan 1), nhánh trong
  `sql_endpoint` cho dump/restore (Plan 6).
- `drivers/mod.rs`: `pub mod mssql; pub mod mssql_ddl; pub mod mssql_script; pub mod
  mssql_structure;` (chia file y hệt cách postgres chia bốn file, không dồn hết vào một file
  nghìn dòng).
- `commands/mod.rs` (khai module) + `modules/mod.rs`: `pub mod mssql;` và các dòng
  `generate_handler!` cho từng lệnh mới.

Frontend:
- `types.ts`: `DbKind` union thêm `"mssql"`, `DEFAULT_PORTS.mssql = 1433`.
- `engines.ts`: `SQL_ENGINES.mssql = { api: mssqlApi, dialect: mssqlDialect }`.
- `connectionForm.ts`: `KIND_LABEL.mssql`, `hasTls` thêm `"mssql"` (D6 — MSSQL có encryption
  option, box TLS có ý nghĩa).
- `i18n/en.ts`, `i18n/vi.ts`: `connection.kindMssql`.
- `src/modules/db/mssql/`: `api.ts`, `dialect.ts`, `columns.ts`, `editing.ts`, `system.ts` — copy
  cấu trúc thư mục `postgres/`.

Mỗi plan bên dưới nói rõ nó cần *bao nhiêu* trong checklist này để tự chạy được (Plan 1 cần gần hết
để app build và connect được; các plan sau chỉ thêm method/lệnh mới, không đụng lại phần khung).

**D6 — TLS/encryption: `use_ssl` giữ nguyên nghĩa, map sang `EncryptionLevel` của `tiberius`.**
`tiberius::Config::encryption(EncryptionLevel)` nhận `Off`/`On`/`Required`. `use_ssl == Some(false)`
→ `Off` (giữ đúng "đã tunnel qua SSH rồi thì khỏi TLS lần hai", giống cách Postgres/MySQL đang xử
lý); còn lại (`None`/`Some(true)`) → `Required` — cứng hơn `Prefer` một chút so với Postgres,
nhưng đúng thực tế: SQL Server mặc định *luôn* mã hoá gói đăng nhập dù server không bật TLS đầy đủ,
nên "thử TLS rồi rơi về plaintext" không phải lựa chọn nhị phân sạch như hai engine kia — chọn
`Required` là an toàn hơn và là mặc định chính `tiberius` khuyến nghị. Nếu server test không có
certificate hợp lệ (rất thường với instance tự cài), `tiberius` cần `trust_cert()` được bật kèm
theo — nghĩa là hộp TLS của MSSQL trong connection form nên hiểu ngầm "mã hoá, không xác minh
certificate" chứ không phải "mã hoá và xác minh đầy đủ chuỗi CA", trừ khi có việc riêng thêm hộp
"Trust server certificate" — **để ngỏ, quyết định lúc code Plan 1** sau khi thử thật với server
test (`192.168.50.86:1433`, khả năng cao dùng self-signed cert mặc định của SQL Server).

**D7 — "Tự tăng" (auto-increment) = cột `IDENTITY(seed, increment)`.**
Đọc từ `sys.identity_columns` (has columns `seed_value`, `increment_value`, `last_value`) join
`sys.columns`. Ánh xạ vào field chung: `SqlColumnMeta.extra`/`SqlStructureColumn.autoIncrement` đọc
y hệt MySQL's `auto_increment` — cột có trong `sys.identity_columns` → `autoIncrement = true`.
Reset counter sau khi xoá hết dữ liệu (`resetAutoIncrement`) dùng
`DBCC CHECKIDENT ('table', RESEED, 0)` — tương đương `ALTER TABLE ... AUTO_INCREMENT = 1` của MySQL.

**D8 — Cancel một script đang chạy: cần xác minh API `tiberius` lúc code Plan 4, không chốt cứng ở
đây.** MySQL huỷ bằng `KILL QUERY <thread_id>` (dừng câu lệnh, giữ session), PostgreSQL bằng
`pg_cancel_backend(pid)` (tương tự). SQL Server có `KILL <session_id>` qua T-SQL, nhưng đó là lệnh
**đóng luôn cả session** chứ không có "KILL QUERY" tách riêng dừng-statement-giữ-session — nếu đúng
vậy thì cancel trên MSSQL sẽ nặng tay hơn ba engine kia (mất luôn transaction/temp table của session
đang chạy, không chỉ câu lệnh). Đường đúng hơn cho "dừng một câu lệnh, giữ session" là gói TDS
`Attention` mà driver client (SSMS, hay chính `tiberius`) có thể gửi trên cùng kết nối đang chạy —
nếu `tiberius` expose được API này (cần đọc doc/source của crate lúc code, không giả định ở đây),
đó là lựa chọn ưu tiên; nếu không, rơi về `KILL <session_id>` qua một connection phụ (giống mẫu
MySQL/Postgres), chấp nhận cái giá "cancel = mất session" và ghi rõ trong doc comment của
`dialect.cancellable`.

**D9 — `GO` là dấu ngăn batch phía client, không phải cú pháp SQL thật — ảnh hưởng bộ tách câu.**
T-SQL script thường ngăn cách các "batch" bằng dòng chỉ chứa `GO` (không phải `;` — `;` vẫn ngăn
statement như bình thường *trong* một batch). `GO` không phải từ khoá SQL: gửi nguyên `GO` cho
server sẽ lỗi cú pháp. Bộ tách câu hiện tại (`mysql_script.rs`/`postgres_script.rs` phía Rust,
`sql/statements.ts` phía JS) tách theo `;` và không biết khái niệm batch. `mssql_script::run` cần
một bước tách batch-theo-`GO` **trước**, rồi trong mỗi batch mới tách câu theo `;` như các engine
khác — hai tầng tách riêng, không nhét `GO` vào cùng bộ tách `;` hiện có (rủi ro: một chuỗi hoặc
comment chứa chữ `go` không được nhầm là dấu ngăn — chỉ một dòng *chỉ có* `GO`, có thể kèm số lặp
`GO 3`, mới được coi là batch separator — đúng luật SQL Server thật). Mỗi batch chạy như một round
trip riêng tới server (giống thật: `GO` vốn dĩ là chỗ SSMS/`sqlcmd` cắt và gửi từng phần).

**D10 — Dump/restore: không có tool tương đương `pg_dump`/`mysqldump` miễn phí, dễ tải, dễ pin
version từ Microsoft.** `sqlcmd` (nay là bản Go, mã nguồn mở, tải qua GitHub release — có sẵn
build cho cả ba platform) chạy được script `.sql` — dùng được cho **restore**, đóng đúng vai trò
`psql`/`mysql` client hiện tại (xem `tools.rs::Tool::PsqlClient`/`MysqlClient`). Nhưng không có
tương đương `pg_dump`/`mysqldump` cho chiều **dump** (`bcp` chỉ xuất dữ liệu thô một bảng ở định
dạng riêng, không sinh DDL + INSERT thành file `.sql` đọc được). Đề xuất: viết **dump tự thân bằng
`tiberius`** — không tool ngoài — sinh DDL (`CREATE TABLE`, `CREATE INDEX`...) bằng cách đọc lại
catalog views (Plan 5 đã có sẵn code đọc structure để tái dùng) và sinh `INSERT` bằng cách đọc dữ
liệu theo trang (giống cách Plan 2 đã đọc). Đây là plan duy nhất **không** đi theo khuôn tool-ngoài
`tools.rs` cho chiều dump — restore vẫn có thể dùng `sqlcmd` nếu tìm/tải được, hoặc cũng tự thân nếu
`sqlcmd` không tải được trên một platform nào đó. **Quyết định cuối (dùng `sqlcmd` cho restore hay
tự thân luôn cả hai chiều) để ngỏ tới Plan 6** — cần hỏi lại sau khi Plan 1-5 xong, xem giá tự viết
dump/restore round-trip đáng tin tới đâu so với công sức thêm một `Suite::Mssql` vào `tools.rs`.

**D11 — Kiểu dữ liệu: thứ tự thử decode trong `column_value`, giống `postgres::column_value`.**
`tiberius` trả `ColumnData<'_>` là một enum Rust đã gõ kiểu theo cột (giống Postgres, khác cách
MySQL suy kiểu từ byte) — nghĩa là hàm chuyển sang `serde_json::Value` là một `match` trên
`ColumnData` chứ không phải chuỗi `try_get::<T>()` như Postgres. Ánh xạ dự kiến (chốt chi tiết lúc
code Plan 1, sau khi xác nhận đúng tên biến thể của `tiberius::ColumnData` tại version dùng):
`BIT→bool`, `TINYINT/SMALLINT/INT/BIGINT→number`, `REAL/FLOAT→number` (NaN/Infinity → null, giống
lý do Postgres làm vậy — xem `is_decodable`), `DECIMAL/NUMERIC/MONEY/SMALLMONEY→string` (giữ
precision, giống Postgres's `rust_decimal`), `DATE/TIME/DATETIME/DATETIME2/SMALLDATETIME/
DATETIMEOFFSET→string` (ISO-ish, giống format Postgres đang trả), `UNIQUEIDENTIFIER→string`,
`VARCHAR/NVARCHAR/CHAR/NCHAR/TEXT/NTEXT→string`, `VARBINARY/BINARY/IMAGE→base64 string` (giống
`Vec<u8>` case của Postgres). `sql_variant`, `xml`, `geography`/`geometry`, `hierarchyid` đọc như
text nếu server cho phép ép `CAST(col AS nvarchar(max))`, giống cách Postgres text-hoá kiểu không có
decoder riêng.

## Kế hoạch triển khai — 7 plan

Mỗi plan là một PR/commit-set độc lập, build xanh và test qua được sau khi làm xong, không để dở
dang giữa plan. Thứ tự là bắt buộc: plan sau dựa vào file/hàm plan trước tạo ra.

### Plan 1 — Khung kết nối: connect/disconnect, server info, list databases/tables

**Phạm vi:** `DbKind::Mssql` tồn tại và connect được thật (kể cả qua SSH tunnel), sidebar liệt kê
được database và table, header hiện version server — **chưa có Data tab** (bảng mở ra rỗng hoặc
báo "not implemented" tạm), chưa Query/Structure tab.

**Backend:**
- `Cargo.toml`: thêm `tiberius` (+ pool crate theo D2) với feature phù hợp (`tokio`, TLS
  native-tls để đồng bộ với stack hiện có nếu `tiberius` hỗ trợ; nếu chỉ hỗ trợ `rustls` thì ghi rõ
  đây là ngoại lệ so với "mọi driver dùng native-tls" đã có, kèm lý do trong comment `Cargo.toml`
  giống cách file này đã giải thích lựa chọn `native-tls` cho những driver khác).
- `drivers/mssql.rs`: `pub async fn connect(host, port, username, password, database, use_ssl) ->
  Result<Pool, AppError>` (D1/D2/D6), `pub async fn server_info(pool) -> Result<ServerInfo,
  AppError>` (`SELECT @@VERSION`, cắt chuỗi lấy version + OS giống cách `postgres::server_info` cắt
  chuỗi `version()` — `@@VERSION` của SQL Server có dạng nhiều dòng "Microsoft SQL Server 2022
  (RTM)... on Linux (Ubuntu ...)", cần parse cụ thể khi có server thật để thử), `pub async fn
  list_databases(pool) -> Result<Vec<String>, AppError>` (`SELECT name FROM sys.databases WHERE
  database_id > 4 AND state = 0 ORDER BY name` — `database_id > 4` loại bỏ 4 database hệ thống
  `master/tempdb/model/msdb`, `state = 0` loại database offline/đang restore), `pub async fn
  list_tables(pool, database) -> Result<Vec<String>, AppError>` (`SELECT s.name, t.name FROM
  sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id ORDER BY (s.name <> 'dbo'), s.name,
  t.name` — không lọc thêm gì vì `sys.tables` vốn đã không chứa bảng hệ thống, khác
  `system_schema_filter` Postgres cần), `qualify`/`resolve`/`quote_ident` (D3/D4, copy từ
  `postgres.rs`, đổi `DEFAULT_SCHEMA = "dbo"` và quote thành `[ident]`/`]]`).
- `state.rs`: `DbHandle::Mssql(Pool)`.
- `commands/mssql.rs` (mới): `mssql_list_databases`, `mssql_server_info`, `mssql_list_tables` —
  ba lệnh, chữ ký y hệt `postgres_list_databases`/`postgres_server_info`/`postgres_list_tables`.
- `commands/mod.rs`: nhánh `DbKind::Mssql` trong `connect_db` (dùng `resolve_endpoint` có sẵn —
  không đổi gì ở tầng SSH tunnel) và `disconnect_db` (đóng pool), hàm `mssql_pool(state, id)`.
- `modules/mod.rs`: khai `mod mssql;` (commands), đăng ký 3 lệnh vào `generate_handler!`.

**Frontend:**
- `types.ts`: `DbKind` thêm `"mssql"`, `DEFAULT_PORTS.mssql = 1433`.
- `src/modules/db/mssql/api.ts` (mới): chỉ điền `listDatabases`/`listTables`/`serverInfo`, mọi
  method khác tạm `notSupported()` (giống cách `postgresApi` đóng 5 method ClickHouse-only lúc
  đầu) — **không** thêm vào `SQL_ENGINES` (`engines.ts`) ở plan này, vì `isSqlKind` gate cả Data
  tab lẫn sidebar bảng — chờ tới khi Plan 2 xong table data mới bật, tránh mở workspace ra một bảng
  không đọc được gì.
- Sidebar và connection form: `KIND_LABEL.mssql`, `hasTls` thêm `"mssql"`, form thêm "SQL Server"
  vào danh sách chọn kind.

**Tiêu chí xong:** thêm connection SQL Server test (`192.168.50.86:1433`, `sa`/`admin`) từ UI,
bấm Connect thành công, sidebar hiện đúng danh sách database khác `master/tempdb/model/msdb`, chọn
một database hiện đúng danh sách table.

### Plan 2 — Đọc bảng: table data, structure, schema outline, collations

**Phạm vi:** Data tab và Structure tab **đọc** được (chưa ghi). `SQL_ENGINES.mssql` được thêm vào
`engines.ts` ở plan này — từ đây một bảng MSSQL mở ra trong workspace thật.

**Backend (`drivers/mssql.rs` + `drivers/mssql_structure.rs` mới):**
- `table_columns`/`ColumnMeta` (giống Postgres's shape): đọc từ `sys.columns` join
  `sys.types`/`INFORMATION_SCHEMA.COLUMNS` (cần cả hai — `sys.columns` có `is_identity`/
  `is_computed`/`is_nullable` dạng bit chuẩn, `INFORMATION_SCHEMA.COLUMNS` có
  `DATA_TYPE`/`CHARACTER_MAXIMUM_LENGTH`/`NUMERIC_PRECISION` dễ ghép thành chuỗi kiểu hiển thị kiểu
  `varchar(255)`/`decimal(10,2)` giống MySQL/Postgres đang hiển thị). Default value đọc qua
  `sys.default_constraints` (`definition` column, dạng `((0))`/`(getdate())` — bọc thêm ngoặc so
  với Postgres, cần bóc ngoặc ngoài khi hiển thị, giữ để hiển thị y hệt SSMS khi ghi lại DDL).
- Foreign key: `sys.foreign_key_columns` join `sys.foreign_keys`, `sys.tables`, `sys.columns` —
  cùng shape `ForeignKey { table, column }` của Postgres.
- `primary_key`: `sys.indexes WHERE is_primary_key = 1` join `sys.index_columns`.
- `build_where`/`table_data`: copy khuôn Postgres (COUNT trước, rồi SELECT phân trang), nhưng
  phân trang dùng `OFFSET ... ROWS FETCH NEXT ... ROWS ONLY` (cú pháp SQL Server 2012+, không phải
  `LIMIT`/`OFFSET`) — **bắt buộc có `ORDER BY`** đi kèm `OFFSET`/`FETCH` (SQL Server từ chối cú
  pháp này nếu thiếu `ORDER BY`, khác Postgres/MySQL cho phép `LIMIT` không `ORDER BY`) — khi
  người dùng không chọn cột sort, dùng khoá chính (hoặc cột đầu tiên nếu không có khoá chính) làm
  `ORDER BY` ngầm, viết rõ trong comment vì đây là khác biệt hành vi so với 3 engine kia.
- `mssql_structure.rs`: `table_structure`/`table_stats`/`collations`, shape y hệt
  `postgres_structure.rs`. `table_stats` đọc từ `sys.dm_db_partition_stats`/`sys.partitions` (số
  dòng ước tính, giống MySQL/Postgres đọc từ catalog thay vì COUNT thật). `collations` đọc
  `sys.fn_helpcollations()`.
- `schema_outline`: một query tổng hợp cột của mọi bảng trong database, shape
  `SqlSchemaOutline`/`SqlOutlineTable`/`SqlOutlineColumn` không đổi.

**Frontend:**
- `src/modules/db/mssql/columns.ts`: `isAutoIncrement` (D7), `isGenerated` (cột computed —
  `sys.columns.is_computed`), `isServerAssigned`, `isBinary` (`varbinary`/`binary`/`image`).
- `src/modules/db/mssql/system.ts`: `isMssqlSystemDatabase` — trả `true` cho
  `master/tempdb/model/msdb` dù chúng đã bị lọc khỏi `listDatabases` (D3-style: hàm vẫn nên tồn tại
  và đúng, phòng khi tương lai một chỗ khác gọi tới, giống cách Postgres vẫn định nghĩa dù
  `list_databases` cũng đã tự lọc trước).
- `src/modules/db/mssql/dialect.ts`: điền `kind: "mssql"`, `editing` tạm để rỗng/placeholder
  (Plan 5 điền thật), mọi cờ ghi (`writable`/`ddlWritable`/`rowsWritable`/`dumpRestoreWritable`)
  **để `false`** ở plan này — chỉ đọc, giống ClickHouse's giai đoạn đầu.
- `engines.ts`: `SQL_ENGINES.mssql = { api: mssqlApi, dialect: mssqlDialect }`.

**Tiêu chí xong:** mở một bảng SQL Server có dữ liệu, thấy đúng cột/kiểu/khoá chính, phân trang và
lọc hoạt động, Structure tab hiện đúng cột + index (read-only), tất cả nút ghi (thêm dòng, sửa ô,
Add table...) đều khoá — giống trải nghiệm ClickHouse trước khi row-writes được mở.

### Plan 3 — Ghi dòng: insertRows / updateRow / deleteRows

**Phạm vi:** Data tab ghi được — bật `rowsWritable: true` trong `mssqlDialect`.

**Backend (`drivers/mssql.rs`):**
- `update_row`/`insert_rows`/`delete_rows`: copy khuôn Postgres nguyên xi (transaction, pre-check
  `matched = 1` trước UPDATE, `IS NOT DISTINCT FROM`-tương-đương). SQL Server không có
  `IS NOT DISTINCT FROM` chuẩn ANSI (dùng được từ SQL Server 2022 trở đi qua cú pháp khác, hoặc
  không có trên bản cũ hơn) — dùng mẫu tương thích ngược:
  `(col = @p OR (col IS NULL AND @p IS NULL))` cho mọi bản SQL Server, thay vì cược vào việc server
  test/server người dùng đủ mới.
- Không có khái niệm `(tableoid, ctid)` như Postgres cho bảng không khoá chính — SQL Server luôn có
  ít nhất `heap` với `%%physloc%%` (undocumented nhưng ổn định, dùng nội bộ bởi chính Microsoft's
  tooling) làm tương đương, hoặc đơn giản hơn: dùng toàn bộ cột làm key khi không có khoá chính
  (giống fallback `primaryKey.length > 0 ? primaryKey : columns` frontend đã tự làm — nghĩa là
  backend không cần cơ chế `%%physloc%%` phức tạp, chỉ cần WHERE đúng mọi cột và chấp nhận rủi ro
  trùng dòng y hệt MySQL đang chấp nhận, **không** cần bắt chước cơ chế đặc thù `ctid` của Postgres).
- Placeholder: `tiberius` dùng `@P1, @P2, ...` (named-ish nhưng đơn giản đếm số, giống spirit của
  Postgres's `$1, $2` — không phải `?` như MySQL).
- `DBCC CHECKIDENT` cho reset counter (D7).

**Frontend:** `mssqlDialect.rowsWritable = true`. Không đổi gì khác ở tầng UI — `SqlTable.tsx` đã
tổng quát hoá đủ qua `dialect`/`api`.

**Tiêu chí xong:** sửa một ô, thêm một dòng (kể cả bỏ trống cột có DEFAULT/IDENTITY), xoá dòng (kể
cả xoá hết + reset IDENTITY) trên bảng SQL Server test, y hệt trải nghiệm MySQL/Postgres.

### Plan 4 — Query tab: run_script, cancelQuery, validateSql

**Phạm vi:** Query tab mở được, chạy multi-statement, hỗ trợ `GO` (D9), cancel được (D8),
validate cú pháp không chạy thật. **Chưa** bật `writable` (DDL/DML tay qua Query tab) — đó là
Plan 5, vì `guard.ts` cần biết `ddlWritable` trước khi cho phép DDL qua đường này.

**Backend (`drivers/mssql_script.rs` mới):**
- Tách batch theo `GO` (D9) trước khi tách câu theo `;` trong mỗi batch — dùng lại
  `sql/statements.ts`'s thuật toán tách `;` (port sang Rust, hoặc port ngược lại nếu Rust có sẵn
  logic tổng quát hơn — kiểm tra `mysql_script.rs`/`postgres_script.rs` lúc code xem có phần dùng
  chung được không, tránh viết lại từ đầu).
- `run(pool, sql, on_session_id)`: mỗi batch một round trip, gom `StatementResult` mọi batch nối
  lại làm một danh sách, dừng toàn bộ script (mọi batch còn lại) nếu một câu lỗi — giữ đúng hợp đồng
  `SqlApi.runScript` hiện tại ("một statement lỗi dừng cả script, statement trước đó vẫn trả về
  kết quả").
- `verb`/`kind` (`rows`/`affected`/`ok`) suy từ statement text đầu batch, giống MySQL/Postgres.
- Session id cho cancel: `SELECT @@SPID` đầu phiên (giống `thread_id`/`CONNECTION_ID()` MySQL).
- `cancel(pool, session_id)`: xem D8 — code lúc này mới xác nhận `tiberius` có Attention API hay
  phải rơi về `KILL`.
- `validate`: SQL Server không có cách "parse mà không chạy" rẻ như MySQL's `PREPARE`/Postgres's
  `PREPARE` — tương đương gần nhất là `SET PARSEONLY ON; <statement>; SET PARSEONLY OFF;` (server
  parse cú pháp, không thực thi, không cả resolve tên bảng/cột — nghĩa là *ít* warning hữu ích hơn
  Postgres's `PREPARE`, chỉ bắt lỗi cú pháp thô, gần giống mức "chỉ syntax error" MySQL đang có).
  Ghi rõ giới hạn này trong doc comment của `mssqlApi.validateSql`, đừng hứa quá tay.

**Frontend:** không đổi `SqlApi` shape, không đổi UI — Query tab đã tổng quát hoá qua `dialect`.

**Tiêu chí xong:** dán một script T-SQL nhiều batch ngăn bởi `GO` (kể cả `GO 3` lặp batch, kể cả
comment `-- go` không bị nhầm là separator) vào Query tab, chạy ra đúng kết quả từng câu; bấm Cancel
giữa chừng một câu chạy lâu (`WAITFOR DELAY`) dừng được.

### Plan 5 — DDL: database/table/column/index

**Phạm vi:** Structure tab ghi được, sidebar "Add table"/Drop database hoạt động. Bật
`ddlWritable: true`, `writable: true` (Query tab giờ nhận DDL/DML tay gõ).

**Backend (`drivers/mssql_ddl.rs` mới), copy khuôn `postgres_ddl.rs`:**
- `create_database`/`drop_database`: `CREATE DATABASE [name]` / `DROP DATABASE [name]` — SQL
  Server từ chối `DROP DATABASE` nếu có kết nối khác đang mở nó, giống PostgreSQL — cần đóng pool
  của chính connection này lên database đó trước khi drop nếu đang đứng ngay trên nó (D2: vì MSSQL
  dùng một pool cho cả server chứ không theo database như Postgres, việc "đóng pool của riêng
  database đó" đơn giản hơn — không cần `Pools::close_pool` phức tạp, chỉ cần `USE master` trước
  khi `DROP`, hoặc set `SINGLE_USER WITH ROLLBACK IMMEDIATE` nếu server test có session khác đang
  mở nó).
- `create_table`: một bảng rỗng với cột `id INT IDENTITY(1,1) PRIMARY KEY`, giống mẫu MySQL/
  Postgres tạo lúc bấm "Add table".
- `rename_table`: `EXEC sp_rename 'old', 'new'` (không có `ALTER TABLE ... RENAME TO` chuẩn ANSI
  trên SQL Server — `sp_rename` là thủ tục hệ thống, cách duy nhất).
- `add_column`/`modify_column`/`drop_column`: `ALTER TABLE ... ADD`/`ALTER TABLE ... ALTER COLUMN`
  (SQL Server không có `CHANGE COLUMN` đổi tên+kiểu cùng lúc như MySQL — đổi tên qua
  `sp_rename 'table.old', 'new', 'COLUMN'` riêng, đổi kiểu/nullable qua `ALTER COLUMN` riêng — hai
  câu lệnh cho một lần "modify" nếu cả tên lẫn kiểu cùng đổi, chạy trong một transaction).
- `add_index`/`modify_index`/`drop_index`: `CREATE [UNIQUE] [CLUSTERED|NONCLUSTERED] INDEX`.
  Primary key không phải "một loại index tạo bằng CREATE INDEX" như MySQL/Postgres — nó là một
  constraint (`ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY`) tuy về mặt vật lý vẫn là index —
  `SqlEditing.primaryKeyName` (đã có sẵn field cho đúng trường hợp này, xem `sql/dialect.ts:59`)
  dùng để cho phép đặt tên constraint thay vì khoá cứng như MySQL.

**Frontend:**
- `src/modules/db/mssql/editing.ts`: điền `SqlEditing` thật — `columnTypes` (bảng kiểu T-SQL:
  `int`, `bigint`, `smallint`, `tinyint`, `bit`, `decimal(p,s)`, `float`, `real`, `money`,
  `smallmoney`, `varchar(n)`, `nvarchar(n)`, `char(n)`, `nchar(n)`, `text`/`ntext` (deprecated,
  vẫn liệt kê vì DB cũ còn dùng), `date`, `time`, `datetime`, `datetime2`, `smalldatetime`,
  `datetimeoffset`, `varbinary(n)`, `binary(n)`, `uniqueidentifier`, `xml`), `unsigned: false`
  (không có UNSIGNED), `columnPosition: false` (không có `FIRST`/`AFTER`, luôn append — giống
  Postgres), `onUpdateCurrentTimestamp: false` (không có, tương đương là trigger), `autoIncrement:
  true` (D7), `objectCollation: true` (cột có COLLATE riêng, giống Postgres), `markExpressionDefaults:
  true`, `indexKinds`: `["primary", "unique", "index"]` (không có fulltext/spatial trong v1 —
  SQL Server có cả hai nhưng cú pháp riêng biệt hẳn, để lại phi mục tiêu), `indexMethods`:
  `["CLUSTERED", "NONCLUSTERED"]` (khái niệm khác hẳn MySQL's BTREE/HASH — đây là "có sắp xếp vật
  lý theo index này hay không", field có sẵn dùng vừa vặn dù ý nghĩa khác), `indexPrefix: false`,
  `primaryKeyName: null` (đặt tên tự do, giống Postgres).
- `mssqlDialect`: `ddlWritable = true`, `writable = true`, `dumpRestoreWritable` vẫn `false` tới
  Plan 6.

**Tiêu chí xong:** trên database test, tạo bảng mới từ sidebar, thêm/sửa/xoá cột và index qua
Structure tab, đổi tên bảng, xoá bảng/database — mọi thao tác phản ánh đúng qua SSMS hoặc
`sqlcmd` chạy tay kiểm lại.

### Plan 6 — Dump & restore

**Phạm vi:** `DatabaseActions`'s Dump/Restore hoạt động. Bật `dumpRestoreWritable: true`.

- Chốt lại D10 trước khi code: thử `sqlcmd` (Go, mã nguồn mở,
  <https://github.com/microsoft/go-sqlcmd>) có tải/pin version được theo đúng khuôn `tools.rs`
  (`Suite::Mssql`, checksum pin cứng) hay không — nếu được, dùng nó cho **restore** (thay `psql`/
  `mysql` client). Nếu tải được cả bản build sẵn ổn định trên cả ba platform, cân nhắc dùng luôn cho
  cả liệt kê nhưng **không** cho dump (vẫn không giải quyết việc sinh DDL+INSERT thành file).
- **Dump: viết tự thân, không tool ngoài.** Tái dùng `mssql_structure::table_structure` (Plan 2)
  để sinh `CREATE TABLE`+`CREATE INDEX` mỗi bảng, và `mssql::table_data` (Plan 2, đọc theo trang
  thay vì `SELECT *` một lần — bảng lớn không load hết vào RAM) để sinh câu `INSERT` hàng loạt
  (`INSERT INTO ... VALUES (...), (...), ...` theo lô để tránh câu quá dài, giống cách driver khác
  chia lô insert). `mode: "structure" | "data" | "all"` giữ nguyên nghĩa. Tiến độ báo qua
  `TRANSFER_PROGRESS_EVENT` như các driver khác — tính theo số bảng đã sinh xong / tổng số bảng
  (không có ước lượng `data_size` đẹp như `pg_dump`/`mysqldump` báo, vì không có tool ngoài đếm hộ
  — chấp nhận progress bar "chạy nhưng không có số phần trăm chính xác", giống trường hợp
  `data_size` không đọc được đã có sẵn trong `dump.rs::Watch`).
- **Restore:** nếu `sqlcmd` khả dụng (theo D10), chạy `sqlcmd -S host,port -U user -P password -d
  database -i path`. Nếu quyết định không đưa `sqlcmd` vào, restore cũng tự thân: đọc file `.sql`,
  tách batch theo `GO` (dùng lại bộ tách Plan 4), chạy tuần tự qua `mssql_script::run`.

**Tiêu chí xong:** Dump một database ra file, tạo database rỗng mới, Restore file đó vào, so sánh
dữ liệu khớp — vòng lặp dump→restore giữ nguyên dữ liệu, giống test đã có cho MySQL/Postgres.

### Plan 7 — Cú pháp/lint/hoàn thiện: SqlSyntax, reserved words, connection form, i18n, CHANGELOG

**Phạm vi:** Query tab tô màu đúng T-SQL, autocomplete/lint hiểu `[bracket]`/`GO`/comment T-SQL,
connection form hoàn thiện, tài liệu cập nhật. Đây là plan duy nhất **đổi shape** ảnh hưởng 4
engine cũ (D4) — cần chạy lại toàn bộ test hiện có của `sql/syntax.test.ts`,
`sql/statements.test.ts`, `sql/lint.test.ts` sau khi đổi, không chỉ test mới của MSSQL.

- `sql/syntax.ts`: đổi `identifierQuote: string | null` thành
  `identifierQuote: { open: string; close: string } | null` (D4), sửa 4 hằng số hiện có
  (`MYSQL_SYNTAX`/`SQLITE_SYNTAX` dùng `{ open: "\`", close: "\`" }`, `POSTGRES_SYNTAX`/
  `CLICKHOUSE_SYNTAX` giữ `null` — không dùng field này để mở/đóng, chúng đọc `"` qua nhánh khác
  của tokenizer), thêm `MSSQL_SYNTAX` với `identifierQuote: { open: "[", close: "]" }`,
  `hashComments: false`, `dashCommentNeedsSpace: false`, `nestedBlockComments: false` (SQL Server
  không nest `/* */`), `doubleQuoteIsIdentifier: true` (mặc định `QUOTED_IDENTIFIER ON`, ăn theo
  chuẩn ANSI giống Postgres), `backslashEscapes: false`, `escapeStringPrefix: false`,
  `dollarQuoting: false`. Thêm field mới `batchSeparator: boolean` (D9) — chỉ `true` cho MSSQL,
  bộ tách statement kiểm field này để tách thêm một tầng theo dòng `GO`/`GO <n>` đứng riêng.
  Sửa lại bộ tách câu (`src/modules/db/sql/statements.ts` và `mysql_script.rs`/`postgres_script.rs`
  phía Rust nếu chúng đọc trực tiếp field cũ) cho khớp shape mới — chạy lại toàn bộ test cũ trước
  khi thêm test mới.
- `src/modules/db/components/SqlEditor/extensions.ts`/`theme.ts`: đăng ký `sql({ dialect: MSSQL,
  ...KHÔNG cần override identifierQuotes vì MSSQL dialect của CodeMirror đã tự có `[` sẵn — chỉ
  cần dùng đúng export `MSSQL` từ `@codemirror/lang-sql` như đã xác nhận có sẵn }))`.
- `sql/lint.ts::reservedWords`: đã tổng quát (đọc từ `cmDialect`), không cần việc riêng — chỉ cần
  `mssqlDialect.cmDialect = MSSQL` là đủ.
- Connection form: hoàn thiện label/placeholder tiếng Việt/Anh (`i18n/vi.ts`, `i18n/en.ts`),
  `connectionForm.test.ts` thêm case cho `mssql` giống các kind khác.
- `CHANGELOG.md`: một dòng ngắn theo convention hiện có (`.agent/conventions/changelog.md`) khi
  Plan 1 merge, không dồn hết tới cuối — mỗi plan xong tự thêm dòng của mình, giống cách ClickHouse
  được ghi nhận tăng dần qua nhiều spec.

**Tiêu chí xong:** gõ T-SQL trong Query tab, `[Order Details]`/comment `--`/`/* */` tô màu đúng,
autocomplete gợi ý tên bảng/cột đúng, chạy lại toàn bộ test suite hiện có (không riêng MSSQL) xanh.

## Việc để ngỏ, cần chốt trong lúc code (không phải thiếu sót của spec — phụ thuộc thử với server thật)

- D2: pool crate cụ thể cho `tiberius` (`deadpool-tiberius` hay tự viết).
- D6: `trust_cert` mặc định bật hay thành một ô riêng trên form.
- D8: `tiberius` có Attention/cancel API cấp-statement hay phải rơi về `KILL` cấp-session.
- D10: `sqlcmd` (Go) có đưa vào `tools.rs` được không, hay restore cũng tự thân luôn.

Bốn điểm này đều nằm ở lớp "chi tiết triển khai phụ thuộc crate/tool đang ở version nào tại thời
điểm code", không đổi kiến trúc tổng thể nếu câu trả lời đi khác dự đoán — nên không chặn việc bắt
đầu Plan 1.
