# Autobank qua SMS Banking

Phạm vi đã chốt:

- **Chỉ SMS Banking.** Không notification listener, không API ngân hàng ở giai đoạn này.
- **SIM và máy đều của khách.** Bạn không nuôi SIM farm, không đăng ký thuê bao, không
  dính quy định viễn thông.
- **Bỏ Vietcombank.** Lý do ở mục cuối.
- Mục tiêu: một đường đọc biến động số dư, chạy được, đủ tin cậy để bán.

---

## 1. Ràng buộc mà SMS áp lên toàn bộ thiết kế

Ba điều này quyết định mọi thứ phía sau. Đọc kỹ trước khi viết code.

**SMS không có mã giao dịch.** Không có trường `id` như API. Bạn phải tự dựng khoá
chống trùng. Khoá tốt nhất là **số dư sau giao dịch** — mỗi giao dịch để lại đúng một
giá trị số dư trên một tài khoản. Ngân hàng nào không gửi số dư trong SMS thì bạn mất
luôn cả dedup lẫn gap detection. Đây là tiêu chí chọn ngân hàng số một.

**Nội dung chuyển khoản bị cắt.** SMS giới hạn ký tự, ngân hàng chèn thêm text riêng
vào đầu, nên phần nội dung khách nhập thường bị cắt cụt — và bị cắt **từ đuôi**.
Hệ quả trực tiếp: mã đơn hàng phải **ngắn và nằm ở đầu** nội dung chuyển khoản.
`DH7K2M sản phẩm ABC` sống sót, `Thanh toan don hang so DH7K2M` thì không.

**Độ trễ không xác định.** Bình thường 1–5 giây, giờ cao điểm hoặc lễ Tết có thể vài
phút. Và SMS **đến không đảm bảo thứ tự**. Đừng bao giờ sắp thứ tự giao dịch bằng
thời gian nhận tin — sắp bằng chuỗi số dư.

---

## 2. Tiêu chí chọn ngân hàng

Chấm điểm từng ngân hàng theo bảng này trước khi viết parser. Không đoán — phải mở tài
khoản thật và tự chuyển tiền để kiểm tra.

| # | Tiêu chí | Tại sao quan trọng | Loại nếu |
|---|---|---|---|
| 1 | SMS có **số dư sau giao dịch** | Khoá dedup + gap detection | Không có → loại |
| 2 | SMS có **nội dung chuyển khoản** | Không có thì không match được đơn | Không có → loại |
| 3 | Nội dung giữ được **≥ 12 ký tự đầu** | Đủ chỗ cho mã đơn | < 8 ký tự → loại |
| 4 | **Không có ngưỡng số tiền tối thiểu** | Ngưỡng = mù với giao dịch nhỏ | Có ngưỡng cao → hoãn |
| 5 | SMS có **số tài khoản** (dù che một phần) | Phân biệt khi khách có nhiều TK | Không có → khó, không chết |
| 6 | Còn duy trì dịch vụ SMS BĐSD | Nhiều ngân hàng đang bỏ dần | Đã ngừng → loại |
| 7 | Phổ biến với hộ kinh doanh nhỏ | Quyết định bạn bán được cho ai | — |
| 8 | Phí SMS hợp lý | Khách trả, nhưng cao quá thì khách bỏ | — |

Tiêu chí 1, 2, 3 là điều kiện cần. Thiếu một trong ba thì đừng hỗ trợ ngân hàng đó,
dù nó phổ biến đến mấy.

---

## 3. Danh sách khảo sát vòng đầu

Đây là **giả thuyết cần kiểm chứng**, không phải kết luận. Mỗi ngân hàng thay đổi
format và chính sách SMS theo thời gian, và không có nguồn công khai nào đáng tin về
template SMS hiện tại. Bạn phải tự mở tài khoản và test.

**Nhóm ưu tiên khảo sát trước** — phổ biến với hộ kinh doanh, mở tài khoản online nhanh,
miễn phí duy trì:

| Ngân hàng | Lý do đưa vào vòng đầu |
|---|---|
| MB Bank | Rất phổ biến với shop nhỏ, mở tài khoản online trong vài phút |
| Techcombank | Tệp khách thành thị đông, nhiều shop online dùng |
| ACB | Phổ biến ở miền Nam, nhiều hộ kinh doanh |
| VPBank | Mở tài khoản dễ, nhiều freelancer và MMO dùng |
| TPBank | Ngân hàng số, tệp khách trẻ |
| Agribank | **Áp đảo ở nông thôn và tỉnh lẻ** — nếu bạn bán ở Nghệ An và các tỉnh, đây có thể là ngân hàng quan trọng nhất, dù ít ai để ý |

**Chọn đúng 3 ngân hàng để làm trước.** Không phải 6. Ba parser chạy tốt có giá trị hơn
sáu parser chạy nửa vời, và ngân hàng thứ tư trở đi sẽ nhanh hơn nhiều khi bạn đã có
hàng đợi tin chưa parse để soi.

Gợi ý bộ ba khởi đầu: **MB Bank + Agribank + một ngân hàng bạn đã có sẵn tài khoản**.
MB cho tệp shop online, Agribank cho tệp tỉnh, cái thứ ba để test nhanh.

---

## 4. Quy trình thu thập mẫu

Đây là việc quan trọng nhất trong hai tuần đầu. Không có mẫu thật thì mọi regex chỉ là
phỏng đoán.

**Chuẩn bị**

1. Mở tài khoản ở 3 ngân hàng đã chọn. Đăng ký SMS BĐSD cho từng tài khoản.
2. Dùng một máy Android riêng, cài app forwarder ở chế độ ghi log thô.
3. Mở thêm một tài khoản ở ngân hàng thứ tư bất kỳ để làm nguồn chuyển tiền.

**Ma trận test — chạy đủ cho từng ngân hàng**

| # | Kịch bản | Cần quan sát |
|---|---|---|
| 1 | Chuyển 2.000đ, nội dung `TEST1` | Có SMS không? Có số dư không? |
| 2 | Chuyển 10.000đ, nội dung `TEST2` | Ngưỡng số tiền tối thiểu |
| 3 | Chuyển 50.000đ, nội dung `TEST3` | Đối chiếu với #1, #2 |
| 4 | Nội dung dài 50 ký tự | **Còn lại bao nhiêu ký tự đầu** |
| 5 | Nội dung có dấu tiếng Việt | Bị bỏ dấu hay giữ nguyên |
| 6 | Nội dung có ký tự đặc biệt `-`, `_`, `.` | Bị lọc mất không |
| 7 | Chuyển 2 giao dịch cùng số tiền, cách 10 giây | SMS có phân biệt được không |
| 8 | Chuyển tiền **đi** (không phải nhận) | Format tiền ra khác thế nào |
| 9 | Nhận từ ngân hàng khác qua NAPAS | Format có khác nội bộ không |
| 10 | Nhận vào lúc 2h sáng | Độ trễ ban đêm |

**Ghi lại vào một file cho mỗi ngân hàng**

```
bank: MB
sender_id: <đầu số hiển thị>
samples:
  - scenario: 1
    raw: "<dán nguyên văn SMS, không sửa gì>"
    received_at: 2026-08-12T09:14:22
  - scenario: 4
    raw: "..."
```

Mười kịch bản × 3 ngân hàng = 30 lần chuyển tiền, tốn chưa tới 200.000đ và hai buổi.
Đây là khoản đầu tư có tỷ suất cao nhất trong cả dự án.

---

## 5. Parser: cấu hình, không phải code

Ngân hàng đổi format không báo trước. Regex nằm trong code nghĩa là mỗi lần đổi là một
lần deploy khẩn và một khoảng thời gian mất giao dịch âm thầm.

**Cấu trúc một rule**

```json
{
  "bank": "MB",
  "senders": ["MBBank", "MB"],
  "rules": [
    {
      "version": 1,
      "active_from": "2026-08-12",
      "pattern": "<regex có named group>",
      "groups": {
        "account": "account",
        "sign": "sign",
        "amount": "amount",
        "balance": "balance",
        "content": "content",
        "occurred_at": "ts"
      },
      "amount_format": "vi",
      "sign_map": { "+": "in", "-": "out" }
    }
  ]
}
```

**Giữ nhiều version song song.** Ngân hàng đổi format lúc 0h thì tin gửi lúc 23h58 vẫn
về sau đó. Parser thử lần lượt từ version mới nhất xuống, bản nào khớp thì dùng.

**Quy trình parse**

```
tin thô
  → chuẩn hoá: bỏ dấu, uppercase, gộp khoảng trắng
  → thử rule theo bank, version mới nhất trước
  → khớp?
      có  → trích các group → chuẩn hoá số tiền → giao dịch
      không → unmatched_queue + cảnh báo
```

**`unmatched_queue` là bắt buộc, không phải tính năng phụ.** Nó là hệ thống cảnh báo
sớm duy nhất của bạn. Không có nó, ngân hàng đổi format và bạn mất giao dịch cả tuần
trước khi có khách kêu. Cấu hình: quá 3 tin không parse được từ cùng một ngân hàng
trong 10 phút → báo Telegram cho bạn ngay.

**Chuẩn hoá số tiền.** Định dạng Việt Nam dùng `.` làm phân cách nghìn: `1.234.567`.
Bỏ hết `.` và `,`, parse thành số nguyên đồng. Đừng dùng float — làm tròn sai một đồng
là đủ để không khớp đơn.

---

## 6. Chống trùng và phát hiện mất tin

**Khoá chống trùng**

```sql
UNIQUE (account_id, balance_after)
```

Mỗi giao dịch để lại đúng một giá trị số dư trên một tài khoản. Đây là khoá tự nhiên,
tốt hơn hash nội dung rất nhiều. Dùng `INSERT ... ON CONFLICT DO NOTHING`.

Nếu ngân hàng không gửi số dư, fallback:

```
fingerprint = sha256(account_id | amount | direction | normalize(content) | floor(ts/60))
```

Kém hơn nhiều, và mất luôn khả năng phát hiện mất tin. Ưu tiên chọn ngân hàng có số dư.

**Phát hiện mất tin**

```
expected_prev = balance_after - (amount * direction)
if expected_prev != last_known_balance:
    → CÓ GAP: mất ít nhất một giao dịch giữa hai tin
```

Khi phát hiện gap: đánh dấu tài khoản `degraded`, báo merchant kèm khoảng thời gian,
và ghi vào log để đối soát cuối ngày. Đây là thứ cho phép bạn dám hứa gì đó với khách.

**Sắp thứ tự bằng số dư, không bằng thời gian.** SMS đến lệch thứ tự là chuyện bình
thường. Chuỗi số dư là thứ tự thật.

---

## 7. Khớp đơn hàng

Với SMS-only, bạn không có tài khoản định danh (VA). Chỉ còn hai đường:

**Mã prefix trong nội dung — đường chính**

Ràng buộc từ mục 1: nội dung bị cắt từ đuôi, nên mã phải ngắn và ở đầu.

- Độ dài mục tiêu: **6–9 ký tự**, chỉ chữ HOA và số
- Cấu trúc: 2 ký tự thương hiệu + 5–6 ký tự base32 của order id + 1 ký tự checksum
- Ví dụ: `AB7K2M9X`
- Regex trích: `\b[A-Z]{2}[A-Z0-9]{5,7}\b`
- **Checksum là bắt buộc.** Không có nó, mã tham chiếu của ngân hàng lọt vào regex và
  bạn khớp nhầm đơn.

Hướng dẫn khách hiển thị mã ở đầu nội dung, in đậm, kèm nút copy. Đây là điểm mà UX
quyết định tỷ lệ khớp tự động.

**Số tiền độc nhất — đường phụ**

Khi khách không nhập được nội dung: cộng thêm 1–999 đồng ngẫu nhiên vào số tiền, khoá
số tiền đó trong 15 phút, khớp theo số tiền. Đơn giản, hiệu quả với đơn giá trị nhỏ,
nhưng không dùng được cho merchant có volume cao vì hết dải nhanh.

**Hàng đợi duyệt tay — bắt buộc phải có**

Mọi thứ không khớp tự động rơi vào đây: trả thiếu, trả thừa, trả hai lần, trả sau khi
đơn hết hạn, nội dung sai. Merchant tự gán vào đơn trên dashboard. Đây là tính năng
khách dùng nhiều nhất và hay bị bỏ quên nhất.

---

## 8. Vì sao bỏ Vietcombank

Vietcombank đã dừng gửi SMS biến động số dư với giao dịch **dưới 50.000đ**, và đang chủ
động hướng khách hàng chuyển sang nhận thông báo miễn phí qua app VCB Digibank.

Với sản phẩm chỉ đọc SMS, điều này có nghĩa: quán cà phê bán ly 25.000đ, quán ăn sáng
bán tô 35.000đ — **không có dữ liệu để đọc**. Không phải chậm, không phải sai — là
không tồn tại. Không sản phẩm nào cứu được.

Đừng nhận merchant F&B dùng Vietcombank rồi hứa sai. Ghi rõ trong tài liệu bán hàng.

Ghi chú: phí SMS là khách trả, không phải chi phí của bạn, nên phí không phải lý do
loại. Chỉ ngưỡng 50.000đ mới là lý do.

---

## 9. Phân phối app

Quyền `RECEIVE_SMS` bị Google Play siết rất chặt — thường chỉ cấp cho app là trình SMS
mặc định. Sản phẩm chỉ dùng SMS gần như chắc chắn không lên Play được.

Kế hoạch: phát hành APK qua trang tải của bạn, ký bằng keystore riêng và giữ kỹ, kèm
hướng dẫn bật cài từ nguồn không xác định. Làm thêm cơ chế tự cập nhật trong app —
không có Play thì không ai tự cập nhật cho bạn.

Chỉ xin `RECEIVE_SMS`, **không xin `READ_SMS`**. `READ_SMS` cho phép đọc toàn bộ hộp
thư cũ, hoàn toàn không cần thiết, và làm cho câu chuyện bảo mật của bạn với khách
khó kể hơn nhiều.

---

## 10. An toàn OTP

Nhắc lại vì nó quan trọng hơn mọi thứ kỹ thuật ở trên: **nếu app của bạn forward một mã
OTP và khách mất tiền, đó không phải bug — đó là vụ án.**

- Lọc OTP chạy **trước** whitelist sender, không có ngoại lệ
- Tin dính pattern OTP bị huỷ ngay tại thiết bị: không ghi DB, không log nội dung,
  không rời máy, kể cả dưới dạng hash
- SMS dài phải ghép đủ các phần **trước** khi lọc — từ khoá cảnh báo thường nằm ở phần cuối
- Không nhân viên nào đọc được SMS thô. Admin chỉ thấy trường đã parse
- Viết rõ trong điều khoản dịch vụ, và biến thành điểm bán: *không đọc SMS cá nhân,
  không nhận OTP, chỉ đọc tin biến động số dư*

---

## 11. Checklist trước khi bán cho khách đầu tiên

- [ ] 3 ngân hàng qua đủ 10 kịch bản test, mẫu lưu vào repo
- [ ] Parser chạy đúng trên toàn bộ mẫu đã thu, có unit test
- [ ] `unmatched_queue` chạy, có cảnh báo Telegram
- [ ] Dedup theo số dư, đã test bằng cách gửi lại tin trùng
- [ ] Gap detection chạy, đã test bằng cách xoá một tin ở giữa
- [ ] Lọc OTP có test case cho từng ngân hàng, không lọt một tin nào
- [ ] Heartbeat 60 giây, cảnh báo khi mất quá 5 phút
- [ ] App sống qua đêm 72 giờ trên máy thật không cắm sạc liên tục
- [ ] Hướng dẫn tối ưu pin cho Xiaomi, Oppo, Vivo, Samsung
- [ ] Webhook có retry, HMAC, và log request/response đầy đủ
- [ ] Hàng đợi duyệt tay dùng được trên điện thoại
- [ ] Điều khoản dịch vụ và chính sách riêng tư, có mục OTP

Ba merchant chạy thật miễn phí ít nhất hai tuần trước khi thu tiền của bất kỳ ai.
