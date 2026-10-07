-- Direct database privilege assertions for the security remediation.
-- Run with `supabase test db` against a disposable local Supabase database.
-- Read-only: no fixtures or production data are inserted or changed.
begin;

do $$
begin
  if has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    raise exception 'authenticated unexpectedly has direct profiles SELECT';
  end if;
  if has_table_privilege('anon', 'public.profiles', 'SELECT') then
    raise exception 'anon unexpectedly has direct profiles SELECT';
  end if;
  if not has_table_privilege('authenticated', 'public.discoverable_profiles', 'SELECT') then
    raise exception 'authenticated cannot read the safe discoverable projection';
  end if;
  if has_table_privilege('anon', 'public.discoverable_profiles', 'SELECT') then
    raise exception 'anon can enumerate discoverable profiles';
  end if;
  if has_table_privilege('authenticated', 'public.matches', 'INSERT') then
    raise exception 'authenticated can directly insert matches';
  end if;
  if has_column_privilege('authenticated', 'public.feedback', 'status', 'INSERT')
    or has_column_privilege('authenticated', 'public.feedback', 'suspension_related', 'INSERT') then
    raise exception 'authenticated can forge feedback moderation state';
  end if;
  if has_function_privilege('anon', 'public.allocate_campus_spot()', 'EXECUTE') then
    raise exception 'anon can execute campus spot allocator';
  end if;
  if has_function_privilege('authenticated', 'public.allocate_campus_spot()', 'EXECUTE') is false then
    raise exception 'authenticated onboarding cannot allocate its one spot';
  end if;
  if has_function_privilege('anon', 'public.create_notification(uuid,uuid,text,uuid)', 'EXECUTE') then
    raise exception 'anon can create notifications';
  end if;
  if has_function_privilege('authenticated', 'public.resolve_login_email(text,text)', 'EXECUTE') then
    raise exception 'authenticated can execute login resolver';
  end if;
  if has_function_privilege('anon', 'public.resolve_login_email(text,text)', 'EXECUTE') then
    raise exception 'anon can execute login resolver';
  end if;
  if not has_function_privilege('service_role', 'public.resolve_login_email(text,text)', 'EXECUTE') then
    raise exception 'service_role cannot execute login resolver';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'profile_photos'
      and policyname = 'visible profile photos select'
      and qual ilike '%can_read_profile_photos%'
  ) then
    raise exception 'profile photo reads are not scoped by the database policy';
  end if;
end;
$$;

rollback;
