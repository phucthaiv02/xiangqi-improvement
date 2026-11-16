import './style.css';
import { Game, START_FEN, parseUcci, moveToUcci, kingSquare, type Move, type Square, type Color } from '@pikafish-js/rules';
import { WEEKS, MONTHS, TEMPLATE, DAYS, DSHORT, ERR_TYPES, FINAL } from './data';
import { load, save, exportJson, importJson, ymd, parseYmd, addDays, uid, type State, type GameEntry } from './store';
import { getEngine, evalPosition, LEVELS, engineLabel, fmtScore, cpOf, type PosEval } from './engine';
import { boardSvg } from './board';
import { vietnamese } from './notation';
import { parseGameText } from './importer';
import { playOut } from './puzzles';
import { ENDGAMES } from './endgames';
import { initPractice, viewPractice, practiceAct, practiceChange, practiceBoardClick, practiceLeave, practiceStatsHtml, addGamePuzzles } from './practice';

type Tab = 'today' | 'board' | 'practice' | 'plan' | 'errors' | 'progress';
type Sub = 'play' | 'review' | 'import';

let S: State = load();
let tab: Tab = 'today';
let sub: Sub = 'play';
let viewDate = ymd(new Date());
let toast = '';

const app = document.getElementById('app')!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const persist = () => save(S);
const todayStr = () => ymd(new Date());
const fmt = (s: string) => { const d = parseYmd(s); return `${d.getDate()}/${d.getMonth() + 1}`; };

/* ---------------- Engine status ---------------- */
let engStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let engMsg = '';
function ensureEngine() {
  if (engStatus !== 'idle') return;
  engStatus = 'loading'; engMsg = 'Đang tải engine Pikafish…';
  getEngine((p) => { engMsg = `Đang tải mạng NNUE ${p.total ? Math.round((p.loaded / p.total) * 100) : 0}%`; if (tab === 'board') updateEngLine(); })
    .then(() => { engStatus = 'ready'; engMsg = `Engine sẵn sàng · ${engineLabel}`; render(); })
    .catch((e: unknown) => { engStatus = 'error'; engMsg = e instanceof Error ? e.message : String(e); render(); });
}
function updateEngLine() { const el = document.getElementById('eng'); if (el) el.textContent = engMsg; }

/* ---------------- Play state ---------------- */
interface Play {
  game: Game; side: Color; level: number; thinking: boolean; id: number;
  sel: Square | null; targets: Square[]; hint: Move | null; hintInfo: string; saved: boolean; flipped: boolean;
}
let play: Play = newPlay('w', 2);
function newPlay(side: Color, level: number): Play {
  return { game: new Game(), side, level, thinking: false, id: Date.now(), sel: null, targets: [], hint: null, hintInfo: '', saved: false, flipped: side === 'b' };
}

function lastMove(g: Game): Move | null { return g.lastMove?.move ?? null; }
function checkKing(g: Game): Square | null { return g.status().inCheck ? kingSquare(g.fen, g.turn) : null; }

async function engineTurn() {
  const p = play;
  if (p.game.status().over || p.game.turn === p.side || p.thinking) return;
  p.thinking = true; render();
  try {
    const eng = await getEngine();
    const lv = LEVELS[p.level];
    const h = await eng.analyze({ fen: START_FEN, moves: p.game.history.map((r) => r.ucci), depth: lv.depth, movetime: lv.movetime });
    const r = await h.result;
    if (p !== play || p.id !== play.id) return;
    const mv = parseUcci(r.bestmove);
    if (mv && p.game.isLegal(mv)) p.game.move(mv);
  } catch (e) {
    engStatus = 'error'; engMsg = e instanceof Error ? e.message : String(e);
  } finally {
    p.thinking = false; afterMove(); render();
  }
}

function afterMove() {
  const st = play.game.status();
  if (st.over && !play.saved) {
    play.saved = true;
    const mine: Record<string, 'win' | 'loss' | 'draw'> = { red: play.side === 'w' ? 'win' : 'loss', black: play.side === 'b' ? 'win' : 'loss', draw: 'draw' };
    const r = st.result ? mine[st.result] : 'draw';
    S.games.unshift({ id: uid(), date: todayStr(), side: play.side === 'w' ? 'red' : 'black', result: r, hang: false, note: `Chơi với Pikafish · ${LEVELS[play.level].name} (${st.reason ?? ''})`, mv: play.game.history.map((x) => x.ucci).join(' ') });
    persist();
  }
}

function boardClick(file: number, rank: number) {
  const p = play;
  if (p.thinking || p.game.status().over || p.game.turn !== p.side) return;
  const sq = { file, rank };
  const target = p.targets.find((t) => t.file === file && t.rank === rank);
  if (p.sel && target) {
    const mv: Move = { from: p.sel, to: target };
    p.game.move(mv); p.sel = null; p.targets = []; p.hint = null; p.hintInfo = '';
    afterMove(); render(); void engineTurn(); return;
  }
  const pc = p.game.board[rank][file];
  if (pc && pc.color === p.side) { p.sel = sq; p.targets = p.game.legalMovesFrom(sq).map((m) => m.to); }
  else { p.sel = null; p.targets = []; }
  render();
}

async function hint() {
  const p = play;
  if (p.thinking || p.game.status().over || p.game.turn !== p.side) return;
  p.thinking = true; render();
  try {
    const r = await evalPosition(p.game.fen, { depth: 14, movetime: 1500 });
    const mv = parseUcci(r.bestmove);
    if (p === play && mv && p.game.isLegal(mv)) { p.hint = mv; p.hintInfo = `${vietnamese(p.game.position, mv)} (${(r.cp / 100).toFixed(2)})`; }
  } catch (e) { engMsg = e instanceof Error ? e.message : String(e); }
  finally { p.thinking = false; render(); }
}

function undo() {
  const p = play;
  if (p.thinking) return;
  const n = p.game.turn === p.side ? 2 : 1;
  for (let i = 0; i < n; i++) p.game.undo();
  p.sel = null; p.targets = []; p.hint = null; p.hintInfo = ''; p.saved = false; p.id = Date.now();
  render();
}

/* ---------------- Review state ---------------- */
interface Review {
  mv: string[]; fen0: string; idx: number; side: 'red' | 'black'; fens: string[]; notes: string[]; moves: Move[];
  evals: (PosEval | null)[]; busy: boolean; progress: string; gameId?: string;
}
let review: Review | null = null;
function buildReview(mv: string[], fen0: string | undefined, side: 'red' | 'black', gameId?: string): Review {
  const g = new Game(fen0 ?? START_FEN);
  const fens = [g.fen], notes: string[] = [], moves: Move[] = [];
  for (const u of mv) {
    const m = parseUcci(u)!;
    notes.push(vietnamese(g.position, m)); moves.push(m);
    g.move(m); fens.push(g.fen);
  }
  return { mv, fen0: fen0 ?? START_FEN, idx: mv.length, side, fens, notes, moves, evals: fens.map(() => null), busy: false, progress: '', gameId };
}
function openReview(e: GameEntry) {
  review = buildReview(e.mv.split(/\s+/).filter(Boolean), e.fen0, e.side, e.id);
  tab = 'board'; sub = 'review'; ensureEngine(); render();
}

async function analyzeAll() {
  const r = review; if (!r || r.busy) return;
  r.busy = true; render();
  try {
    for (let i = 0; i < r.fens.length; i++) {
      if (r.evals[i]) continue;
      r.progress = `Phân tích thế ${i + 1}/${r.fens.length}…`; updateProg();
      const g = new Game(r.fens[i]);
      if (g.status().over) { r.evals[i] = { bestmove: '(none)', cp: -10000, pv: [], depth: 0 }; continue; }
      r.evals[i] = await evalPosition(r.fens[i], { depth: 12, movetime: 600 });
      if (review !== r) return;
    }
    r.progress = 'Đã phân tích xong.';
  } catch (e) { r.progress = e instanceof Error ? e.message : String(e); }
  finally { r.busy = false; if (review === r) render(); }
}
function updateProg() { const el = document.getElementById('prog'); if (el && review) el.textContent = review.progress; }

interface Issue { ply: number; loss: number; label: string; cls: string; best: string; mine: boolean }
const clampCp = (v: number) => Math.max(-1500, Math.min(1500, v));
function issues(r: Review): Issue[] {
  const out: Issue[] = [];
  for (let i = 0; i < r.mv.length; i++) {
    const a = r.evals[i], b = r.evals[i + 1];
    if (!a || !b) continue;
    const loss = a.bestmove === r.mv[i] ? 0 : Math.max(0, clampCp(a.cp) + clampCp(b.cp));
    const redMoved = new Game(r.fens[i]).turn === 'w';
    const mine = (r.side === 'red') === redMoved;
    let label = '', cls = '';
    if (loss >= 300) { label = 'Sai lầm lớn'; cls = 'q-blunder'; } else if (loss >= 150) { label = 'Sai lầm'; cls = 'q-mistake'; } else if (loss >= 60) { label = 'Thiếu chính xác'; cls = 'q-inacc'; }
    out.push({ ply: i, loss, label, cls, best: a.bestmove, mine });
  }
  return out;
}
function guessType(r: Review, ply: number): string {
  const pieces = r.fens[ply].split(' ')[0].replace(/[\d/]/g, '').length;
  if (ply < 20) return 'Khai cuộc';
  if (pieces <= 12) return 'Tàn cuộc';
  return 'Trung cuộc';
}
function addIssuesToLog() {
  const r = review; if (!r) return;
  let n = 0;
  for (const it of issues(r)) {
    if (!it.mine || it.loss < 150) continue;
    const bm = parseUcci(it.best);
    const bestTxt = bm ? vietnamese(new Game(r.fens[it.ply]).position, bm) : it.best;
    const id = `${r.gameId ?? 'imp'}-${it.ply}`;
    if (S.errors.some((e) => e.id === id)) continue;
    S.errors.unshift({ id, date: todayStr(), type: guessType(r, it.ply), note: `Nước ${it.ply + 1} (${r.notes[it.ply]}) mất ${it.loss} cp. Engine đề xuất: ${bestTxt}.`, fen: r.fens[it.ply] });
    n++;
  }
  persist(); toast = n ? `Đã thêm ${n} lỗi vào sổ lỗi.` : 'Không có lỗi mới (≥150 cp) của bạn để thêm.';
  render();
}

async function makePuzzles() {
  const r = review; if (!r || r.busy) return;
  const items = issues(r).filter((i) => i.mine && i.loss >= 150).slice(0, 8)
    .map((i) => ({ fen: r.fens[i.ply], ply: i.ply, note: `Nước ${i.ply + 1} (${r.notes[i.ply]}) mất ${i.loss} cp` }));
  if (!items.length) { toast = 'Chưa có lỗi ≥150 cp của bạn. Hãy bấm "Phân tích cả ván" trước.'; render(); return; }
  r.busy = true; render();
  try {
    const n = await addGamePuzzles(items, r.gameId, (m) => { r.progress = m; updateProg(); });
    toast = n ? `Đã tạo ${n} bài luyện tập — xem ở tab Luyện tập.` : 'Không có bài mới (các thế này đã có trong kho).';
  } catch (e) { toast = e instanceof Error ? e.message : String(e); }
  finally { r.busy = false; render(); }
}

/* ---------------- Import state ---------------- */
let impText = '', impSide: 'red' | 'black' = 'red', impResult: 'win' | 'loss' | 'draw' = 'loss', impInfo = '';
let impParsed: ReturnType<typeof parseGameText> | null = null;

/* ---------------- Timer ---------------- */
let timerEnd = 0, timerTotal = 0, timerId = 0;
function tickTimer() {
  const left = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
  const d = document.getElementById('tdisp'), b = document.getElementById('tbar');
  if (d) d.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  if (b) b.style.width = `${timerTotal ? ((timerTotal - left) / timerTotal) * 100 : 0}%`;
  if (left <= 0) { clearInterval(timerId); timerId = 0; }
}

/* ---------------- Views ---------------- */
function progressInfo() {
  const diff = Math.floor((parseYmd(todayStr()).getTime() - parseYmd(S.start).getTime()) / 86400000);
  const day = Math.max(0, Math.min(83, diff));
  return { diff, week: Math.min(11, Math.floor(day / 7)) };
}

function viewToday(): string {
  const td = todayStr();
  const { diff, week } = progressInfo();
  const W = WEEKS[week];
  const wstart = addDays(S.start, week * 7);
  let strip = '';
  for (let i = 0; i < 7; i++) {
    const ds = addDays(wstart, i), tasks = TEMPLATE[parseYmd(ds).getDay()];
    const done = tasks.filter((_, k) => S.checks[`${ds}|${k}`]).length;
    const cls = done === tasks.length ? 'full' : done ? 'part' : '';
    strip += `<button type="button" data-act="pickday" data-date="${ds}" aria-pressed="${ds === viewDate}"><span>${DSHORT[parseYmd(ds).getDay()]}</span><b>${parseYmd(ds).getDate()}</b><span class="dot ${cls}"></span></button>`;
  }
  const tasks = TEMPLATE[parseYmd(viewDate).getDay()];
  const items = tasks.map((t, k) => {
    const on = !!S.checks[`${viewDate}|${k}`];
    return `<li class="task ${on ? 'done' : ''}"><label><input type="checkbox" data-act="check" data-key="${viewDate}|${k}" ${on ? 'checked' : ''}><span>${esc(t[0])}</span></label><span class="min">${t[1]} phút</span></li>`;
  }).join('');
  const played = S.games.length, wins = S.games.filter((g) => g.result === 'win').length;
  return `
  <div class="tiles">
    <div class="tile"><div class="k">Tuần</div><div class="v">${week + 1}<small> / 12</small></div></div>
    <div class="tile"><div class="k">Ngày</div><div class="v">${diff < 0 ? '–' : Math.min(diff + 1, 84)}<small> / 84</small></div></div>
    <div class="tile"><div class="k">Ván đã ghi</div><div class="v">${played}<small> · thắng ${wins}</small></div></div>
  </div>
  <div class="card"><h2>${esc(MONTHS[W.m - 1])}</h2><p class="theme">Tuần ${week + 1}: ${esc(W.t)}</p><p class="goal">${esc(W.d)}</p><p class="goal"><b>Mục tiêu:</b> ${esc(W.g)}</p>
    <div class="strip">${strip}</div>
    <h2>${DAYS[parseYmd(viewDate).getDay()]}, ${fmt(viewDate)}${viewDate === td ? ' · hôm nay' : ''}</h2>
    <ul class="tasks">${items}</ul></div>
  <div class="card"><h2>Đồng hồ tập trung</h2><div class="timer"><div id="tdisp">00:00</div>
    <div class="presets">${[15, 25, 45].map((m) => `<button class="btn ghost sm" data-act="timer" data-min="${m}">${m} phút</button>`).join('')}<button class="btn plain sm" data-act="timer" data-min="0">Dừng</button></div></div>
    <div class="bar"><i id="tbar"></i></div></div>`;
}

function movesList(notes: string[], cur: number, clickable: boolean, marks?: (i: number) => string): string {
  let h = '<ol class="mv">';
  for (let i = 0; i < notes.length; i += 2) {
    const cell = (j: number) => j < notes.length
      ? (clickable ? `<button class="mc ${cur === j + 1 ? 'cur' : ''}" data-act="goto" data-i="${j + 1}">${esc(notes[j])}${marks?.(j) ?? ''}</button>` : `<span class="mc">${esc(notes[j])}</span>`)
      : '<span></span>';
    h += `<li><b>${i / 2 + 1}.</b>${cell(i)}${cell(i + 1)}</li>`;
  }
  return h + '</ol>';
}

function viewBoard(): string {
  ensureEngine();
  const subs = (['play', 'review', 'import'] as Sub[]).map((s) => `<button role="tab" data-act="sub" data-sub="${s}" aria-selected="${sub === s}">${{ play: 'Chơi với máy', review: 'Xem lại & phân tích', import: 'Nhập ván' }[s]}</button>`).join('');
  const eng = `<div class="eng ${engStatus === 'error' ? 'err' : ''}" id="eng">${esc(engMsg || 'Đang khởi động engine…')}</div>`;
  const t = toast ? `<div class="card"><b>${esc(toast)}</b></div>` : '';
  toast = '';
  return `<div class="subtabs" role="tablist">${subs}</div>${t}${sub === 'play' ? viewPlay(eng) : sub === 'review' ? viewReview(eng) : viewImport()}`;
}

function viewPlay(eng: string): string {
  const p = play, g = p.game, st = g.status();
  const status = st.over
    ? `<span class="stat end">${st.result === 'draw' ? 'Hòa' : st.result === 'red' ? 'Đỏ thắng' : 'Đen thắng'} (${esc(st.reason ?? '')})</span>`
    : `<span class="stat">${p.thinking ? 'Engine đang nghĩ…' : g.turn === p.side ? 'Đến lượt bạn' : 'Đến lượt máy'}${st.inCheck ? ' · Chiếu!' : ''}</span>`;
  const notes = g.history.map((r) => vietnamese(new Game(r.fenBefore).position, r.move));
  const svg = boardSvg({ board: g.board, flipped: p.flipped, selected: p.sel, targets: p.targets, last: lastMove(g), hint: p.hint, checkKing: checkKing(g) });
  return `<div class="card"><div class="ctl">
    <label class="f">Bạn cầm<select data-act="pside"><option value="w" ${p.side === 'w' ? 'selected' : ''}>Đỏ (đi trước)</option><option value="b" ${p.side === 'b' ? 'selected' : ''}>Đen</option></select></label>
    <label class="f">Mức độ<select data-act="plevel">${LEVELS.map((l, i) => `<option value="${i}" ${p.level === i ? 'selected' : ''}>${l.name}</option>`).join('')}</select></label>
    <button class="btn" data-act="pnew">Ván mới</button></div><p>${eng.replace('class="eng', 'class="eng')}</p></div>
  <div class="bwrap"><div class="bcol">${svg}<div class="nav">${status}</div></div>
  <div class="bcol card"><div class="nav">
    <button class="btn ghost sm" data-act="hint" ${p.thinking || st.over || engStatus !== 'ready' ? 'disabled' : ''}>Gợi ý</button>
    <button class="btn ghost sm" data-act="undo" ${p.thinking || g.history.length === 0 ? 'disabled' : ''}>Đi lại</button>
    <button class="btn ghost sm" data-act="flip">Xoay bàn</button>
    <button class="btn plain sm" data-act="resign" ${st.over ? 'disabled' : ''}>Đầu hàng</button>
    ${st.over || g.history.length ? '<button class="btn ghost sm" data-act="reviewcur">Phân tích ván</button>' : ''}</div>
    ${p.hintInfo ? `<p class="small">Gợi ý: <b>${esc(p.hintInfo)}</b></p>` : ''}
    <div class="mvwrap">${movesList(notes, -1, false)}</div></div></div>`;
}

function viewReview(eng: string): string {
  if (!review) return `<div class="card"><p>Chưa có ván nào để xem. Chọn một ván trong tab <b>Tiến độ</b>, hoặc dùng <b>Nhập ván</b>.</p>${eng}</div>`;
  const r = review;
  const g = new Game(r.fens[r.idx]);
  const is = issues(r);
  const marks = (j: number) => { const it = is[j]; return it && it.label ? ` <span class="${it.cls}">${it.loss >= 300 ? '??' : it.loss >= 150 ? '?' : '?!'}</span>` : ''; };
  const e = r.evals[r.idx];
  const redCp = e ? (g.turn === 'w' ? e.cp : -e.cp) : 0;
  const pct = e ? Math.max(5, Math.min(95, 50 + clampCp(redCp) / 30)) : 50;
  const bm = e && e.bestmove !== '(none)' ? parseUcci(e.bestmove) : null;
  const svg = boardSvg({ board: g.board, flipped: r.side === 'black', last: r.idx > 0 ? r.moves[r.idx - 1] : null, hint: bm, checkKing: g.status().inCheck ? kingSquare(g.fen, g.turn) : null });
  const mine = is.filter((i) => i.mine);
  const avg = mine.length ? Math.round(mine.reduce((a, b) => a + b.loss, 0) / mine.length) : 0;
  const list = is.filter((i) => i.mine && i.loss >= 60).map((i) => `<div class="row"><div class="main"><b>Nước ${i.ply + 1}</b>: ${esc(r.notes[i.ply])} <span class="${i.cls}">${i.label}</span> <span class="cp">−${i.loss} cp</span><br><span class="meta">Engine đề xuất: ${esc(parseUcci(i.best) ? vietnamese(new Game(r.fens[i.ply]).position, parseUcci(i.best)!) : i.best)}</span></div><button class="btn ghost sm" data-act="goto" data-i="${i.ply}">Xem thế</button></div>`).join('');
  return `<div class="card"><div class="ctl">
    <label class="f">Bạn cầm<select data-act="rside"><option value="red" ${r.side === 'red' ? 'selected' : ''}>Đỏ</option><option value="black" ${r.side === 'black' ? 'selected' : ''}>Đen</option></select></label>
    <button class="btn" data-act="analyze" ${r.busy || engStatus !== 'ready' ? 'disabled' : ''}>Phân tích cả ván</button>
    <button class="btn ghost" data-act="tolog" ${is.length ? '' : 'disabled'}>Thêm lỗi vào sổ</button>
    <button class="btn ghost" data-act="mkpuz" ${is.length && !r.busy ? '' : 'disabled'}>Tạo bài luyện tập</button></div>
    <p>${eng}</p><div class="eng" id="prog">${esc(r.progress)}</div></div>
  <div class="bwrap"><div class="bcol">${svg}<div class="evalbar" title="Đánh giá (Đỏ ở bên trái)"><i style="width:${pct}%"></i></div>
    <div class="nav"><button class="btn ghost sm" data-act="goto" data-i="0">⏮</button><button class="btn ghost sm" data-act="goto" data-i="${Math.max(0, r.idx - 1)}">◀</button><button class="btn ghost sm" data-act="goto" data-i="${Math.min(r.mv.length, r.idx + 1)}">▶</button><button class="btn ghost sm" data-act="goto" data-i="${r.mv.length}">⏭</button>
    <span class="small">Thế ${r.idx}/${r.mv.length}${e ? ` · ${fmtScore({ score: { type: 'cp', value: redCp }, raw: '' })} (Đỏ)` : ''}</span></div></div>
  <div class="bcol card"><div class="mvwrap">${movesList(r.notes, r.idx, true, marks)}</div></div></div>
  ${is.length ? `<div class="card"><h2>Tóm tắt</h2><p class="small">Mất trung bình ${avg} cp mỗi nước của bạn.</p><div class="list">${list || '<p class="muted small">Không có nước nào mất ≥ 60 cp.</p>'}</div></div>` : ''}`;
}

function viewImport(): string {
  const res = impParsed ? `<p class="small">${impParsed.moves.length ? `Đã đọc <b>${impParsed.moves.length}</b> nước (${impParsed.kind === 'ucci' ? 'tọa độ' : 'ký hiệu'}).` : ''} ${impParsed.error ? `<span class="q-mistake">${esc(impParsed.error)}</span>` : ''}</p>` : '';
  return `<div class="card"><h2>Nhập ván</h2><p class="small muted">Dán bản ghi ván từ xiangqi.com hoặc nơi khác: tọa độ (h2e2 h9g7 …), ký hiệu Trung (炮二平五), tiếng Việt (Pháo 2 bình 5) hoặc WXF (C2=5). Có thể kèm dòng FEN.</p>
  <textarea class="imp" id="imptext" placeholder="1. 炮二平五 马8进7 2. 马二进三 …">${esc(impText)}</textarea>
  <div class="ctl"><label class="f">Bạn cầm<select data-act="iside"><option value="red" ${impSide === 'red' ? 'selected' : ''}>Đỏ</option><option value="black" ${impSide === 'black' ? 'selected' : ''}>Đen</option></select></label>
  <label class="f">Kết quả<select data-act="ires"><option value="win" ${impResult === 'win' ? 'selected' : ''}>Thắng</option><option value="draw" ${impResult === 'draw' ? 'selected' : ''}>Hòa</option><option value="loss" ${impResult === 'loss' ? 'selected' : ''}>Thua</option></select></label>
  <button class="btn" data-act="iparse">Đọc ván</button></div>${res}
  ${impParsed && impParsed.moves.length ? '<div class="nav"><button class="btn ghost" data-act="iview">Xem lại & phân tích</button><button class="btn ghost" data-act="isave">Lưu vào sổ ván</button></div>' : ''}</div>`;
}

function viewPlan(): string {
  const { week } = progressInfo();
  let html = `<div class="card"><h2>Kế hoạch 12 tuần</h2><label class="f">Ngày bắt đầu<input type="date" data-act="start" value="${S.start}"></label></div>`;
  MONTHS.forEach((m, mi) => {
    html += `<h3>${esc(m)}</h3>`;
    WEEKS.forEach((W, i) => {
      if (W.m !== mi + 1) return;
      const cur = i === week;
      html += `<details class="week ${cur ? 'cur' : ''}" ${cur ? 'open' : ''}><summary><span class="wn">Tuần ${i + 1}</span><span class="wt">${esc(W.t)}</span>${cur ? '<span class="pill now">Hiện tại</span>' : ''}</summary><div class="body"><div>${esc(W.d)}</div><div class="muted"><b>Mục tiêu:</b> ${esc(W.g)}</div></div></details>`;
    });
  });
  return html;
}

function viewErrors(): string {
  const counts: Record<string, number> = {}; ERR_TYPES.forEach((t) => (counts[t] = 0));
  S.errors.forEach((e) => { counts[e.type] = (counts[e.type] ?? 0) + 1; });
  const max = Math.max(1, ...Object.values(counts));
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const dist = Object.entries(counts).map(([t, n]) => `<div class="r ${n && top[0] === t ? 'top' : ''}"><span>${esc(t)}</span><div class="t"><i style="width:${(n / max) * 100}%"></i></div><span>${n}</span></div>`).join('');
  const list = S.errors.map((e) => `<div class="row"><div class="main"><span class="pill">${esc(e.type)}</span> <span class="meta">${fmt(e.date)}</span><div>${esc(e.note)}</div>${e.fen ? `<div class="meta">${esc(e.fen)}</div>` : ''}</div><button class="btn plain sm" data-act="delerr" data-id="${esc(e.id)}">Xóa</button></div>`).join('');
  return `<div class="card"><h2>Thêm lỗi</h2><form class="grid" data-form="err"><label class="f">Loại lỗi<select name="type">${ERR_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></label>
    <label class="f full">Mô tả<input type="text" name="note" required placeholder="Ví dụ: bỏ Pháo bị treo ở nước 18"></label><button class="btn">Lưu</button></form></div>
  <div class="card"><h2>Phân bố lỗi</h2><div class="dist">${dist}</div></div>
  <div class="card"><h2>Sổ lỗi (${S.errors.length})</h2><div class="list">${list || '<p class="muted small">Chưa có lỗi nào.</p>'}</div></div>`;
}

function spark(vals: { date: string; v: number }[]): string {
  if (vals.length < 2) return '<p class="muted small">Cần ít nhất 2 lần ghi để vẽ biểu đồ.</p>';
  const w = 560, h = 120, pad = 24, vs = vals.map((x) => x.v);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const pt = (i: number, v: number) => [pad + (i / (vals.length - 1)) * (w - pad * 2), h - pad - ((v - lo) / span) * (h - pad * 2)];
  const d = vals.map((x, i) => pt(i, x.v).join(',')).join(' ');
  const dots = vals.map((x, i) => { const [cx, cy] = pt(i, x.v); return `<circle class="pt" cx="${cx}" cy="${cy}" r="4"/><text class="val" x="${cx}" y="${cy - 9}" text-anchor="middle">${x.v}</text>`; }).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}"><line class="gl" x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}"/><polyline class="ln" points="${d}"/>${dots}</svg>`;
}

function viewProgress(): string {
  const g = S.games, n = g.length, w = g.filter((x) => x.result === 'win').length, d = g.filter((x) => x.result === 'draw').length;
  const metric = (key: 'puzzle' | 'elo', label: string) => `<div class="card"><h2>${label}</h2>${spark(S.metrics[key])}
    <form class="grid" data-form="metric" data-key="${key}"><label class="f">Ngày<input type="date" name="date" value="${todayStr()}"></label><label class="f">Giá trị<input type="number" name="v" required step="any"></label><button class="btn">Ghi</button></form></div>`;
  const games = g.map((x) => `<div class="row"><div class="main"><span class="pill ${x.result}">${{ win: 'Thắng', loss: 'Thua', draw: 'Hòa' }[x.result]}</span> <span class="meta">${fmt(x.date)} · cầm ${x.side === 'red' ? 'Đỏ' : 'Đen'}</span><div class="small">${esc(x.note)}</div></div><div class="acts"><button class="btn ghost sm" data-act="rev" data-id="${x.id}">Xem lại</button><button class="btn plain sm" data-act="delgame" data-id="${x.id}">Xóa</button></div></div>`).join('');
  const fin = FINAL.map((t, i) => `<li class="task ${S.finalTest[i] ? 'done' : ''}"><label><input type="checkbox" data-act="final" data-i="${i}" ${S.finalTest[i] ? 'checked' : ''}><span>${esc(t)}</span></label></li>`).join('');
  return `<div class="tiles"><div class="tile"><div class="k">Ván</div><div class="v">${n}</div></div><div class="tile"><div class="k">Tỉ lệ thắng</div><div class="v">${n ? Math.round((w / n) * 100) : 0}<small>%</small></div></div><div class="tile"><div class="k">Hòa</div><div class="v">${d}</div></div></div>
  <div class="two">${metric('puzzle', 'Bài chiếu bí đúng (%)')}${metric('elo', 'Elo / điểm xếp hạng')}</div>
  <div class="card"><h2>Bài kiểm tra cuối khóa (tuần 12)</h2><ul class="tasks">${fin}</ul></div>
  ${practiceStatsHtml()}
  <div class="card"><h2>Các ván</h2><div class="list">${games || '<p class="muted small">Chưa có ván nào. Chơi ở tab Bàn cờ hoặc nhập ván.</p>'}</div></div>
  <div class="card"><h2>Sao lưu</h2><p class="small muted">Dữ liệu lưu trong trình duyệt này. Xuất file JSON để chuyển sang máy khác.</p><div class="nav"><button class="btn ghost" data-act="export">Xuất JSON</button><label class="btn ghost" style="cursor:pointer">Nhập JSON<input type="file" accept="application/json" data-act="import" hidden></label><button class="btn plain" data-act="reset">Xóa tất cả</button></div></div>`;
}

function render() {
  const tabs: [Tab, string][] = [['today', 'Hôm nay'], ['board', 'Bàn cờ'], ['practice', 'Luyện tập'], ['plan', 'Kế hoạch'], ['errors', 'Sổ lỗi'], ['progress', 'Tiến độ']];
  const body = { today: viewToday, board: viewBoard, practice: viewPractice, plan: viewPlan, errors: viewErrors, progress: viewProgress }[tab]();
  app.innerHTML = `<header class="top"><div class="piece">帥</div><div><h1>Cờ tướng 12 tuần</h1><p class="sub">Giáo án, bàn cờ và phân tích bằng Pikafish</p></div></header>
  <nav class="tabs">${tabs.map(([k, l]) => `<button data-act="tab" data-tab="${k}" ${tab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>${body}`;
}

/* ---------------- Events ---------------- */
function download(name: string, text: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

app.addEventListener('click', (ev) => {
  const t = ev.target as Element;
  const hit = t.closest('.hit') as SVGElement | null;
  if (hit && tab === 'board' && sub === 'play') { boardClick(Number(hit.dataset.f), Number(hit.dataset.r)); return; }
  if (hit && tab === 'practice') { practiceBoardClick(Number(hit.dataset.f), Number(hit.dataset.r)); return; }
  const el = t.closest('[data-act]') as HTMLElement | null;
  if (!el) return;
  const a = el.dataset.act!;
  if (el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  switch (a) {
    case 'tab': if (tab === 'practice' && el.dataset.tab !== 'practice') practiceLeave(); tab = el.dataset.tab as Tab; render(); break;
    case 'sub': sub = el.dataset.sub as Sub; render(); break;
    case 'pickday': viewDate = el.dataset.date!; render(); break;
    case 'timer': {
      clearInterval(timerId); const m = Number(el.dataset.min);
      timerTotal = m * 60; timerEnd = Date.now() + timerTotal * 1000;
      if (m) timerId = window.setInterval(tickTimer, 500); tickTimer(); break;
    }
    case 'pnew': { play = newPlay(play.side, play.level); render(); void engineTurn(); break; }
    case 'hint': void hint(); break;
    case 'undo': undo(); break;
    case 'flip': play.flipped = !play.flipped; render(); break;
    case 'resign': { play.game.resign(play.side); afterMove(); render(); break; }
    case 'reviewcur': { review = buildReview(play.game.history.map((r) => r.ucci), undefined, play.side === 'w' ? 'red' : 'black'); sub = 'review'; render(); break; }
    case 'goto': if (review) { review.idx = Number(el.dataset.i); render(); } break;
    case 'analyze': void analyzeAll(); break;
    case 'tolog': addIssuesToLog(); break;
    case 'mkpuz': void makePuzzles(); break;
    case 'iparse': {
      impText = (document.getElementById('imptext') as HTMLTextAreaElement).value;
      impParsed = parseGameText(impText); render(); break;
    }
    case 'iview': if (impParsed) { review = buildReview(impParsed.moves, impParsed.fen0 ?? undefined, impSide); sub = 'review'; render(); } break;
    case 'isave': if (impParsed) {
      S.games.unshift({ id: uid(), date: todayStr(), side: impSide, result: impResult, hang: false, note: 'Nhập từ bản ghi', mv: impParsed.moves.join(' '), fen0: impParsed.fen0 ?? undefined });
      persist(); toast = 'Đã lưu ván vào tab Tiến độ.'; render();
    } break;
    case 'delerr': S.errors = S.errors.filter((e) => e.id !== el.dataset.id); persist(); render(); break;
    case 'delgame': S.games = S.games.filter((e) => e.id !== el.dataset.id); persist(); render(); break;
    case 'rev': { const e = S.games.find((x) => x.id === el.dataset.id); if (e) openReview(e); break; }
    case 'export': download(`xiangqi-backup-${todayStr()}.json`, exportJson(S)); break;
    case 'reset': if (confirm('Xóa toàn bộ dữ liệu trong trình duyệt này?')) { localStorage.clear(); S = load(); render(); } break;
    default: practiceAct(a, el);
  }
});

app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  const a = el.dataset.act; if (!a) return;
  switch (a) {
    case 'check': S.checks[el.dataset.key!] = (el as HTMLInputElement).checked; persist(); render(); break;
    case 'final': S.finalTest[el.dataset.i!] = (el as HTMLInputElement).checked; persist(); render(); break;
    case 'start': if (el.value) { S.start = el.value; persist(); render(); } break;
    case 'pside': play = newPlay(el.value as Color, play.level); render(); void engineTurn(); break;
    case 'plevel': play.level = Number(el.value); break;
    case 'rside': if (review) { review.side = el.value as 'red' | 'black'; render(); } break;
    case 'iside': impSide = el.value as 'red' | 'black'; break;
    case 'ires': impResult = el.value as 'win' | 'loss' | 'draw'; break;
    case 'pf-level': case 'pf-source': case 'pf-week': case 'gentarget': case 'genwant': practiceChange(a, el); break;
    case 'import': {
      const f = (el as HTMLInputElement).files?.[0]; if (!f) break;
      f.text().then((txt) => { try { S = importJson(txt); persist(); toast = ''; render(); } catch (e) { alert(e instanceof Error ? e.message : 'Lỗi'); } });
      break;
    }
  }
});

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target as HTMLFormElement; const fd = new FormData(f);
  if (f.dataset.form === 'err') {
    S.errors.unshift({ id: uid(), date: todayStr(), type: String(fd.get('type')), note: String(fd.get('note')) }); persist(); render();
  } else if (f.dataset.form === 'metric') {
    const key = f.dataset.key as 'puzzle' | 'elo';
    S.metrics[key].push({ date: String(fd.get('date')), v: Number(fd.get('v')) });
    S.metrics[key].sort((a, b) => a.date.localeCompare(b.date)); persist(); render();
  }
});

app.addEventListener('input', (ev) => { const el = ev.target as HTMLElement; if (el.id === 'imptext') impText = (el as HTMLTextAreaElement).value; });

void moveToUcci; void cpOf;
initPractice({ S: () => S, persist, render, esc, today: todayStr, weekIndex: () => progressInfo().week, ensureEngine, engLine: () => engMsg, engReady: () => engStatus === 'ready', isActive: () => tab === 'practice' });
render();

// Công cụ kiểm tra (chỉ bật khi thêm ?debug vào URL): chạy tàn cuộc tự đấu để xác định kết quả mong đợi.
if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>).__xq = { playOut, ENDGAMES };
