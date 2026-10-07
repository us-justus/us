-- Security remediation, additive to the applied migration history.
-- Existing user data is not rewritten or removed by this migration.

create table if not exists public.campus_spot_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  spot integer not null unique,
  created_at timestamptz not null default now()
);
alter table public.campus_spot_claims enable row level security;
revoke all on table public.campus_spot_claims from public, anon, authenticated;

-- Protected profile state. Service-role/admin RPC updates remain possible;
-- authenticated callers may set username and spot once during onboarding only.
create or replace function public.guard_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  if auth.role() in ('service_role', 'supabase_admin') or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_active is distinct from true
      or new.suspension_reason is not null
      or new.suspended_at is not null
      or new.suspended_by is not null then
      raise exception 'protected profile fields are server-managed' using errcode = '42501';
    end if;
    if new.spot is not null then
      if not exists (select 1 from public.campus_spot_claims c where c.user_id = auth.uid() and c.spot = new.spot) then
        raise exception 'spot is server-managed' using errcode = '42501';
      end if;
    end if;
    if new.username is not null and auth.uid() is distinct from new.user_id then
      raise exception 'username is server-managed' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.is_active is distinct from old.is_active
    or new.suspension_reason is distinct from old.suspension_reason
    or new.suspended_at is distinct from old.suspended_at
    or new.suspended_by is distinct from old.suspended_by then
    raise exception 'protected profile fields are server-managed' using errcode = '42501';
  end if;
  if new.username is distinct from old.username and not (old.username is null and new.username is not null and auth.uid() = old.user_id) then
    raise exception 'username cannot be changed' using errcode = '42501';
  end if;
  if new.spot is distinct from old.spot and not (old.spot is null and new.spot is not null and auth.uid() = old.user_id and exists (select 1 from public.campus_spot_claims c where c.user_id = auth.uid() and c.spot = new.spot)) then
    raise exception 'spot cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.allocate_campus_spot()
returns int language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
declare v_user uuid := auth.uid(); v_spot int;
begin
  if v_user is null then raise exception 'authenticated user required' using errcode = '42501'; end if;
  select spot into v_spot from public.campus_spot_claims where user_id = v_user;
  if v_spot is not null then return v_spot; end if;
  update public.campus_spot_allocator set next_spot = next_spot + 1 where id = 1 returning next_spot - 1 into v_spot;
  if v_spot is null then raise exception 'allocator unavailable'; end if;
  insert into public.campus_spot_claims(user_id, spot) values (v_user, v_spot) on conflict (user_id) do nothing;
  select spot into v_spot from public.campus_spot_claims where user_id = v_user;
  return v_spot;
end; $$;
revoke all on function public.allocate_campus_spot() from public, anon;
grant execute on function public.allocate_campus_spot() to authenticated;

drop trigger if exists trg_guard_profile_security_fields on public.profiles;
create trigger trg_guard_profile_security_fields before insert or update on public.profiles
for each row execute function public.guard_profile_security_fields();

-- Matches are created only by the mutual-like trigger, which executes as its
-- owner. The direct authenticated INSERT policy and table privilege are removed.
drop policy if exists "own matches insert" on public.matches;
revoke insert on table public.matches from public, anon, authenticated;

-- Keep profile/photo reads scoped to self or active discoverable profiles.
drop policy if exists "discover profiles select" on public.profiles;
create policy "discover active profiles select" on public.profiles
  for select to authenticated using (is_active is true);
drop policy if exists "own photos select" on public.profile_photos;
create policy "visible profile photos select" on public.profile_photos
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = profile_id and p.is_active is true)
  );

-- Keep the authenticated notification flow, but derive its actor from the
-- session and require a real underlying interaction for every notification.
create or replace function public.create_notification(
  p_user_id uuid, p_actor_id uuid, p_type text, p_reference_id uuid
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
declare v_id uuid; v_actor uuid := auth.uid();
begin
  if p_type not in ('LIKE', 'MATCH', 'MESSAGE') or p_reference_id is null or p_user_id is null then
    raise exception 'invalid notification' using errcode = '22023';
  end if;
  if v_actor is null then
    if auth.role() <> 'service_role' or p_actor_id is null then raise exception 'authenticated caller required' using errcode = '42501'; end if;
    v_actor := p_actor_id;
  elsif p_actor_id is not null and p_actor_id <> v_actor then
    raise exception 'notification actor must be caller' using errcode = '42501';
  end if;
  if v_actor = p_user_id then raise exception 'self notification' using errcode = '22023'; end if;
  if p_type = 'LIKE' and not exists (select 1 from public.likes l where l.id = p_reference_id and l.from_user_id = v_actor and l.to_user_id = p_user_id) then
    raise exception 'notification reference not found' using errcode = '02000';
  elsif p_type = 'MATCH' and not exists (select 1 from public.matches m where m.id = p_reference_id and ((m.user_a_id = v_actor and m.user_b_id = p_user_id) or (m.user_b_id = v_actor and m.user_a_id = p_user_id))) then
    raise exception 'notification reference not found' using errcode = '02000';
  elsif p_type = 'MESSAGE' and not exists (
    select 1 from public.messages msg join public.matches m on m.id = msg.match_id
    where msg.id = p_reference_id and msg.sender_id = v_actor
      and ((m.user_a_id = v_actor and m.user_b_id = p_user_id) or (m.user_b_id = v_actor and m.user_a_id = p_user_id))
  ) then raise exception 'notification reference not found' using errcode = '02000';
  end if;
  insert into public.notifications(user_id, actor_id, type, reference_id)
  values (p_user_id, v_actor, p_type, p_reference_id)
  on conflict (user_id, type, reference_id) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.notifications where user_id = p_user_id and type = p_type and reference_id = p_reference_id limit 1; end if;
  return v_id;
end; $$;
revoke all on function public.create_notification(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.create_notification(uuid, uuid, text, uuid) to authenticated, service_role;

-- Referral invitee identity is the authenticated principal, never an argument.
create or replace function public.record_referral(p_invite_token text, p_invitee_user_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public, auth, pg_temp as $$
declare v_inviter_id uuid; v_invitee uuid := auth.uid();
begin
  if v_invitee is null or (p_invitee_user_id is not null and p_invitee_user_id <> v_invitee) then
    raise exception 'invalid referral caller' using errcode = '42501';
  end if;
  select inviter_user_id into v_inviter_id from public.invites where token = p_invite_token and disabled_at is null limit 1;
  if v_inviter_id is null or v_inviter_id = v_invitee then return false; end if;
  insert into public.referrals(inviter_user_id, invitee_user_id) values (v_inviter_id, v_invitee)
  on conflict (invitee_user_id) do nothing;
  return true;
end; $$;
revoke all on function public.record_referral(text, uuid) from public, anon;
grant execute on function public.record_referral(text, uuid) to authenticated;

-- Photo writes go through the validating server routes (which inspect actual
-- bytes before using service_role). No authenticated storage UPDATE policy is
-- retained: a WITH CHECK on the path alone still permits forged image bytes.
drop policy if exists "own update photos" on storage.objects;
-- Direct public-key uploads would bypass byte validation too.
drop policy if exists "own upload photos" on storage.objects;

-- Least privilege for the notification immutable-field trigger helper.
revoke all on function public.enforce_notification_immutable_fields() from public, anon, authenticated;

-- Feedback moderation context is trusted server data, never client input.
create or replace function public.guard_feedback_moderation_metadata()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public, auth, pg_temp as $$
begin
  if auth.role() in ('service_role', 'supabase_admin') or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.suspension_related, false) or new.related_suspension_at is not null then
      raise exception 'feedback moderation metadata is server-managed' using errcode = '42501';
    end if;
  elsif new.suspension_related is distinct from old.suspension_related
    or new.related_suspension_at is distinct from old.related_suspension_at then
    raise exception 'feedback moderation metadata is server-managed' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists trg_guard_feedback_moderation_metadata on public.feedback;
create trigger trg_guard_feedback_moderation_metadata before insert or update on public.feedback
for each row execute function public.guard_feedback_moderation_metadata();
revoke all on function public.guard_feedback_moderation_metadata() from public, anon, authenticated;
-- Direct feedback INSERT is limited to student-authored fields so clients
-- cannot initialize rows as resolved or forge admin reply/resolution state.
revoke insert on table public.feedback from public, anon, authenticated;
grant insert (user_id, category, message) on table public.feedback to authenticated;
grant insert on table public.feedback to service_role;
revoke all on function public.guard_profile_security_fields() from public, anon, authenticated;
-- NOTE: guard_verification_email_identity() is created further below; its
-- REVOKE lives immediately after its creation (ordering: REVOKE requires the
-- function to exist, else 42883 rolls back the whole migration).

-- Do not expose auth user IDs or moderation columns through table-level
-- PostgREST reads. Trusted server routes use service_role after auth.getUser();
-- public callers get only the safe discoverable projection below.
revoke all on table public.profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.profiles to service_role;
create or replace view public.discoverable_profiles
with (security_barrier = true) as
select username, spot, nickname, age, year, branch, bio, interests
from public.profiles where is_active is true and username is not null;
-- Platform default privileges grant new relations to anon/authenticated
-- explicitly, so revoking from PUBLIC alone leaves anon readable. Revoke
-- from every client-facing role, then grant the safe projection narrowly.
revoke all on table public.discoverable_profiles from public, anon, authenticated;
grant select on table public.discoverable_profiles to authenticated;

-- Preserve the intentional public photo delivery while making photo RLS
-- independent of direct SELECT privileges on the private profiles table.
create or replace function public.can_read_profile_photos(p_profile_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = p_profile_id and (p.user_id = auth.uid() or p.is_active is true))
$$;
create or replace function public.owns_profile(p_profile_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
  select exists (select 1 from public.profiles p where p.id = p_profile_id and p.user_id = auth.uid())
$$;
revoke all on function public.can_read_profile_photos(uuid) from public, anon;
revoke all on function public.owns_profile(uuid) from public, anon;
grant execute on function public.can_read_profile_photos(uuid) to authenticated;
grant execute on function public.owns_profile(uuid) to authenticated;
drop policy if exists "visible profile photos select" on public.profile_photos;
create policy "visible profile photos select" on public.profile_photos for select to authenticated
using (public.can_read_profile_photos(profile_id));
drop policy if exists "own photos insert" on public.profile_photos;
create policy "own photos insert" on public.profile_photos for insert to authenticated
with check (public.owns_profile(profile_id));
drop policy if exists "own photos update" on public.profile_photos;
create policy "own photos update" on public.profile_photos for update to authenticated
using (public.owns_profile(profile_id)) with check (public.owns_profile(profile_id));
drop policy if exists "own photos delete" on public.profile_photos;
create policy "own photos delete" on public.profile_photos for delete to authenticated
using (public.owns_profile(profile_id));
revoke all on function public.handle_updated_at() from public, anon, authenticated;
revoke all on function public.create_match_if_mutual() from public, anon, authenticated;
revoke all on function public.guard_email_verified_at() from public, anon, authenticated;
revoke all on function public.resolve_login_email(text, text) from public, anon, authenticated;
grant execute on function public.resolve_login_email(text, text) to service_role;
revoke all on function public.resolve_phone_login_email(text, text) from public, anon, authenticated;
grant execute on function public.resolve_phone_login_email(text, text) to service_role;
grant execute on function public.get_waitlist_count() to service_role;

-- The verified email and its trust timestamp form one server-owned identity
-- pair; changing email through PostgREST must never retain prior trust.
create or replace function public.guard_verification_email_identity()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public, auth, pg_temp as $$
begin
  if auth.role() in ('service_role', 'supabase_admin') or public.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and new.email is distinct from old.email then
    raise exception 'verification email is server-managed' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and new.email is not null then
    raise exception 'verification email is server-managed' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists trg_guard_verification_email_identity on public.verification_records;
create trigger trg_guard_verification_email_identity before insert or update on public.verification_records
for each row execute function public.guard_verification_email_identity();
revoke all on function public.guard_verification_email_identity() from public, anon, authenticated;
