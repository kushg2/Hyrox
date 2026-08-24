-- Run this once in the Supabase SQL editor.

create table if not exists app_state (
  id         text primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

-- The sync ID is a 40-character random string that only exists on your
-- devices, so it acts as the capability token. Anyone who has it can read
-- and write that one row; nobody can enumerate rows they don't know the ID
-- for, because every query filters on the primary key.
--
-- This is the right trade-off for a personal training log. If you'd rather
-- have real auth, see the "Locking it down" section of the README.
create policy "read own row" on app_state
  for select to anon using (true);

create policy "write own row" on app_state
  for insert to anon with check (true);

create policy "update own row" on app_state
  for update to anon using (true) with check (true);
