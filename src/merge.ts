// Hợp nhất ba chiều (base / local / remote) cho trạng thái app. Hàm thuần, không phụ thuộc trình duyệt.
import type { State } from './store';

/** JSON có khóa được sắp xếp, vì jsonb của Postgres không giữ thứ tự khóa. */
export function stable(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

export const ATTEMPT_CAP = 2000;

type Item = Record<string, unknown>;

/** Phần dữ liệu được đồng bộ (placementDraft chỉ ở máy này). */
export type Syncable = Omit<State, 'placementDraft'>;

export function syncable(s: State): Syncable {
  const { placementDraft: _draft, ...rest } = s;
  void _draft;
  return rest;
}

/** Điền giá trị mặc định cho dữ liệu cũ hoặc thiếu trường. */
export function normalize(x: unknown, fallbackStart = ''): State {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<State>;
  const m = (o.metrics ?? {}) as Partial<State['metrics']>;
  return {
    ...(o as State),
    start: typeof o.start === 'string' ? o.start : fallbackStart,
    checks: { ...(o.checks ?? {}) },
    errors: [...(o.errors ?? [])],
    games: [...(o.games ?? [])],
    metrics: { puzzle: [...(m.puzzle ?? [])], elo: [...(m.elo ?? [])] },
    finalTest: { ...(o.finalTest ?? {}) },
    puzzles: [...(o.puzzles ?? [])],
    attempts: [...(o.attempts ?? [])],
    placement: [...(o.placement ?? [])],
    placementDraft: o.placementDraft ?? null,
  };
}

export function isEmptyState(s: State): boolean {
  return !s.errors.length && !s.games.length && !s.puzzles.length && !s.attempts.length && !s.placement.length
    && !s.metrics.puzzle.length && !s.metrics.elo.length
    && !Object.keys(s.checks).length && !Object.keys(s.finalTest).length;
}

/**
 * Hợp nhất danh sách theo khóa.
 * - Mục có trong base mà thiếu ở local hoặc remote: đã bị xóa → bỏ.
 * - Mục có ở cả hai: lấy bản khác base; nếu cả hai đổi thì local thắng.
 * - Mục mới ở một phía: giữ.
 */
export function mergeList<T>(key: (x: T, i: number) => string, base: T[], local: T[], remote: T[]): T[] {
  const index = (a: T[]) => { const m = new Map<string, T>(); a.forEach((x, i) => m.set(key(x, i), x)); return m; };
  const b = index(base), l = index(local), r = index(remote);
  const ids: string[] = [...l.keys()];
  for (const id of r.keys()) if (!l.has(id)) ids.push(id);
  const out: T[] = [];
  for (const id of ids) {
    const inL = l.has(id), inR = r.has(id), inB = b.has(id);
    if (inB && (!inL || !inR)) continue;
    if (inL && inR) {
      const lv = l.get(id)!, rv = r.get(id)!;
      const ls = stable(lv);
      if (ls === stable(rv)) out.push(lv);
      else if (inB && ls === stable(b.get(id))) out.push(rv);
      else out.push(lv);
    } else out.push((inL ? l : r).get(id)!);
  }
  return out;
}

/** Hợp nhất ba chiều cho một giá trị (hoặc một khóa của map). Local thắng khi xung đột. */
export function mergeValue<T>(base: T | undefined, local: T | undefined, remote: T | undefined): T | undefined {
  const ls = stable(local), rs = stable(remote), bs = stable(base);
  if (ls === rs) return local;
  if (ls === bs) return remote;
  return local;
}

export function mergeMap<T>(base: Record<string, T>, local: Record<string, T>, remote: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const v = mergeValue(base[k], local[k], remote[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Khóa cho mục không có id: nội dung + số thứ tự lần xuất hiện (để giữ các lần trùng nhau). */
function occurrenceKeys<T>(items: T[], k: (x: T) => string): string[] {
  const seen = new Map<string, number>();
  return items.map((x) => { const base = k(x); const n = (seen.get(base) ?? 0) + 1; seen.set(base, n); return `${base}#${n}`; });
}

function mergeKeyless<T>(k: (x: T) => string, base: T[], local: T[], remote: T[]): T[] {
  type K = { x: T; id: string };
  const withKeys = (a: T[]): K[] => { const ks = occurrenceKeys(a, k); return a.map((x, i) => ({ x, id: ks[i] })); };
  return mergeList<K>((e) => e.id, withKeys(base), withKeys(local), withKeys(remote)).map((e) => e.x);
}

const byDateDesc = <T extends { date?: string }>(a: T[]) => [...a].sort((x, y) => String(y.date ?? '').localeCompare(String(x.date ?? '')));

export function mergeState(baseIn: State | null, localIn: State, remoteIn: State): State {
  const local = normalize(localIn), remote = normalize(remoteIn);
  const base = normalize(baseIn ?? {}, '');
  const id = (x: Item) => String(x.id);

  const puzzles = mergeList(id, base.puzzles as unknown as Item[], local.puzzles as unknown as Item[], remote.puzzles as unknown as Item[]) as unknown as State['puzzles'];
  const alive = new Set(puzzles.map((p) => p.id));
  const known = new Set([...base.puzzles, ...local.puzzles, ...remote.puzzles].map((p) => p.id));
  const removed = new Set([...known].filter((x) => !alive.has(x)));

  const akey = (a: State['attempts'][number]) => `${a.pid}|${a.date}|${a.secs}|${a.ok}`;
  let attempts = mergeKeyless(akey, base.attempts, local.attempts, remote.attempts).filter((a) => !removed.has(a.pid));
  attempts = [...attempts].sort((x, y) => x.date.localeCompare(y.date));
  if (attempts.length > ATTEMPT_CAP) attempts = attempts.slice(attempts.length - ATTEMPT_CAP);

  const mkey = (m: State['metrics']['puzzle'][number]) => `${m.date}|${m.v}`;
  const metric = (k: 'puzzle' | 'elo') => [...mergeKeyless(mkey, base.metrics[k], local.metrics[k], remote.metrics[k])].sort((a, b) => a.date.localeCompare(b.date));

  return {
    ...local,
    start: mergeValue(base.start || undefined, local.start, remote.start) ?? local.start,
    checks: mergeMap(base.checks, local.checks, remote.checks),
    finalTest: mergeMap(base.finalTest, local.finalTest, remote.finalTest),
    errors: byDateDesc(mergeList(id, base.errors as unknown as Item[], local.errors as unknown as Item[], remote.errors as unknown as Item[]) as unknown as State['errors']),
    games: byDateDesc(mergeList(id, base.games as unknown as Item[], local.games as unknown as Item[], remote.games as unknown as Item[]) as unknown as State['games']),
    placement: byDateDesc(mergeList(id, base.placement as unknown as Item[], local.placement as unknown as Item[], remote.placement as unknown as Item[]) as unknown as State['placement']),
    metrics: { puzzle: metric('puzzle'), elo: metric('elo') },
    puzzles,
    attempts,
    placementDraft: local.placementDraft,
  };
}
