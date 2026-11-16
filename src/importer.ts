import { Game, START_FEN, moveToUcci, parseFen, type Move } from '@pikafish-js/rules';
import { canon, extractHanMoves } from './notation';
import { toChineseNotation } from '@pikafish-js/rules';

export interface Parsed { fen0: string | null; moves: string[]; error?: string; kind: 'ucci' | 'han' | 'viet' | 'none' }

const RE_FEN = /([rnbakcpRNBAKCP1-9]+\/){9}[rnbakcpRNBAKCP1-9]+\s+[wbrWBR]\b[^\n"\]]*/;
const RE_UCCI = /(?<![a-z0-9])([a-i])\s?(\d)\s?[-x:]?\s?([a-i])\s?(\d)(?![a-z0-9])/gi;

/** Đọc văn bản ván cờ (UCCI/ICCS, ký hiệu Trung, Việt, WXF) và khớp từng nước với nước hợp lệ của thư viện. */
export function parseGameText(text: string): Parsed {
  let fen0: string | null = null;
  const fm = text.match(RE_FEN);
  let body = text;
  if (fm) {
    let f = fm[0].trim().replace(/\s+/g, ' ');
    const parts = f.split(' ');
    if (parts[1] === 'r' || parts[1] === 'R') parts[1] = 'w';
    if (parts.length < 6) f = `${parts[0]} ${parts[1].toLowerCase()} - - 0 1`; else f = parts.join(' ');
    try { parseFen(f); fen0 = f; body = text.replace(fm[0], ' '); } catch { fen0 = null; }
  }
  body = body.replace(/\{[^}]*\}|\[[^\]]*\]|\([^)]*\)/g, ' ');
  const start = fen0 ?? START_FEN;

  const ucci = [...body.matchAll(RE_UCCI)].map((m) => `${m[1]}${m[2]}${m[3]}${m[4]}`.toLowerCase());
  const han = extractHanMoves(body);

  const tryUcci = () => run(start, ucci, (g, tok) => g.legalMoves().find((m) => moveToUcci(m) === tok));
  const tryHan = () => run(start, han, (g, tok) => {
    const want = canon(tok);
    return g.legalMoves().find((m: Move) => canon(toChineseNotation(g.position, m)) === want);
  });
  const compact = compactTokens(body);
  const tryViet = () => run(start, compact!, (g, tok) => findCompact(g, tok));
  const c = compact ? tryViet() : null;
  const a = ucci.length ? tryUcci() : null;
  const b = han.length ? tryHan() : null;
  const cands: { kind: 'ucci' | 'han' | 'viet'; r: Run }[] = [];
  if (c) cands.unshift({ kind: 'viet', r: c });
  if (a) cands.push({ kind: 'ucci', r: a });
  if (b) cands.push({ kind: 'han', r: b });
  cands.sort((x, y) => y.r.moves.length - x.r.moves.length);
  const best = cands[0];
  if (!best || !best.r.moves.length && !best.r.error) return { fen0, moves: [], kind: 'none', error: 'Không nhận ra nước đi nào. Hỗ trợ: h2e2, 炮二平五, Pháo 2 bình 5, C2=5, P8-5 (Pháo 8 bình 5).' };
  return { fen0, moves: best.r.moves, error: best.r.error, kind: best.kind };
}

interface Run { moves: string[]; error?: string }
function run(fen: string, toks: string[], find: (g: Game, tok: string) => Move | undefined): Run {
  const g = new Game(fen);
  const moves: string[] = [];
  let error: string | undefined;
  for (let i = 0; i < toks.length; i++) {
    const m = find(g, toks[i]);
    if (!m) {
      const unreadable = toks === undefined ? false : /^[A-Za-z]{1,2}\S*$/.test(toks[i]) && !/^(Tg|[PMXTSBK])[1-9][./\-=][1-9]$/i.test(toks[i]) && !/^[a-i]\d[a-i]\d$/i.test(toks[i]);
      error = unreadable
        ? `Nước thứ ${i + 1} "${toks[i]}" không đọc được (có gõ nhầm không?), đã dừng tại đó.`
        : `Nước thứ ${i + 1} "${toks[i]}" không hợp lệ ở thế này, đã dừng tại đó.`;
      break;
    }
    g.move(m);
    moves.push(moveToUcci(m));
  }
  return { moves, error };
}

// Ký hiệu Việt viết tắt: P=Pháo, M=Mã, X=Xe, T=Tượng, S=Sĩ, B=Tốt, Tg=Tướng;
// "." = tiến, "/" = thoái, "-" hoặc "=" = bình. Ví dụ: P8-5, M2.3, T1/3.
const COMPACT = /^(Tg|[PMXTSBK])([1-9])([./\-=])([1-9])$/i;
const C_PIECE: Record<string, string> = { p: '炮', m: '马', x: '车', t: '相', s: '仕', b: '兵', tg: '帅', k: '帅' };
const C_ACT: Record<string, string> = { '.': '进', '/': '退', '-': '平', '=': '平' };

/** Tách ván viết tắt thành từng nước. Trả về null nếu văn bản không giống kiểu này. */
function compactTokens(body: string): string[] | null {
  const toks = body.split(/\s+/).filter((t) => t && !/^\d+[.)]?$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  if (toks.length < 3) return null;
  const ok = toks.filter((t) => COMPACT.test(t)).length;
  return ok / toks.length >= 0.6 ? toks : null;
}

function findCompact(g: Game, tok: string): Move | undefined {
  const m = tok.match(COMPACT);
  if (!m) return undefined;
  const piece = C_PIECE[m[1].toLowerCase()];
  const file = Number(m[2]);
  const act = C_ACT[m[3]];
  const dest = m[4];
  const base = canon(`${piece}${file}${act}${dest}`);
  const legal = g.legalMoves();
  const exact = legal.find((mv) => canon(toChineseNotation(g.position, mv)) === base);
  if (exact) return exact;
  // Hai quân cùng cột: thư viện viết "前炮平五". Khớp theo quân, hành động, đích và cột xuất phát.
  const want = canon(`${piece}${act}${dest}`);
  const cands = legal.filter((mv) => {
    const n = canon(toChineseNotation(g.position, mv)).replace(/^[前中后]/, '');
    const p = g.board[mv.from.rank][mv.from.file];
    if (!p) return false;
    const f = p.color === 'w' ? 9 - mv.from.file : mv.from.file + 1;
    return f === file && n.replace(/^[2-5]/, '') === want;
  });
  return cands.length === 1 ? cands[0] : undefined;
}
