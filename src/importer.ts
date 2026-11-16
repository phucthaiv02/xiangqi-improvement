import { Game, START_FEN, moveToUcci, parseFen, type Move } from '@pikafish-js/rules';
import { canon, extractHanMoves } from './notation';
import { toChineseNotation } from '@pikafish-js/rules';

export interface Parsed { fen0: string | null; moves: string[]; error?: string; kind: 'ucci' | 'han' | 'none' }

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
  const a = ucci.length ? tryUcci() : null;
  const b = han.length ? tryHan() : null;
  const cands: { kind: 'ucci' | 'han'; r: Run }[] = [];
  if (a) cands.push({ kind: 'ucci', r: a });
  if (b) cands.push({ kind: 'han', r: b });
  cands.sort((x, y) => y.r.moves.length - x.r.moves.length);
  const best = cands[0];
  if (!best || !best.r.moves.length && !best.r.error) return { fen0, moves: [], kind: 'none', error: 'Không nhận ra nước đi nào. Hỗ trợ: h2e2, 炮二平五, Pháo 2 bình 5, C2=5.' };
  return { fen0, moves: best.r.moves, error: best.r.error, kind: best.kind };
}

interface Run { moves: string[]; error?: string }
function run(fen: string, toks: string[], find: (g: Game, tok: string) => Move | undefined): Run {
  const g = new Game(fen);
  const moves: string[] = [];
  let error: string | undefined;
  for (let i = 0; i < toks.length; i++) {
    const m = find(g, toks[i]);
    if (!m) { error = `Nước thứ ${i + 1} "${toks[i]}" không hợp lệ ở thế này, đã dừng tại đó.`; break; }
    g.move(m);
    moves.push(moveToUcci(m));
  }
  return { moves, error };
}
