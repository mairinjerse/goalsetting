-- Waypoint database schema.
--
-- Run this once in your Supabase project's SQL editor (Project -> SQL Editor -> New query).
-- It creates one table per entity in the app (goals, metrics, habits, milestones, contacts),
-- all scoped to the signed-in user via Row Level Security, so each user can only ever
-- see and modify their own rows -- Supabase's anon key alone grants no access.

create extension if not exists "pgcrypto";

create table if not exists public.goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  emoji       text not null default '🎯',
  name        text not null,
  target_date date,
  why         text not null default '',
  identity    text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.metrics (
  id       uuid primary key default gen_random_uuid(),
  goal_id  uuid not null references public.goals(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  name     text not null,
  unit     text not null default '',
  target   numeric not null default 0,
  current  numeric not null default 0
);

create table if not exists public.habits (
  id       uuid primary key default gen_random_uuid(),
  goal_id  uuid not null references public.goals(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  name     text not null,
  cadence  text not null default 'Daily',
  log      jsonb not null default '{}'::jsonb,
  best     integer not null default 0
);

create table if not exists public.milestones (
  id       uuid primary key default gen_random_uuid(),
  goal_id  uuid not null references public.goals(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  name     text not null,
  done     boolean not null default false
);

create table if not exists public.contacts (
  id              uuid primary key default gen_random_uuid(),
  goal_id         uuid not null references public.goals(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  category        text not null default 'Network',
  notes           text not null default '',
  reached_out_at  date,
  meeting_at      date,
  created_at      timestamptz not null default now()
);

create index if not exists metrics_goal_id_idx    on public.metrics(goal_id);
create index if not exists habits_goal_id_idx     on public.habits(goal_id);
create index if not exists milestones_goal_id_idx on public.milestones(goal_id);
create index if not exists contacts_goal_id_idx   on public.contacts(goal_id);
create index if not exists goals_user_id_idx      on public.goals(user_id);

alter table public.goals      enable row level security;
alter table public.metrics    enable row level security;
alter table public.habits     enable row level security;
alter table public.milestones enable row level security;
alter table public.contacts   enable row level security;

create policy "own rows" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.metrics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.milestones
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.contacts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
