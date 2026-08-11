# GGPay Multi-tenant Reseller MVP Plan

## Mục tiêu

Biến receiver SePay một-tenant thành API reseller nhiều tenant có thể pilot với
khách thật: tenant riêng, API key riêng, tài khoản ngân hàng riêng, webhook HMAC
riêng, delivery/retry riêng, transaction API cô lập dữ liệu, và metering hàng tháng.

## Phạm vi

### Có trong MVP

- Admin API tạo và quản lý tenant.
- Sinh API key một lần; DB chỉ lưu SHA-256, không lưu plaintext.
- Gắn mỗi số tài khoản ngân hàng với đúng một tenant.
- Cấu hình một webhook URL + secret cho mỗi tenant.
- Receiver định tuyến giao dịch theo `account_number`.
- Giao dịch tài khoản chưa đăng ký vẫn lưu raw/canonical, nhưng không dispatch;
  đánh dấu `unrouted` để admin xử lý, không làm SePay retry vô ích.
- Customer API liệt kê giao dịch và delivery của chính tenant.
- Metering theo số giao dịch tiền vào canonical mỗi tháng; retry không tính thêm.
- Webhook HMAC/retry hiện tại được tenant hóa.
- Migration tương thích dữ liệu hiện có trên Render.
- CI PostgreSQL kiểm tra tenant isolation và end-to-end routing.

### Chưa có

- Dashboard web.
- Đăng ký tự phục vụ/OAuth.
- Thanh toán hóa đơn tự động.
- Quota hard-stop khi hết gói.
- Nhiều webhook cho một tenant.
- Nhiều upstream ngoài SePay.
- SMS Banking tự xây.

## Kiến trúc

```text
SePay
  → POST /webhooks/sepay
  → raw_events
  → canonical transaction
  → route account_number → bank_accounts.tenant_id
      ├─ matched: tenant transaction + usage event + delivery
      └─ unmatched: transaction routing_status=unrouted, không dispatch

Admin (INSPECT_TOKEN)
  → /admin/v1/tenants
  → /admin/v1/tenants/:id/api-keys
  → /admin/v1/tenants/:id/bank-accounts
  → /admin/v1/tenants/:id/webhook

Customer (GGPay API key)
  → /v1/transactions
  → /v1/deliveries
  → /v1/usage
```

Admin API tiếp tục dùng `INSPECT_TOKEN` trong Render. Customer API dùng
`Authorization: Bearer gg_live_<public-id>.<secret>`; middleware băm secret rồi
so constant-time với digest trong DB, sau đó đặt `tenantId` vào request context.

## Schema

### `tenants`

- `id uuid primary key`
- `name text not null`
- `slug text unique not null`
- `status text check active|suspended`
- `created_at timestamptz`

### `tenant_api_keys`

- `id uuid primary key`
- `tenant_id uuid references tenants`
- `key_prefix text unique not null` — public-id để tìm dòng nhanh
- `secret_hash bytea not null`
- `name text not null`
- `last_used_at timestamptz`
- `revoked_at timestamptz`
- `created_at timestamptz`

Plaintext chỉ xuất hiện trong response lúc tạo key, không log và không lưu DB.

### `bank_accounts`

- `id uuid primary key`
- `tenant_id uuid references tenants`
- `account_number text unique not null`
- `bank_code text`
- `label text`
- `active boolean`
- timestamps

Unique toàn cục theo `account_number`: một tài khoản không thể bị route sang hai tenant.

### `tenant_webhooks`

- `id uuid primary key`
- `tenant_id uuid unique references tenants`
- `url text not null`
- `secret_encrypted text not null`
- `active boolean`
- timestamps

MVP cần lấy secret plaintext để ký webhook, nên mã hóa bằng AES-256-GCM với
`WEBHOOK_ENCRYPTION_KEY` trong Render. Không lưu plaintext/hash-only vì hash không
thể dùng để tạo HMAC outbound.

### Thay đổi bảng hiện có

`transactions` thêm:

- `tenant_id uuid null references tenants`
- `bank_account_id uuid null references bank_accounts`
- `routing_status text not null default 'unrouted'` (`routed|unrouted`)
- index `(tenant_id, occurred_at desc)`

Dữ liệu cũ giữ `tenant_id=null`, `unrouted`.

`deliveries` thêm:

- `tenant_id uuid references tenants`
- `webhook_id uuid references tenant_webhooks`
- `event_id uuid not null` — cố định qua mọi attempt

Retry selection nhóm theo `(transaction_id, webhook_id)`, không chỉ transaction.

`usage_events`:

- `id uuid primary key`
- `tenant_id uuid references tenants`
- `transaction_id uuid unique references transactions`
- `metric text default 'incoming_transaction'`
- `occurred_at timestamptz`

Unique transaction đảm bảo SePay retry không tính tiền hai lần.

## API

### Admin

- `POST /admin/v1/tenants` `{name, slug}` → tenant.
- `POST /admin/v1/tenants/:id/api-keys` `{name}` → key plaintext một lần.
- `DELETE /admin/v1/api-keys/:id` → revoke.
- `POST /admin/v1/tenants/:id/bank-accounts`
  `{account_number, bank_code?, label?}`.
- `PUT /admin/v1/tenants/:id/webhook` `{url, secret?}`; nếu không truyền secret,
  server tự sinh và trả plaintext một lần.
- `GET /admin/v1/tenants/:id` → cấu hình không lộ secret/hash.

Admin endpoints dùng Bearer `INSPECT_TOKEN` và không được phép dùng scheme Apikey.

### Customer

- `GET /v1/transactions?limit=50&before=<cursor>`.
- `GET /v1/transactions/:id`.
- `GET /v1/deliveries?limit=50`.
- `GET /v1/usage?month=2026-08` → `{incoming_transactions: N}`.

Mọi query bắt buộc `where tenant_id=$tenantId`; test tenant isolation là điều kiện merge.

### Webhook outbound

Giữ payload hiện tại, thêm:

- `tenant_id`
- `event_type: "transaction.created"`
- `event_id` ổn định qua retry

Headers:

- `X-GGPay-Event-Id`
- `X-GGPay-Timestamp`
- `X-GGPay-Signature: sha256=<hex>`

HMAC trên `${timestamp}.${rawBody}`. Delivery at-least-once; khách dedup bằng `event_id`.

## Luồng receiver

1. Xác thực SePay `Authorization: Apikey`.
2. Ghi raw event, rồi normalize.
3. Trong transaction DB:
   - tra `bank_accounts` active bằng account number;
   - insert canonical transaction với tenant/routing status;
   - nếu tiền vào và routed, insert `usage_events on conflict do nothing`.
4. Ack SePay `200 {success:true}` sau khi DB commit.
5. Sau ack, lấy active tenant webhook và dispatch.
6. Nếu account chưa map, log structured warning + hiện trong admin report; không retry
   SePay vì payload đã lưu đầy đủ và có thể backfill sau.

## An toàn và vận hành

- `WEBHOOK_ENCRYPTION_KEY` bắt buộc là base64 của đúng 32 bytes.
- Không log API key, webhook secret, Authorization header hoặc raw HMAC material.
- URL webhook MVP chỉ chấp nhận HTTPS, ngoại trừ localhost trong test.
- Chặn private/link-local IP sau DNS resolution trước mỗi delivery để giảm SSRF;
  redirect tắt (`redirect: 'manual'`).
- Customer API key có prefix để lookup và hash secret constant-time.
- Suspended tenant: customer API trả 403, receiver vẫn lưu transaction nhưng không dispatch
  và không ghi usage billable.
- `/health` tiếp tục kiểm tra DB.

## Trình tự triển khai

1. Migration + crypto/API-key primitives.
2. Admin tenant provisioning API.
3. Tenant routing trong receiver + backfill command cho transaction unrouted.
4. Tenant webhook dispatcher/retry và SSRF guard.
5. Customer transaction/delivery/usage API với tenant isolation.
6. Integration tests đầy đủ trên PostgreSQL CI.
7. Deploy Render, tạo tenant pilot, map TPBank `10004087955`, cấu hình webhook test.
8. Chuyển giao dịch thật và xác minh tenant nhận đúng một event; tenant khác không đọc được.

## Tiêu chí hoàn tất

- CI unit + PostgreSQL xanh.
- Hai tenant test không thể đọc chéo transaction/delivery.
- Giao dịch TPBank thật được route đúng tenant.
- Usage tăng đúng 1 dù SePay gửi lại.
- Webhook tenant nhận event HMAC hợp lệ; lỗi được retry theo lịch.
- Revoke API key có hiệu lực ngay.
- Account chưa map không làm mất raw/canonical transaction.
