import { type Board, type Move, type Piece, type Square } from '@pikafish-js/rules';

export const CELL = 54, M = 48;
const W = M * 2 + CELL * 8, H = M * 2 + CELL * 9;
const GLYPH: Record<string, [string, string]> = {
  k: ['帥', '將'], a: ['仕', '士'], b: ['相', '象'], n: ['傌', '馬'], r: ['俥', '車'], c: ['炮', '砲'], p: ['兵', '卒'],
};
const glyph = (p: Piece) => GLYPH[p.type][p.color === 'w' ? 0 : 1];

export interface BoardView {
  board: Board;
  flipped: boolean;
  selected?: Square | null;
  targets?: Square[];
  last?: Move | null;
  hint?: Move | null;
  checkKing?: Square | null;
  enemyAt?: (s: Square) => boolean;
}

/** Tọa độ vẽ: rank 0 = hàng nhà của Đỏ, hiển thị ở dưới (đảo khi flipped). */
function xy(file: number, rank: number, flipped: boolean): [number, number] {
  const col = flipped ? 8 - file : file;
  const row = flipped ? rank : 9 - rank;
  return [M + col * CELL, M + row * CELL];
}

export function boardSvg(v: BoardView): string {
  const p = (f: number, r: number) => xy(f, r, v.flipped);
  let g = `<rect class="bg" width="${W}" height="${H}" rx="10"/><g class="grid">`;
  for (let r = 0; r < 10; r++) { const [x1, y] = p(0, r); const [x2] = p(8, r); g += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>`; }
  for (let f = 0; f < 9; f++) {
    const [x, y1] = p(f, 0);
    if (f === 0 || f === 8) { const [, y2] = p(f, 9); g += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>`; }
    else {
      const [, y4] = p(f, 4), [, y5] = p(f, 5), [, y9] = p(f, 9);
      g += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y4}"/><line x1="${x}" y1="${y5}" x2="${x}" y2="${y9}"/>`;
    }
  }
  for (const [r0, r1] of [[0, 2], [7, 9]]) {
    const [xa, ya] = p(3, r0), [xb, yb] = p(5, r1), [xc, yc] = p(5, r0), [xd, yd] = p(3, r1);
    g += `<line x1="${xa}" y1="${ya}" x2="${xb}" y2="${yb}"/><line x1="${xc}" y1="${yc}" x2="${xd}" y2="${yd}"/>`;
  }
  g += '</g>';
  const [rx, ry1] = p(0, 4), [, ry2] = p(0, 5);
  g += `<text class="river" x="${W / 2 - 95}" y="${(ry1 + ry2) / 2 + 9}" text-anchor="middle">楚 河</text><text class="river" x="${W / 2 + 95}" y="${(ry1 + ry2) / 2 + 9}" text-anchor="middle">漢 界</text>`;
  void rx;
  for (let f = 0; f < 9; f++) {
    const [x] = p(f, 0);
    const name = v.flipped ? f + 1 : 9 - f; // số cột theo Đỏ
    g += `<text class="lab" x="${x}" y="${H - 14}" text-anchor="middle">${name}</text>`;
  }
  const mark = (s: Square, cls: string, r: number) => { const [x, y] = p(s.file, s.rank); return `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}"/>`; };
  if (v.last) g += mark(v.last.from, 'lastf', 24) + mark(v.last.to, 'lastt', 26);
  if (v.hint) g += mark(v.hint.from, 'lastf', 27) + mark(v.hint.to, 'sel', 27);
  if (v.checkKing) g += mark(v.checkKing, 'chk', 26);
  for (let rank = 0; rank < 10; rank++) for (let file = 0; file < 9; file++) {
    const pc = v.board[rank][file];
    if (!pc) continue;
    const [x, y] = p(file, rank);
    g += `<g class="pc ${pc.color === 'w' ? 'red' : 'blk'}"><circle cx="${x}" cy="${y}" r="23"/><circle class="in" cx="${x}" cy="${y}" r="19"/><text x="${x}" y="${y + 9}" text-anchor="middle">${glyph(pc)}</text></g>`;
  }
  if (v.selected) g += mark(v.selected, 'sel', 26);
  for (const t of v.targets ?? []) g += v.board[t.rank][t.file] ? mark(t, 'tgc', 25) : mark(t, 'tgd', 8);
  for (let rank = 0; rank < 10; rank++) for (let file = 0; file < 9; file++) {
    const [x, y] = p(file, rank);
    g += `<rect class="hit" data-f="${file}" data-r="${rank}" x="${x - CELL / 2}" y="${y - CELL / 2}" width="${CELL}" height="${CELL}"/>`;
  }
  return `<svg class="board" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bàn cờ tướng">${g}</svg>`;
}
