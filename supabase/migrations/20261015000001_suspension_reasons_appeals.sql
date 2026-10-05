-- us INSIDE Step 3 amendment: suspension reasons + suspension-appeal loop.
--
-- CONTEXT: suspension was a silent `profiles.is_active = false` with the
-- admin's explanation living only in audit metadata. This amendment makes
-- the suspension a communicable state: the admin must supply a reason, the
-- suspended student sees that reason on a dedicated suspended screen, and
-- the appeal travels through the existing feedback workflow (no second
-- inbox, no separate appeal system).
--
-- REUSES (nothing existing is modified or weakened):
--   - profiles.is_active stays the account-status mechanism; discover /
--     search / /u/[username] / invites already exclude is_active = false.
--   - public.inside_audit_events + STUDENT_SUSPENDED / STUDENT_RESTORED as
--     the historical record. History is never deleted or rewritten here.
--   - public.feedback as the appeal transport (category ACCOUNT).
--   - requireInsideAdmin() + is_admin() for authorization (defense in depth:
--     routes check the gate AND every function below re-checks is_admin()).
--   - The single-statement CTE pattern (total + page in ONE statement).
--
-- ADDS:
--   1. profiles.suspension_reason / suspended_at / suspended_by — the
--      CURRENT suspension state only. Written on suspend, cleared on
--      restore. No suspension-history table: history lives in
--      inside_audit_events.
--   2. feedback.suspension_related / feedback.related_suspension_at — the
--      appeal link. Set server-side from the author's live profile state;
--      never trusted from the client. No suspension_id: the current state
--      lives on profiles, so there is no suspension row to reference.
--   3. admin_set_student_active() gains p_reason (required for suspend,
--      length-capped, ignored on restore) and becomes the sole writer of
--      the suspension columns. suspended_by comes from auth.uid() — never
--      a parameter. Restore clears all three columns.
--   4. admin_list_students() returns the suspension columns (admin-only).
--   5. admin_list_feedback() returns suspension context per row
--      (suspension_related, related_suspension_at, author suspension state
--      + reason) so the admin sees appeal + cause in one place.
--
-- PRIVACY: suspension columns are readable by the row owner through the
-- existing "own profile select" RLS policy (the suspended student must see
-- their own reason) and by admins through the RPCs below. Every public
-- projection (search, /u/[username], invites, discover, /api/account/state)
-- selects explicit column lists that do NOT include these columns, so no
-- public surface changes. The suspended-login response and
-- /api/account/suspension are the only student-facing reason paths.
--
-- SECURITY MODEL (mirrors the moderation RPCs):
--   - All functions refuse unless is_admin(). EXECUTE to authenticated
--     only; revoked from public/anon. auth.users is never read.
--
-- ROLLBACK: drop the redefined functions' new signatures (recreate the
-- prior 4-arg admin_list_students / 2-arg admin_set_student_active from
-- 20261013000001 / 20261011000002), drop the added columns, and drop the
-- feedback columns.

-- ============================================================
-- PART 1 — current-suspension state on profiles
-- ============================================================
alter table public.profiles
  add column if not exists suspension_reason text null check (
    suspension_reason is null or char_length(suspension_reason) between 1 and 280
  );

alter table public.profiles
  add column if not exists suspended_at timestamptz null;

alter table public.profiles
  add column if not exists suspended_by uuid null references auth.users(id) on delete set null;

comment on column public.profiles.suspension_reason is
  'Admin-provided explanation for the CURRENT suspension. Shown only to the suspended student and to /inside admins — never in public projections.';
comment on column public.profiles.suspended_at is
  'Timestamp of the CURRENT suspension. Cleared on restore; history lives in inside_audit_events.';
comment on column public.profiles.suspended_by is
  'Admin user ID that performed the CURRENT suspension. Server-derived (auth.uid()), never client input. Null for rows suspended before actor tracking existed.';

-- Backfill rows suspended before reasons existed so the CHECK below holds
-- on staging. The placeholder says what it is; the next admin action on
-- the row (restore, or a new suspend with a real reason) replaces it.
update public.profiles
   set suspension_reason = 'Suspended before a reason was recorded.',
       suspended_at = coalesce(suspended_at, updated_at, now())
 where is_active = false
   and suspension_reason is null;

-- Invariant: suspension metadata exists only while suspended. Active rows
-- carry no reason/timestamp/actor; suspended rows always carry a reason and
-- timestamp (the writer below enforces all three going forward).
-- suspended_by stays nullable for legacy rows suspended before actor
-- tracking existed — backfilled above with reason + timestamp only.
alter table public.profiles
  drop constraint if exists profiles_suspension_state_check;

alter table public.profiles
  add constraint profiles_suspension_state_check check (
    (
      is_active = false
      and suspension_reason is not null
      and suspended_at is not null
    )
    or (
      is_active is distinct from false
      and suspension_reason is null
      and suspended_at is null
      and suspended_by is null
    )
  );

-- ============================================================
-- PART 2 — appeal link on feedback
-- ============================================================
alter table public.feedback
  add column if not exists suspension_related boolean not null default false;

alter table public.feedback
  add column if not exists related_suspension_at timestamptz null;

-- An appeal always pins the suspension moment it refers to; ordinary
-- feedback carries neither flag nor timestamp.
alter table public.feedback
  drop constraint if exists feedback_suspension_link_check;

alter table public.feedback
  add constraint feedback_suspension_link_check check (
    (suspension_related = true and related_suspension_at is not null)
    or (suspension_related = false and related_suspension_at is null)
  );

create index if not exists idx_feedback_suspension_related
  on public.feedback(suspension_related, created_at desc)
  where suspension_related = true;

comment on column public.feedback.suspension_related is
  'True when the author submitted this from the suspended-appeal flow while suspended. Server-derived from the live profile — never trusted from the client.';
comment on column public.feedback.related_suspension_at is
  'Snapshot of profiles.suspended_at at appeal time, so the appeal stays linked to its cause even after a later restore.';

-- ============================================================
-- PART 3 — admin_set_student_active() + p_reason, owns the columns
-- (DROP + CREATE: OR REPLACE cannot change arity)
-- ============================================================
drop function if exists public.admin_set_student_active(uuid, boolean);

create function public.admin_set_student_active(
  p_target_user_id uuid,
  p_active boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_prev boolean;
  v_next boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_target_user_id is null or p_active is null then
    raise exception 'target and active state are required' using errcode = '22000';
  end if;

  if v_reason is not null and char_length(v_reason) > 280 then
    raise exception 'suspension reason too long' using errcode = '22000';
  end if;

  if p_active = false then
    -- Suspend REQUIRES a reason. The actor/timestamp are server-derived:
    -- suspended_by = the calling admin's JWT identity, never a parameter.
    if v_reason is null then
      raise exception 'suspension reason is required' using errcode = '22000';
    end if;

    update public.profiles
       set is_active = false,
           suspension_reason = v_reason,
           suspended_at = now(),
           suspended_by = auth.uid(),
           updated_at = now()
     where user_id = p_target_user_id
       and is_active is distinct from false;
  else
    -- Restore clears the CURRENT suspension state. Audit history
    -- (STUDENT_SUSPENDED / STUDENT_RESTORED) is untouched.
    update public.profiles
       set is_active = true,
           suspension_reason = null,
           suspended_at = null,
           suspended_by = null,
           updated_at = now()
     where user_id = p_target_user_id
       and is_active is distinct from true;
  end if;

  if not found then
    -- Either no profile row, or already in the target state. Distinguish
    -- so the route can skip audit on no-ops without a second read.
    select is_active into v_prev
      from public.profiles
     where user_id = p_target_user_id;
    if not found then
      raise exception 'student not found' using errcode = '02000';
    end if;
    return jsonb_build_object(
      'user_id', p_target_user_id,
      'previous_active', v_prev,
      'new_active', v_prev,
      'changed', false
    );
  end if;

  v_prev := not p_active;
  v_next := p_active;

  return jsonb_build_object(
    'user_id', p_target_user_id,
    'previous_active', v_prev,
    'new_active', v_next,
    'changed', true
  );
end;
$$;

revoke all on function public.admin_set_student_active(uuid, boolean, text) from public;
revoke all on function public.admin_set_student_active(uuid, boolean, text) from anon;
grant execute on function public.admin_set_student_active(uuid, boolean, text) to authenticated;

comment on function public.admin_set_student_active(uuid, boolean, text) is
  'INSIDE Step 3: suspend (false, reason required) / restore (true, clears suspension state) a student. Admin-only; suspension_reason/suspended_at/suspended_by are server-derived. Reports previous/new state plus a changed flag so routes skip audit on no-ops.';

-- ============================================================
-- PART 4 — admin_list_students() + suspension columns
-- (DROP + CREATE: signature gains no args but the projection changes;
-- recreated whole for a single authoritative definition)
-- ============================================================
drop function if exists public.admin_list_students(text, int, int, text);

create function public.admin_list_students(
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0,
  p_status text default 'all'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_status not in ('all', 'active', 'suspended') then
    raise exception 'invalid student status filter' using errcode = '22000';
  end if;

  -- Single statement: every CTE below is visible to the whole query.
  -- Full outer join: verification-first rows (USN step done, no profile
  -- yet) and profile-first rows both appear. The auth schema is never read.
  -- Suspension columns are admin-only output here — no public projection
  -- selects them.
  with base as (
    select
      coalesce(v.user_id, p.user_id) as user_id,
      v.usn as usn,
      v.email as email,
      v.email_verified as email_verified,
      v.verification_status as verification_status,
      v.created_at as verification_created_at,
      p.username as username,
      p.spot as spot,
      p.nickname as nickname,
      p.age as age,
      p.year as year,
      p.branch as branch,
      p.is_active as is_active,
      p.suspension_reason as suspension_reason,
      p.suspended_at as suspended_at,
      p.created_at as profile_created_at,
      p.updated_at as profile_updated_at,
      (select count(*) from public.profile_photos ph where ph.profile_id = p.id) as photo_count
    from public.verification_records v
    full outer join public.profiles p on p.user_id = v.user_id
  ),
  filtered as (
    select * from base
    where (
      v_search is null
       or username ilike '%' || v_search || '%'
       or nickname ilike '%' || v_search || '%'
       or usn ilike '%' || v_search || '%'
       or email ilike '%' || v_search || '%'
       or (v_search ~ '^[0-9]+$' and spot = v_search::int)
    )
    and (
      p_status = 'all'
       or (p_status = 'active' and is_active is distinct from false)
       or (p_status = 'suspended' and is_active = false)
    )
  ),
  total as (
    select count(*) as n from filtered
  )
  select jsonb_build_object(
    'students',
    coalesce(
      (
        select jsonb_agg(r order by r.sort_key desc nulls last)
        from (
          select
            user_id, usn, email, email_verified, verification_status,
            verification_created_at, username, spot, nickname, age, year, branch,
            is_active, suspension_reason, suspended_at,
            profile_created_at, profile_updated_at, photo_count,
            coalesce(profile_created_at, verification_created_at) as sort_key
          from filtered
          order by coalesce(profile_created_at, verification_created_at) desc nulls last
          limit v_limit offset v_offset
        ) r
      ),
      '[]'::jsonb
    ),
    'total',
    (select n from total)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_list_students(text, int, int, text) from public;
revoke all on function public.admin_list_students(text, int, int, text) from anon;
grant execute on function public.admin_list_students(text, int, int, text) to authenticated;

comment on function public.admin_list_students(text, int, int, text) is
  'INSIDE dashboard: paginated admin student listing (username/nickname/USN/email/spot search, all/active/suspended filter) including current suspension state. Admin-only; public fields + suspension context only, never auth-schema internals.';

-- ============================================================
-- PART 5 — admin_list_feedback() + suspension context
-- (DROP + CREATE: the per-row shape gains appeal/suspension context)
-- ============================================================
drop function if exists public.admin_list_feedback(text, int, int);

create or replace function public.admin_list_feedback(
  p_status text default 'open',
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_status text := lower(btrim(coalesce(p_status, 'open')));
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_status not in ('open', 'resolved', 'all') then
    raise exception 'invalid feedback status filter' using errcode = '22000';
  end if;

  -- Single statement: every CTE below is visible to the whole query
  -- (staging 42P01 regression pattern). OPEN rows sort before RESOLVED
  -- (the inbox default is the work queue); newest-first within each band.
  -- Student context is public profile fields + the trusted onboarding
  -- email — auth.users is never read. Suspension context lets the admin
  -- see appeal + cause in one place: the appeal link on the feedback row
  -- plus the author's CURRENT suspension state and reason.
  with base as (
    select
      f.id as id,
      f.user_id as user_id,
      f.category as category,
      f.message as message,
      f.status as status,
      f.created_at as created_at,
      f.admin_reply as admin_reply,
      f.replied_at as replied_at,
      f.resolved_at as resolved_at,
      f.suspension_related as suspension_related,
      f.related_suspension_at as related_suspension_at,
      p.username as username,
      p.nickname as nickname,
      v.usn as usn,
      v.email as email,
      (p.is_active = false) as author_suspended,
      p.suspension_reason as author_suspension_reason
    from public.feedback f
    left join public.profiles p on p.user_id = f.user_id
    left join public.verification_records v on v.user_id = f.user_id
    where (v_status = 'all')
       or (v_status = 'open' and f.status = 'OPEN')
       or (v_status = 'resolved' and f.status = 'RESOLVED')
  ),
  total as (
    select count(*) as n from base
  )
  select jsonb_build_object(
    'feedback',
    coalesce(
      (
        select jsonb_agg(r order by (r.status = 'OPEN') desc, r.created_at desc)
        from (
          select * from base
          order by (status = 'OPEN') desc, created_at desc
          limit v_limit offset v_offset
        ) r
      ),
      '[]'::jsonb
    ),
    'total',
    (select n from total)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_list_feedback(text, int, int) from public;
revoke all on function public.admin_list_feedback(text, int, int) from anon;
grant execute on function public.admin_list_feedback(text, int, int) to authenticated;

comment on function public.admin_list_feedback(text, int, int) is
  'INSIDE feedback inbox: paginated listing (open/resolved/all, default open) with student context (username/nickname/USN/trusted email) plus suspension-appeal context. Admin-only; never auth-schema internals.';
