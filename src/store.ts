export interface ErrorEntry { id: string; date: string; type: string; note: string; fen?: string }
export interface GameEntry {
  id: string; date: string; side: 'red' | 'black'; result: 'win' | 'loss' | 'draw';
  hang: boolean; note: string; mv: string; fen0?: string; acc?: number;
}
export interface Metric { date: string; v: number }
export type Level5 = 1 | 2 | 3 | 4 | 5;
/** Bài luyện tập. solution[0] là nước của người giải, solution[1] là nước đáp lại của máy, … */
export interface Puzzle {
  id: string; fen: string; solution: string[]; alts: string[];
  source: 'game' | 'gen'; kind: 'mate' | 'tactic' | 'loss'; mateIn?: number;
  gap: number; recDepth: number; score: number; level: Level5;
  created: string; gameId?: string; ply?: number; note?: string;
}
export interface Attempt { pid: string; date: string; ok: boolean; secs: number; shown?: boolean }
export interface State {
  start: string;
  checks: Record<string, boolean>;
  errors: ErrorEntry[];
  games: GameEntry[];
  metrics: { puzzle: Metric[]; elo: Metric[] };
  finalTest: Record<string, boolean>;
  puzzles: Puzzle[];
  attempts: Attempt[];
}

const KEY = 'xiangqi-improvement.v1';
const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function fresh(): State {
  return { start: ymd(new Date()), checks: {}, errors: [], games: [], metrics: { puzzle: [], elo: [] }, finalTest: {}, puzzles: [], attempts: [] };
}

export function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch { /* corrupt or unavailable storage */ }
  return fresh();
}

export function save(s: State): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}

export function exportJson(s: State): string { return JSON.stringify({ app: 'xiangqi-improvement', v: 1, data: s }, null, 2); }

export function importJson(text: string): State {
  const j = JSON.parse(text);
  const d = j && j.data ? j.data : j;
  if (!d || typeof d.start !== 'string' || !Array.isArray(d.games) || !Array.isArray(d.errors)) throw new Error('File sao lưu không hợp lệ');
  return { ...fresh(), ...d };
}
