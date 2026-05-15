-- ---------------------------------------------------------------
-- Budget — Supabase schema
-- ---------------------------------------------------------------
-- One row per user holding the entire budget JSON document.
-- Single-document storage keeps the client simple and survives
-- future schema changes in the app without DB migrations.
--
-- Run this once in Supabase → SQL Editor → "New query".
-- ---------------------------------------------------------------

create table if not exists public.budgets (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create or replace function public.touch_budgets_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_budgets_touch on public.budgets;
create trigger trg_budgets_touch
before update on public.budgets
for each row execute function public.touch_budgets_updated_at();

-- Row Level Security: each user can only read/write their own row.
alter table public.budgets enable row level security;

drop policy if exists "Read own budget"   on public.budgets;
drop policy if exists "Insert own budget" on public.budgets;
drop policy if exists "Update own budget" on public.budgets;
drop policy if exists "Delete own budget" on public.budgets;

create policy "Read own budget"
  on public.budgets for select
  using (auth.uid() = user_id);

create policy "Insert own budget"
  on public.budgets for insert
  with check (auth.uid() = user_id);

create policy "Update own budget"
  on public.budgets for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Delete own budget"
  on public.budgets for delete
  using (auth.uid() = user_id);
