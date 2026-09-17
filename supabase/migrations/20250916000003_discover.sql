create extension if not exists "pgcrypto";

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create table if not exists public.passes (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a_id <> user_b_id),
  check (user_a_id < user_b_id),
  unique(user_a_id, user_b_id)
);

create index if not exists idx_likes_from on public.likes(from_user_id);
create index if not exists idx_likes_to on public.likes(to_user_id);
create index if not exists idx_passes_from on public.passes(from_user_id);
create index if not exists idx_passes_to on public.passes(to_user_id);
create index if not exists idx_blocks_blocker on public.blocks(blocker_id);
create index if not exists idx_blocks_blocked on public.blocks(blocked_id);
create index if not exists idx_matches_user_a on public.matches(user_a_id);
create index if not exists idx_matches_user_b on public.matches(user_b_id);

alter table public.likes enable row level security;
alter table public.passes enable row level security;
alter table public.blocks enable row level security;
alter table public.matches enable row level security;

drop policy if exists "own likes select" on public.likes;
create policy "own likes select" on public.likes for select to authenticated using (auth.uid() = from_user_id or auth.uid() = to_user_id);

drop policy if exists "own likes insert" on public.likes;
create policy "own likes insert" on public.likes for insert to authenticated with check (auth.uid() = from_user_id);

drop policy if exists "own passes select" on public.passes;
create policy "own passes select" on public.passes for select to authenticated using (auth.uid() = from_user_id);

drop policy if exists "own passes insert" on public.passes;
create policy "own passes insert" on public.passes for insert to authenticated with check (auth.uid() = from_user_id);

drop policy if exists "own blocks select" on public.blocks;
create policy "own blocks select" on public.blocks for select to authenticated using (auth.uid() = blocker_id or auth.uid() = blocked_id);

drop policy if exists "own blocks insert" on public.blocks;
create policy "own blocks insert" on public.blocks for insert to authenticated with check (auth.uid() = blocker_id);

drop policy if exists "own blocks delete" on public.blocks;
create policy "own blocks delete" on public.blocks for delete to authenticated using (auth.uid() = blocker_id);

drop policy if exists "own matches select" on public.matches;
create policy "own matches select" on public.matches for select to authenticated using (auth.uid() = user_a_id or auth.uid() = user_b_id);

drop policy if exists "own matches insert" on public.matches;
create policy "own matches insert" on public.matches for insert to authenticated with check (auth.uid() = user_a_id or auth.uid() = user_b_id);


create or replace function public.create_match_if_mutual()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_exists boolean;
  v_a uuid;
  v_b uuid;
begin
  select exists(select 1 from public.likes where from_user_id = NEW.to_user_id and to_user_id = NEW.from_user_id) into v_exists;
  if v_exists then
    v_a := least(NEW.from_user_id, NEW.to_user_id);
    v_b := greatest(NEW.from_user_id, NEW.to_user_id);
    insert into public.matches (user_a_id, user_b_id) values (v_a, v_b) on conflict (user_a_id, user_b_id) do nothing;
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_likes_match on public.likes;
create trigger trg_likes_match after insert on public.likes for each row execute function public.create_match_if_mutual();
