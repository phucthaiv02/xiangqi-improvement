export const WEEKS: {m:number;t:string;d:string;g:string}[] =[
 {m:1,t:"Chiếu bí 1–3 nước và thói quen kiểm tra 3 điều",d:"20 bài chiếu bí + 1–2 ván chậm",g:"Đúng ≥ 90% bài 1–2 nước, ≥ 70% bài 3 nước"},
 {m:1,t:"Chiến thuật cơ bản: ăn đôi, ghim, dẫn dụ, thí quân",d:"15 bài chiến thuật + học 1 chủ đề mới mỗi ngày",g:"Nhận ra ít nhất 4 mẫu chiến thuật trong ván của chính mình"},
 {m:1,t:"Khai cuộc Pháo đầu (Đỏ) và Bình phong mã (Đen), 10–12 nước đầu",d:"Học 1 nhánh biến mỗi ngày, chơi thử ngay trong ván",g:"Chơi đúng khung cả hai bên mà không nhìn tài liệu"},
 {m:1,t:"Mẫu chiếu bí kinh điển và tàn cuộc cơ bản",d:"15 bài chiếu bí 3–5 nước + 1 thế tàn cuộc",g:"Thuộc các mẫu Ngọa tào mã, Quải giác mã, Mã hậu pháo, Song xe, Muộn cung"},
 {m:2,t:"Khai cuộc khi cầm Đen: Bình phong mã sâu hơn, làm quen Thuận pháo",d:"1 nhánh biến + 10 bài chiến thuật + 1 ván",g:"Biết vì sao mỗi nước đầu được đi, không chỉ thuộc nước"},
 {m:2,t:"Đánh giá thế cờ: vật chất, nhịp độ, an toàn của Tướng, Tốt qua sông",d:"Phân tích 2 thế cờ trung cuộc + 15 bài chiến thuật",g:"Nêu được kế hoạch 2–3 nước cho mỗi thế cờ"},
 {m:2,t:"Tàn cuộc nâng cao: Xe Pháo, Mã Pháo và Tốt đấu với Sĩ Tượng",d:"2 thế tàn cuộc + 10 bài chiếu bí 4–5 nước",g:"Thắng được các thế tàn cuộc mẫu khi đánh với máy"},
 {m:2,t:"Phòng thủ, đổi quân đúng lúc và hệ khai cuộc phụ",d:"1 nhánh biến + 1 ván phòng thủ + xem lại ván",g:"Giữ vững khi bị ép và biết khi nào nên đổi Xe"},
 {m:3,t:"Thi đấu tăng cường và thống kê lỗi",d:"2 ván + xem lại 100% ván thua",g:"Phân loại được lỗi: chiến thuật, khai cuộc, trung cuộc, tàn cuộc, thời gian"},
 {m:3,t:"Vá nhóm lỗi hay gặp nhất của tuần 9",d:"20 bài đúng chủ đề yếu + 1–2 ván",g:"Nhóm lỗi đó giảm ít nhất một nửa"},
 {m:3,t:"Chiếu bí khó, tàn cuộc dễ nhầm, quản lý thời gian",d:"10 bài khó + 1 thế tàn cuộc + 1–2 ván",g:"Không thua vì hết giờ khi đang hơn"},
 {m:3,t:"Kiểm tra cuối khóa và đặt mục tiêu tiếp",d:"Làm 4 phần của bài kiểm tra cuối khóa (mục Tiến độ)",g:"So sánh với kết quả đo ban đầu"}
];
export const MONTHS: string[] =["Tháng 1 · Nền tảng chiến thuật","Tháng 2 · Trung cuộc và hệ thống hóa","Tháng 3 · Thi đấu và vá điểm yếu"];

export const TEMPLATE: [string, number][][] =[
 [["Nghỉ, hoặc ôn nhẹ sổ lỗi",15]],
 [["Chiếu bí / chiến thuật",45],["Khai cuộc",45]],
 [["Chiếu bí / chiến thuật",45],["Tàn cuộc",45]],
 [["Khai cuộc hoặc trung cuộc theo chủ đề tuần",45],["1 ván có thời gian",45]],
 [["Chiếu bí / chiến thuật",45],["Tàn cuộc",45]],
 [["2 ván có thời gian",75],["Ghi sổ lỗi",15]],
 [["2–3 ván dài",90],["Xem lại ván thua, chạy engine sau cùng",60]]
];
export const DAYS: string[] =["Chủ nhật","Thứ hai","Thứ ba","Thứ tư","Thứ năm","Thứ sáu","Thứ bảy"];
export const DSHORT: string[] =["CN","T2","T3","T4","T5","T6","T7"];
export const ERR_TYPES: string[] =["Bỏ quân treo","Bỏ lỡ chiến thuật","Khai cuộc","Trung cuộc","Tàn cuộc","Hết giờ","Khác"];
export const FINAL: string[] =["Chơi 20 ván có thời gian và ghi tỉ lệ thắng","Giải 30 bài chiếu bí 3–5 nước trong 30 phút","Chơi lại 4 thế tàn cuộc cơ bản với máy, thắng hoặc hòa đúng","Đọc lại sổ lỗi và viết ra 3 điểm cần học tiếp"];
