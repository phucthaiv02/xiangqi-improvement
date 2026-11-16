// Tab "Luyện tập": giải bài (từ ván của bạn + bộ sinh tự động), thư viện tàn cuộc, bộ sinh bài.
import { Game, moveToUcci, parseUcci, kingSquare, type Color, type Move, type Square } from '@pikafish-js/rules';
import { boardSvg } from './board';
import { getEngine, LEVELS } from './engine';
import { vietnamese } from './notation';
import { ENDGAMES, type Endgame } from './endgames';
import {
  LEVEL_NAMES, LEVEL_WEEKS, effLevel, fenKey, generate, isAbort, puzzleFromGameError, suggestLevel, weeksText, type GenProgress,
} from './puzzles';
import { type Attempt, type Level5, type Puzzle, type State } from './store';

export interface Deps {
  S(): State; persist(): void; render(): void; esc(s: string): string; today(): string; weekIndex(): number;
  ensureEngine(): void; engLine(): string; engReady(): boolean; isActive(): boolean;
}
let D: Deps;
export function initPractice(d: Deps) { D = d; }

type PSub = 'solve' | 'endgame' | 'gen';
let psub: PSub = 'solve';
const filt = { level: 'all', source: 'all', week: 'all' };
export const MAX_GEN = 300;

/* ======================= Giải bài ======================= */
interface Solve {
  pz: Puzzle; game: Game; step: number; sel: Square | null; targets: Square[]; last: Move | null; flipped: boolean;
  t0: number; status: 'play' | 'done'; msg: string; cls: string; recorded: boolean; failed: boolean; shown: boolean; ans: string;
}
let cur: Solve | null = null;

const levelOf = (p: Puzzle) => effLevel(p, D.S().attempts);
function pool(): Puzzle[] {
  return D.S().puzzles.filter((p) => {
    const l = levelOf(p);
    if (filt.level !== 'all' && l !== Number(filt.level)) return false;
    if (filt.source !== 'all' && p.source !== filt.source) return false;
    if (filt.week !== 'all') { const w = Number(filt.week), [a, b] = LEVEL_WEEKS[l]; if (w < a || w > b) return false; }
    return true;
  });
}

function startSolve(pz: Puzzle) {
  const game = new Game(pz.fen);
  cur = { pz, game, step: 0, sel: null, targets: [], last: null, flipped: game.turn === 'b', t0: Date.now(), status: 'play', msg: '', cls: '', recorded: false, failed: false, shown: false, ans: '' };
}

function pickNext(suggested: boolean) {
  const all = pool();
  if (!all.length) { cur = null; return; }
  const S = D.S();
  let cands = all.filter((p) => p.id !== cur?.pz.id);
  if (!cands.length) cands = all;
  if (suggested) {
    const sg = suggestLevel(S.puzzles, S.attempts, D.weekIndex());
    const atLevel = cands.filter((p) => levelOf(p) === sg.level);
    if (atLevel.length) cands = atLevel;
    else {
      const near = [...cands].sort((a, b) => Math.abs(levelOf(a) - sg.level) - Math.abs(levelOf(b) - sg.level));
      cands = near.filter((p) => Math.abs(levelOf(p) - sg.level) === Math.abs(levelOf(near[0]) - sg.level));
    }
  }
  const last = new Map<string, string>();
  for (const a of S.attempts) last.set(a.pid, a.date);
  const unseen = cands.filter((p) => !last.has(p.id));
  const bag = unseen.length ? unseen : cands;
  startSolve(bag[Math.floor(Math.random() * bag.length)]);
}

function record(c: Solve, ok: boolean) {
  if (c.recorded) return;
  c.recorded = true;
  const S = D.S();
  S.attempts.push({ pid: c.pz.id, date: D.today(), ok, secs: Math.round((Date.now() - c.t0) / 1000), shown: c.shown || undefined });
  if (S.attempts.length > 2000) S.attempts.splice(0, S.attempts.length - 2000);
  D.persist();
}

function answerText(pz: Puzzle): string {
  const g = new Game(pz.fen), out: string[] = [];
  for (const u of pz.solution) {
    const m = parseUcci(u); if (!m || !g.isLegal(m)) break;
    out.push(vietnamese(g.position, m)); g.move(m);
  }
  const alts = pz.alts.map((u) => { const m = parseUcci(u); return m ? vietnamese(new Game(pz.fen).position, m) : u; });
  return out.join(' → ') + (alts.length ? ` (cũng đúng: ${alts.join(', ')})` : '');
}

function tryMove(m: Move) {
  const c = cur!, g = c.game, side = g.turn;
  const u = moveToUcci(m), expected = c.pz.solution[c.step];
  let correct = u === expected || (c.step === 0 && c.pz.alts.includes(u));
  if (!correct) { // nước chiếu bí ngay cũng được tính là đúng
    const t = g.clone(); t.move(m); const st = t.status();
    if (st.over && st.result === (side === 'w' ? 'red' : 'black')) correct = true;
  }
  if (!correct) {
    c.failed = true; record(c, false);
    c.msg = 'Chưa đúng. Hãy thử nước khác hoặc xem đáp án.'; c.cls = 'q-mistake'; c.sel = null; c.targets = [];
    return;
  }
  g.move(m); c.last = m; c.sel = null; c.targets = [];
  const off = u !== expected; // đáp án thay thế → dừng ở đây
  if (g.status().over || off || c.step + 1 >= c.pz.solution.length) return finish(c);
  const reply = parseUcci(c.pz.solution[c.step + 1]);
  if (reply && g.isLegal(reply)) { g.move(reply); c.last = reply; }
  c.step += 2;
  if (c.step >= c.pz.solution.length || g.status().over) return finish(c);
  c.msg = 'Đúng! Máy đã đáp lại, tiếp tục tìm nước kế tiếp.'; c.cls = 'q-ok';
}

function finish(c: Solve) {
  c.status = 'done';
  const ok = !c.failed && !c.shown;
  record(c, ok);
  c.msg = ok ? 'Chính xác!' : 'Đã hoàn thành (không tính đúng vì đã sai hoặc xem đáp án).'; c.cls = ok ? 'q-ok' : 'q-inacc';
}

/* ======================= Tàn cuộc ======================= */
interface EgPlay { eg: Endgame; game: Game; side: Color; thinking: boolean; sel: Square | null; targets: Square[]; flipped: boolean; recorded: boolean; resigned: boolean; t0: number; token: number }
let egp: EgPlay | null = null;
const egLevel = () => LEVELS[LEVELS.length - 1];
const expText: Record<Endgame['exp'], string> = { red: 'Đỏ thắng', draw: 'Hòa', black: 'Đen thắng' };

function startEg(eg: Endgame, side?: Color) {
  const s: Color = side ?? (eg.exp === 'black' ? 'b' : 'w');
  egp = { eg, game: new Game(eg.fen), side: s, thinking: false, sel: null, targets: [], flipped: s === 'b', recorded: false, resigned: false, t0: Date.now(), token: Date.now() };
  void egEngineTurn();
}

async function egEngineTurn() {
  const p = egp;
  if (!p || p.thinking || p.game.status().over || p.game.turn === p.side || gen.running) return;
  if (!D.engReady()) { D.ensureEngine(); return; }
  p.thinking = true; D.render();
  try {
    const eng = await getEngine();
    const lv = egLevel();
    const h = await eng.analyze({ fen: p.eg.fen, moves: p.game.history.map((r) => r.ucci), depth: lv.depth, movetime: lv.movetime });
    const r = await h.result;
    if (p !== egp || p.token !== egp.token) return;
    const mv = parseUcci(r.bestmove);
    if (mv && p.game.isLegal(mv)) p.game.move(mv);
  } catch { /* engine bận hoặc bị hủy */ }
  finally { p.thinking = false; egAfter(); D.render(); }
}

function egOutcome(p: EgPlay): { score: number; text: string } | null {
  const st = p.game.status();
  if (!st.over && !p.resigned) return null;
  const mine = p.side === 'w' ? 'red' : 'black';
  if (p.resigned) return { score: 0, text: 'Bạn đã đầu hàng.' };
  if (st.result === 'draw' || !st.result) return { score: 1, text: `Hòa (${st.reason ?? ''}).` };
  return st.result === mine ? { score: 2, text: 'Bạn thắng!' } : { score: 0, text: 'Bạn thua.' };
}
function egAfter() {
  const p = egp; if (!p || p.recorded) return;
  const o = egOutcome(p); if (!o) return;
  p.recorded = true;
  const expRed = p.eg.exp === 'red' ? 2 : p.eg.exp === 'draw' ? 1 : 0;
  const expMine = p.side === 'w' ? expRed : 2 - expRed;
  const S = D.S();
  S.attempts.push({ pid: `eg:${p.eg.id}`, date: D.today(), ok: o.score >= expMine, secs: Math.round((Date.now() - p.t0) / 1000) });
  D.persist();
}

/* ======================= Bộ sinh bài ======================= */
const gen = { running: false, ctl: null as AbortController | null, p: { games: 0, screened: 0, verified: 0, added: 0, skipped: 0, msg: 'Chưa chạy.' } as GenProgress, target: 5, want: 0 as Level5 | 0 };

function startGen() {
  if (gen.running) return;
  D.ensureEngine();
  const S = D.S();
  const known = new Set(S.puzzles.map((p) => fenKey(p.fen)));
  gen.ctl = new AbortController(); gen.running = true;
  gen.p = { games: 0, screened: 0, verified: 0, added: 0, skipped: 0, msg: 'Đang tải engine…' };
  D.render();
  void generate({
    target: gen.target, wantLevel: gen.want, known, signal: gen.ctl.signal,
    onProgress: (p) => { gen.p = p; const el = document.getElementById('genprog'); if (el) el.textContent = fmtProg(p); },
    onPuzzle: (pz) => {
      const st = D.S();
      st.puzzles.push(pz);
      let over = st.puzzles.filter((x) => x.source === 'gen').length - MAX_GEN;
      if (over > 0) st.puzzles = st.puzzles.filter((x) => (x.source === 'gen' && over-- > 0 ? false : true));
      D.persist();
    },
  }).then(() => { gen.running = false; gen.ctl = null; if (D.isActive()) D.render(); });
}
export function stopGen() { gen.ctl?.abort(); }
export function practiceLeave() { stopGen(); }
const fmtProg = (p: GenProgress) => `${p.msg} · ván tự đấu ${p.games} · sàng lọc ${p.screened} · xác minh ${p.verified} · đã thêm ${p.added}${p.skipped ? ` · bỏ qua ${p.skipped}` : ''}`;

/** Tạo bài từ danh sách lỗi của một ván đã phân tích (gọi từ tab Bàn cờ). */
export async function addGamePuzzles(items: { fen: string; ply: number; note: string }[], gameId: string | undefined, onProgress: (s: string) => void): Promise<number> {
  const S = D.S();
  let n = 0;
  const known = new Set(S.puzzles.map((p) => fenKey(p.fen)));
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (known.has(fenKey(it.fen))) continue;
    onProgress(`Tạo bài ${i + 1}/${items.length}…`);
    try {
      const pz = await puzzleFromGameError(it.fen, gameId, it.ply, it.note);
      if (pz) { S.puzzles.push(pz); known.add(fenKey(it.fen)); n++; D.persist(); }
    } catch (e) { if (isAbort(e)) break; throw e; }
  }
  return n;
}

/* ======================= View ======================= */
const lvPill = (l: Level5) => `<span class="pill lv lv${l}">${l} · ${LEVEL_NAMES[l]}</span>`;
const srcText = (p: Puzzle) => (p.source === 'game' ? 'Từ ván của bạn' : 'Tự sinh');
const kindText = (p: Puzzle) => (p.kind === 'mate' ? `Chiếu bí ${p.mateIn} nước` : p.kind === 'loss' ? 'Tìm nước đúng (lỗi trong ván)' : 'Tìm nước mạnh nhất');

export function viewPractice(): string {
  D.ensureEngine();
  const tabs: [PSub, string][] = [['solve', 'Giải bài'], ['endgame', 'Tàn cuộc'], ['gen', 'Bộ sinh bài']];
  const sub = `<div class="subtabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-act="psub" data-sub="${k}" aria-selected="${psub === k}">${l}</button>`).join('')}</div>`;
  const eng = `<div class="eng" id="peng">${D.esc(D.engLine() || 'Đang khởi động engine…')}</div>`;
  return sub + (psub === 'solve' ? viewSolve() : psub === 'endgame' ? viewEndgame(eng) : viewGen(eng));
}

function viewSolve(): string {
  const S = D.S();
  const sg = suggestLevel(S.puzzles, S.attempts, D.weekIndex());
  const opts = (vals: [string, string][], v: string) => vals.map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('');
  const n = pool().length;
  const filters = `<div class="card"><div class="ctl">
    <label class="f">Bậc<select data-act="pf-level">${opts([['all', 'Tất cả'], ...([1, 2, 3, 4, 5] as Level5[]).map((l): [string, string] => [String(l), `${l} · ${LEVEL_NAMES[l]}`])], filt.level)}</select></label>
    <label class="f">Nguồn<select data-act="pf-source">${opts([['all', 'Tất cả'], ['game', 'Từ ván của bạn'], ['gen', 'Tự sinh']], filt.source)}</select></label>
    <label class="f">Tuần<select data-act="pf-week">${opts([['all', 'Tất cả'], ...Array.from({ length: 12 }, (_, i): [string, string] => [String(i + 1), `Tuần ${i + 1}`])], filt.week)}</select></label>
    <button class="btn" data-act="pnext" data-s="1" ${n ? '' : 'disabled'}>Bài gợi ý</button>
    <button class="btn ghost" data-act="pnext" data-s="0" ${n ? '' : 'disabled'}>Bài ngẫu nhiên</button></div>
    <p class="small">Kho: <b>${S.puzzles.length}</b> bài (${n} khớp bộ lọc). Mức gợi ý: ${lvPill(sg.level)} <span class="muted">(${weeksText(sg.level)}) — ${D.esc(sg.reason)}</span></p>
    ${S.puzzles.length ? '' : '<p class="muted small">Kho đang trống. Vào <b>Bộ sinh bài</b> để Pikafish tự tạo bài, hoặc phân tích một ván ở tab <b>Bàn cờ</b> rồi bấm “Tạo bài luyện tập”.</p>'}</div>`;
  if (!cur) return filters;
  const c = cur, pz = c.pz, g = c.game, l = levelOf(pz);
  const showMv = c.shown ? parseUcci(pz.solution[c.step] ?? '') : null;
  const svg = boardSvg({ board: g.board, flipped: c.flipped, selected: c.sel, targets: c.targets, last: c.last, hint: showMv, checkKing: g.status().inCheck ? kingSquare(g.fen, g.turn) : null });
  const side = g.turn === 'w' ? 'Đỏ' : 'Đen';
  const adj = l !== pz.level ? ` <span class="muted small">(gốc ${pz.level}, đã hiệu chỉnh theo kết quả của bạn)</span>` : '';
  const tries = S.attempts.filter((a) => a.pid === pz.id);
  return filters + `<div class="bwrap"><div class="bcol">${svg}<div class="nav"><span class="stat">${side} đi · ${D.esc(kindText(pz))}</span></div></div>
    <div class="bcol card" data-pid="${pz.id}"><h2>${lvPill(l)} <span class="muted small">${weeksText(l)}</span></h2>${adj}
      <p class="small">${srcText(pz)}${pz.note ? ` · ${D.esc(pz.note)}` : ''}<br>Độ sâu nhận ra: <b>${pz.recDepth > 14 ? '>14' : pz.recDepth}</b> · chênh nước 1–2: <b>${pz.gap >= 1000 ? 'duy nhất' : pz.gap + ' cp'}</b> · điểm khó: <b>${pz.score}</b>${tries.length ? ` · bạn đã làm ${tries.length} lần (đúng ${tries.filter((t) => t.ok).length})` : ''}</p>
      <p class="${c.cls}"><b>${D.esc(c.msg || `Tìm nước đi cho ${side}.`)}</b></p>
      ${c.ans ? `<p class="small"><b>Đáp án:</b> ${D.esc(c.ans)}</p>` : ''}
      <div class="nav">
        <button class="btn ghost sm" data-act="pshow" ${c.ans ? 'disabled' : ''}>Xem đáp án</button>
        <button class="btn ghost sm" data-act="pretry">Làm lại</button>
        <button class="btn sm" data-act="pnext" data-s="1">Bài tiếp theo</button>
        <button class="btn plain sm" data-act="pdel" data-id="${pz.id}">Xóa bài</button></div></div></div>`;
}

function viewEndgame(eng: string): string {
  const S = D.S();
  const stat = (id: string) => { const a = S.attempts.filter((x) => x.pid === `eg:${id}`); return a.length ? `${a.filter((x) => x.ok).length}/${a.length} lần đạt` : 'chưa chơi'; };
  const list = ENDGAMES.map((e) => `<div class="row"><div class="main"><b>${D.esc(e.title)}</b> <span class="pill">Tuần ${e.week}</span> <span class="pill">${expText[e.exp]}</span><br><span class="meta">${D.esc(e.hint)} · ${stat(e.id)}</span></div><button class="btn ghost sm" data-act="egplay" data-id="${e.id}" ${gen.running ? 'disabled' : ''}>Chơi</button></div>`).join('');
  let play = '';
  if (egp) {
    const p = egp, g = p.game, st = g.status(), o = egOutcome(p);
    const svg = boardSvg({ board: g.board, flipped: p.flipped, selected: p.sel, targets: p.targets, last: g.lastMove?.move ?? null, checkKing: st.inCheck ? kingSquare(g.fen, g.turn) : null });
    const notes = g.history.map((r) => vietnamese(new Game(r.fenBefore).position, r.move));
    const status = o ? `<span class="stat end">${D.esc(o.text)}</span>` : `<span class="stat">${p.thinking ? 'Engine đang nghĩ…' : g.turn === p.side ? 'Đến lượt bạn' : 'Đến lượt máy'}${st.inCheck ? ' · Chiếu!' : ''}</span>`;
    play = `<div class="card"><h2>${D.esc(p.eg.title)}</h2><p class="small">Bạn cầm <b>${p.side === 'w' ? 'Đỏ' : 'Đen'}</b>. Kết quả mong đợi khi chơi đúng: <b>${expText[p.eg.exp]}</b> (xác định bằng Pikafish tự đấu). Máy chơi ở mức cao nhất (${D.esc(egLevel().name)}). ${D.esc(p.eg.hint)}</p>
      <div class="ctl"><button class="btn ghost sm" data-act="egside">Đổi bên</button><button class="btn ghost sm" data-act="egreset">Chơi lại</button><button class="btn plain sm" data-act="egresign" ${o ? 'disabled' : ''}>Đầu hàng</button></div></div>
      <div class="bwrap"><div class="bcol">${svg}<div class="nav">${status}</div></div><div class="bcol card"><div class="mvwrap"><ol class="mv">${notes.map((n, i) => (i % 2 ? '' : `<li><b>${i / 2 + 1}.</b><span class="mc">${D.esc(n)}</span><span class="mc">${D.esc(notes[i + 1] ?? '')}</span></li>`)).join('')}</ol></div></div></div>`;
  }
  return `${play}<div class="card"><h2>Thư viện tàn cuộc</h2><p class="small muted">${ENDGAMES.length} thế theo tuần của giáo án. Chơi với Pikafish mức cao nhất; bấm “Đổi bên” để tập cả công lẫn thủ.</p>${eng}${gen.running ? '<p class="small q-inacc">Đang sinh bài — hãy dừng bộ sinh trước khi chơi tàn cuộc.</p>' : ''}<div class="list">${list}</div></div>`;
}

function viewGen(eng: string): string {
  const S = D.S();
  const g = S.puzzles.filter((p) => p.source === 'gen');
  const by = ([1, 2, 3, 4, 5] as Level5[]).map((l) => `${l}: ${g.filter((p) => p.level === l).length}`).join(' · ');
  return `<div class="card"><h2>Bộ sinh bài tự động</h2>
    <p class="small muted">Pikafish tự đấu các ván ngắn ở mức thấp (có ngẫu nhiên hóa), rồi lọc thế có chiếu bí trong 1–5 nước hoặc có một nước tốt hơn nước thứ hai ≥ 200 cp. Mỗi bài được xác minh ở độ sâu 18 và chấm độ khó bằng engine. Chạy nền, bạn vẫn dùng được trang; rời tab này sẽ tự dừng.</p>
    <div class="ctl"><label class="f">Số bài cần sinh<input type="number" min="1" max="20" value="${gen.target}" data-act="gentarget"></label>
    <label class="f">Bậc mong muốn<select data-act="genwant"><option value="0" ${gen.want === 0 ? 'selected' : ''}>Bất kỳ</option>${([1, 2, 3, 4, 5] as Level5[]).map((l) => `<option value="${l}" ${gen.want === l ? 'selected' : ''}>${l} · ${LEVEL_NAMES[l]}</option>`).join('')}</select></label>
    <button class="btn" data-act="genstart" ${gen.running ? 'disabled' : ''}>Bắt đầu sinh</button>
    <button class="btn ghost" data-act="genstop" ${gen.running ? '' : 'disabled'}>Dừng</button></div>
    ${eng}<div class="eng" id="genprog" aria-live="polite">${D.esc(fmtProg(gen.p))}</div></div>
    <div class="card"><h2>Kho bài tự sinh</h2><p class="small">${g.length}/${MAX_GEN} bài · theo bậc → ${by}</p>
    <div class="nav"><button class="btn plain sm" data-act="genclear" ${g.length ? '' : 'disabled'}>Xóa bài tự sinh</button></div></div>`;
}

/* ======================= Thống kê (tab Tiến độ) ======================= */
export function practiceStatsHtml(): string {
  const S = D.S();
  const pa = S.attempts.filter((a) => !a.pid.startsWith('eg:'));
  const ea = S.attempts.filter((a) => a.pid.startsWith('eg:'));
  const byId = new Map(S.puzzles.map((p) => [p.id, p]));
  const pct = (a: Attempt[]) => (a.length ? `${Math.round((a.filter((x) => x.ok).length / a.length) * 100)}%` : '–');
  const avg = (a: Attempt[]) => (a.length ? `${Math.round(a.reduce((s, x) => s + x.secs, 0) / a.length)} giây` : '–');
  const rows = ([1, 2, 3, 4, 5] as Level5[]).map((l) => {
    const a = pa.filter((x) => { const p = byId.get(x.pid); return p && p.level === l; });
    return `<div class="r"><span>${l} · ${LEVEL_NAMES[l]}</span><span class="small muted">${S.puzzles.filter((p) => p.level === l).length} bài</span><span>${a.length} lần · đúng ${pct(a)} · TB ${avg(a)}</span></div>`;
  }).join('');
  const src = (s: Puzzle['source'], t: string) => { const a = pa.filter((x) => byId.get(x.pid)?.source === s); return `${t}: ${a.length} lần, đúng ${pct(a)}`; };
  return `<div class="card"><h2>Luyện tập</h2>
    <div class="tiles"><div class="tile"><div class="k">Kho bài</div><div class="v">${S.puzzles.length}</div></div><div class="tile"><div class="k">Lần giải</div><div class="v">${pa.length}</div></div><div class="tile"><div class="k">Tỉ lệ đúng</div><div class="v">${pct(pa)}</div></div></div>
    <div class="dist">${rows}</div>
    <h3>Theo loại bài</h3>
    <div class="dist">${([['mate', 'Chiếu bí'], ['tactic', 'Chiến thuật'], ['loss', 'Từ nước sai trong ván của bạn']] as const).map(([k, t]) => { const a = pa.filter((x) => byId.get(x.pid)?.kind === k); return `<div class="r"><span>${t}</span><span class="small muted">${S.puzzles.filter((p) => p.kind === k).length} bài</span><span>${a.length} lần · đúng ${pct(a)} · TB ${avg(a)}</span></div>`; }).join('')}</div>
    <p class="small muted">${src('game', 'Từ ván của bạn')} · ${src('gen', 'Tự sinh')} · Tàn cuộc: ${ea.length} ván, đạt mục tiêu ${pct(ea)}</p></div>`;
}

/* ======================= Sự kiện ======================= */
export function practiceBoardClick(file: number, rank: number): boolean {
  if (psub === 'solve') {
    const c = cur;
    if (!c || c.status !== 'play') return true;
    const t = c.targets.find((x) => x.file === file && x.rank === rank);
    if (c.sel && t) { tryMove({ from: c.sel, to: t }); D.render(); return true; }
    const pc = c.game.board[rank][file];
    if (pc && pc.color === c.game.turn) { c.sel = { file, rank }; c.targets = c.game.legalMovesFrom(c.sel).map((m) => m.to); } else { c.sel = null; c.targets = []; }
    D.render(); return true;
  }
  if (psub === 'endgame') {
    const p = egp;
    if (!p || p.thinking || p.game.status().over || p.resigned || p.game.turn !== p.side) return true;
    const t = p.targets.find((x) => x.file === file && x.rank === rank);
    if (p.sel && t) { p.game.move({ from: p.sel, to: t }); p.sel = null; p.targets = []; egAfter(); D.render(); void egEngineTurn(); return true; }
    const pc = p.game.board[rank][file];
    if (pc && pc.color === p.side) { p.sel = { file, rank }; p.targets = p.game.legalMovesFrom(p.sel).map((m) => m.to); } else { p.sel = null; p.targets = []; }
    D.render(); return true;
  }
  return true;
}

export function practiceAct(a: string, el: HTMLElement): boolean {
  switch (a) {
    case 'psub': psub = el.dataset.sub as PSub; D.render(); return true;
    case 'pnext': pickNext(el.dataset.s === '1'); D.render(); return true;
    case 'pretry': if (cur) { const keep = cur; startSolve(keep.pz); cur!.recorded = true; D.render(); } return true;
    case 'pshow': if (cur) { cur.shown = true; if (!cur.recorded) record(cur, false); cur.ans = answerText(cur.pz); cur.msg = 'Đáp án đã hiện (nước đầu được đánh dấu trên bàn).'; cur.cls = 'q-inacc'; D.render(); } return true;
    case 'pdel': { const S = D.S(); S.puzzles = S.puzzles.filter((p) => p.id !== el.dataset.id); S.attempts = S.attempts.filter((x) => x.pid !== el.dataset.id); D.persist(); cur = null; D.render(); return true; }
    case 'egplay': { const e = ENDGAMES.find((x) => x.id === el.dataset.id); if (e) { startEg(e); D.render(); } return true; }
    case 'egside': if (egp) { startEg(egp.eg, egp.side === 'w' ? 'b' : 'w'); D.render(); } return true;
    case 'egreset': if (egp) { startEg(egp.eg, egp.side); D.render(); } return true;
    case 'egresign': if (egp) { egp.resigned = true; egAfter(); D.render(); } return true;
    case 'genstart': startGen(); return true;
    case 'genstop': stopGen(); return true;
    case 'genclear': { const S = D.S(); const ids = new Set(S.puzzles.filter((p) => p.source === 'gen').map((p) => p.id)); S.puzzles = S.puzzles.filter((p) => p.source !== 'gen'); S.attempts = S.attempts.filter((x) => !ids.has(x.pid)); D.persist(); if (cur && ids.has(cur.pz.id)) cur = null; D.render(); return true; }
  }
  return false;
}

export function practiceChange(a: string, el: HTMLInputElement | HTMLSelectElement): boolean {
  switch (a) {
    case 'pf-level': filt.level = el.value; D.render(); return true;
    case 'pf-source': filt.source = el.value; D.render(); return true;
    case 'pf-week': filt.week = el.value; D.render(); return true;
    case 'genwant': gen.want = Number(el.value) as Level5 | 0; return true;
    case 'gentarget': gen.target = Math.max(1, Math.min(20, Number(el.value) || 5)); return true;
  }
  return false;
}


