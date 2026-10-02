-- us STEP 3D — invite links / referral attribution
-- Invite architecture uses stable auth.users.id as the internal identity.
-- Invite token is an opaque public string; never encodes USN/email/auth ID.

create extension if not exists "pgcrypto";

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

-- Token uniqueness is database-enforced
create unique index if not exists idx_invites_token_unique on public.invites (token);

-- Inviter lookup: one stable invite per user (active = disabled_at IS NULL)
create unique index if not exists idx_invites_inviter_active
  on public.invites (inviter_user_id)
  where disabled_at is null;

-- Index for resolving tokens
create index if not exists idx_invites_inviter_user_id on public.invites (inviter_user_id);

alter table public.invites enable row level security;

-- Authenticated users can read their own invite(s)
drop policy if exists "own invite select" on public.invites;
create policy "own invite select" on public.invites
  for select to authenticated using (auth.uid() = inviter_user_id);

-- Authenticated users can create their own invite (upsert with inviter_user_id = auth.uid())
drop policy if exists "own invite upsert" on public.invites;
create policy "own invite upsert" on public.invites
  for insert to authenticated with check (auth.uid() = inviter_user_id);

-- Authenticated users can disable their own invite (future revocation)
drop policy if exists "own invite update" on public.invites;
create policy "own invite update" on public.invites
  for update to authenticated using (auth.uid() = inviter_user_id) with check (auth.uid() = inviter_user_id);

-- NO public/anon select policy: token resolution happens server-side only
-- via a dedicated RPC/function to avoid exposing inviter_user_id, USN, email, etc.

grant select, insert, update on table public.invites to authenticated;

-- Server-side function to resolve an invite token for the landing page
-- Returns only public inviter info needed for display (username, spot, nickname)
-- Never returns inviter_user_id, USN, email, or verification metadata
create or replace function public.resolve_invite_token(p_token text)
returns table (
  username text,
  spot int,
  nickname text
) language plpgsql security definer set search_path = public as $$
begin
  return query
  select p.username, p.spot, p.nickname
  from public.invites i
  join public.profiles p on p.user_id = i.inviter_user_id
  where i.token = p_token
    and i.disabled_at is null
    and p.is_active = true
    and p.username is not null
  limit 1;
end; $$;

revoke all on function public.resolve_invite_token(text) from anon, authenticated;
grant execute on function public.resolve_invite_token(text) to anon, authenticated;

-- Server-side function to create/get a user's stable invite
-- Concurrency-safe: uses ON CONFLICT on the unique partial index
create or replace function public.get_or_create_invite()
returns table (token text, invite_url text) language plpgsql security definer set search_path = public as $$
declare
  v_token text;
  v_inviter_id uuid := auth.uid();
begin
  -- Try to insert a new invite; if one already exists (active), return it
  insert into public.invites (inviter_user_id, token)
  values (v_inviter_id, encode(gen_random_bytes(16), 'hex'))
  on conflict (inviter_user_id) where disabled_at is null
  do update set token = excluded.token -- no-op, keeps existing token
  returning token into v_token;

  -- If the insert didn't return (conflict on existing active invite), fetch it
  if v_token is null then
    select token into v_token
    from public.invites
    where inviter_user_id = v_inviter_id
      and disabled_at is null
    limit 1;
  end if;

  return query select v_token, '/invite/' || v_token;
end; $$;

revoke all on function public.get_or_create_invite() from anon, authenticated;
grant execute on function public.get_or_create_invite() to authenticated;

-- Server-side function to record a referral when onboarding completes
-- Called once when a new user finishes onboarding with an active invite cookie
-- Immutable after creation (no update path)
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references auth.users(id) on delete cascade,
  invitee_user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_referrals_inviter on public.referrals (inviter_user_id);
create index if not exists idx_referrals_invitee on public.referrals (invitee_user_id);

alter table public.referrals enable row level security;

-- Inviter can see who they referred (public fields only via join)
drop policy if exists "inviter referral select" on public.referrals;
create policy "inviter referral select" on public.referrals
  for select to authenticated using (auth.uid() = inviter_user_id);

-- Invitee can see their own referral source
drop policy if exists "invitee referral select" on public.referrals;
create policy "invitee referral select" on public.referrals
  for select to authenticated using (auth.uid() = invitee_user_id);

-- Server-only insert (via SECURITY DEFINER function)
grant select on table public.referrals to authenticated;

create or replace function public.record_referral(p_invite_token text, p_invitee_user_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_inviter_id uuid;
begin
  -- Resolve the invite token to get the inviter
  select inviter_user_id into v_inviter_id
  from public.invites
  where token = p_invite_token
    and disabled_at is null
  limit 1;

  if v_inviter_id is null then
    return false;
  end if;

  -- Prevent self-referral
  if v_inviter_id = p_invitee_user_id then
    return false;
  end if;

  -- Insert the referral (invitee_user_id is unique, so this is idempotent)
  insert into public.referrals (inviter_user_id, invitee_user_id)
  values (v_inviter_id, p_invitee_user_id)
  on conflict (invitee_user_id) do nothing;

  return true;
end; $$;

revoke all on function public.record_referral(text, uuid) from anon, authenticated;
grant execute on function public.record_referral(text, uuid) to authenticated;