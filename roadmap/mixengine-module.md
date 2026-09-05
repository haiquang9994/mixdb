# Roadmap — module `mixengine` trong MixDB

Kế hoạch dựng phần UI để quản lý **MixEngine** ngay trong MixDB. Viết 2026-09-06, trước khi có
dòng code nào. Năm pha; mỗi pha tự chạy được và để lại một tab dùng được.

**Trạng thái: chưa bắt đầu.**

Nguồn phía MixEngine dùng để viết roadmap này:

| | |
| --- | --- |
| Cẩm nang | <https://mixnz.github.io/mixengine/llms.txt> (bản gộp: `/en/llms-full.txt`) |
| Hợp đồng API | <https://github.com/mixnz/mixengine/tree/master/bindings> — TypeScript sinh bằng ts-rs, CI canh |
| Danh sách màn hình | `.claude/features/client-surface.md` trong repo `mixnz/mixengine` |
| Giao thức | `.claude/architecture/daemon-and-ipc.md`, cùng repo |

## Bối cảnh

MixEngine là môi trường web dev cục bộ: nhiều phiên bản PHP/Node/Python/Ruby cùng lúc, kèm web
server, database và cache, tên miền `.test` thật và HTTPS tự động, không Docker. Nó chạy dưới dạng
một daemon (`mixengined`) và **cố ý không có GUI** — [ADR 0011](https://github.com/mixnz/mixengine/blob/master/.claude/decisions/0011-no-gui-in-this-repository.md).
`mix` chỉ là một client mỏng trên cùng một API.

Bên đó đã chuẩn bị sẵn cho một client đồ họa ở repo khác: `client-surface.md` liệt kê 9 màn hình một
GUI phải dựng được và chứng minh trên giấy rằng API đủ cho từng cái. Roadmap này nhận danh sách đó
làm phạm vi, và MixDB là client ấy.

Hai app đã biết nhau một chiều rồi: MixEngine gọi MixDB là extension kiểu `desktop-app`
(`DesktopClient.name` = `"MixDB"`), và `database.open` bắn `mixdb://connect?…` sang. Phía nhận đã có
trong repo này — [`handoff.rs`](../src-tauri/src/modules/db/handoff.rs) và
[spec T83](../docs/superpowers/specs/2026-09-03-mixengine-connection-handoff-design.md). Pha 0 dưới
đây trả nốt phần còn nợ của đường đó trước khi mở module mới.

## Quyết định chốt trước

**Một module thứ năm, không phải một tool.** `mixengine` đứng cạnh `db`, `rest`, `terminal`,
`tools`: một folder dưới `src/modules/` và một dòng trong
[`src/shell/registry.ts`](../src/shell/registry.ts). Panel của module `tools` là khung một cột, không
đủ cho một dashboard có stream sự kiện và bảng nhiều cột. Quy trình đầy đủ nằm ở
[adding-a-module](../.agent/conventions/adding-a-module.md).

**JSON-RPC thẳng tới daemon, không gọi `mix`.** Backend Rust nói HTTP/1.1 qua Unix socket
(`<root>/run/mixengined.sock`) hoặc named pipe Windows
(`\\.\pipe\mixengine.<user-sid>.<home-fingerprint>`). Lý do: `GET /events`, `GET /logs/{id}` và
`GET /metrics` là ba stream SSE — gọi `mix --json` qua process thì mất cả ba, và còn phụ thuộc `mix`
có trên `PATH`. Daemon **không bao giờ** mở cổng TCP; `--listen` trong tài liệu bên đó là thiết kế
chưa xây, đừng nhắm vào nó.

**Types là thứ đi mượn, không phải thứ tự viết.** `bindings/` được publish thành
`mixengine-api-<version>-typescript.tar.gz` trên mỗi release, ký cùng khóa với binary. Vendor nguyên
xi vào `src/modules/mixengine/api/types/`, kèm một dòng ghi version, và không sửa tay. Đây là ngoại
lệ có ý thức với `types.ts` của module `db` (vốn chép tay theo models Rust): ở đây phía kia đã có CI
canh hợp đồng, chép tay là tự nguyện làm lệch.

**Nghiệp vụ ở lại phía daemon.** Client không suy ra trạng thái, không tự ghép địa chỉ keyring, không
tự dò filesystem tìm ứng dụng. Mọi thứ đó đều đã là một câu trả lời trong API.

## Ranh giới trong MixDB

```
src/modules/mixengine/
  index.ts              ModuleDefinition
  MixEngineTab.tsx      Cổng: daemon sống chưa → sidebar 9 màn hình
  api.ts                Chỗ duy nhất gọi invoke() của module này
  api/types/            bindings/ vendor nguyên xi, không sửa tay
  tabState.ts           Màn hình đang mở + id đang chọn (ids only, localStorage)
  screens/              Một folder một màn hình
  components/  i18n/  mixengine.css  

src-tauri/src/modules/mixengine/
  transport.rs          UnixStream / named pipe, kèm kiểm chủ sở hữu pipe
  rpc.rs                POST /rpc, batch, ánh xạ Error -> AppError
  stream.rs             SSE của /events, /logs, /metrics -> Tauri Channel
  autostart.rs          /health, và spawn `mixengined --detach` khi không kết nối được
  commands.rs  models.rs  state.rs  mod.rs
```

Ba luật của repo áp nguyên vào đây: không file nào ngoài `src/modules/mixengine/` được biết khái
niệm của module ([`npm run lint`](../eslint.config.js) là thứ nói không); mọi chuỗi người dùng thấy
đi qua `t()` trong cả `en.ts` lẫn `vi.ts`; và root của workspace cần đủ khối năm thuộc tính ở
[workspace-root](../.agent/conventions/workspace-root.md).

Một luật riêng của module này: **spawn `mixengined --detach` phải đi qua `crate::platform::hide_console`**,
đúng như [spawning-processes](../.agent/conventions/spawning-processes.md) — nếu không Windows bật một
cửa sổ console đen trước mặt người dùng.

## Bảng ánh xạ màn hình → pha

| Màn hình (client-surface) | Pha |
| --- | --- |
| Dashboard | 1 |
| Services (bảng + start/stop) | 1 |
| Sites | 2 |
| Domains & TLS | 2 |
| Runtimes | 3 |
| Services (settings, limits, credentials) | 3 |
| Logs | 3 |
| Blueprints | 4 |
| Extensions | 4 |
| Settings (root, autostart, updates, doctor, uninstall) | 4 |
| Metrics (live + lịch sử 24h) | 4 |

---

## Pha 0 — trả nợ đường handoff đã có

Không đụng tới module mới. Đây là phần MixDB còn nợ sau khi MixEngine chốt T84, ghi trong
`docs/superpowers/plans/2026-09-04-mixengine-keyring-convention.md` (gitignored, local-only).

Hợp đồng T84: URL handoff mọc thêm đúng một tham số `secret_key`, luôn đi kèm `user`. Địa chỉ đầy đủ
của credential là **một cặp** — `service` = `"mixengine"` (hằng số biên dịch cứng ở cả hai phía,
không bao giờ đi trên wire) và `key` = `<service-id>/<user>` (đi qua `secret_key`).

- **T0.1** — `handoff::parse()` đọc thêm `secret_key`, thành field mới trên `Handoff`; `ConnectionConfig`
  không đổi hình.
- **T0.2** — mang "bằng chứng env" từ lúc nhận tới lúc Save: `Opening.secret.is_some()` → field trên
  `Handoff` → `TabRequest.state` → state của form → payload lúc Save. Thiếu cờ này (link bấm từ
  trình duyệt) thì form vẫn mở, nhưng Save chỉ được lưu mật khẩu người dùng tự gõ, không được tạo
  tham chiếu.
- **T0.3** — chốt định dạng "tham chiếu" trong `Secrets`, và UI nói *"đọc từ kho credential của máy"*
  thay vì hiện một ô mật khẩu rỗng khó hiểu.

**Vì sao đứng trước:** `SecretAddress` là kiểu đầu tiên hai app dùng chung. Dựng module mới trước khi
nó đúng nghĩa là dựng màn hình Services trên một khái niệm còn nợ.

**Xong khi:** một connection MixEngine bắn sang, Save lại, đóng app, mở lại — vẫn kết nối được mà
MixDB chưa từng giữ bản sao thứ hai của mật khẩu.

---

## Pha 1 — transport, và Dashboard

Pha nặng nhất, vì mọi thứ sau nó chỉ là thêm màn hình.

### Transport

- **T1.1 — Địa chỉ endpoint.** Đọc `MIXENGINE_HOME` (mặc định theo nền tảng) để dựng đường socket;
  trên Windows dựng tên pipe từ SID người dùng và fingerprint của `<root>/run`.
- **T1.2 — Client HTTP trên transport cục bộ.** `hyper` trên `UnixStream` / `NamedPipeClient`.
  `POST /rpc` một call hoặc batch.
- **T1.3 — Kiểm chủ sở hữu pipe trước byte đầu tiên (chỉ Windows).** Namespace pipe của Windows
  phẳng và toàn máy, tên suy ra được từ một SID công khai, và `CreateNamedPipeW` không cần quyền gì —
  nên một tài khoản khác có thể giữ tên đó trước khi daemon lên và thu mọi request, kể cả
  `elevation.*`. Client đọc **owner của đối tượng pipe** và cúp máy nếu không phải tài khoản này, báo
  *"đang do … giữ, không phải tài khoản này"*. Unix không cần: socket là file trong `run/` của chính
  tài khoản. Đây là R1 trong review 2026-08-27 của họ; bỏ qua bước này là một lỗ bảo mật thật, không
  phải sự cẩn thận thừa.
- **T1.4 — Lỗi.** `Error` của họ là enum đóng: `not_found · already_exists · invalid_argument ·
  conflict · precondition_failed · port_in_use · privileged_required · unsupported_platform ·
  dependency_missing · process_failed · io · internal`, kèm `message` và `hint`. Rẽ nhánh theo `code`,
  **không bao giờ theo câu chữ**. `hint` là thứ UI vẽ thành hành động gợi ý. HTTP `200` mang `error`
  vẫn là một call thất bại — status chỉ nói về phong bì.
- **T1.5 — Daemon chưa chạy là một trạng thái đọc được, không phải một lỗi.** `GET /health` không cần
  auth, đúng để quyết định có tự khởi động không. Không kết nối được thì spawn
  `mixengined --detach` (qua `hide_console`); nó chỉ trả về khi daemon đã trả lời trên endpoint và in
  endpoint ra stdout. Không viết vòng lặp backoff trong client. UI phân biệt được *"không chạy"* với
  *"không trả lời"*, và tự kết nối lại mà không cần restart tab.
- **T1.6 — Stream sự kiện.** `GET /events` là SSE, gói `DaemonEvent` **internally tagged**: một
  `data:` chứa `{"type": …}`. Một handler `onmessage` switch theo `type`, không phải một
  `addEventListener` mỗi biến thể — nhờ vậy một biến thể mới ở phiên bản sau tới client cũ như một
  object bỏ qua được. Stream rảnh gửi comment `:` mỗi 15 giây. `resync` mang số message đã lỡ: khi
  nhận nó, gọi lại các `*.list` tương ứng. **Sự kiện là best-effort và không bao giờ là đường duy
  nhất để biết trạng thái.**

### Dashboard

`daemon.status` cho version, protocol, pid, home, endpoint, uptime, `elevation`, `dns`, `update`.
`service.list` cho một hàng mỗi service: `state`, `supervised`, `pid`, `port`, `last_started_at`,
`last_exit_code`, `depends_on`. Start/stop/restart per service và stop-all.

- **T1.7** — bảng service, trạng thái đến từ `service_state_changed` trên stream, **không suy ra**.
  `service.start/stop/restart` là ngoại lệ duy nhất nhận `wait` thay vì trả job; `wait: false` cho
  client muốn hành xử như job.
- **T1.8 — Elevation là một luồng, không phải một lỗi.** `elevation_required` mang **mọi** thao tác
  đang chờ kèm thứ chúng thay đổi cụ thể (đúng dòng hosts nào, cổng nào, kho nào). UI hiện danh sách
  đó rồi mới bật **một** prompt qua `elevation.grant`. Từ chối là một kết cục API mô hình hóa được,
  không phải lỗi; `elevation.drop` là đường ra. Daemon **không bao giờ** tự bật prompt.
- **T1.9 — Job.** Mọi thao tác dài trả `JobSummary` (`id`, `kind`, `state`, `percent`, `message`,
  `outcome`); tiến độ tới qua `job_progress` / `job_finished`. Vẽ trạng thái ngay trên hàng, không
  phủ spinner lên cả màn hình. `job.wait` là method duy nhất cố ý chờ, và có timeout.

**Xong khi:** mở tab thấy daemon (tự khởi động nếu cần), thấy mọi service với trạng thái thật, bật
tắt được, và một thao tác cần quyền quản trị hiện ra đầy đủ trước khi UAC/sudo bật lên.

---

## Pha 2 — Sites, Domains & TLS

- **T2.1 — Danh sách site.** `site.list` → `SiteSummary { domain, owner, kind, doc_root, https, state,
  sharing }`. `owner` là một project theo tên **hoặc một extension theo id**: site của extension chỉ
  được xem/start/stop, mọi sửa khác phải từ chối kèm đúng câu lệnh gỡ extension đó.
- **T2.2 — Tạo và sửa site.** `site.create` / `site.update`: doc root, `kind`
  (`php-fpm` · `static` · `reverse-proxy` · `node-app`), phiên bản PHP, service liên kết, domain phụ.
  Lộ đường doc root và URL duyệt được, để MixDB tự mở trình duyệt / file manager / terminal — MixDB
  đã có sẵn cả ba đường đó.
- **T2.3 — Chia sẻ LAN.** `site.share` trả interface, address, URL; `site.unshare` rút về. Máy có
  nhiều mạng thì daemon **từ chối chứ không tự chọn**, và nêu tên các ứng viên để UI mời chọn.
  `for_seconds` đặt hạn, `SiteSharing.until` mang hạn về.
- **T2.4 — Thông báo khi một share tự kết thúc.** `site_sharing_changed` mang lý do
  (`SharingChange`): người ta tắt, hết giờ, hoặc máy rời mạng đang chia sẻ. `client-surface.md` gọi
  thẳng đây là **chỗ duy nhất `mix` là client yếu hơn**: với CLI, lý do nằm trong `daemon.log` và
  trên một stream không ai đọc. Đây là lý do tồn tại của cả pha này — đừng làm nó thành một dòng
  trong bảng.
- **T2.5 — Bảng chẩn đoán domain.** `domain.list` / `domain.dns_status` →
  `DomainStatus { domain, site, hosts_entry, wildcard, server_answers, resolves_to, because }`.
  `domain.add` / `domain.remove`.
- **T2.6 — CA, và hai câu trả lời tin cậy chứ không phải một.** `cert.ca_status` mang `trust` cho kho
  hệ thống **và** `browsers` cho các NSS database Firefox/Chrome đọc, mỗi cái một hàng kèm đường dẫn
  và trình duyệt sở hữu. Gộp hai cái làm một là vẽ tick xanh cạnh một trình duyệt đang hiện ổ khóa
  đỏ. Sửa cái thứ hai là `daemon.doctor_repair`, không bật prompt — nên nó là một cái nút, không phải
  một luồng elevation.
- **T2.7 — Chứng chỉ theo site.** `cert.issue` trả một `SiteCertOutcome` mỗi site kèm tên nó phủ và
  còn bao nhiêu ngày → vẽ được cả bảng bằng một call. Cấp lại là cùng một call, idempotent, không bật
  prompt. Không có `cert.list`, `cert.renew`, `cert.ca_install` — cả ba đều bị từ chối có lý do.

**Xong khi:** tạo được một site mới, thấy nó xanh, chia sẻ ra LAN rồi để hết giờ và nhận đúng một
thông báo nói vì sao nó tắt.

---

## Pha 3 — Runtimes, Services chi tiết, Logs

- **T3.1 — Runtimes.** `runtime.list_installed` → `RuntimeSummary { kind, version, channel, path,
  installed_at, bytes, default }`; `runtime.list_available`; `install` / `uninstall` là job có tiến
  độ; `set_default`; bật tắt PHP extension theo từng phiên bản.
- **T3.2 — Cài đặt của một service là **dữ liệu**, không phải một form đã render.** Port, bind, data
  dir, limits, autostart, idle timeout đến dưới dạng dữ liệu để UI tự dựng. Config sinh ra đọc lại
  được nhưng chỉ để xem. Lỗi validate trả **theo từng field**, không phải một chuỗi.
- **T3.3 — Giới hạn bộ nhớ vẽ khác nhau cho `Hard` và `Advisory`.** `Hard` là bức tường: chạm trần là
  bị giết hoặc lần cấp phát sau thất bại. `Advisory` là một vạch được canh: service vượt qua vẫn chạy
  tiếp, sau đó là một cảnh báo và — nếu recipe cho phép — một lần restart. UI phải có control cho cả
  hai và **không được trình bày cái thứ hai như một bảo đảm**. Riêng "service *này* có bị restart
  không" nằm ở `service.limits` → `watchdog { after_minutes, restarts }`, `null` nghĩa là không ai
  canh — và database thì cố ý được cảnh báo rồi để yên.
- **T3.4 — Database.** `database.create` trả database, account và **địa chỉ keyring**, không bao giờ
  trả mật khẩu. `database.client` trả `DatabaseClientReport { protocol, secret, client }` — `installed`
  kèm executable, `not_installed` kèm nơi đã tìm và homepage, `no_client`, và `protocol: null` cho
  service không client nào mở. **Cả ba đều là trạng thái, không phải lỗi**: vẽ chúng như một
  affordance vắng mặt kèm một câu giải thích, đừng vẽ như một thất bại của người dùng.
- **T3.5 — `database.open`, nhìn từ phía trong.** Đây chính là đường đã đẻ ra Pha 0: daemon đọc
  credential đúng khoảnh khắc bàn giao, tự khởi động client tìm được với mật khẩu trong environment
  của process đó, và trả về **địa chỉ** nó đọc từ đâu, không trả **giá trị**. Trong MixDB, "Open in
  MixDB" ở màn hình này không nên đi vòng qua OS: nó là một tab mới ngay trong app.
- **T3.6 — Logs.** `GET /logs/{service_id}?tail=N&follow=1`, SSE đóng khung như `/events`. `tail` một
  mình là ảnh chụp rồi kết thúc; `follow` giữ kết nối. **Log không bao giờ là event** — bus 1024
  message của `/events` là 1024 thay đổi trạng thái, một service ở chế độ debug sẽ ăn hết nó và làm
  rơi đúng những transition mà client mở stream để chờ ([ADR 0009](https://github.com/mixnz/mixengine/blob/master/.claude/decisions/0009-logs-travel-on-their-own-stream.md)).
  Lộ luôn đường file trên đĩa để UI mở được thư mục chứa.

**Xong khi:** cài được một PHP mới với thanh tiến độ thật, sửa được port của MariaDB và thấy lỗi
validate đúng ô, và tail được log của nó trong lúc nó khởi động.

---

## Pha 4 — Metrics, Blueprints, Extensions, Settings

- **T4.1 — Metrics, hai nhịp lấy mẫu.** Mở `GET /metrics` **chính là** subscribe, đóng là hủy — nên
  một client crash không để lại cái laptop bị đo mỗi giây. Không ai xem thì daemon vẫn lấy một mẫu
  mỗi phút, và lịch sử 24 giờ (`metrics.history`) làm từ đúng những mẫu đó. Không có
  `metrics.subscribe`.
- **T4.2 — Một phút thiếu nghĩa là không ai đo, không bao giờ nghĩa là không dùng gì.** Vẽ một khoảng
  trống; nối hai điểm qua nó là bịa ra một đêm số liệu chưa từng được lấy. Cùng luật ấy trong một
  mẫu: `cpu_percent` là `null` ở chỗ không lấy được số, và vẽ nó thành 0% là tuyên bố một service
  rảnh đúng vào giây nó đắt nhất. CPU/RSS gộp theo cả process group — php-fpm master và worker là một
  hàng — và là **ước lượng thừa**, không phải đại lượng mà giới hạn `memory_mb` bị đo theo.
- **T4.3 — Blueprints, và hai nghĩa vụ client không được từ chối.** Mỗi chỗ nêu tên một blueprint
  phải nói có gì bảo chứng cho nó không — `blueprint.import` quyết định điều đó một lần và không gì
  khác nêu lại. Và trước một lần apply có bước `RunScaffold`, UI phải hiện **đúng câu lệnh đó** kèm
  trạng thái tin cậy, rồi gửi một `ScaffoldConsent` nêu cả hai; daemon từ chối consent lệch bất kỳ
  nửa nào. Output của job đọc ở `GET /logs/job/{id}`.
- **T4.4 — Extensions.** `extension.registry_list` / `install` / `uninstall` / `configure`. Trước khi
  cài, `extension.plan` nói quyền, `homepage`, và với `kind = web-app` thì cả php-fpm pool nó chạy
  trên đó lẫn database nó quản. Nếu nó khai `signs_in`, tài khoản đó phải hiện **giữa** danh sách
  quyền chứ không phải bên cạnh tên miền, kèm đúng ba câu: tài khoản nào, mật khẩu lấy từ keyring lúc
  pool khởi động, và không gì ghi nó xuống đĩa.
- **T4.5 — `desktop-app` là chính MixDB.** `ExtensionPlan.client` là `installed { program }` hoặc
  `not_installed { searched }`. MixEngine **tìm** ứng dụng chứ không cài nó, nên version của entry
  không phải câu trả lời của máy này. Một màn hình MixDB tự nói về chính mình ở đây là chuyện dễ vẽ
  sai — giữ nó là một câu, không phải một luồng cài đặt.
- **T4.6 — Settings.** Root directory, TLD quản lý, web server mặc định, updates, `daemon.doctor` và
  `daemon.doctor_repair`. Autostart là một công tắc đọc từ `autostart.status`, và câu trả lời nói
  máy này có cơ chế nào, entry nằm đâu, và — thứ duy nhất client **không được** tự suy ra — một entry
  đã đăng ký thì thuộc home này hay home khác. Công tắc phải đọc được là *"bật, cho một home khác"*.
- **T4.7 — Gỡ MixEngine.** `daemon.uninstall_plan` trước và luôn luôn, vì thứ người ta sắp cho phép
  là thứ họ được xem. Rồi `daemon.uninstall`, một job bật đúng một prompt. Vẽ **mọi** hàng, kể cả
  những hàng trả lời *không có gì ở đó*: màn hình giấu chúng đi khiến người ta không phân biệt được
  "không có resolver wiring" với "resolver wiring không được xem tới". `keep_home` là lời mời giữ lại
  database. **Daemon tự kết thúc khi home đi cùng nó** — client phải chờ kết nối đóng rồi đọc lại các
  hàng `on_exit` từ đĩa, đó mới là *không còn gì sót lại* thay vì *daemon nói thế*.
- **T4.8 — Diagnostics.** `daemon.bundle` gom một archive và trả đường dẫn của nó — "copy
  diagnostics" là một file để mở, không phải năm chỗ để đọc. Thứ nó từ chối mang theo thì nó nêu tên,
  và UI hiện luôn cái đó thay vì trình bày archive như đã đầy đủ.

**Xong khi:** trả lời được câu *"đêm qua cái gì ăn pin của tôi"* từ lịch sử 24 giờ, và gỡ được
MixEngine khỏi máy mà xem trước được từng dòng.

---

## Luật xuyên suốt

Năm luật này của MixEngine, chép vào đây vì chúng ràng buộc UI chứ không phải chỉ ràng buộc daemon.
Vi phạm bất kỳ cái nào đều tạo ra một UI *chạy được* nhưng nói dối.

1. **Trạng thái được thông báo, không bao giờ được suy ra.** Hiện `Starting…` vì stream nói thế. Một
   công tắc nói dối về việc MariaDB có đang chạy hay không thì tệ hơn một công tắc chậm.
2. **Không gì chặn.** Thao tác nào có thể dài hơn một request đều là job có id và tiến độ.
3. **Quyền quản trị giải thích được trước khi được xin.** Danh sách đầy đủ, rồi một prompt.
4. **Mỗi lỗi mang theo cách chữa của nó.** `Error.hint` là hành động gợi ý UI vẽ ra.
5. **Bí mật đọc đúng lúc bàn giao, không bao giờ hiện trên đường đi.** "Hiện mật khẩu" là một call
   riêng và cố ý, không phải một field trên một lần đọc service.

## Phiên bản

Site tài liệu nói về **một** release (`index.json` ghi là bản nào — hiện 0.1.0). Daemon đang chạy tự
khai version của nó qua `daemon.status`. Khi hai cái lệch nhau, **daemon là sự thật về cái máy trước
mặt**, site là sự thật về bản phát hành hiện tại. Protocol version học từ handshake, không phải từ
file types — đó là lý do nó cố ý không nằm trong `bindings/`.

Một member mới thêm vào response là optional trên wire và **không** làm bump protocol version; đừng
viết code vỡ khi thiếu nó. `daemon.version` và `GET /health` là ngoại lệ ngược lại: chúng không bao
giờ mọc thêm field, vì đó là thứ client đọc trước khi biết có tin phần còn lại được không.

## Ngoài phạm vi

- Không dựng lại `mix` CLI trong MixDB. Mọi method mutating đều đã gọi được từ CLI, đó là bảo đảm của
  họ chứ không phải việc của ta.
- Không quản lý MixEngine trên máy khác. Daemon không có đường mạng có xác thực, và cố ý như vậy.
- Không đọc/ghi thẳng SQLite hay file config của MixEngine. Chỉ đi qua API.
- Không tự cài MixEngine. Không tìm thấy daemon thì nói ở đâu đã tìm và link tới trang cài đặt —
  đúng như MixEngine làm với MixDB theo chiều ngược lại.

## Câu còn để ngỏ

- **Vendor `bindings/` bằng cách nào.** Tải tarball đã ký mỗi lần bump, hay submodule, hay chép tay
  một lần rồi canh bằng một script trong `scripts/`? Quyết trước T1.2, và ghi vào
  `.agent/decisions/` khi Pha 1 xong.
- **Một tab hay nhiều tab.** Chín màn hình trong một tab có sidebar là mặc định của roadmap này. Nếu
  Logs và Metrics muốn mở cạnh nhau, chúng có thể phải là tab riêng — để Pha 3 trả lời bằng cái đã
  dùng thật, không quyết bây giờ.
- **Tray/menu-bar.** `client-surface.md` nói một tray item không cần gì hơn dashboard: trạng thái
  chung, stop-all, danh sách site. Rẻ, nhưng là quyết định về shell của MixDB chứ không phải về
  module — để sau Pha 1.
