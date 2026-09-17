create extension if not exists "pgcrypto";

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 120),
  details text check (char_length(details) <= 1000),
  status text not null default 'pending' check (status in ('pending','reviewed','resolved','dismissed')),
  created_at timestamptz not null default now(),
  check (reporter_id <> reported_id)
);

create index if not exists idx_reports_reporter on public.reports(reporter_id);
create index if not exists idx_reports_reported on public.reports(reported_id);
create index if not exists idx_reports_status on public.reports(status);

alter table public.reports enable row level security;

drop policy if exists "own reports insert" on public.reports;
create policy "own reports insert" on public.reports
  for insert to authenticated with check (auth.uid() = reporter_id);

drop policy if exists "own reports select" on public.reports;
create policy "own reports select" on public.reports
  for select to authenticated using (auth.uid() = reporter_id);
