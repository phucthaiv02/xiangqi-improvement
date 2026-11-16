// Phân loại lỗi tự động dựa trên đánh giá của Pikafish + các hàm của @pikafish-js/rules
// (applyMove, isAttacked, pieceAt…). Không có bộ sinh nước đi hay luật tự viết ở đây.
import { Game, applyMove, isAttacked, opposite, parseUcci, pieceAt, type Move, type Piece, type Position, type Square } from '@pikafish-js/rules';
import { vietnamese } from './notation';

const VAL: Record<string, number> = { r: 9, c: 4.5, n: 4, a: 2, b: 2, p: 1, k: 0 };
const NAME: Record<string, string> = { r: 'Xe', c: 'Pháo', n: 'Mã', a: 'Sĩ', b: 'Tượng', p: 'Tốt', k: 'Tướng' };

function value(p: Piece, sq: Square): number {
  if (p.type !== 'p') return VAL[p.type];
  const crossed = p.color === 'w' ? sq.rank >= 5 : sq.rank <= 4;
  return crossed ? 2 : 1;
}

/** Lời/lỗ ước lượng của một nước ăn quân: giá trị quân bị ăn trừ giá trị quân đi ăn nếu bị ăn lại. */
export function captureGain(pos: Position, m: Move): number {
  const cap = pieceAt(pos.board, m.to), mover = pieceAt(pos.board, m.from);
  if (!cap || !mover || cap.type === 'k') return 0;
  const next = applyMove(pos, m);
  const recapture = isAttacked(next.board, m.to, opposite(pos.turn));
  return value(cap, m.to) - (recapture ? value(mover, m.to) : 0);
}

export interface Classified { type: string; why: string; auto: true }

export interface ClassifyInput {
  fenBefore: string; fenAfter: string; best: string; user: string;
  bestCp: number;              // điểm của nước tốt nhất, theo góc nhìn bên đi
  reply: string | null;        // nước đáp tốt nhất của engine sau nước của người dùng
  ply: number;
}

export function phaseOf(fen: string, ply: number): string {
  const pieces = fen.split(' ')[0].replace(/[\d/]/g, '').length;
  if (ply < 20) return 'Khai cuộc';
  if (pieces <= 12) return 'Tàn cuộc';
  return 'Trung cuộc';
}

export function classifyError(i: ClassifyInput): Classified {
  const before = new Game(i.fenBefore).position, after = new Game(i.fenAfter).position;
  // 1) Bỏ quân treo: engine đáp bằng nước ăn quân có lời của mình.
  const rep = i.reply && i.reply !== '(none)' ? parseUcci(i.reply) : null;
  if (rep) {
    const victim = pieceAt(after.board, rep.to);
    if (victim && captureGain(after, rep) >= 2) {
      const wasThreatened = isAttacked(before.board, rep.to, opposite(before.turn));
      const nm = NAME[victim.type];
      const how = wasThreatened ? 'quân này đang bị đe dọa mà bạn không cứu' : 'nước đi để quân bị treo';
      return { type: 'Bỏ quân treo', why: `Máy ăn ${nm} (${vietnamese(after, rep)}): ${how}.`, auto: true };
    }
  }
  // 2) Bỏ lỡ chiến thuật: nước tốt nhất thắng quân hoặc chiếu bí mà người dùng bỏ qua.
  const bm = parseUcci(i.best);
  if (bm && i.best !== i.user) {
    if (i.bestCp >= 9000) return { type: 'Bỏ lỡ chiến thuật', why: `Bỏ lỡ chiếu bí: ${vietnamese(before, bm)}.`, auto: true };
    const g = captureGain(before, bm);
    if (g >= 2) {
      const victim = pieceAt(before.board, bm.to)!;
      return { type: 'Bỏ lỡ chiến thuật', why: `Bỏ lỡ nước ăn ${NAME[victim.type]} có lời: ${vietnamese(before, bm)}.`, auto: true };
    }
  }
  // 3) Còn lại: theo giai đoạn ván.
  return { type: phaseOf(i.fenBefore, i.ply), why: '', auto: true };
}
