import assert from 'node:assert/strict';
import { mergeState, normalize, stable, syncable, ATTEMPT_CAP } from '../src/merge';
import { runSync, SyncController, type SyncBackend, type Row, type WriteResult } from '../src/sync';
import type { State } from '../src/store';

const mk = (o: Partial<State> = {}): State => normalize({ start: '2026-11-01', ...o });
const err = (id: string, type = 'Khai cuộc', date = '2026-11-02') => ({ id, date, type, note: id });
const game = (id: string, date = '2026-11-02') => ({ id, date, side: 'red' as const, result: 'win' as const, hang: false, note: id, mv: '' });
const pz = (id: string) => ({ id, fen: 'x', solution: [], alts: [], source: 'gen' as const, kind: 'mate' as const, gap: 0, recDepth: 1, score: 1, level: 1 as const, created: '2026-11-01' });
const ids = (a: { id: string }[]) => a.map((x) => x.id).sort();
let n = 0; const t = (name: string, f: () => void | Promise<void>) => { n++; return Promise.resolve(f()).then(() => console.log('ok  ', name)); };

(async () => {
await t('thêm ở hai thiết bị → hợp lại', () => {
  const base = mk({ errors: [err('a')] });
  const m = mergeState(base, mk({ errors: [err('b'), err('a')] }), mk({ errors: [err('c'), err('a')] }));
  assert.deepEqual(ids(m.errors), ['a', 'b', 'c']);
});
await t('xóa ở một thiết bị → bị xóa', () => {
  const base = mk({ errors: [err('a'), err('b')], games: [game('g')] });
  const m = mergeState(base, mk({ errors: [err('b')], games: [game('g')] }), mk({ errors: [err('a'), err('b')], games: [] }));
  assert.deepEqual(ids(m.errors), ['b']); assert.deepEqual(ids(m.games), []);
});
await t('sửa ở remote, local không đổi → lấy remote', () => {
  const base = mk({ errors: [err('a', 'Khai cuộc')] });
  const m = mergeState(base, base, mk({ errors: [err('a', 'Tàn cuộc')] }));
  assert.equal(m.errors[0].type, 'Tàn cuộc');
});
await t('cả hai sửa → local thắng; local sửa, remote không → local', () => {
  const base = mk({ errors: [err('a', 'Khai cuộc')] });
  assert.equal(mergeState(base, mk({ errors: [err('a', 'Hết giờ')] }), mk({ errors: [err('a', 'Tàn cuộc')] })).errors[0].type, 'Hết giờ');
  assert.equal(mergeState(base, mk({ errors: [err('a', 'Hết giờ')] }), base).errors[0].type, 'Hết giờ');
});
await t('thứ tự khóa jsonb khác nhau không gây xung đột giả', () => {
  assert.equal(stable({ a: 1, b: { c: 2, d: 3 } }), stable({ b: { d: 3, c: 2 }, a: 1 }));
});
await t('checks/finalTest/start ba chiều', () => {
  const base = mk({ checks: { x: true, y: true }, finalTest: { 0: true } });
  const local = mk({ checks: { x: true, y: true, z: true }, finalTest: { 0: true } });          // local thêm z
  const remote = mk({ checks: { x: false, y: true }, finalTest: { 0: true }, start: '2026-11-05' }); // remote bỏ x, đổi start
  const m = mergeState(base, local, remote);
  assert.deepEqual(m.checks, { x: false, y: true, z: true }); assert.equal(m.start, '2026-11-05');
});
await t('xóa bài → attempts của bài đó bị bỏ, eg: giữ nguyên', () => {
  const at = (pid: string) => ({ pid, date: '2026-11-03', ok: true, secs: 9 });
  const base = mk({ puzzles: [pz('p1'), pz('p2')], attempts: [at('p1'), at('p2'), at('eg:1')] });
  const local = mk({ puzzles: [pz('p2')], attempts: [at('p2'), at('eg:1')] });
  const m = mergeState(base, local, base);
  assert.deepEqual(ids(m.puzzles), ['p2']); assert.deepEqual(m.attempts.map((a) => a.pid).sort(), ['eg:1', 'p2']);
});
await t('attempts trùng nhau được giữ đủ số lần; hợp hai thiết bị; giới hạn 2000', () => {
  const at = (secs: number, date = '2026-11-03') => ({ pid: 'p', date, ok: true, secs });
  const base = mk({ attempts: [at(5), at(5)] });
  const m = mergeState(base, mk({ attempts: [at(5), at(5), at(6)] }), mk({ attempts: [at(5), at(5), at(7)] }));
  assert.equal(m.attempts.length, 4);
  const many = mk({ attempts: Array.from({ length: ATTEMPT_CAP + 50 }, (_, i) => ({ pid: 'p', date: '2026-11-03', ok: true, secs: i })) });
  assert.equal(mergeState(null, many, mk()).attempts.length, ATTEMPT_CAP);
});
await t('metrics hợp theo date|v, placementDraft không đồng bộ', () => {
  const draft = { id: 'd' } as unknown as State['placementDraft'];
  const m = mergeState(null, mk({ metrics: { puzzle: [{ date: '2026-11-02', v: 50 }], elo: [] }, placementDraft: draft }), mk({ metrics: { puzzle: [{ date: '2026-11-01', v: 40 }], elo: [] } }));
  assert.deepEqual(m.metrics.puzzle.map((x) => x.v), [40, 50]); assert.equal(m.placementDraft, draft);
  assert.equal('placementDraft' in syncable(m), false);
});

/* ---------- Mô phỏng hai thiết bị với backend giả ---------- */
class FakeDb {
  row: Row | null = null; down = false; failNextWrites = 0; interfere: (() => void) | null = null;
  backend: SyncBackend = {
    fetch: async () => { if (this.down) throw new Error('Mất mạng'); return this.row ? { data: JSON.parse(JSON.stringify(this.row.data)), rev: this.row.rev } : null; },
    write: async (data, exp): Promise<WriteResult> => {
      if (this.down) throw new Error('Mất mạng');
      if (this.interfere) { const f = this.interfere; this.interfere = null; f(); }
      if (this.failNextWrites > 0) { this.failNextWrites--; return { ok: false }; }
      if (exp === null) { if (this.row) return { ok: false }; this.row = { data: JSON.parse(JSON.stringify(data)), rev: 1 }; return { ok: true, rev: 1 }; }
      if (!this.row || this.row.rev !== exp) return { ok: false };
      this.row = { data: JSON.parse(JSON.stringify(data)), rev: exp + 1 }; return { ok: true, rev: exp + 1 };
    },
  };
}
class Device {
  S: State; base: State | null = null; renders = 0;
  constructor(public db: FakeDb, init: Partial<State> = {}) { this.S = mk(init); }
  deps() { return { backend: this.db.backend, getState: () => this.S, applyState: (s: State) => { Object.assign(this.S, s); this.renders++; }, loadBase: () => this.base, saveBase: (s: State | null) => { this.base = s ? JSON.parse(JSON.stringify(s)) : null; } }; }
  sync(force = false) { return runSync(this.deps(), { force }); }
}

await t('thiết bị mới rỗng lấy nguyên dữ liệu remote', async () => {
  const db = new FakeDb(); const A = new Device(db, { errors: [err('a')], games: [game('g')], start: '2026-10-20' });
  await A.sync(); const B = new Device(db, { start: '2026-11-16' }); await B.sync();
  assert.deepEqual(ids(B.S.errors), ['a']); assert.equal(B.S.start, '2026-10-20');
});
await t('hai thiết bị cùng có dữ liệu lần đầu → hợp nhất, local thắng', async () => {
  const db = new FakeDb(); const A = new Device(db, { errors: [err('a')] }); await A.sync();
  const B = new Device(db, { errors: [err('b')] }); await B.sync(); await A.sync();
  assert.deepEqual(ids(A.S.errors), ['a', 'b']); assert.deepEqual(ids(B.S.errors), ['a', 'b']);
});
await t('chuỗi sửa/xóa qua lại giữa hai thiết bị hội tụ', async () => {
  const db = new FakeDb(); const A = new Device(db, { errors: [err('a'), err('b')] }); await A.sync();
  const B = new Device(db); await B.sync();
  A.S.errors = A.S.errors.filter((e) => e.id !== 'a'); B.S.errors.push(err('c')); B.S.checks['k'] = true;
  await A.sync(); await B.sync(); await A.sync();
  assert.deepEqual(ids(A.S.errors), ['b', 'c']); assert.deepEqual(ids(B.S.errors), ['b', 'c']); assert.equal(A.S.checks['k'], true);
});
await t('xung đột rev khi ghi → đọc lại, hợp nhất lại, không mất dữ liệu', async () => {
  const db = new FakeDb(); const A = new Device(db, { errors: [err('a')] }); await A.sync();
  const B = new Device(db); await B.sync(); B.S.errors.push(err('b'));
  A.S.errors.push(err('c'));
  db.interfere = () => { db.row = { data: JSON.parse(JSON.stringify({ ...A.S, errors: [err('a'), err('x')] })), rev: db.row!.rev + 1 }; };
  await A.sync(); // gặp ghi chen ngang → thử lại
  assert.deepEqual(ids(A.S.errors), ['a', 'c', 'x']);
  await B.sync(); await A.sync(); assert.deepEqual(ids(B.S.errors), ids(A.S.errors));
});
await t('xung đột liên tục 3 lần → báo lỗi, dữ liệu cục bộ còn nguyên', async () => {
  const db = new FakeDb(); const A = new Device(db, { errors: [err('a')] }); await A.sync();
  A.S.errors.push(err('b')); db.failNextWrites = 3;
  await assert.rejects(() => A.sync(), /Xung đột/); assert.deepEqual(ids(A.S.errors), ['a', 'b']);
  await A.sync(); assert.deepEqual(ids((db.row!.data as State).errors), ['a', 'b']);
});
await t('mất mạng → lỗi, không mất dữ liệu; có mạng lại → đẩy lên', async () => {
  const db = new FakeDb(); const A = new Device(db, { errors: [err('a')] }); await A.sync();
  A.S.errors.push(err('b')); db.down = true;
  await assert.rejects(() => A.sync(), /Mất mạng`?/); assert.equal(A.S.errors.length, 2);
  db.down = false; await A.sync(); assert.deepEqual(ids((db.row!.data as State).errors), ['a', 'b']);
});
await t('sửa cục bộ trong lúc đang chờ mạng không bị ghi đè', async () => {
  const db = new FakeDb(); const A = new Device(db, { errors: [err('a')] }); await A.sync();
  const B = new Device(db); await B.sync(); B.S.errors.push(err('b')); await B.sync();
  A.S.errors.push(err('c'));
  db.interfere = () => { A.S.errors.push(err('mid')); };
  const r = await A.sync();
  assert.deepEqual(ids(A.S.errors), ['a', 'b', 'c', 'mid']); assert.equal(r.needAnother, true);
  await A.sync(); assert.ok(ids((db.row!.data as State).errors).includes('mid'));
});
await t('không đổi gì → không ghi, không render lại', async () => {
  const db = new FakeDb(); const A = new Device(db, { errors: [err('a')] }); await A.sync();
  const rev = db.row!.rev, rc = A.renders; const r = await A.sync();
  assert.equal(db.row!.rev, rev); assert.equal(A.renders, rc); assert.equal(r.pushed, false);
});
await t('ghi đè bắt buộc sau nhập JSON (force) thay thế dữ liệu remote', async () => {
  const db = new FakeDb(); const A = new Device(db, { errors: [err('a'), err('b')] }); await A.sync();
  const B = new Device(db); await B.sync();
  B.S = mk({ errors: [err('z')] }); await B.sync(true); await A.sync();
  assert.deepEqual(ids(A.S.errors), ['z']);
});
await t('placementDraft không bị đẩy lên và không bị ghi đè', async () => {
  const db = new FakeDb(); const A = new Device(db, { errors: [err('a')] }); A.S.placementDraft = { id: 'draft' } as never; await A.sync();
  assert.equal('placementDraft' in (db.row!.data as object), false);
  const B = new Device(db); await B.sync(); assert.equal(B.S.placementDraft, null); assert.equal((A.S.placementDraft as never as { id: string }).id, 'draft');
});

/* ---------- Bộ điều khiển: debounce, hoãn khi bận, tránh vòng lặp ---------- */
await t('controller: debounce gộp nhiều lần lưu, hoãn khi bận, offline báo lỗi', async () => {
  const db = new FakeDb(); const D = new Device(db, { errors: [err('a')] });
  const timers: { fn: () => void; ms: number; dead?: boolean }[] = [];
  let busy = false, online = true, signedIn = true;
  const c = new SyncController({
    makeDeps: () => (signedIn ? D.deps() : null), isOnline: () => online, isBusy: () => busy, now: () => 1,
    setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; }, clearTimer: (h) => { (h as { dead?: boolean }).dead = true; },
  }, 3000);
  c.schedule(); c.schedule(); c.schedule();
  assert.equal(timers.filter((x) => !x.dead).length, 1);
  busy = true; timers.find((x) => !x.dead)!.fn(); await Promise.resolve();
  assert.equal(db.row, null); // đang bận → chưa đồng bộ
  busy = false; await c.syncNow(); assert.equal(c.status, 'ok'); assert.ok(db.row);
  online = false; await c.syncNow(); assert.equal(c.status, 'error');
  online = true; signedIn = false; await c.syncNow(); assert.equal(c.status, 'signedout');
});

console.log(`\n${n} test đều qua`);
})().catch((e) => { console.error('THẤT BẠI:', e); process.exit(1); });
