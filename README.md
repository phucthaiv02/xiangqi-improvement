# Cờ tướng 12 tuần

Ứng dụng web luyện cờ tướng trong 3 tháng: giáo án 12 tuần, sổ lỗi, theo dõi tiến độ, bàn cờ chơi với **Pikafish** (engine cờ tướng mạnh, chạy bằng WebAssembly ngay trong trình duyệt), nhập ván từ bản ghi và phân tích tự động.

Không có engine hay luật cờ tự viết: luật/FEN/ký hiệu dùng [`@pikafish-js/rules`](https://github.com/Maicarons/pikafish-js), engine dùng [`pikafish-js`](https://github.com/Maicarons/pikafish-js) (bản biên dịch WASM của [Pikafish](https://github.com/official-pikafish/Pikafish)).

## Tính năng
- **Hôm nay / Kế hoạch / Sổ lỗi / Tiến độ**: giáo án 12 tuần, checklist theo ngày, đồng hồ, thống kê lỗi, biểu đồ chỉ số, bài kiểm tra cuối khóa.
- **Chơi với máy** (6 mức độ), gợi ý nước đi, đi lại, xoay bàn; ván kết thúc tự lưu.
- **Nhập ván**: tọa độ (`h2e2`), ký hiệu Trung (`炮二平五`), tiếng Việt (`Pháo 2 bình 5`), WXF (`C2=5`), có thể kèm FEN.
- **Xem lại & phân tích**: Pikafish đánh giá từng thế, đánh dấu `?!` / `?` / `??` theo số centipawn mất, thêm lỗi của bạn vào sổ lỗi.
- Sao lưu/khôi phục bằng file JSON. Dữ liệu lưu trong `localStorage` của trình duyệt (chưa đồng bộ giữa các thiết bị).

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
- Cần trình duyệt có WebAssembly (Chrome/Edge/Firefox/Safari mới). Lần đầu tải mạng NNUE ~25 MB, sau đó được cache.
- Dùng mạng Pikafish *Lite* (đã chưng cất) cho nhẹ; yếu hơn bản đầy đủ nhưng vẫn vượt xa trình độ mục tiêu.
- Chưa có đồng bộ đa thiết bị.

## Giấy phép
Mã nguồn dự án: **AGPL-3.0-or-later** (xem `LICENSE`), vì dùng `pikafish-js` và `@pikafish-js/rules` (AGPL-3.0-or-later). Xem `NOTICE` về Pikafish (GPL-3.0) và các mạng NNUE.
