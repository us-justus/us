-- us INSIDE v1: internal admin dashboard foundation.
--
-- ADDS (nothing existing is modified or weakened):
--   1. launch_config.prelaunch_version (default 'v1') — selects which
--      pre-launch experience is active. launch_config id = 1 stays the single
--      authoritative product state; `launched` remains the only auth flag.
--   2. admin_users — explicit authorization list. user_id PK references
--      auth.users. RLS enabled with NO policies (fail-closed: no client role
--      can read or write it) and NO table grants.
--   3. is_admin() — SECURITY DEFINER boolean for the caller's auth.uid().
--      Only sanctioned callers: /inside server code (via the user's session).
--   4. resolve_phone_login_email() — password-gated phone -> auth-email
--      mapping for admin login. Email identifiers sign in directly and USN
--      identifiers reuse the existing resolve_login_email(); phone is the
--      only path with no existing resolver (phone auth does not exist in
--      the product), so it gets the smallest new function following the
--      same pattern: bcrypt check inside, NULL on every failure, dummy
--      bcrypt burn on the miss path, result never returned to clients.
--   5. admin_overview_counts() — SECURITY DEFINER overview metrics.
--      Refuses unless is_admin(). Returns { total_users, waiting } only —
--      no USNs, emails, phones, auth IDs, or verification metadata.
--        total_users = count(*) of verification_records (every USN-verified
--          account — the broadest "user" the database holds).
--        waiting     = users with a profile AND >= 1 profile photo, i.e.
--          onboarding step = complete (the same definition the product uses
--          to render the pre-launch waiting state).
--   6. admin_set_launch() — SECURITY DEFINER launch mutation. Refuses
--      unless is_admin(). Launching sets launched = true and
--      launched_at = now(); returning to pre-launch sets launched = false
--      and PRESERVES launched_at as the historical record (existing code
--      treats launched_at as display-only; nothing clears it).
--
-- No service-role grant, no RLS weakening, no client-reachable writes.

-- ============================================================
-- PART 1 — pre-launch version on the existing singleton
-- ============================================================
alter table public.launch_config
  add column if not exists prelaunch_version text not null default 'v1';

-- ============================================================
-- PART 2 — admin_users (explicit authorization list)
-- ============================================================
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- Intentionally NO policies and NO grants: every client role is denied.
-- Only SECURITY DEFINER functions below (which check is_admin() first)
-- can touch this table. Bootstrap one row manually, e.g.:
--   insert into public.admin_users (user_id)
--   values ('<auth.users.id of the admin>');

-- ============================================================
-- PART 3 — is_admin()
-- ============================================================
create or replace function public.is_admin()
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  return exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
  );
end;
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

comment on function public.is_admin() is
  'INSIDE v1: true when the calling session belongs to admin_users. Server-route use only.';

-- ============================================================
-- PART 4 — resolve_phone_login_email() (admin login only)
-- ============================================================
create or replace function public.resolve_phone_login_email(p_phone text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_email text;
  v_hash text;
begin
  if v_digits = '' or length(v_digits) < 7 or length(v_digits) > 15
     or p_password is null or p_password = '' then
    return null;
  end if;

  -- Exact digit match, or same last-10 digits (tolerates a missing / extra
  -- country prefix between what the admin typed and E.164 in auth.users).
  select u.email, u.encrypted_password
    into v_email, v_hash
    from auth.users u
   where regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = v_digits
      or (length(v_digits) >= 10
          and length(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')) >= 10
          and right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10))
   limit 1;

  if v_email is null or v_hash is null or v_hash = '' then
    perform extensions.crypt(p_password, extensions.gen_salt('bf', 10));
    return null;
  end if;

  if extensions.crypt(p_password, v_hash) = v_hash then
    return v_email;
  end if;
  return null;
end;
$$;

revoke all on function public.resolve_phone_login_email(text, text) from public;
grant execute on function public.resolve_phone_login_email(text, text) to anon, authenticated;

comment on function public.resolve_phone_login_email(text, text) is
  'INSIDE v1: phone -> auth email for admin login only, returned solely when the password verifies, else NULL. Server-route use only; never expose the result to clients.';

-- ============================================================
-- PART 5 — admin_overview_counts()
-- ============================================================
create or replace function public.admin_overview_counts()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_total int;
  v_waiting int;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*) into v_total from public.verification_records;

  select count(*) into v_waiting
    from public.profiles p
   where exists (
     select 1 from public.profile_photos ph where ph.profile_id = p.id
   );

  return jsonb_build_object('total_users', v_total, 'waiting', v_waiting);
end;
$$;

revoke all on function public.admin_overview_counts() from public;
grant execute on function public.admin_overview_counts() to authenticated;

comment on function public.admin_overview_counts() is
  'INSIDE v1: { total_users, waiting } aggregates for the dashboard. Admin-only; exposes no private fields.';

-- ============================================================
-- PART 6 — admin_set_launch()
-- ============================================================
create or replace function public.admin_set_launch(p_launched boolean, p_version text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_row public.launch_config%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_version is not null and p_version <> '' and p_version !~ '^v[0-9]{1,3}$' then
    raise exception 'invalid pre-launch version' using errcode = '22000';
  end if;

  update public.launch_config
     set launched = p_launched,
         -- Launching stamps now(); un-launching preserves launched_at as
         -- the historical record (launched_at is display-only everywhere).
         launched_at = case when p_launched then now() else launched_at end,
         prelaunch_version = coalesce(nullif(p_version, ''), prelaunch_version),
         updated_at = now()
   where id = 1
  returning * into v_row;

  return jsonb_build_object(
    'launched', v_row.launched,
    'launched_at', v_row.launched_at,
    'prelaunch_version', v_row.prelaunch_version
  );
end;
$$;

revoke all on function public.admin_set_launch(boolean, text) from public;
grant execute on function public.admin_set_launch(boolean, text) to authenticated;

comment on function public.admin_set_launch(boolean, text) is
  'INSIDE v1: the only sanctioned launch_config writer. Admin-only; preserves id = 1 singleton semantics.';
