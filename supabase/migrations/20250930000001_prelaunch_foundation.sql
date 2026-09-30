-- us STEP 1 pre-launch foundation: launch_config + username + #spot
-- Extends the existing architecture; replaces nothing.
-- launch_config is the single server-authoritative launch flag.
-- username / spot live on profiles (stable identity stays auth.users.id).

-- ============================================================
-- PART 1 — launch_config (singleton, server authoritative)
-- ============================================================
create table if not exists public.launch_config (
  id int primary key check (id = 1),
  launched boolean not null default false,
  launched_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.launch_config enable row level security;

-- Read-only for clients: SELECT for anon + authenticated (countdown display,
-- server helpers). No INSERT/UPDATE/DELETE policies => clients cannot modify.
drop policy if exists "launch config readable" on public.launch_config;
create policy "launch config readable" on public.launch_config
  for select to anon, authenticated using (true);

grant select on table public.launch_config to anon, authenticated;

drop trigger if exists trg_launch_config_updated on public.launch_config;
create trigger trg_launch_config_updated before update on public.launch_config
for each row execute function public.handle_updated_at();

insert into public.launch_config (id, launched, launched_at)
values (1, false, null)
on conflict (id) do nothing;

-- ============================================================
-- PART 7 — username architecture (public lookup key only)
-- ============================================================
-- Stable relational identity stays auth.users.id (profiles.user_id).
-- username is a nullable public handle for /u/[username], search, invites.
-- Nullable: existing rows predate username UI (built in a later slice).
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists spot int;

-- URL-safe handle: 3..30 chars, letters/digits/underscore only.
-- Case-insensitive uniqueness enforced by the lower() index below.
do $$ begin
  alter table public.profiles add constraint profiles_username_format
    check (username is null or username ~ '^[A-Za-z0-9_]{3,30}$');
exception when duplicate_object then null; end $$;

-- Case-insensitive uniqueness (NULLs ignored via partial index).
create unique index if not exists idx_profiles_username_lower
  on public.profiles (lower(username)) where username is not null;

-- ============================================================
-- PART 8 — permanent #spot (atomic, never COUNT(*))
-- ============================================================
-- Immutable campus registration number. Assigned once server-side,
-- survives logout/login, username changes, and profile edits.
do $$ begin
  alter table public.profiles add constraint profiles_spot_positive
    check (spot is null or spot > 0);
exception when duplicate_object then null; end $$;

create unique index if not exists idx_profiles_spot_unique
  on public.profiles (spot) where spot is not null;

-- Single-row allocator. Allocation is one atomic UPDATE (row lock),
-- so concurrent registrations can never receive the same spot.
create table if not exists public.campus_spot_allocator (
  id int primary key check (id = 1),
  next_spot int not null default 1 check (next_spot > 0)
);

alter table public.campus_spot_allocator enable row level security;
-- No policies and no grants: allocator is server-only. Allocation happens
-- exclusively through the SECURITY DEFINER function below.

insert into public.campus_spot_allocator (id, next_spot)
values (1, 1)
on conflict (id) do nothing;

create or replace function public.allocate_campus_spot()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_spot int;
begin
  update public.campus_spot_allocator
    set next_spot = next_spot + 1
    where id = 1
    returning next_spot - 1 into v_spot;
  return v_spot;
end; $$;

revoke all on table public.campus_spot_allocator from anon, authenticated;
-- Authenticated app users may allocate via the function only (atomic,
-- server-side). The allocator table itself stays unreachable.
grant execute on function public.allocate_campus_spot() to authenticated;
revoke execute on function public.allocate_campus_spot() from anon;
