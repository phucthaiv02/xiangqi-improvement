# Cờ tướng 12 tuần

Ứng dụng web luyện cờ tướng trong 3 tháng: giáo án 12 tuần, sổ lỗi, theo dõi tiến độ, bàn cờ chơi với **Pikafish** (engine cờ tướng mạnh, chạy bằng WebAssembly ngay trong trình duyệt), nhập ván từ bản ghi và phân tích tự động.

Không có engine hay luật cờ tự viết: luật/FEN/ký hiệu dùng [`@pikafish-js/rules`](https://github.com/Maicarons/pikafish-js), engine dùng [`pikafish-js`](https://github.com/Maicarons/pikafish-js) (bản biên dịch WASM của [Pikafish](https://github.com/official-pikafish/Pikafish)).

## Tính năng
- **Hôm nay / Kế hoạch / Sổ lỗi / Tiến độ**: giáo án 12 tuần, checklist theo ngày, đồng hồ, thống kê lỗi, biểu đồ chỉ số, bài kiểm tra cuối khóa.
- **Chơi với máy** (6 mức độ), gợi ý nước đi, đi lại, xoay bàn; ván kết thúc tự lưu.
- **Nhập ván**: tọa độ (`h2e2`), ký hiệu Trung (`炮二平五`), tiếng Việt (`Pháo 2 bình 5`), WXF (`C2=5`), có thể kèm FEN.
- **Xem lại & phân tích**: Pikafish đánh giá từng thế, đánh dấu `?!` / `?` / `??` theo số centipawn mất, thêm lỗi của bạn vào sổ lỗi.
- **Luyện tập** (tab riêng): giải bài từ ván của bạn và bài tự sinh, thư viện tàn cuộc, bộ sinh bài; mô tả bên dưới.
- Sao lưu/khôi phục bằng file JSON (gồm cả kho bài và lịch sử giải). Dữ liệu lưu trong `localStorage` của trình duyệt (chưa đồng bộ giữa các thiết bị).

## Luyện tập
Tab **Luyện tập** có ba phần, tất cả dùng Pikafish (không có engine hay luật tự viết):

1. **Giải bài** — bài đến từ hai nguồn:
   - *Từ ván của bạn*: ở tab Bàn cờ → Xem lại, bấm **Phân tích cả ván** rồi **Tạo bài luyện tập**. Mỗi nước của bạn mất ≥ 150 cp thành một bài (tối đa 8 bài/lần): thế cờ trước nước đó, nước đúng do Pikafish tìm lại ở độ sâu 14 (đáp án thay thế trong vòng 50 cp cũng được tính đúng).
   - *Tự sinh*: xem phần Bộ sinh bài.

   Bạn đi nước trên bàn; bài chiếu bí nhiều nước sẽ tự đáp lại bằng nước phản kháng chính và bạn tiếp tục tìm nước kế tiếp. Có nút xem đáp án, làm lại, bài tiếp theo. Chỉ lần đầu tính đúng/sai (sai hoặc xem đáp án = sai); thời gian giải được ghi lại. Có bộ lọc theo bậc, nguồn và tuần giáo án.
2. **Tàn cuộc** — 17 thế chuẩn theo tuần (Xe, Xe Pháo, Mã Pháo, Tốt đấu Sĩ Tượng, Xe đấu Mã Pháo…), chơi với Pikafish ở mức cao nhất, có nút **Đổi bên**. Kết quả mong đợi của mỗi thế được xác định bằng cách cho Pikafish tự đấu độ sâu 10 (hết nước đi tính thua, lặp thế, thiếu quân… do `@pikafish-js/rules` xét). Tự kiểm lại: mở trang với `?debug` rồi chạy `__xq.playOut(fen)` trong console.
3. **Bộ sinh bài** — Pikafish tự đấu các ván ngắn (vài nước đầu ngẫu nhiên, sau đó chọn ngẫu nhiên trong các nước gần tốt nhất ở độ sâu thấp). Từ các thế đó:
   - sàng lọc nhanh (độ sâu 8, multiPV 2): giữ thế có chiếu bí trong 1–5 nước, hoặc nước tốt nhất hơn nước thứ hai ≥ 200 cp và đang có lợi (≥ +150 cp; với bậc 3 trở lên cho phép nước duy nhất để giữ thế);
   - xác minh ở độ sâu 18 (multiPV 3): nước tốt nhất phải giữ nguyên và điều kiện vẫn đúng; nước chiếu bí cùng độ dài được chấp nhận là đáp án thay thế;
   - chấm độ khó, loại trùng FEN, lưu vào `localStorage` (tối đa 300 bài tự sinh, bài cũ nhất bị loại trước).

   Chạy bất đồng bộ trên Web Worker của engine nên trang vẫn dùng được; rời tab Luyện tập thì tự dừng. Có thể chọn **bậc mong muốn** (bài khác bậc bị bỏ qua nên sinh bậc khó mất lâu hơn; bậc 5 rất hiếm với ván tự đấu).

### Cách chấm độ khó
Mỗi bài được cộng điểm từ bốn tín hiệu do engine đo:

| Tín hiệu | Cách đo | Điểm |
|---|---|---|
| Độ sâu nhận ra | depth nhỏ nhất (1–14) mà nước đúng được chọn và giữ nguyên đến depth 14 | ≤2: 0 · 3–4: 1 · 5–6: 2 · 7–9: 3 · 10–12: 4 · >12: 5 |
| Độ dài lời giải | số nước chiếu bí (N−1)×0,5; bài chiến thuật 0,5 | 0–2 |
| Độ duy nhất | chênh giữa nước 1 và nước 2 (multiPV) | ≥800 cp: 0 · 400–799: 0,5 · <400: 1 · bài chiếu bí: 0,5 |
| Ngược trực giác | thí quân (+1), đi lùi (+0,5), nước im lặng không ăn/chiếu (+0,5), thế ≥40 nước hợp lệ (+0,5; ≥30: +0,25) | 0–2,5 |

Tổng điểm → bậc: <1,25 → 1 *Rất dễ* · <2,25 → 2 *Dễ* · <3,5 → 3 *Vừa* · <5 → 4 *Khó* · còn lại → 5 *Rất khó*. Chiếu bí 1 nước dễ thấy luôn là bậc 1. Bậc gắn với tuần giáo án: 1 → tuần 1–2, 2 → 1–4, 3 → 4–8, 4 → 8–11, 5 → 11–12.

**Hiệu chỉnh theo kết quả thực**: sau ≥3 lần giải, bài sai ≥60% được tăng một bậc, bài đúng 100% giảm một bậc. **Bài gợi ý** chọn bậc sao cho tỉ lệ đúng trong 10 lần giải gần nhất khoảng 70–80% (đúng >80% thì lên bậc, <70% thì xuống; chưa đủ dữ liệu thì chọn theo tuần hiện tại). Thống kê theo bậc, theo nguồn và tàn cuộc nằm ở tab **Tiến độ**.

## Chạy trên máy
```bash
npm ci
npm run dev        # tự tải engine vào public/engine rồi chạy Vite
```
Engine (~41 MB gồm 2 mạng NNUE) **không** nằm trong git; `scripts/fetch-engine.mjs` tải từ GitHub Releases của pikafish-js và kiểm tra SHA-256.

## Deploy lên Vercel
1. Vào https://vercel.com/new, chọn **Import Git Repository** → `phucthaiv02/xiangqi-improvement`.
2. Giữ nguyên cấu hình (đã có `vercel.json`: install `npm ci`, build `node scripts/fetch-engine.mjs && npx vite build`, output `dist`). Bấm **Deploy**.
3. Hoặc dùng CLI: `npx vercel --prod`.

`vercel.json` gửi các header `Cross-Origin-Opener-Policy: same-origin` và `Cross-Origin-Embedder-Policy: require-corp` — bắt buộc để WASM đa luồng (`SharedArrayBuffer`) chạy được. Không tải gì từ domain khác.

## Giới hạn
- Bộ sinh bài tạo nhiều bài bậc 1–3; bậc 4 xuất hiện khá ít và bậc 5 rất hiếm (cần ván tự đấu chất lượng cao hơn). Thang điểm độ khó là ước lượng, nên có bước hiệu chỉnh theo kết quả giải của bạn.
- Bộ chấm "thí quân" chỉ kiểm tra quân đi tới ô bị đối phương tấn công và đắt hơn quân bị ăn, nên là xấp xỉ.
- Cần trình duyệt có WebAssembly (Chrome/Edge/Firefox/Safari mới). Lần đầu tải mạng NNUE ~25 MB, sau đó được cache.
- Dùng mạng Pikafish *Lite* (đã chưng cất) cho nhẹ; yếu hơn bản đầy đủ nhưng vẫn vượt xa trình độ mục tiêu.
- Chưa có đồng bộ đa thiết bị.

## Giấy phép
Mã nguồn dự án: **AGPL-3.0-or-later** (xem `LICENSE`), vì dùng `pikafish-js` và `@pikafish-js/rules` (AGPL-3.0-or-later). Xem `NOTICE` về Pikafish (GPL-3.0) và các mạng NNUE.
