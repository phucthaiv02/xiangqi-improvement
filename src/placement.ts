// Kiểm tra đầu vào (tuần 0) và kiểm tra cuối khóa: bài chiến thuật có bấm giờ, thang thi đấu với Pikafish,
// bảng tự đánh giá, rồi báo cáo. Bài tập và nước đi lấy từ kho bài (Pikafish chấm) và @pikafish-js/rules.
import { Game, START_FEN, moveToUcci, parseUcci, kingSquare, type Color, type Move, type Square } from '@pikafish-js/rules';
import { boardSvg } from './board';
import { getEngine, LEVELS } from './engine';
import { MAX_GEN, type Deps } from './practice';
import { LEVEL_NAMES, fenKey, generate, weeksText } from './puzzles';
import {
  addDays, uid, ymd,
  type Domain, type Level5, type PGame, type PItem, type PItemResult, type PlacementDraft, type PlacementRun, type PSurvey, type Puzzle, type State,
} from './store';

type D2 = Deps & { stopAuto(): void; setStart(d: string): void };
let D: D2;
export function initPlacement(d: D2) { D = d; }

const PER_LEVEL = 4;                 // 4 bài mỗi bậc × 5 bậc = 20 bài
const MIN_ITEMS = 10;                // ít nhất để bắt đầu khi kho thiếu bài
const LIMITS = [60, 90, 120, 150, 180]; // giây tối đa cho mỗi bài, theo bậc
const RATING = [700, 1000, 1300, 1600, 1900, 2200]; // điểm quy ước của app cho 6 mức engine (không phải Elo chính thức)
const LEVELS5: Level5[] = [1, 2, 3, 4, 5];

let viewRun: string | null = null;
let pendingKind: 'start' | 'final' = 'start';
const prep = { running: false, ctl: null as AbortController | null, msg: '' };

/* ---------------- Chọn bài ---------------- */
const shuffle = <T,>(a: T[]) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const usedKeys = (S: State) => new Set(S.placement.flatMap((r) => r.items.map((i) => fenKey(i.fen))));

/** Ưu tiên: bài tự sinh đã xác minh ở depth 18 và chưa dùng → bài từ ván chưa dùng → bài đã dùng. */
function stockByLevel(S: State): Record<number, Puzzle[]> {
  const used = usedKeys(S), out: Record<number, Puzzle[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const l of LEVELS5) {
    const ps = S.puzzles.filter((p) => p.level === l);
    const rank = (p: Puzzle) => (used.has(fenKey(p.fen)) ? 2 : 0) + (p.source === 'gen' ? 0 : 1);
    out[l] = shuffle(ps).sort((a, b) => rank(a) - rank(b));
  }
  return out;
}
const toItem = (p: Puzzle): PItem => ({ pid: p.id, fen: p.fen, solution: p.solution, alts: p.alts, level: p.level, kind: p.kind, mateIn: p.mateIn });

function pickItems(S: State): { items: PItem[]; have: number[]; subs: number } {
  const stock = stockByLevel(S);
  const have = LEVELS5.map((l) => stock[l].length);
  const taken: Record<number, Puzzle[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const l of LEVELS5) taken[l] = stock[l].splice(0, PER_LEVEL);
  let subs = 0;
  for (const l of LEVELS5) {
    let need = PER_LEVEL - taken[l].length;
    if (need <= 0) continue;
    const order = LEVELS5.filter((x) => x !== l).sort((a, b) => Math.abs(a - l) - Math.abs(b - l) || a - b);
    for (const o of order) { while (need > 0 && stock[o].length) { taken[l].push(stock[o].shift()!); need--; subs++; } }
  }
  const items = LEVELS5.flatMap((l) => taken[l]).map(toItem).sort((a, b) => a.level - b.level);
  return { items, have, subs };
}

/* ---------------- Trạng thái chạy ---------------- */
interface Cur { game: Game; step: number; sel: Square | null; targets: Square[]; last: Move | null; t0: number; limit: number; status: 'play' | 'done'; ok: boolean; msg: string; flipped: boolean }
let cur: Cur | null = null;
let timerId = 0;

interface PG { game: Game; side: Color; levelIdx: number; thinking: boolean; sel: Square | null; targets: Square[]; flipped: boolean; token: number; recorded: boolean; resigned: boolean; note: string }
let pg: PG | null = null;

const draft = () => D.S().placementDraft;
const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

function stopTimer() { if (timerId) { clearInterval(timerId); timerId = 0; } }
function tick() {
  const c = cur, d = draft();
  if (!c || !d || c.status !== 'play') { stopTimer(); return; }
  const el = (Date.now() - c.t0) / 1000, left = c.limit - el;
  const t = document.getElementById('ptime'); if (t) t.textContent = fmtT(left);
  const b = document.getElementById('pbar'); if (b) b.style.width = `${Math.min(100, (el / c.limit) * 100)}%`;
  const tot = document.getElementById('ptotal'); if (tot) tot.textContent = fmtT((Date.now() - d.t0) / 1000);
  if (left <= 0) { finishPuzzle(false, true); D.render(); }
}

function startPuzzle() {
  const d = draft(); if (!d) return;
  const it = d.items[d.results.length];
  if (!it) { toGames(d); return; }
  const game = new Game(it.fen);
  cur = { game, step: 0, sel: null, targets: [], last: null, t0: Date.now(), limit: LIMITS[it.level - 1], status: 'play', ok: false, msg: '', flipped: game.turn === 'b' };
  stopTimer(); timerId = window.setInterval(tick, 250);
}

function finishPuzzle(ok: boolean, timeout = false, skipped = false) {
  const d = draft(), c = cur; if (!d || !c || c.status !== 'play') return;
  c.status = 'done'; c.ok = ok; stopTimer();
  const r: PItemResult = { ok, secs: Math.round((Date.now() - c.t0) / 1000) };
  if (timeout) r.timeout = true; if (skipped) r.skipped = true;
  d.results.push(r); D.persist();
  c.msg = ok ? 'Đúng!' : timeout ? 'Hết giờ cho bài này.' : skipped ? 'Đã bỏ qua.' : 'Chưa đúng.';
}

function tryMove(m: Move) {
  const d = draft()!, c = cur!, it = d.items[d.results.length], g = c.game, side = g.turn;
  const u = moveToUcci(m), expected = it.solution[c.step];
  let correct = u === expected || (c.step === 0 && it.alts.includes(u));
  if (!correct) { const t = g.clone(); t.move(m); const st = t.status(); if (st.over && st.result === (side === 'w' ? 'red' : 'black')) correct = true; }
  c.sel = null; c.targets = [];
  if (!correct) { finishPuzzle(false); return; }
  g.move(m); c.last = m;
  if (g.status().over || u !== expected || c.step + 1 >= it.solution.length) { finishPuzzle(true); return; }
  const reply = parseUcci(it.solution[c.step + 1]);
  if (reply && g.isLegal(reply)) { g.move(reply); c.last = reply; }
  c.step += 2;
  if (c.step >= it.solution.length || g.status().over) { finishPuzzle(true); return; }
  c.msg = 'Đúng! Máy đã đáp lại, tìm nước tiếp theo.';
}

function toGames(d: PlacementDraft) {
  cur = null; stopTimer();
  d.phase = 'games'; D.persist();
}

/* ---------------- Thang thi đấu ---------------- */
function ladderNext(games: PGame[]): number {
  if (!games.length) return 2;
  const l = games[games.length - 1];
  return Math.max(0, Math.min(LEVELS.length - 1, l.level + (l.result === 'win' ? 1 : l.result === 'loss' ? -1 : 0)));
}
function startGame() {
  const d = draft(); if (!d) return;
  D.stopAuto(); D.ensureEngine();
  const side: Color = d.games.length % 2 === 0 ? 'w' : 'b';
  pg = { game: new Game(), side, levelIdx: ladderNext(d.games), thinking: false, sel: null, targets: [], flipped: side === 'b', token: Date.now(), recorded: false, resigned: false, note: '' };
  void gEngineTurn();
}
async function gEngineTurn() {
  const p = pg;
  if (!p || p.thinking || p.game.status().over || p.resigned || p.game.turn === p.side || p.game.history.length >= 200) return;
  if (!D.engReady()) return;
  p.thinking = true; D.render();
  try {
    const eng = await getEngine(), lv = LEVELS[p.levelIdx];
    const h = await eng.analyze({ fen: START_FEN, moves: p.game.history.map((r) => r.ucci), depth: lv.depth, movetime: lv.movetime });
    const r = await h.result;
    if (p !== pg || p.token !== pg.token) return;
    const mv = parseUcci(r.bestmove);
    if (mv && p.game.isLegal(mv)) p.game.move(mv);
  } catch { /* hủy hoặc engine bận */ }
  finally { p.thinking = false; gAfter(); D.render(); }
}
function gAfter() {
  const p = pg, d = draft(); if (!p || !d || p.recorded) return;
  const st = p.game.status();
  const capped = p.game.history.length >= 200;
  if (!st.over && !p.resigned && !capped) return;
  p.recorded = true;
  const mine = p.side === 'w' ? 'red' : 'black';
  const result: PGame['result'] = p.resigned ? 'loss' : capped && !st.over ? 'draw' : st.result === 'draw' || !st.result ? 'draw' : st.result === mine ? 'win' : 'loss';
  const reason = p.resigned ? 'đầu hàng' : capped && !st.over ? 'quá 100 nước, tính hòa' : String(st.reason ?? '');
  d.games.push({ level: p.levelIdx, side: mine, result, plies: p.game.history.length, mv: p.game.history.map((r) => r.ucci).join(' '), reason });
  p.note = `${{ win: 'Bạn thắng', loss: 'Bạn thua', draw: 'Hòa' }[result]} (${reason}).`;
  D.persist();
}

/* ---------------- Chấm điểm ---------------- */
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0);

function estimateRating(games: PGame[]): number | null {
  if (!games.length) return null;
  let num = 0, den = 0;
  games.forEach((g, i) => { const perf = RATING[g.level] + (g.result === 'win' ? 150 : g.result === 'loss' ? -150 : 0); const w = i + 1; num += perf * w; den += w; });
  return Math.round(num / den);
}

const START_MAP: Record<Level5, [number, Level5]> = { 1: [1, 1], 2: [1, 2], 3: [2, 2], 4: [4, 3], 5: [5, 4] };

export function buildRun(d: PlacementDraft): PlacementRun {
  const rs = d.results, items = d.items;
  const idx = (f: (it: PItem, r: PItemResult) => boolean) => items.map((it, i) => ({ it, r: rs[i] })).filter((x) => x.r && f(x.it, x.r));
  const okAll = rs.filter((r) => r.ok).length;
  const puzzlePct = Math.round(pct(okAll, rs.length));
  let sumAcc = 0;
  for (const l of LEVELS5) { const xs = idx((it) => it.level === l); if (xs.length) sumAcc += xs.filter((x) => x.r.ok).length / xs.length; }
  const ability = clamp(Math.round(sumAcc), 1, 5) as Level5;
  const weighted = (xs: { it: PItem; r: PItemResult }[]) => { const den = xs.reduce((a, x) => a + x.it.level, 0); return den ? Math.round(pct(xs.reduce((a, x) => a + (x.r.ok ? x.it.level : 0), 0), den)) : null; };
  const mate = idx((it) => it.kind === 'mate'), tac = idx((it) => it.kind !== 'mate');
  const hard = idx((it) => it.level >= 3);
  const okTimes = idx(() => true).filter((x) => x.r.ok);
  const speed = okTimes.length ? Math.round(100 * (1 - clamp(okTimes.reduce((a, x) => a + x.r.secs / LIMITS[x.it.level - 1], 0) / okTimes.length, 0, 1))) : null;
  const est = estimateRating(d.games);
  const sv = d.survey as Partial<PSurvey>;
  const self = (v?: number) => (v ? Math.round((v - 1) * 25) : null);
  const hardObj = hard.length ? Math.round(pct(hard.filter((x) => x.r.ok).length, hard.length)) : null;
  const calcSelf = self(sv.calc);
  const calc = hardObj !== null && calcSelf !== null ? Math.round(hardObj * 0.7 + calcSelf * 0.3) : hardObj ?? calcSelf;
  const domains: Domain[] = [
    { key: 'mate', label: 'Chiếu bí', score: weighted(mate) },
    { key: 'tactic', label: 'Chiến thuật', score: weighted(tac) },
    { key: 'calc', label: 'Tính toán (bài bậc 3+ và tự đánh giá)', score: calc },
    { key: 'speed', label: 'Tốc độ giải', score: speed },
    { key: 'play', label: 'Thi đấu với máy', score: est === null ? null : Math.round(clamp(((est - 600) / 1600) * 100, 0, 100)) },
    { key: 'opening', label: 'Khai cuộc (tự đánh giá)', score: self(sv.opening), self: true },
    { key: 'endgame', label: 'Tàn cuộc (tự đánh giá)', score: self(sv.endgame), self: true },
    { key: 'safety', label: 'Kiểm tra an toàn trước khi đi (tự đánh giá)', score: self(sv.safety), self: true },
    { key: 'time', label: 'Quản lý thời gian (tự đánh giá)', score: self(sv.time), self: true },
  ];
  const [startWeek, startLevel] = START_MAP[ability];
  return {
    id: uid(), kind: d.kind, date: ymd(new Date()), secs: Math.round((Date.now() - d.t0) / 1000),
    items, results: rs, games: d.games, survey: Object.keys(sv).length >= 5 ? (sv as PSurvey) : null,
    puzzlePct, ability, est, domains, startWeek, startLevel,
  };
}

const WEAK_WEEKS: Record<string, string> = {
  mate: 'tuần 1, 4 và 11 (chiếu bí)', tactic: 'tuần 2, 6 và 10 (chiến thuật)', calc: 'tuần 6, 9 và 11 (tính toán, đánh giá thế cờ)',
  speed: 'tuần 9 và 11 (giải nhanh, quản lý thời gian)', play: 'tuần 8, 9 và 10 (thi đấu, phòng thủ, vá lỗi)',
  opening: 'tuần 3, 5 và 8 (khai cuộc)', endgame: 'tuần 4, 7 và 11 (tàn cuộc)', safety: 'tuần 1 và 8 (thói quen kiểm tra 3 điều)', time: 'tuần 11 (quản lý thời gian)',
};

/* ---------------- Báo cáo ---------------- */
const esc = (s: string) => D.esc(s);
const lvPill = (l: Level5) => `<span class="pill lv lv${l}">${l} · ${LEVEL_NAMES[l]}</span>`;
const bar = (label: string, v: number | null, selfTag = false) => `<div class="r"><span>${esc(label)}${selfTag ? '' : ''}</span><div class="t"><i style="width:${v ?? 0}%"></i></div><span>${v === null ? '–' : v}</span></div>`;

function reportHtml(run: PlacementRun): string {
  const S = D.S();
  const first = S.placement.find((r) => r.kind === 'start');
  const byLevel = LEVELS5.map((l) => {
    const xs = run.items.map((it, i) => ({ it, r: run.results[i] })).filter((x) => x.it.level === l && x.r);
    const ok = xs.filter((x) => x.r.ok).length, avg = xs.length ? Math.round(xs.reduce((a, x) => a + x.r.secs, 0) / xs.length) : 0;
    return `<tr><td>${lvPill(l)}</td><td>${ok}/${xs.length}</td><td>${xs.length ? Math.round(pct(ok, xs.length)) + '%' : '–'}</td><td>${xs.length ? fmtT(avg) : '–'}</td></tr>`;
  }).join('');
  const games = run.games.length
    ? run.games.map((g, i) => `<tr><td>Ván ${i + 1}</td><td>${esc(LEVELS[g.level].name)}</td><td>${g.side === 'red' ? 'Đỏ' : 'Đen'}</td><td>${{ win: 'Thắng', loss: 'Thua', draw: 'Hòa' }[g.result]} · ${Math.ceil(g.plies / 2)} nước</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">Không làm phần thi đấu.</td></tr>';
  const ds = run.domains;
  const known = ds.filter((d) => d.score !== null);
  const weak = known.filter((d) => (d.score as number) < 50).sort((a, b) => (a.score as number) - (b.score as number));
  const strong = known.filter((d) => (d.score as number) >= 70).sort((a, b) => (b.score as number) - (a.score as number));
  const applyBtn = run.kind === 'start' ? `<button class="btn ghost sm" data-act="pl-apply" data-week="${run.startWeek}">Đặt tuần hiện tại = tuần ${run.startWeek}</button>` : '';
  const cmp = run.kind === 'final' && first ? compareTable(first, run) : '';
  return `<div class="card"><h2>${run.kind === 'start' ? 'Kết quả kiểm tra đầu vào' : 'Kết quả kiểm tra cuối khóa'} · ${run.date}</h2>
    <div class="tiles"><div class="tile"><div class="k">Bài đúng</div><div class="v">${run.puzzlePct}<small>%</small></div></div>
    <div class="tile"><div class="k">Bậc chiến thuật ước lượng</div><div class="v">${run.ability}<small> · ${LEVEL_NAMES[run.ability]}</small></div></div>
    <div class="tile"><div class="k">Điểm thi đấu (quy ước)</div><div class="v">${run.est ?? '–'}</div></div></div>
    <p class="small muted">Điểm thi đấu là thang quy ước của app (mức engine → điểm), không phải Elo chính thức. Thời gian làm bài: ${fmtT(run.secs)}.</p>
    <h3>Theo bậc độ khó</h3><table class="tbl"><thead><tr><th>Bậc</th><th>Đúng</th><th>Tỉ lệ</th><th>TB/bài</th></tr></thead><tbody>${byLevel}</tbody></table>
    <h3>Thi đấu với Pikafish</h3><table class="tbl"><tbody>${games}</tbody></table>
    <h3>Điểm theo mảng (0–100)</h3><div class="dist">${ds.map((d) => bar(d.label, d.score)).join('')}</div>
    ${strong.length ? `<p class="small"><b>Điểm mạnh:</b> ${strong.map((d) => esc(d.label.replace(/ \(.*\)/, ''))).join(', ')}.</p>` : ''}
    ${weak.length ? `<p class="small"><b>Cần cải thiện:</b> ${weak.map((d) => `${esc(d.label.replace(/ \(.*\)/, ''))} → ${WEAK_WEEKS[d.key]}`).join('; ')}.</p>` : '<p class="small muted">Chưa có mảng nào dưới 50 điểm.</p>'}
    ${run.kind === 'start' ? `<h3>Gợi ý bắt đầu</h3><p>Bắt đầu từ <b>tuần ${run.startWeek}</b> của giáo án và luyện bài <b>bậc ${run.startLevel} · ${LEVEL_NAMES[run.startLevel]}</b> (${weeksText(run.startLevel)}).</p><div class="nav">${applyBtn}</div>` : ''}
    ${cmp}
    <div class="nav"><button class="btn" data-act="pl-back">Xong</button><button class="btn ghost" data-act="pl-redo" data-kind="${run.kind}">Làm lại</button><button class="btn plain" data-act="pl-del" data-id="${run.id}">Xóa kết quả này</button></div></div>`;
}

function compareTable(a: PlacementRun, b: PlacementRun): string {
  const rows: [string, number | null, number | null][] = [
    ['Bài đúng (%)', a.puzzlePct, b.puzzlePct], ['Bậc chiến thuật', a.ability, b.ability], ['Điểm thi đấu (quy ước)', a.est, b.est],
    ...b.domains.map((d): [string, number | null, number | null] => [d.label, a.domains.find((x) => x.key === d.key)?.score ?? null, d.score]),
  ];
  const body = rows.map(([l, x, y]) => {
    const dlt = x !== null && y !== null ? y - x : null;
    return `<tr><td>${esc(l)}</td><td>${x ?? '–'}</td><td>${y ?? '–'}</td><td class="${dlt === null ? '' : dlt > 0 ? 'q-ok' : dlt < 0 ? 'q-mistake' : ''}">${dlt === null ? '–' : (dlt > 0 ? '+' : '') + dlt}</td></tr>`;
  }).join('');
  return `<h3>So sánh với kết quả đo ban đầu (${a.date})</h3><table class="tbl"><thead><tr><th>Chỉ số</th><th>Đầu vào</th><th>Cuối khóa</th><th>Thay đổi</th></tr></thead><tbody>${body}</tbody></table>`;
}

/* ---------------- Màn hình ---------------- */
const SURVEY: [keyof PSurvey, string][] = [
  ['opening', 'Khai cuộc: tôi thuộc khung Pháo đầu (khi cầm Đỏ) và Bình phong mã (khi cầm Đen) khoảng 10 nước đầu.'],
  ['endgame', 'Tàn cuộc: tôi biết cách thắng hoặc giữ hòa các thế cơ bản (Xe Pháo, Mã Pháo, Tốt đấu Sĩ Tượng).'],
  ['calc', 'Tính toán: khi chiến đấu tôi nhìn trước được 3 nước trở lên một cách chắc chắn.'],
  ['safety', 'An toàn: trước mỗi nước tôi kiểm tra quân mình có bị treo, bị chiếu hoặc bị ăn không.'],
  ['time', 'Thời gian: tôi hiếm khi hết giờ và biết phân bổ thời gian cho từng giai đoạn.'],
];

export function viewPlacement(): string {
  D.ensureEngine();
  const S = D.S();
  if (viewRun) { const r = S.placement.find((x) => x.id === viewRun); if (r) return reportHtml(r); viewRun = null; }
  const d = S.placementDraft;
  if (!d) return viewPrep();
  const head = `<div class="card"><h2>${d.kind === 'start' ? 'Kiểm tra đầu vào' : 'Kiểm tra cuối khóa'}</h2><div class="steps">${(['puzzles', 'games', 'survey'] as const).map((p, i) => `<span class="step ${d.phase === p ? 'on' : ''}">${i + 1}. ${{ puzzles: 'Bài tập', games: 'Thi đấu', survey: 'Tự đánh giá' }[p]}</span>`).join('')}</div></div>`;
  return head + (d.phase === 'puzzles' ? viewPuzzles(d) : d.phase === 'games' ? viewGames(d) : viewSurvey(d));
}

function viewPrep(): string {
  const S = D.S(), kind = pendingKind;
  const { items, have, subs } = pickItems(S);
  const rows = LEVELS5.map((l, i) => `<tr><td>${lvPill(l)}</td><td>${Math.min(have[i], PER_LEVEL)}/${PER_LEVEL}</td><td>${have[i]}</td></tr>`).join('');
  const short = LEVELS5.some((_, i) => have[i] < PER_LEVEL);
  const hist = S.placement.slice().reverse().map((r) => `<div class="row"><div class="main"><b>${r.kind === 'start' ? 'Đầu vào' : 'Cuối khóa'}</b> <span class="meta">${r.date}</span><div class="small">${r.puzzlePct}% bài đúng · bậc ${r.ability} · điểm thi đấu ${r.est ?? '–'}</div></div><button class="btn ghost sm" data-act="pl-view" data-id="${r.id}">Xem</button></div>`).join('');
  return `<div class="card"><h2>${kind === 'start' ? 'Kiểm tra đầu vào (tuần 0)' : 'Kiểm tra cuối khóa (tuần 12)'}</h2>
    <p class="small muted">Gồm 3 phần, khoảng 30–45 phút: (1) 20 bài chiến thuật/chiếu bí rải đều 5 bậc, có bấm giờ; (2) tối đa 3 ván với Pikafish, mức tăng hoặc giảm theo kết quả; (3) bảng tự đánh giá ngắn. Kết quả ghi vào Tiến độ để so sánh đầu và cuối khóa.</p>
    <div class="nav"><button class="btn ${kind === 'start' ? '' : 'ghost'}" data-act="pl-kind" data-kind="start">Đầu vào</button><button class="btn ${kind === 'final' ? '' : 'ghost'}" data-act="pl-kind" data-kind="final">Cuối khóa</button></div></div>
  <div class="card"><h3>Kho bài sẵn có</h3><table class="tbl"><thead><tr><th>Bậc</th><th>Dùng được</th><th>Tổng trong kho</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="small">Sẽ dùng <b>${items.length}</b> bài${subs ? ` (${subs} bài lấy từ bậc gần nhất vì thiếu)` : ''}. Ưu tiên bài tự sinh đã xác minh ở độ sâu 18 và chưa dùng trong lần kiểm tra trước.</p>
    <div class="nav"><button class="btn ghost" data-act="pl-gen" ${prep.running || !short ? 'disabled' : ''}>Sinh thêm bài còn thiếu</button>${prep.running ? '<button class="btn plain" data-act="pl-gen-stop">Dừng</button>' : ''}
    <button class="btn" data-act="pl-start" ${items.length < MIN_ITEMS || prep.running ? 'disabled' : ''}>Bắt đầu (${items.length} bài)</button></div>
    <div class="eng" id="plprep">${esc(prep.msg)}</div>${items.length < MIN_ITEMS ? `<p class="small q-mistake">Cần ít nhất ${MIN_ITEMS} bài. Hãy sinh thêm bài hoặc dùng tab Luyện tập.</p>` : ''}${D.engLine() ? `<p class="eng">${esc(D.engLine())}</p>` : ''}</div>
  ${hist ? `<div class="card"><h2>Lịch sử</h2><div class="list">${hist}</div></div>` : ''}`;
}

function viewPuzzles(d: PlacementDraft): string {
  const finished = !!cur && cur.status === 'done';
  const i = finished ? d.results.length - 1 : d.results.length;
  if (i >= d.items.length) return `<div class="card"><p>Đã xong phần bài tập.</p><div class="nav"><button class="btn" data-act="pl-togames">Sang phần thi đấu</button></div></div>`;
  const it = d.items[i], c = cur;
  const ok = d.results.filter((r) => r.ok).length;
  if (!c) return `<div class="card"><h2>Bài tập ${i + 1}/${d.items.length}</h2><p class="small muted">Đã làm ${i} bài (đúng ${ok}). Mỗi bài có giới hạn thời gian theo bậc và chỉ có một lần thử.</p><div class="nav"><button class="btn" data-act="pl-resume">${i ? 'Làm tiếp' : 'Bắt đầu'}</button><button class="btn plain" data-act="pl-discard">Hủy bài kiểm tra</button></div></div>`;
  const g = c.game;
  const svg = boardSvg({ board: g.board, flipped: c.flipped, selected: c.sel, targets: c.targets, last: c.last, checkKing: g.status().inCheck ? kingSquare(g.fen, g.turn) : null });
  const goal = it.kind === 'mate' ? `Chiếu bí trong ${it.mateIn} nước` : 'Tìm nước mạnh nhất';
  return `<div class="card"><div class="nav"><b>Bài ${i + 1}/${d.items.length}</b> ${lvPill(it.level)} <span class="small">${goal} · ${g.turn === 'w' ? 'Đỏ' : 'Đen'} đi</span>
    <span class="small" style="margin-left:auto">${finished ? `Đã dùng <b>${fmtT(d.results[i].secs)}</b>` : `Còn <b id="ptime">${fmtT(c.limit - (Date.now() - c.t0) / 1000)}</b>`} · tổng <span id="ptotal">${fmtT((Date.now() - d.t0) / 1000)}</span></span></div>
    <div class="bar"><i id="pbar" style="width:${finished ? 100 : Math.min(100, ((Date.now() - c.t0) / 1000 / c.limit) * 100)}%"></i></div></div>
  <div class="bwrap"><div class="bcol">${svg}</div><div class="bcol card">
    ${c.msg ? `<p class="${c.status === 'done' ? (c.ok ? 'q-ok' : 'q-mistake') : 'q-ok'}"><b>${esc(c.msg)}</b></p>` : '<p class="small muted">Chọn quân rồi chọn ô đích.</p>'}
    <div class="nav">${c.status === 'play' ? '<button class="btn plain sm" data-act="pl-skip">Bỏ qua (tính sai)</button>' : `<button class="btn" data-act="pl-next">${i + 1 >= d.items.length ? 'Xong phần bài tập' : 'Bài tiếp'}</button>`}</div></div></div>`;
}

function viewGames(d: PlacementDraft): string {
  const n = d.games.length, p = pg;
  const rec = d.games.map((g, i) => `<li>Ván ${i + 1}: ${esc(LEVELS[g.level].name)} · ${g.side === 'red' ? 'Đỏ' : 'Đen'} · ${{ win: 'thắng', loss: 'thua', draw: 'hòa' }[g.result]}</li>`).join('');
  const eng = `<div class="eng">${esc(D.engLine())}</div>`;
  const done = n >= 3;
  if (!p || p.recorded) {
    const note = p?.recorded ? `<p><b>${esc(p.note)}</b></p>` : '';
    const nextName = LEVELS[ladderNext(d.games)].name;
    return `<div class="card"><h2>Thi đấu thích nghi với Pikafish</h2><p class="small muted">Tối đa 3 ván. Ván đầu ở mức Trung bình; thắng thì lên mức, thua thì xuống mức. Đỏ và Đen xen kẽ. Điểm thi đấu được ước lượng từ mức và kết quả.</p>
      ${rec ? `<ul class="small">${rec}</ul>` : ''}${note}${eng}
      <div class="nav">${done ? '' : `<button class="btn" data-act="pl-gstart" ${D.engReady() ? '' : 'disabled'}>Ván ${n + 1} · ${esc(nextName)} · ${n % 2 === 0 ? 'cầm Đỏ' : 'cầm Đen'}</button>`}
      <button class="btn ${done || n ? '' : 'ghost'}" data-act="pl-tosurvey">${n ? 'Xong phần thi đấu' : 'Bỏ qua phần thi đấu'}</button></div></div>`;
  }
  const g = p.game, st = g.status();
  const last = g.lastMove?.move ?? null;
  const svg = boardSvg({ board: g.board, flipped: p.flipped, selected: p.sel, targets: p.targets, last, checkKing: st.inCheck ? kingSquare(g.fen, g.turn) : null });
  const status = p.thinking ? 'Engine đang nghĩ…' : g.turn === p.side ? 'Đến lượt bạn' : 'Đến lượt máy';
  return `<div class="card"><b>Ván ${n + 1}/3 · ${esc(LEVELS[p.levelIdx].name)}</b> · bạn cầm ${p.side === 'w' ? 'Đỏ' : 'Đen'} · ${status}${st.inCheck ? ' · Chiếu!' : ''}</div>
  <div class="bwrap"><div class="bcol">${svg}</div><div class="bcol card"><div class="nav"><button class="btn plain sm" data-act="pl-gresign">Đầu hàng</button></div><p class="small muted">${Math.ceil(g.history.length / 2)} nước đã đi.</p></div></div>`;
}

function viewSurvey(d: PlacementDraft): string {
  const sv = d.survey;
  const q = SURVEY.map(([k, text]) => `<div class="card"><p>${esc(text)}</p><div class="opts"><span class="small muted">1 = chưa được</span>${[1, 2, 3, 4, 5].map((v) => `<label class="opt"><input type="radio" name="q-${k}" data-act="pl-survey" data-q="${k}" value="${v}" ${sv[k] === v ? 'checked' : ''}> ${v}</label>`).join('')}<span class="small muted">5 = rất tốt</span></div></div>`).join('');
  const full = SURVEY.every(([k]) => !!sv[k]);
  return `${q}<div class="nav"><button class="btn" data-act="pl-finish" ${full ? '' : 'disabled'}>Xem kết quả</button></div>`;
}

/* ---------------- Thẻ ở tab Hôm nay / Tiến độ ---------------- */
export function placementCardHtml(): string {
  const S = D.S(), d = S.placementDraft;
  const first = S.placement.find((r) => r.kind === 'start'), fin = S.placement.find((r) => r.kind === 'final');
  const week = D.weekIndex();
  if (d) return `<div class="card"><h2>${d.kind === 'start' ? 'Kiểm tra đầu vào' : 'Kiểm tra cuối khóa'} đang làm dở</h2><p class="small muted">Phần: ${{ puzzles: 'bài tập', games: 'thi đấu', survey: 'tự đánh giá' }[d.phase]}.</p><div class="nav"><button class="btn" data-act="pl-open">Tiếp tục</button></div></div>`;
  if (!first) return `<div class="card"><h2>Kiểm tra đầu vào (tuần 0)</h2><p class="small muted">Làm một lần trước khi bắt đầu giáo án để biết bậc bài và tuần nên bắt đầu, và để so sánh với cuối khóa. Khoảng 30–45 phút.</p><div class="nav"><button class="btn" data-act="pl-begin" data-kind="start">Làm kiểm tra đầu vào</button></div></div>`;
  if (week >= 11 && !fin) return `<div class="card"><h2>Đến lúc kiểm tra cuối khóa</h2><p class="small muted">Cùng định dạng với bài đầu vào để so sánh (đầu vào: ${first.puzzlePct}% đúng, bậc ${first.ability}).</p><div class="nav"><button class="btn" data-act="pl-begin" data-kind="final">Làm kiểm tra cuối khóa</button></div></div>`;
  return '';
}

export function placementCompareHtml(): string {
  const S = D.S();
  const first = S.placement.find((r) => r.kind === 'start'), fin = S.placement.slice().reverse().find((r) => r.kind === 'final');
  if (!first) return `<div class="card"><h2>Kiểm tra đầu vào</h2><p class="small muted">Chưa làm. Kết quả đầu vào dùng để so sánh với cuối khóa.</p><div class="nav"><button class="btn ghost" data-act="pl-begin" data-kind="start">Làm kiểm tra đầu vào</button></div></div>`;
  const body = fin ? compareTable(first, fin) : `<p class="small">Đầu vào ${first.date}: ${first.puzzlePct}% bài đúng · bậc ${first.ability} · điểm thi đấu ${first.est ?? '–'}. Chưa có kết quả cuối khóa.</p>`;
  return `<div class="card"><h2>Đầu vào so với cuối khóa</h2>${body}<div class="nav"><button class="btn ghost sm" data-act="pl-view" data-id="${first.id}">Xem báo cáo đầu vào</button>${fin ? `<button class="btn ghost sm" data-act="pl-view" data-id="${fin.id}">Xem báo cáo cuối khóa</button>` : ''}</div></div>`;
}

/* ---------------- Sự kiện ---------------- */
export function placementBegin(kind: 'start' | 'final') { pendingKind = kind; viewRun = null; D.ensureEngine(); D.render(); }

export function placementLeave() { prep.ctl?.abort(); stopTimer(); cur = null; pg = null; }

export function placementBoardClick(file: number, rank: number): boolean {
  const d = draft(); if (!d) return true;
  if (d.phase === 'puzzles') {
    const c = cur; if (!c || c.status !== 'play') return true;
    const t = c.targets.find((x) => x.file === file && x.rank === rank);
    if (c.sel && t) { tryMove({ from: c.sel, to: t }); D.render(); return true; }
    const pc = c.game.board[rank][file];
    if (pc && pc.color === c.game.turn) { c.sel = { file, rank }; c.targets = c.game.legalMovesFrom(c.sel).map((m) => m.to); } else { c.sel = null; c.targets = []; }
    D.render(); return true;
  }
  if (d.phase === 'games') {
    const p = pg;
    if (!p || p.recorded || p.thinking || p.game.status().over || p.game.turn !== p.side) return true;
    const t = p.targets.find((x) => x.file === file && x.rank === rank);
    if (p.sel && t) { p.game.move({ from: p.sel, to: t }); p.sel = null; p.targets = []; gAfter(); D.render(); void gEngineTurn(); return true; }
    const pc = p.game.board[rank][file];
    if (pc && pc.color === p.side) { p.sel = { file, rank }; p.targets = p.game.legalMovesFrom(p.sel).map((m) => m.to); } else { p.sel = null; p.targets = []; }
    D.render(); return true;
  }
  return true;
}

async function genMissing() {
  if (prep.running) return;
  D.stopAuto(); D.ensureEngine();
  prep.running = true; prep.ctl = new AbortController(); prep.msg = 'Đang chuẩn bị…'; D.render();
  const S = D.S(), known = new Set(S.puzzles.map((p) => fenKey(p.fen)));
  const stock = stockByLevel(S), signal = prep.ctl.signal;
  for (const l of LEVELS5) {
    const need = PER_LEVEL - stock[l].length;
    if (need <= 0 || signal.aborted) continue;
    await generate({
      target: need, wantLevel: l, known, signal, maxGames: l >= 4 ? 40 : 70,
      onProgress: (p) => { prep.msg = `Bậc ${l} (cần thêm ${need}): ${p.msg} · đã thêm ${p.added}`; const el = document.getElementById('plprep'); if (el) el.textContent = prep.msg; },
      onPuzzle: (pz) => {
        const st = D.S(); st.puzzles.push(pz);
        let over = st.puzzles.filter((x) => x.source === 'gen').length - MAX_GEN;
        if (over > 0) st.puzzles = st.puzzles.filter((x) => !(x.source === 'gen' && over-- > 0));
        D.persist();
      },
    });
  }
  prep.running = false; prep.msg = signal.aborted ? 'Đã dừng.' : 'Đã chuẩn bị xong. Bậc nào vẫn thiếu sẽ dùng bài từ bậc gần nhất.';
  if (D.isActive()) D.render();
}

export function placementAct(a: string, el: HTMLElement): boolean {
  const S = D.S();
  switch (a) {
    case 'pl-begin': placementBegin(el.dataset.kind === 'final' ? 'final' : 'start'); return true;
    case 'pl-open': viewRun = null; D.render(); return true;
    case 'pl-kind': pendingKind = el.dataset.kind === 'final' ? 'final' : 'start'; D.render(); return true;
    case 'pl-gen': void genMissing(); return true;
    case 'pl-gen-stop': prep.ctl?.abort(); return true;
    case 'pl-start': {
      const { items } = pickItems(S); if (items.length < MIN_ITEMS) return true;
      S.placementDraft = { id: uid(), kind: pendingKind, started: ymd(new Date()), t0: Date.now(), phase: 'puzzles', items, results: [], games: [], skippedGames: false, survey: {} };
      D.persist(); cur = null; startPuzzle(); D.render(); return true;
    }
    case 'pl-resume': startPuzzle(); D.render(); return true;
    case 'pl-skip': finishPuzzle(false, false, true); D.render(); return true;
    case 'pl-next': { const d = draft(); if (!d) return true; if (d.results.length >= d.items.length) { toGames(d); } else startPuzzle(); D.render(); return true; }
    case 'pl-togames': { const d = draft(); if (d) { d.phase = 'games'; D.persist(); } D.render(); return true; }
    case 'pl-discard': if (confirm('Hủy bài kiểm tra đang làm dở?')) { S.placementDraft = null; cur = null; pg = null; stopTimer(); D.persist(); D.render(); } return true;
    case 'pl-gstart': startGame(); D.render(); return true;
    case 'pl-gresign': if (pg && !pg.recorded) { pg.resigned = true; gAfter(); D.render(); } return true;
    case 'pl-tosurvey': { const d = draft(); if (d) { d.skippedGames = d.games.length === 0; d.phase = 'survey'; pg = null; D.persist(); } D.render(); return true; }
    case 'pl-finish': {
      const d = draft(); if (!d) return true;
      const run = buildRun(d);
      S.placement.push(run);
      const date = run.date;
      S.metrics.puzzle.push({ date, v: run.puzzlePct });
      if (run.est !== null) S.metrics.elo.push({ date, v: run.est });
      S.metrics.puzzle.sort((x, y) => x.date.localeCompare(y.date)); S.metrics.elo.sort((x, y) => x.date.localeCompare(y.date));
      S.placementDraft = null; cur = null; pg = null; stopTimer(); viewRun = run.id; D.persist(); D.render(); return true;
    }
    case 'pl-view': viewRun = el.dataset.id ?? null; D.render(); return true;
    case 'pl-back': viewRun = null; D.render(); return true;
    case 'pl-redo': viewRun = null; pendingKind = el.dataset.kind === 'final' ? 'final' : 'start'; D.render(); return true;
    case 'pl-del': if (confirm('Xóa kết quả kiểm tra này? (Điểm đã ghi vào biểu đồ Tiến độ được giữ nguyên.)')) { S.placement = S.placement.filter((r) => r.id !== el.dataset.id); viewRun = null; D.persist(); D.render(); } return true;
    case 'pl-apply': { const w = Number(el.dataset.week) || 1; D.setStart(addDays(D.today(), -(w - 1) * 7)); D.render(); return true; }
  }
  return false;
}

export function placementChange(a: string, el: HTMLInputElement | HTMLSelectElement): boolean {
  if (a === 'pl-survey') {
    const d = draft(); if (!d) return true;
    const k = (el as HTMLInputElement).dataset.q as keyof PSurvey;
    d.survey[k] = Number(el.value); D.persist(); D.render(); return true;
  }
  return false;
}
