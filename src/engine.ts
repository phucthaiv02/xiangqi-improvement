import workerUrl from 'pikafish-js/engine.worker.js?url';
import { createEngine, type PikafishEngine, type AnalysisInfo, type NetProgress } from 'pikafish-js';

interface Manifest {
  engines: Record<string, { label: string; builds: Record<string, { js: string; wasm: string }>; net: { url: string; size: number; sha256: string } }>;
}

export interface Level { name: string; depth: number; movetime: number }
export const LEVELS: Level[] = [
  { name: 'Nhập môn · độ sâu 1', depth: 1, movetime: 150 },
  { name: 'Dễ · độ sâu 3', depth: 3, movetime: 300 },
  { name: 'Trung bình · độ sâu 5', depth: 5, movetime: 600 },
  { name: 'Khá · độ sâu 8', depth: 8, movetime: 1200 },
  { name: 'Mạnh · độ sâu 12', depth: 12, movetime: 2500 },
  { name: 'Rất mạnh · độ sâu 16', depth: 16, movetime: 5000 },
];

let enginePromise: Promise<PikafishEngine> | null = null;
export let engineLabel = '';

export function getEngine(onProgress?: (p: NetProgress) => void, variant = 'lite'): Promise<PikafishEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      if (!crossOriginIsolated) throw new Error('Trang chưa ở chế độ cross-origin isolated (cần header COOP/COEP). Thử tải lại trang.');
      const res = await fetch(new URL('engine/engine.json', document.baseURI));
      if (!res.ok) throw new Error('Thiếu public/engine (chạy `npm run fetch-engine`).');
      const man = (await res.json()) as Manifest;
      const variants: Record<string, never> = {} as never;
      for (const [name, spec] of Object.entries(man.engines)) {
        (variants as Record<string, unknown>)[name] = {
          builds: spec.builds,
          netUrl: new URL(spec.net.url, document.baseURI).href,
          netSha256: spec.net.sha256,
        };
      }
      const v = man.engines[variant] ? variant : Object.keys(man.engines)[0];
      engineLabel = man.engines[v].label;
      return createEngine({
        variants, variant: v,
        workerFactory: () => new Worker(workerUrl, { type: 'classic', name: 'pikafish' }),
        onNetProgress: onProgress,
      } as never);
    })();
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

/** Điểm (centipawn) theo góc nhìn bên đang đi; chiếu hết được quy về ±10000 − ply. */
export function cpOf(info: AnalysisInfo | null | undefined): number {
  const s = info?.score;
  if (!s) return 0;
  if (s.type === 'mate') return s.value > 0 ? 10000 - s.value : -10000 - s.value;
  return s.value;
}

export function fmtScore(info: AnalysisInfo | null | undefined): string {
  const s = info?.score;
  if (!s) return '–';
  if (s.type === 'mate') return `M${s.value}`;
  return (s.value >= 0 ? '+' : '') + (s.value / 100).toFixed(2);
}

export interface PosEval { bestmove: string; cp: number; pv: string[]; depth: number }

export async function evalPosition(fen: string, opts: { depth?: number; movetime?: number } = {}): Promise<PosEval> {
  const engine = await getEngine();
  const h = await engine.analyze({ fen, depth: opts.depth ?? 12, movetime: opts.movetime ?? 700 });
  const r = await h.result;
  return { bestmove: r.bestmove, cp: cpOf(r.lastInfo), pv: r.lastInfo?.pv ?? [], depth: r.lastInfo?.depth ?? 0 };
}
