# Deploy EZPay Receiver

## Render

1. Đẩy repository lên một GitHub repository riêng tư.
2. Trên Render chọn **New → Blueprint** và trỏ tới repository; Render đọc
   `render.yaml`, tạo web service và Postgres.
3. Trong **Environment**, lưu lại `SEPAY_WEBHOOK_TOKEN`, `INSPECT_TOKEN` và
   `OUTBOUND_WEBHOOK_SECRET` mà Render sinh ra.
4. Đặt `OUTBOUND_WEBHOOK_URL` thành URL nhận webhook của khách. Có thể để trống
   trong Mốc 1; receiver vẫn nhận, lưu và chuẩn hoá bình thường.
5. Gọi `GET /health`; kết quả đúng là `{"ok":true}`.
6. Trong SePay, tạo webhook gọi `POST /webhooks/sepay`, chọn chứng thực API Key,
   rồi dùng đúng `SEPAY_WEBHOOK_TOKEN` ở bước 3.

Không ghi token thật vào repository. Header `Authorization`, cookie và
`X-API-Key` được redact trước khi lưu vào `raw_events`.

## Kiểm tra

```bash
curl https://<service>.onrender.com/health

curl -H "Authorization: Bearer <INSPECT_TOKEN>" \
  https://<service>.onrender.com/events

curl -H "Authorization: Bearer <INSPECT_TOKEN>" \
  https://<service>.onrender.com/report
```

`GET /events?limit=50` trả payload thô mới nhất. `limit` nằm trong khoảng 1–500.

`GET /report` có bốn nhóm:

- `latency`: p50, p95 và độ trễ lớn nhất theo kênh suy đoán `api`/`sms`.
- `fieldCoverage`: tỷ lệ có số dư, nội dung, mã tham chiếu và mã thanh toán.
- `sepayRetries`: cùng một `id` của SePay được gửi lại bao nhiêu lần.
- `normalizeFailures`: payload đã lưu nhưng chưa chuẩn hoá được.

`channel` hiện được **suy đoán**: có `referenceCode` là API, không có là SMS.
Phải đối chiếu dữ liệu thật trước khi coi đây là sự thật.

## Hạn chế free tier

Render có thể thay đổi chính sách free tier, cho service ngủ hoặc hết hạn
Postgres. Trước khi dùng production, chuyển sang gói có storage bền vững và
kiểm tra backup. Prototype này chưa được coi là hệ thống production.
