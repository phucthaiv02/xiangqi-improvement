-- Chạy file này một lần trong Supabase → SQL Editor.
-- Mỗi người dùng một hàng; toàn bộ dữ liệu app nằm trong cột jsonb `data`.
create table if not exists public.user_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null,
  rev        bigint      not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

drop policy if exists "user_data_select_own" on public.user_data;
drop policy if exists "user_data_insert_own" on public.user_data;
drop policy if exists "user_data_update_own" on public.user_data;
drop policy if exists "user_data_delete_own" on public.user_data;

create policy "user_data_select_own" on public.user_data for select to authenticated using (auth.uid() = user_id);
create policy "user_data_insert_own" on public.user_data for insert to authenticated with check (auth.uid() = user_id);
create policy "user_data_update_own" on public.user_data for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_data_delete_own" on public.user_data for delete to authenticated using (auth.uid() = user_id);

-- Người dùng chưa đăng nhập (vai trò anon) không có quyền gì với bảng này.
revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;
