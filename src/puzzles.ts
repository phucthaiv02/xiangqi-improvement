// Sinh bài và chấm độ khó bằng Pikafish (qua pikafish-js). Luật cờ lấy từ @pikafish-js/rules;
// ở đây không có engine hay bộ sinh nước đi tự viết.
import type { AnalysisInfo } from 'pikafish-js';
import {
  Game, applyMove, generateLegalMoves, isAttacked, isKingInCheck, moveToUcci, opposite, parseUcci, pieceAt,
  type PieceType,
} from '@pikafish-js/rules';
import { getEngine } from './engine';
import { uid, ymd, type Attempt, type Level5, type Puzzle } from './store';

export interface Row { multipv: number; depth: number; cp: number; mate: number | null; pv: string[]; move: string }

/* ---------- Khóa tuần tự: engine chỉ chạy một tìm kiếm tại một thời điểm ---------- */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export function searchRows(fen: string, o: { depth: number; multiPV?: number; movetime?: number; signal?: AbortSignal }): Promise<Row[]> {
  return exclusive(async () => {
    if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const eng = await getEngine();
    const h = await eng.analyze({ fen, depth: o.depth, movetime: o.movetime ?? 800, multiPV: o.multiPV ?? 1, signal: o.signal });
    const r = await h.result;
    const best = new Map<number, AnalysisInfo>();
    for (const i of r.info) {
      if (!i.pv?.length || !i.score || i.score.bound) continue;
      const k = i.multipv ?? 1;
      const prev = best.get(k);
      if (!prev || (i.depth ?? 0) >= (prev.depth ?? 0)) best.set(k, i);
    }
    return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([k, i]): Row => {
      const s = i.score!;
      const cp = s.type === 'mate' ? (s.value > 0 ? 10000 - s.value : -10000 - s.value) : s.value;
      return { multipv: k, depth: i.depth ?? 0, cp, mate: s.type === 'mate' ? s.value : null, pv: i.pv!, move: i.pv![0] };
    });
  });
}

export const isAbort = (e: unknown) => (e instanceof DOMException && e.name === 'AbortError') || (e instanceof Error && /abort/i.test(`${e.name} ${e.message}`));

/* ---------- Chấm độ khó ---------- */
const VAL: Record<PieceType, number> = { r: 9, c: 4.5, n: 4, a: 2, b: 2, p: 1, k: 0 };

/** Độ "ngược trực giác" của nước đúng: thí quân, đi lùi, nước im lặng, thế nhiều nước hợp lệ (0–2.5). */
export function counterIntuitive(fen: string, uci: string): number {
  const g = new Game(fen), pos = g.position, m = parseUcci(uci);
  if (!m) return 0;
  const mover = pieceAt(pos.board, m.from), cap = pieceAt(pos.board, m.to);
  const next = applyMove(pos, m), opp = opposite(pos.turn);
  let s = 0;
  if (mover && isAttacked(next.board, m.to, opp) && VAL[mover.type] > (cap ? VAL[cap.type] : 0)) s += 1;
  const dir = pos.turn === 'w' ? 1 : -1;
  if ((m.to.rank - m.from.rank) * dir < 0) s += 0.5;
  if (!cap && !isKingInCheck(next, opp)) s += 0.5;
  const n = generateLegalMoves(pos).length;
  s += n >= 40 ? 0.5 : n >= 30 ? 0.25 : 0;
  return s;
}

export const depthScore = (d: number) => (d <= 2 ? 0 : d <= 4 ? 1 : d <= 6 ? 2 : d <= 9 ? 3 : d <= 12 ? 4 : 5);
export const toLevel = (score: number): Level5 => (score < 1.25 ? 1 : score < 2.25 ? 2 : score < 3.5 ? 3 : score < 5 ? 4 : 5);

export interface Grade { recDepth: number; score: number; level: Level5 }
export const MAX_REC = 14;

/** Độ sâu nhận ra = depth nhỏ nhất mà nước tốt nhất đúng và giữ nguyên đến depth 14. */
export async function grade(fen: string, best: string, kind: Puzzle['kind'], mateIn: number | undefined, gap: number, signal?: AbortSignal): Promise<Grade> {
  const seq: string[] = [];
  for (let d = 1; d <= MAX_REC; d++) {
    const rows = await searchRows(fen, { depth: d, movetime: 800, signal });
    seq[d] = rows[0]?.move ?? '';
  }
  let rec = MAX_REC + 1;
  for (let d = MAX_REC; d >= 1 && seq[d] === best; d--) rec = d;
  const length = kind === 'mate' && mateIn ? (mateIn - 1) * 0.5 : 0.5;
  const uniq = kind === 'mate' ? 0.5 : gap >= 800 ? 0 : gap >= 400 ? 0.5 : 1;
  const score = depthScore(rec) + length + uniq + counterIntuitive(fen, best);
  let level = toLevel(score);
  if (kind === 'mate' && mateIn === 1 && rec <= 2) level = 1; // chiếu bí 1 nước dễ thấy luôn là bậc 1
  else if (kind === 'mate' && mateIn === 2 && rec <= 2) level = Math.min(level, 2) as Level5;
  return { recDepth: rec, score: Math.round(score * 100) / 100, level };
}

/** Tuần giáo án gắn với từng bậc (1-based, gồm hai đầu). */
export const LEVEL_WEEKS: Record<Level5, [number, number]> = { 1: [1, 2], 2: [1, 4], 3: [4, 8], 4: [8, 11], 5: [11, 12] };
export const LEVEL_NAMES: Record<Level5, string> = { 1: 'Rất dễ', 2: 'Dễ', 3: 'Vừa', 4: 'Khó', 5: 'Rất khó' };
export const weeksText = (l: Level5) => { const [a, b] = LEVEL_WEEKS[l]; return a === b ? `tuần ${a}` : `tuần ${a}–${b}`; };

export const fenKey = (fen: string) => fen.split(' ').slice(0, 2).join(' ');

/* ---------- Dựng bài từ một thế + kết quả engine đã xác minh ---------- */
function build(fen: string, rows: Row[], g: Grade, source: Puzzle['source'], extra: Partial<Puzzle> = {}): Puzzle {
  const top = rows[0], second = rows[1];
  const isMate = top.mate !== null && top.mate > 0 && top.mate <= 5;
  const gap = second ? Math.max(0, top.cp - second.cp) : 1000;
  const alts = rows.slice(1).filter((r) => (isMate ? r.mate !== null && r.mate > 0 && r.mate <= top.mate! : r.cp >= top.cp - 50)).map((r) => r.move);
  const solution = isMate ? top.pv.slice(0, top.mate! * 2 - 1) : [top.move];
  return {
    id: uid(), fen, solution, alts, source, kind: isMate ? 'mate' : (extra.kind ?? 'tactic'), mateIn: isMate ? top.mate! : undefined,
    gap, recDepth: g.recDepth, score: g.score, level: g.level, created: ymd(new Date()), ...extra,
  };
}

/** Bài từ lỗi trong ván của người dùng: nước đúng do engine tìm ở depth cao. */
export async function puzzleFromGameError(fen: string, gameId: string | undefined, ply: number, note: string, signal?: AbortSignal): Promise<Puzzle | null> {
  const rows = await searchRows(fen, { depth: 14, multiPV: 3, movetime: 1500, signal });
  if (!rows.length) return null;
  const top = rows[0];
  const isMate = top.mate !== null && top.mate > 0 && top.mate <= 5;
  const gap = rows[1] ? Math.max(0, top.cp - rows[1].cp) : 1000;
  const g = await grade(fen, top.move, isMate ? 'mate' : 'loss', top.mate ?? undefined, gap, signal);
  return build(fen, rows, g, 'game', { kind: isMate ? 'mate' : 'loss', gameId, ply, note });
}

/* ---------- Bộ sinh bài tự động ---------- */
export interface GenProgress { games: number; screened: number; verified: number; added: number; skipped: number; msg: string }

const rnd = (n: number) => Math.floor(Math.random() * n);

/** Một ván tự đấu ngắn: vài nước ngẫu nhiên đầu ván, sau đó Pikafish độ sâu thấp chọn ngẫu nhiên trong các nước gần tốt nhất. */
async function selfPlay(signal: AbortSignal, strong: boolean): Promise<string[]> {
  const g = new Game();
  const total = strong ? 40 + rnd(90) : 20 + rnd(50), randomPlies = 4 + rnd(5);
  const cands: string[] = [], tail: string[] = [];
  for (let ply = 0; ply < total && !g.status().over; ply++) {
    if (ply >= 14 && Math.random() < 0.45) cands.push(g.fen);
    if (ply >= 14) { tail.push(g.fen); if (tail.length > 6) tail.shift(); }
    let uci: string;
    if (ply < randomPlies) {
      const ms = g.legalMoves();
      uci = moveToUcci(ms[rnd(ms.length)]);
    } else {
      const rows = await searchRows(g.fen, { depth: strong ? 6 : 2, multiPV: 3, movetime: strong ? 150 : 60, signal });
      const ok = rows.filter((r) => r.cp >= rows[0].cp - (strong ? 40 : 150));
      if (!ok.length) break;
      uci = ok[rnd(ok.length)].move;
    }
    const m = parseUcci(uci);
    if (!m || !g.isLegal(m)) break;
    g.move(m);
  }
  return [...cands.slice(0, 8), ...tail]; // thêm vài thế cuối ván: nơi hay có chiếu bí
}

export interface GenOpts {
  target: number; known: Set<string>; signal: AbortSignal; maxGames?: number; wantLevel?: Level5 | 0;
  onProgress: (p: GenProgress) => void; onPuzzle: (p: Puzzle) => void;
}

export async function generate(o: GenOpts): Promise<GenProgress> {
  const p: GenProgress = { games: 0, screened: 0, verified: 0, added: 0, skipped: 0, msg: 'Đang khởi động engine…' };
  const maxGames = o.maxGames ?? (o.wantLevel ? (o.wantLevel >= 3 ? 200 : 250) : 60);
  const hard = !!o.wantLevel && o.wantLevel >= 3; // bài khó: ván tự đấu chất lượng cao hơn, chấp nhận nước duy nhất để giữ thế
  const minCp = hard ? -50 : 150;
  const emit = (msg?: string) => { if (msg) p.msg = msg; o.onProgress({ ...p }); };
  emit();
  try {
    while (p.added < o.target && p.games < maxGames && !o.signal.aborted) {
      emit(`Ván tự đấu #${p.games + 1}…`);
      const cands = await selfPlay(o.signal, hard);
      p.games++;
      for (const fen of cands) {
        if (p.added >= o.target || o.signal.aborted) break;
        const key = fenKey(fen);
        if (o.known.has(key)) continue;
        const legal = generateLegalMoves(new Game(fen).position).length;
        if (legal < 2) continue;
        emit(`Sàng lọc thế (${p.screened + 1})…`);
        const quick = await searchRows(fen, { depth: 8, multiPV: 2, movetime: 300, signal: o.signal });
        p.screened++;
        const t = quick[0], s = quick[1];
        if (!t || !s) continue;
        const mateQ = t.mate !== null && t.mate > 0 && t.mate <= 5;
        const tacticQ = t.mate === null && t.cp >= minCp && t.cp - s.cp >= 200;
        if (!mateQ && !tacticQ) continue;
        emit('Xác minh ở độ sâu cao…');
        const rows = await searchRows(fen, { depth: 18, multiPV: 3, movetime: 2500, signal: o.signal });
        const t2 = rows[0], s2 = rows[1];
        if (!t2 || t2.move !== t.move) continue;
        const mate2 = t2.mate !== null && t2.mate > 0 && t2.mate <= 5;
        if (mateQ ? !mate2 : !(t2.mate === null && t2.cp >= minCp && s2 && t2.cp - s2.cp >= 200)) continue;
        p.verified++;
        emit('Chấm độ khó…');
        const g = await grade(fen, t2.move, mate2 ? 'mate' : 'tactic', t2.mate ?? undefined, s2 ? t2.cp - s2.cp : 1000, o.signal);
        if (o.wantLevel && g.level !== o.wantLevel) { p.skipped++; emit(`Bỏ qua bài bậc ${g.level} (cần bậc ${o.wantLevel})…`); continue; }
        const pz = build(fen, rows, g, 'gen');
        o.known.add(key);
        p.added++;
        o.onPuzzle(pz);
        emit(`Đã thêm bài ${p.added}/${o.target} (bậc ${pz.level}).`);
      }
    }
    emit(o.signal.aborted ? 'Đã dừng.' : p.added >= o.target ? 'Hoàn tất.' : `Dừng sau ${p.games} ván tự đấu (đã đạt giới hạn).`);
  } catch (e) {
    if (isAbort(e) || o.signal.aborted) emit('Đã dừng.');
    else emit(`Lỗi: ${e instanceof Error ? e.message : String(e)}`);
  }
  return p;
}

/* ---------- Hiệu chỉnh độ khó theo kết quả thực & gợi ý bậc ---------- */
export function effLevel(p: Puzzle, attempts: Attempt[]): Level5 {
  const a = attempts.filter((x) => x.pid === p.id);
  if (a.length < 3) return p.level;
  const fails = a.filter((x) => !x.ok).length;
  let l: number = p.level;
  if (fails / a.length >= 0.6) l += 1;
  else if (fails === 0) l -= 1;
  return Math.max(1, Math.min(5, l)) as Level5;
}

export interface Suggest { level: Level5; rate: number | null; n: number; reason: string }
/** Mục tiêu: tỉ lệ đúng khoảng 70–80% trong 10 bài gần nhất. */
export function suggestLevel(puzzles: Puzzle[], attempts: Attempt[], weekIndex: number): Suggest {
  const byId = new Map(puzzles.map((p) => [p.id, p]));
  const recent = attempts.filter((a) => byId.has(a.pid)).slice(-10);
  if (recent.length < 4) {
    const wk = weekIndex + 1;
    const lv = ([1, 2, 3, 4, 5] as Level5[]).find((l) => wk <= LEVEL_WEEKS[l][1]) ?? 5;
    return { level: lv, rate: null, n: recent.length, reason: `Chưa đủ dữ liệu, chọn theo tuần ${wk} của giáo án.` };
  }
  const rate = recent.filter((a) => a.ok).length / recent.length;
  const avg = Math.round(recent.reduce((s, a) => s + effLevel(byId.get(a.pid)!, attempts), 0) / recent.length);
  const lv = Math.max(1, Math.min(5, rate > 0.8 ? avg + 1 : rate < 0.7 ? avg - 1 : avg)) as Level5;
  const pct = Math.round(rate * 100);
  return { level: lv, rate, n: recent.length, reason: rate > 0.8 ? `Đúng ${pct}% (>80%) nên tăng bậc.` : rate < 0.7 ? `Đúng ${pct}% (<70%) nên giảm bậc.` : `Đúng ${pct}%, đang ở mức vừa sức.` };
}

/** Cho Pikafish tự đấu từ một thế để biết kết quả (dùng để kiểm tra thư viện tàn cuộc, xem README). */
export async function playOut(fen: string, maxPlies = 160, depth = 10): Promise<{ result: string; reason: string; plies: number; cp0: number }> {
  const g = new Game(fen);
  let cp0 = 0;
  for (let i = 0; i < maxPlies && !g.status().over; i++) {
    const rows = await searchRows(g.fen, { depth, movetime: 400 });
    if (!rows.length) break;
    if (i === 0) cp0 = g.turn === 'w' ? rows[0].cp : -rows[0].cp;
    const m = parseUcci(rows[0].move);
    if (!m || !g.isLegal(m)) break;
    g.move(m);
  }
  const st = g.status();
  return { result: st.over ? String(st.result) : 'draw', reason: st.over ? String(st.reason) : 'giới hạn nước đi', plies: g.history.length, cp0 };
}
