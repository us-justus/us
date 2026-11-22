-- us — Profile-photo metadata path ownership + SECURITY DEFINER search_path hardening.
--
-- Adds a database-enforced boundary so a profile_photos row can only reference
-- a storage object whose path is owned by the profile's owner (path prefix =
-- the owner's auth user id). This closes the gap where an authenticated client
-- could insert/update metadata pointing at another user's object path.
--
-- Additive to the applied migration history (historical migrations untouched).

-- ---------------------------------------------------------------------------
-- 1) Path-ownership helper + guard for profile_photos.storage_path.
-- ---------------------------------------------------------------------------

create or replace function public.profile_owns_photo_path(p_profile_id uuid, p_storage_path text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p_storage_path is not null
      and split_part(p_storage_path, '/', 1) = p.user_id::text
      and position('..' in p_storage_path) = 0
      and p_storage_path not like '%//%'
      and p_storage_path not like '/%'
      and p_storage_path not like '%/'
      and length(p_storage_path) > length(p.user_id::text) + 1
  )
$$;

create or replace function public.guard_profile_photo_storage_path()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id from public.profiles where id = new.profile_id;
  if v_user_id is null then
    raise exception 'profile not found for photo row' using errcode = '23503';
  end if;
  if new.storage_path is null
     or split_part(new.storage_path, '/', 1) <> v_user_id::text
     or new.storage_path ~ '\.\.'
     or new.storage_path like '%//%'
     or new.storage_path like '/%'
     or new.storage_path like '%/'
     or length(new.storage_path) <= length(v_user_id::text) + 1 then
    raise exception 'invalid profile photo storage path' using errcode = '23514';
  end if;
  return new;
end; $$;

drop trigger if exists trg_guard_profile_photo_storage_path on public.profile_photos;
create trigger trg_guard_profile_photo_storage_path
before insert or update on public.profile_photos
for each row execute function public.guard_profile_photo_storage_path();

-- RLS: an authenticated writer may only reference a path it owns.
drop policy if exists "own photos insert" on public.profile_photos;
create policy "own photos insert" on public.profile_photos
  for insert to authenticated
  with check (
    public.owns_profile(profile_id)
    and public.profile_owns_photo_path(profile_id, storage_path)
  );

drop policy if exists "own photos update" on public.profile_photos;
create policy "own photos update" on public.profile_photos
  for update to authenticated
  using (public.owns_profile(profile_id))
  with check (
    public.owns_profile(profile_id)
    and public.profile_owns_photo_path(profile_id, storage_path)
  );

revoke all on function public.profile_owns_photo_path(uuid, text) from public, anon;
grant execute on function public.profile_owns_photo_path(uuid, text) to authenticated, service_role;
revoke all on function public.guard_profile_photo_storage_path() from public, anon, authenticated, service_role;

-- Format floor: storage_path must be a non-empty "{uuid}/..." value.
alter table public.profile_photos
  drop constraint if exists profile_photos_storage_path_format;
alter table public.profile_photos
  add constraint profile_photos_storage_path_format
  check (storage_path ~ '^[0-9a-fA-F-]{36}/.+' and storage_path not like '%//%' and storage_path not like '%/');

-- ---------------------------------------------------------------------------
-- 2) SECURITY DEFINER search_path hardening (add pg_catalog where missing).
-- ---------------------------------------------------------------------------

alter function public.admin_list_feedback(text, integer, integer) set search_path = pg_catalog, public, auth, pg_temp;
alter function public.admin_list_reports(text, integer, integer) set search_path = pg_catalog, public, auth, pg_temp;
alter function public.admin_list_students(text, integer, integer, text) set search_path = pg_catalog, public, auth, pg_temp;
alter function public.admin_overview_counts() set search_path = pg_catalog, public, auth, pg_temp;
alter function public.admin_prepare_waitlist_email_queue() set search_path = pg_catalog, public, auth, pg_temp;
alter function public.admin_resolve_feedback(uuid) set search_path = pg_catalog, public, auth, pg_temp;
alter function public.admin_resolve_report(uuid, text) set search_path = pg_catalog, public, auth, pg_temp;
alter function public.admin_set_student_active(uuid, boolean, text) set search_path = pg_catalog, public, auth, pg_temp;
alter function public.admin_waitlist_email_queue_summary() set search_path = pg_catalog, public, auth, pg_temp;
alter function public.check_login_rate_limit(text, text) set search_path = pg_catalog, public, pg_temp;
alter function public.claim_email_verification_job(text, integer) set search_path = pg_catalog, public, pg_temp;
alter function public.clear_login_rate_limit(text) set search_path = pg_catalog, public, pg_temp;
alter function public.consume_email_verification_token(text) set search_path = pg_catalog, public, pg_temp;
alter function public.expire_email_verification_jobs() set search_path = pg_catalog, public, pg_temp;
alter function public.get_waitlist_count() set search_path = pg_catalog, public, auth, pg_temp;
alter function public.is_admin() set search_path = pg_catalog, public, auth, pg_temp;
alter function public.mint_email_verification_token(uuid, text, text, integer) set search_path = pg_catalog, public, pg_temp;
alter function public.resolve_login_email(text, text) set search_path = pg_catalog, public, auth, pg_temp;
alter function public.resolve_phone_login_email(text, text) set search_path = pg_catalog, public, auth, pg_temp;