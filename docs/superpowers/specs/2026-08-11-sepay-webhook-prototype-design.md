# Prototype nhận webhook SePay — Thiết kế

Ngày: 2026-08-11

## 1. Bối cảnh và mục tiêu

Dự án ban đầu cân nhắc hai hướng: tự xây hệ thống đọc biến động số dư qua SMS
hoặc làm đại lý bán lại SePay và xây phần giá trị gia tăng bên trên.

**Kết quả ngày 2026-08-12:** giao dịch ngân hàng thật đã đi qua
TPBank → SePay → GGPay với webhook HTTP 200; thử nghiệm lặp lại cho thấy độ trễ
đủ tốt. Giai đoạn hiện tại đã chốt dùng SePay làm upstream và bỏ hoàn toàn việc
tự xây SMS Banking. `autobank-sms-banking.md` chỉ còn là tài liệu lưu trữ.

Prototype này tồn tại để trả lời bằng dữ liệu thật, không phải phỏng đoán:

1. Dữ liệu SePay bắn ra trông thế nào, đầy đủ tới đâu?
2. Độ trễ thật bao nhiêu, và chênh lệch giữa kênh API và kênh SMS ra sao?
3. Nội dung chuyển khoản có bị cắt không?
4. Kiến trúc "API of record" — nhận từ SePay, chuẩn hoá về hợp đồng riêng,
   bắn tiếp cho khách — có chạy trơn không?

Câu 1–3 quyết định có nên làm đại lý. Câu 4 quyết định kiến trúc sản phẩm.

## 2. Ngoài phạm vi

- Không xây collector SMS, không app Android. SePay tự lo phần thượng nguồn.
- Không làm khớp đơn hàng, không hàng đợi duyệt tay.
- Không làm dashboard. Soi dữ liệu qua endpoint JSON.
- Không làm đa nhà cung cấp. Chỉ SePay, nhưng chừa chỗ cắm adapter thứ hai.
- Không dùng "Giả lập giao dịch" của SePay làm nguồn kiểm chứng chính —
  đã chốt là chờ ngân hàng thật. Payload mẫu chỉ dùng cho unit test.

## 3. Kiến trúc

```
SePay ──POST──►  [1] receiver     xác thực → ghi raw → ack
                       │
                       ▼
                  [2] normalizer  hàm thuần: payload SePay → giao dịch chuẩn
                       │
                       ▼
                  [3] store       ghi transactions, chống trùng
                       │
                       ▼
                  [4] dispatcher  bắn webhook ra, HMAC + retry
                       │
                       ▼
                  [5] test-sink   endpoint tự dựng, đóng vai khách
```

Stack: Node + TypeScript, Postgres. Deploy lên Render: có URL HTTPS cố định,
chạy 24/7, và Postgres quản lý sẵn cùng chỗ nên không phải nối hai nhà cung
cấp. Đổi sang Fly.io hay VPS sau này không ảnh hưởng thiết kế.

Không dùng SQLite: filesystem trên PaaS free tier là ephemeral, deploy lại
là mất dữ liệu.

### Ranh giới các module

| Module | Nhiệm vụ | Phụ thuộc |
|---|---|---|
| `receiver` | HTTP, xác thực, ghi raw, trả lời; kèm `GET /events` có bảo vệ để soi dữ liệu | `store` |
| `normalizer` | **Hàm thuần**, không I/O: payload → giao dịch chuẩn | không |
| `store` | Truy cập DB | Postgres |
| `dispatcher` | Giao webhook ra ngoài, retry | `store` |
| `retry-worker` | Vòng lặp `setInterval` 30s, quét `deliveries` có `next_retry_at` đã tới hạn | `dispatcher` |
| `test-sink` | Endpoint nhận, chỉ ghi log | không |

`retry-worker` chạy trong cùng tiến trình ở giai đoạn này — chưa cần queue
riêng vì tải bằng không. Khi nào cần tách thì `deliveries` đã là hàng đợi sẵn.

`normalizer` là hàm thuần vì hai lý do: test được toàn bộ bằng fixture, và
chạy lại được trên `raw_events` khi sửa logic mà không cần dữ liệu mới.

## 4. Mô hình dữ liệu

### Bảng

```sql
raw_events (
  id            uuid primary key,
  source        text not null,          -- 'sepay'
  received_at   timestamptz not null,   -- giờ server
  headers       jsonb not null,
  body          jsonb not null,
  remote_ip     inet,
  status        text not null,          -- 'stored' | 'normalized' | 'normalize_failed'
  error         text
)

transactions (
  id              uuid primary key,
  source          text not null,
  source_event_id text not null,
  channel         text not null,        -- 'api' | 'sms' | 'unknown'
  bank_code       text not null,
  account_number  text not null,
  sub_account     text,
  direction       text not null,        -- 'in' | 'out'
  amount          bigint not null,      -- đồng, số nguyên
  balance_after   bigint,
  content         text,
  payment_code    text,                 -- SePay tự trích, field `code`
  reference_code  text,
  occurred_at     timestamptz not null,
  received_at     timestamptz not null,
  latency_ms      integer not null,
  raw_id          uuid not null references raw_events(id),
  UNIQUE (source, source_event_id)
)

deliveries (
  id             uuid primary key,
  transaction_id uuid not null references transactions(id),
  url            text not null,
  attempt        integer not null,
  status_code    integer,
  error          text,
  next_retry_at  timestamptz,
  delivered_at   timestamptz
)
```

### Ghi chú thiết kế

**`raw_events` không chống trùng.** Cố ý. SePay có thể retry, và một mục tiêu
của bài test là đo xem họ retry mấy lần, cách nhau bao lâu. Dedup ở tầng này
sẽ giấu mất hành vi cần quan sát. Chống trùng nằm ở `transactions`.

**Chống trùng chỉ cần `UNIQUE (source, source_event_id)`.** Toàn bộ thiết kế
khoá theo chuỗi số dư ở mục 6 của `autobank-sms-banking.md` không cần dùng
tới — SePay đã chống trùng ở thượng nguồn. Đây là thứ thừa hưởng khi làm đại lý.

**Tiền là `bigint` đồng.** SePay dùng `decimal(20,2)` trong ví dụ của họ, nên
`transferAmount` có thể về dạng `1700000` hoặc `1700000.00`. Normalizer phải
xử lý cả hai và luôn cho ra số nguyên đồng. Không dùng float ở bất kỳ đâu.

**`channel` là giả thuyết cần kiểm chứng, không phải sự thật.** Suy đoán:
`referenceCode` có giá trị → kênh API; null → kênh SMS. Ghi lại kết quả suy
đoán nhưng giữ nguyên `raw_events` để đối chiếu. Chính bài test sẽ xác nhận
hoặc bác bỏ.

**`payment_code`** đến từ field `code` của SePay — họ tự trích mã đơn từ nội
dung chuyển khoản. Cần kiểm chứng độ chính xác, vì nếu dùng được thì phần
trích mã ở mục 7 của tài liệu gốc cũng không phải tự làm.

## 5. Chi tiết tích hợp SePay

Đã xác minh từ tài liệu chính thức của họ.

**Payload** (`POST`, JSON):

```json
{
  "id": 123456,
  "gateway": "MBBank",
  "transactionDate": "2024-05-25 21:11:02",
  "accountNumber": "0359123456",
  "subAccount": null,
  "code": null,
  "content": "Thanh toan QR SE123456",
  "description": "Thanh toan QR SE123456",
  "transferType": "in",
  "transferAmount": 1700000,
  "referenceCode": "FT123456789",
  "accumulated": 0
}
```

**Response mong đợi:** HTTP 200 với body `{"success": true}`. Ví dụ chính thức
của SePay trả về đúng dạng này, nên nhiều khả năng họ kiểm tra body chứ không
chỉ status code. Trả `{"success": false, "message": "..."}` khi lỗi.

**Xác thực:** cấu hình kiểu `API Key` trong dashboard SePay. Họ gửi header
`Authorization: Bearer <token>`. So sánh bằng hàm constant-time.

**IP nguồn của SePay** (dùng làm lớp phòng thủ thứ hai):

```
IPv4: 172.236.138.20, 172.233.83.68, 171.244.35.2,
      151.158.108.68, 151.158.109.79, 103.255.238.139
IPv6: 2400:8905::2000:8cff:fe98:45cd, 2600:3c15::2000:8aff:fedd:874b
```

Ghi `remote_ip` vào `raw_events`. Giai đoạn đầu **chỉ ghi log và cảnh báo khi
IP lạ, chưa chặn** — danh sách IP có thể thay đổi mà họ không báo, chặn nhầm
thì mất giao dịch thật.

**Không sao chép code mẫu của SePay.** File `receiver.php` trong tài liệu của
họ nối chuỗi thẳng vào câu SQL, dính SQL injection. Chỉ tham chiếu tên trường.

**Đối chiếu chéo:** dashboard SePay có mục "Nhật ký WebHooks" ghi thời điểm họ
bắn. So với `received_at` của mình để tách độ trễ mạng khỏi độ trễ ngân hàng.

## 6. Xử lý lỗi

Nguyên tắc nền: **tách "đã nhận được chưa" khỏi "đã hiểu được chưa".** Retry
chỉ giải quyết được vế đầu.

| Tình huống | Xử lý | Trả về SePay |
|---|---|---|
| Token sai/thiếu | Không ghi gì | 401 |
| Ghi `raw_events` thất bại | Không mất dữ liệu vì chưa ack | 500, để SePay retry |
| Ghi raw xong, normalize lỗi | `status = 'normalize_failed'` + cảnh báo | 200 `{"success": true}` |
| Payload thiếu trường bắt buộc | như trên | 200 |
| Trùng `source_event_id` | Bỏ qua insert, vẫn ghi raw | 200 |
| Dispatcher gọi sink lỗi | Ghi `deliveries`, hẹn retry | không liên quan |

Điểm quan trọng ở dòng thứ ba: normalize lỗi là **lỗi phía mình**, SePay retry
lại cũng cho ra kết quả y hệt. Bắt họ retry chỉ tạo rác. Ack và tự đi sửa,
rồi chạy lại normalizer trên `raw_events` đã lưu.

`normalize_failed` chính là `unmatched_queue` ở mục 5 tài liệu gốc, dạng tối
giản. Quá 3 bản ghi trong 10 phút thì cảnh báo.

**Retry của dispatcher:** 0s → 10s → 1m → 5m → 30m → 2h → 6h, sau đó dead
letter. Ký `HMAC-SHA256` trên body kèm timestamp trong header.

## 7. Testing

**Unit — `normalizer`** (phần lớn giá trị nằm ở đây vì nó là hàm thuần):

- payload mẫu chuẩn → giao dịch đúng
- `transferAmount` dạng `1700000` và `1700000.00` → cùng ra `1700000n`
- `transferType: "out"` → `direction: 'out'`
- `referenceCode: null` → `channel: 'sms'`
- `referenceCode: "FT..."` → `channel: 'api'`
- `content`, `subAccount`, `code` null → không nổ
- `accumulated: 0` → `balance_after: 0n`, phân biệt được với null
- thiếu trường bắt buộc → ném lỗi có tên rõ ràng

**Integration — `receiver`:**

- token đúng → 200 `{"success": true}`, có 1 dòng `raw_events`
- token sai → 401, không có dòng nào
- không header auth → 401
- cùng payload gửi 2 lần → 2 dòng `raw_events`, 1 dòng `transactions`
- DB chết → 500 (kiểm tra bằng cách đóng pool)

**Integration — `dispatcher`:**

- sink trả 500 → có dòng `deliveries` với `next_retry_at`
- sink trả 200 → `delivered_at` được ghi
- chữ ký HMAC verify được ở phía sink

## 8. Hai mốc

**Mốc 1 — nằm chờ sẵn.** `receiver` + `raw_events` + `GET /events` (có bảo vệ
bằng token) để soi dữ liệu. Deploy, lấy URL, cấu hình vào dashboard SePay.

Mục tiêu: sẵn sàng **trước khi** ngân hàng kích hoạt, để không bỏ lỡ giao dịch
thật đầu tiên. Đăng ký BĐSD với ngân hàng có thể mất vài ngày.

**Mốc 2 — phần còn lại.** `normalizer`, `store`, `dispatcher`, `test-sink`.
Làm trong lúc chờ ngân hàng. Khi giao dịch thật về, đã có sẵn cả dữ liệu thô
lẫn dữ liệu chuẩn hoá để đối chiếu.

## 9. Việc bạn phải tự làm

Những việc này tôi không làm hộ được:

1. Đăng ký tài khoản SePay.
2. Kết nối tài khoản ngân hàng — đường API hoặc đường SMS. Nếu đi đường SMS:
   lấy số điện thoại SePay cấp, đăng ký với ngân hàng làm **số thứ hai** nhận
   biến động số dư. **Chỉ đăng ký BĐSD, tuyệt đối không đăng ký OTP.**
3. Tạo webhook trong dashboard SePay: dán URL đã deploy, chọn kiểu chứng thực
   `API Key`, dán token.
4. Chuyển tiền test thật.

Tôi sẽ soạn checklist thao tác chi tiết kèm ma trận kịch bản chuyển tiền.

## 10. Tiêu chí thành công

Prototype coi là xong khi trả lời được, bằng số:

- **Độ trễ** p50 và p95 của `latency_ms`, tách theo `channel`.
- **Hành vi retry của SePay**: bao nhiêu lần, cách nhau bao lâu, khi nào bỏ.
- **Bảng đối chiếu trường null** giữa kênh API và kênh SMS — trường nào mất
  khi đi đường SMS.
- **Nội dung có bị cắt không**: chuyển khoản với nội dung dài 50 ký tự, so
  chuỗi nhận được với chuỗi đã gõ. Đây là câu hỏi quan trọng nhất với chiến
  lược, vì nó quyết định mã đơn hàng dài bao nhiêu thì an toàn.
- **`code` do SePay trích có chính xác không** so với nội dung thật.

## 11. Câu hỏi mở

- SePay có gửi header signature hay retry counter nào không? Tài liệu không
  nhắc. Mốc 1 lưu toàn bộ header nên sẽ biết.
- Response body có bắt buộc phải là `{"success": true}` không, hay chỉ cần
  status 200? Thử trả về body rỗng ở một lần giao dịch để xem họ có retry.
- Với kênh SMS, `accumulated` (số dư) có được điền không? Nếu null thì mất
  luôn khả năng phát hiện mất tin ở mục 6 tài liệu gốc.
