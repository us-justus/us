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
  if has_table_privilege('authenticated', 'public.discoverable_profiles', 'SELECT') then
    raise exception 'authenticated can read a projection that bypasses product guards';
  end if;
  if has_table_privilege('anon', 'public.discoverable_profiles', 'SELECT') then
    raise exception 'anon can enumerate discoverable profiles';
  end if;
  if not has_table_privilege('service_role', 'public.discoverable_profiles', 'SELECT') then
    raise exception 'service_role cannot read the server-only discoverable projection';
  end if;
  -- The constraint may render as IN (...) or = ANY (ARRAY[...]). Extract the
  -- complete set of quoted literals so an added value fails this assertion,
  -- not just a missing expected value.
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'profiles'
      and c.conname = 'profiles_gender_allowed'
      and pg_get_constraintdef(c.oid) ilike '%gender is null%'
      and (
        select array_agg(captures.match[1] order by captures.match[1])
        from pg_catalog.regexp_matches(
          pg_get_constraintdef(c.oid),
          '''([^'']*)''',
          'g'
        ) as captures(match)
      ) = array['Female', 'Male']
  ) then
    raise exception 'profiles_gender_allowed must allow exactly Male/Female (or NULL)';
  end if;
  if has_table_privilege('authenticated', 'public.matches', 'INSERT') then
    raise exception 'authenticated can directly insert matches';
  end if;
  if has_column_privilege('authenticated', 'public.feedback', 'status', 'INSERT')
    or has_column_privilege('authenticated', 'public.feedback', 'suspension_related', 'INSERT') then
    raise exception 'authenticated can forge feedback moderation state';
  end if;
  -- Service-role feedback paths (20261027000001): submit needs INSERT and
  -- SELECT on the columns of `INSERT ... RETURNING id`; the admin reply needs
  -- SELECT for its lookup and UPDATE for its persist. Missing these denied
  -- every production submission (42501) while INSERT alone looked sufficient.
  if not has_table_privilege('service_role', 'public.feedback', 'INSERT') then
    raise exception 'service_role cannot submit feedback';
  end if;
  if not has_column_privilege('service_role', 'public.feedback', 'id', 'SELECT')
    or not has_column_privilege('service_role', 'public.feedback', 'user_id', 'SELECT')
    or not has_column_privilege('service_role', 'public.feedback', 'category', 'SELECT')
    or not has_column_privilege('service_role', 'public.feedback', 'status', 'SELECT') then
    raise exception 'service_role cannot read the columns its feedback routes select';
  end if;
  if not has_column_privilege('service_role', 'public.feedback', 'admin_reply', 'UPDATE')
    or not has_column_privilege('service_role', 'public.feedback', 'replied_at', 'UPDATE')
    or not has_column_privilege('service_role', 'public.feedback', 'replied_by', 'UPDATE')
    or not has_column_privilege('service_role', 'public.feedback', 'brevo_message_id', 'UPDATE') then
    raise exception 'service_role cannot persist the admin feedback reply';
  end if;
  -- RLS stays the client boundary: no UPDATE/DELETE policy exists for any role.
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'feedback' and cmd in ('UPDATE', 'DELETE')
  ) then
    raise exception 'feedback must keep no client UPDATE/DELETE policy';
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
