// Giao thức đồng bộ, tách khỏi Supabase để test được bằng backend giả.
import type { State } from './store';
import { isEmptyState, mergeState, normalize, stable, syncable } from './merge';

export interface Row { data: unknown; rev: number }
export type WriteResult = { ok: true; rev: number } | { ok: false };

export interface SyncBackend {
  /** Đọc hàng của người dùng; null nếu chưa có. */
  fetch(): Promise<Row | null>;
  /** expectedRev = null: chèn mới (thất bại nếu đã có). Ngược lại: cập nhật nếu rev còn khớp. */
  write(data: unknown, expectedRev: number | null): Promise<WriteResult>;
}

export interface SyncDeps {
  backend: SyncBackend;
  getState(): State;
  /** Áp dữ liệu đã hợp nhất vào trạng thái hiện tại (không được kích hoạt đẩy lại). */
  applyState(s: State): void;
  loadBase(): State | null;
  saveBase(s: State | null): void;
}

export interface SyncResult { pushed: boolean; applied: boolean; needAnother: boolean }

const MAX_TRIES = 3;

function withDraft(s: State, local: State): State { return { ...s, placementDraft: local.placementDraft }; }

/** Một lượt đồng bộ. force = ghi đè bản trên máy chủ bằng dữ liệu cục bộ (dùng sau khi nhập JSON). */
export async function runSync(deps: SyncDeps, opts: { force?: boolean } = {}): Promise<SyncResult> {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const row = await deps.backend.fetch();
    const local = normalize(deps.getState());
    const snapshotState = normalize(JSON.parse(JSON.stringify(local)));
    const snapshot = stable(syncable(snapshotState));
    let merged: State;

    if (!row) merged = local;
    else {
      const remote = normalize(row.data);
      if (opts.force) merged = local;
      else {
        const base = deps.loadBase();
        merged = !base && isEmptyState(local) ? withDraft(remote, local) : mergeState(base, local, remote);
      }
    }

    const out = syncable(merged);
    const remoteSame = row ? stable(syncable(normalize(row.data))) === stable(out) : false;
    if (!remoteSame) {
      const res = await deps.backend.write(out, row ? row.rev : null);
      if (!res.ok) continue; // người khác vừa ghi: đọc lại rồi hợp nhất lại
    }

    // Trong lúc chờ mạng, người dùng có thể đã sửa dữ liệu: giữ phần sửa đó và hẹn đẩy lại.
    const now = normalize(deps.getState());
    let finalState = merged;
    let needAnother = false;
    if (stable(syncable(now)) !== snapshot) {
      // Phần người dùng sửa trong lúc chờ = (now so với bản chụp); hợp nhất vào kết quả đã ghi.
      finalState = mergeState(snapshotState, now, merged);
      needAnother = true;
    }
    const changed = stable(syncable(finalState)) !== stable(syncable(now));
    deps.saveBase(out as unknown as State);
    if (changed) deps.applyState(withDraft(finalState, now));
    return { pushed: !remoteSame, applied: changed, needAnother };
  }
  throw new Error('Xung đột khi đồng bộ, sẽ thử lại.');
}

/* ---------------- Bộ điều khiển (debounce, lặp, trạng thái) ---------------- */

export type SyncStatus = 'off' | 'signedout' | 'idle' | 'syncing' | 'ok' | 'error';

export interface ControllerEnv {
  /** Trả về deps khi đã đăng nhập; null nếu chưa. */
  makeDeps(): SyncDeps | null;
  isOnline(): boolean;
  /** true khi nên hoãn (ví dụ máy đang nghĩ nước). */
  isBusy(): boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
}

export class SyncController {
  status: SyncStatus = 'idle';
  lastAt: number | null = null;
  error = '';
  private timer: unknown = null;
  private running = false;
  private again: { force: boolean } | null = null;
  private listeners: (() => void)[] = [];
  constructor(private env: ControllerEnv, private debounceMs = 3000) {}

  onChange(fn: () => void) { this.listeners.push(fn); }
  private emit() { this.listeners.forEach((f) => f()); }
  private set(s: SyncStatus, err = '') { this.status = s; this.error = err; this.emit(); }

  /** Gọi sau mỗi lần lưu cục bộ. */
  schedule() {
    if (!this.env.makeDeps()) return;
    if (this.timer) this.env.clearTimer(this.timer);
    this.timer = this.env.setTimer(() => { this.timer = null; void this.syncNow(); }, this.debounceMs);
  }

  async syncNow(opts: { force?: boolean } = {}): Promise<void> {
    if (this.timer) { this.env.clearTimer(this.timer); this.timer = null; }
    const deps = this.env.makeDeps();
    if (!deps) { this.set('signedout'); return; }
    if (!this.env.isOnline()) { this.set('error', 'Đang ngoại tuyến'); return; }
    if (this.env.isBusy()) { this.timer = this.env.setTimer(() => { this.timer = null; void this.syncNow(opts); }, 5000); return; }
    if (this.running) { this.again = { force: Boolean(opts.force || this.again?.force) }; return; }
    this.running = true; this.set('syncing');
    try {
      const r = await runSync(deps, opts);
      this.lastAt = this.env.now();
      this.set('ok');
      if (r.needAnother) this.again = { force: false };
    } catch (e) {
      this.set('error', e instanceof Error ? e.message : 'Lỗi không rõ');
      this.timer = this.env.setTimer(() => { this.timer = null; void this.syncNow(); }, 30000);
    } finally {
      this.running = false;
    }
    if (this.again) { const a = this.again; this.again = null; await this.syncNow(a); }
  }
}
