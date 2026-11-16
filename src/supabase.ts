// Adapter Supabase: đăng nhập magic link và đọc/ghi một hàng user_data cho mỗi người dùng.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Row, SyncBackend, WriteResult } from './sync';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const syncConfigured = Boolean(url && anon);

let client: SupabaseClient | null = null;
export function getClient(): SupabaseClient | null {
  if (!syncConfigured) return null;
  client ??= createClient(url!, anon!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  return client;
}

export async function currentSession(): Promise<Session | null> {
  const c = getClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session;
}

export function onSession(fn: (s: Session | null) => void): void {
  getClient()?.auth.onAuthStateChange((_e, s) => fn(s));
}

export async function sendLoginLink(email: string): Promise<string | null> {
  const c = getClient();
  if (!c) return 'Chưa cấu hình Supabase.';
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> { await getClient()?.auth.signOut(); }

export function supabaseBackend(c: SupabaseClient, userId: string): SyncBackend {
  return {
    async fetch(): Promise<Row | null> {
      const { data, error } = await c.from('user_data').select('data, rev').eq('user_id', userId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { data: data.data, rev: Number(data.rev) } : null;
    },
    async write(data: unknown, expectedRev: number | null): Promise<WriteResult> {
      if (expectedRev === null) {
        const { error } = await c.from('user_data').insert({ user_id: userId, data, rev: 1 });
        if (!error) return { ok: true, rev: 1 };
        if (error.code === '23505') return { ok: false };
        throw new Error(error.message);
      }
      const { data: rows, error } = await c.from('user_data')
        .update({ data, rev: expectedRev + 1, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('rev', expectedRev).select('rev');
      if (error) throw new Error(error.message);
      return rows && rows.length ? { ok: true, rev: expectedRev + 1 } : { ok: false };
    },
  };
}
