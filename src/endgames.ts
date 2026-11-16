// Thư viện thế tàn cuộc chuẩn theo tuần giáo án. `exp` là kết quả mong đợi (red/draw/black) khi cả hai
// bên chơi đúng, xác định bằng cách cho Pikafish tự đấu độ sâu 10 từ mỗi thế (mở trang với ?debug rồi gọi
// __xq.playOut(fen) trong console; xem README). Luật hết nước đi, lặp thế, thiếu quân do @pikafish-js/rules xét.
export interface Endgame { id: string; week: number; title: string; fen: string; exp: 'red' | 'draw' | 'black'; hint: string }

export const ENDGAMES: Endgame[] = [
  { id: 'xe-tuong', week: 4, title: 'Xe + Tướng đấu Tướng trơ trọi', fen: '4k4/9/9/9/9/9/9/9/R8/3K5 w - - 0 1', exp: 'red', hint: 'Dùng Xe cắt cột, đưa Tướng lên hỗ trợ.' },
  { id: 'hai-xe', week: 4, title: 'Hai Xe đấu Tướng trơ trọi', fen: '4k4/9/9/9/9/9/9/9/RR7/3K5 w - - 0 1', exp: 'red', hint: 'Hai Xe luân phiên chiếu theo hàng ngang.' },
  { id: 'ma-phao', week: 4, title: 'Mã + Pháo đấu Tướng trơ trọi', fen: '4k4/9/9/9/9/9/9/2N1C4/9/3K5 w - - 0 1', exp: 'red', hint: 'Mã chặn đường lui, Pháo chiếu qua ngòi.' },
  { id: 'xe-vs-sty', week: 4, title: 'Xe đấu Sĩ Tượng toàn', fen: '2bakab2/9/9/9/9/9/9/9/9/R2K5 w - - 0 1', exp: 'draw', hint: 'Bên thủ giữ Sĩ Tượng liên hoàn, tránh để Xe ăn quân treo.' },
  { id: 'xe-phao-sty', week: 7, title: 'Xe Pháo đấu Sĩ Tượng toàn', fen: '2bakab2/9/9/9/9/9/9/9/2C6/R2K5 w - - 0 1', exp: 'red', hint: 'Xe kiềm chế, Pháo tìm ngòi để chiếu.' },
  { id: 'ma-phao-sty', week: 7, title: 'Mã Pháo đấu Sĩ Tượng toàn', fen: '2bakab2/9/9/9/9/9/9/2N1C4/9/3K5 w - - 0 1', exp: 'red', hint: 'Mã Pháo phối hợp tốt có thể thắng, nhưng bên thủ có nhiều cơ hội cầm hòa nếu Đỏ đi vội.' },
  { id: 'phao-tot-sty', week: 7, title: 'Pháo + Tốt qua sông đấu Sĩ Tượng toàn', fen: '2bakab2/9/9/9/4P4/9/9/2C6/9/3K5 w - - 0 1', exp: 'draw', hint: 'Tốt qua sông làm ngòi cho Pháo; bên thủ cần cẩn thận ở cột giữa.' },
  { id: 'hai-tot-sty', week: 7, title: 'Hai Tốt đấu Sĩ Tượng toàn', fen: '2bakab2/9/9/9/3PP4/9/9/9/9/3K5 w - - 0 1', exp: 'draw', hint: 'Hai Tốt ở giữa khó phá Sĩ Tượng liên hoàn.' },
  { id: 'xe-tot-xe', week: 7, title: 'Xe + Tốt đấu Xe', fen: '4k4/9/9/9/4P4/9/8r/9/9/R2K5 w - - 0 1', exp: 'draw', hint: 'Giữ Xe tự do và cản Tốt; thường hòa.' },
  { id: 'xe-ma-sy', week: 8, title: 'Xe đấu Mã + Sĩ', fen: '3ak4/4a4/4n4/9/9/9/9/9/9/R2K5 w - - 0 1', exp: 'red', hint: 'Tách Mã khỏi Sĩ rồi ăn quân yếu.' },
  { id: 'xe-vs-phao-sy', week: 8, title: 'Xe đấu Pháo + Sĩ', fen: '3ak4/4a4/9/9/9/9/9/5c3/9/R2K5 w - - 0 1', exp: 'draw', hint: 'Pháo Sĩ giữ vững nếu Pháo luôn có ngòi an toàn.' },
  { id: 'tot-qua-song', week: 8, title: 'Hai Tốt qua sông đấu Tướng trơ trọi', fen: '4k4/9/9/9/PP7/9/9/9/9/3K5 w - - 0 1', exp: 'red', hint: 'Hai Tốt kèm Tướng ép Tướng đối phương vào thế hết nước đi (bí nước là thua trong cờ tướng).' },
  { id: 'tot-sy', week: 8, title: 'Tốt đấu hai Sĩ', fen: '3ak4/4a4/9/9/3P5/9/9/9/9/3K5 w - - 0 1', exp: 'draw', hint: 'Một Tốt không đủ phá hai Sĩ.' },
  { id: 'ma-sty', week: 8, title: 'Mã đấu Sĩ Tượng toàn', fen: '2bakab2/9/9/9/9/9/9/2N6/9/3K5 w - - 0 1', exp: 'draw', hint: 'Mã lẻ loi không thể phá thế phòng thủ vững.' },
  { id: 'phao-sy-sty', week: 11, title: 'Pháo + Sĩ đấu Sĩ Tượng toàn', fen: '2bakab2/9/9/9/9/9/9/2C6/4A4/3K5 w - - 0 1', exp: 'draw', hint: 'Thế rất khó thắng; tập giữ an toàn cho Tướng và Sĩ.' },
  { id: 'xe-ma-xe', week: 11, title: 'Xe + Mã đấu Xe', fen: '4k4/9/9/9/9/9/9/2N6/8r/R2K5 w - - 0 1', exp: 'draw', hint: 'Giữ liên kết Xe Mã, tránh bị đổi Xe lúc Mã yếu.' },
  { id: 'xe-phao-xe-ma', week: 11, title: 'Xe Pháo đấu Xe Mã', fen: '4k3r/9/4n4/9/9/9/9/2C6/9/R2K5 w - - 0 1', exp: 'red', hint: 'Dùng ưu thế quân để tấn công, cẩn thận bị Mã Xe phản công.' },
];
