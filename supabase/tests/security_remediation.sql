-- Direct database privilege assertions for the security remediation and the
-- least-privilege tightening migration.
-- Run with `supabase test db` against a disposable local Supabase database.
-- Read-only: no fixtures or production data are inserted or changed.

create extension if not exists pgtap;

begin;

select plan(44);

-- Server-only tables: no client-facing access.
select ok(has_table_privilege('anon', 'public.profiles', 'SELECT') = false, 'anon cannot read profiles');
select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT') = false, 'authenticated cannot read profiles');
select ok(has_table_privilege('service_role', 'public.profiles', 'SELECT') = true, 'service_role can read profiles');
select ok(has_table_privilege('authenticated', 'public.discoverable_profiles', 'SELECT') = false, 'authenticated cannot read the discoverable projection');
select ok(has_table_privilege('anon', 'public.discoverable_profiles', 'SELECT') = false, 'anon cannot enumerate discoverable profiles');
select ok(has_table_privilege('service_role', 'public.discoverable_profiles', 'SELECT') = true, 'service_role can read the discoverable projection');

-- Gender constraint allows exactly Male/Female (or NULL).
select ok(
  exists (
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
  ),
  'profiles_gender_allowed must allow exactly Male/Female (or NULL)'
);

-- Matches: no direct client insert.
select ok(has_table_privilege('authenticated', 'public.matches', 'INSERT') = false, 'authenticated cannot directly insert matches');

-- Feedback: students cannot forge moderation state; service routes have what they need.
select ok(has_column_privilege('authenticated', 'public.feedback', 'status', 'INSERT') = false, 'authenticated cannot forge feedback status');
select ok(has_column_privilege('authenticated', 'public.feedback', 'suspension_related', 'INSERT') = false, 'authenticated cannot forge feedback suspension metadata');
select ok(has_table_privilege('service_role', 'public.feedback', 'INSERT') = true, 'service_role can submit feedback');
select ok(has_table_privilege('service_role', 'public.feedback', 'SELECT') = true, 'service_role can read feedback submissions');
select ok(has_table_privilege('service_role', 'public.feedback', 'UPDATE') = true, 'service_role can persist admin feedback reply');
select ok(
  not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'feedback' and cmd in ('UPDATE', 'DELETE')
  ),
  'feedback must keep no client UPDATE/DELETE policy'
);

-- Spot allocator: anon no, authenticated yes.
select ok(has_function_privilege('anon', 'public.allocate_campus_spot()', 'EXECUTE') = false, 'anon cannot execute campus spot allocator');
select ok(has_function_privilege('authenticated', 'public.allocate_campus_spot()', 'EXECUTE') = true, 'authenticated onboarding cannot allocate its one spot');
select ok(has_function_privilege('anon', 'public.create_notification(uuid,uuid,text,uuid)', 'EXECUTE') = false, 'anon can create notifications');
select ok(has_function_privilege('authenticated', 'public.resolve_login_email(text,text)', 'EXECUTE') = false, 'authenticated can execute login resolver');
select ok(has_function_privilege('service_role', 'public.resolve_login_email(text,text)', 'EXECUTE') = true, 'service_role can execute login resolver');
select ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'profile_photos'
      and policyname = 'visible profile photos select'
      and qual ilike '%can_read_profile_photos%'
  ),
  'profile photo reads are not scoped by the database policy'
);

-- Least privilege (2026-11-22 tightening): admin RPCs are service-role only.
select ok(has_function_privilege('anon', 'public.admin_list_reports(text, integer, integer)', 'EXECUTE') = false, 'anon cannot list reports');
select ok(has_function_privilege('authenticated', 'public.admin_list_reports(text, integer, integer)', 'EXECUTE') = false, 'authenticated cannot list reports');
select ok(has_function_privilege('service_role', 'public.admin_list_reports(text, integer, integer)', 'EXECUTE') = true, 'service_role can list reports');
select ok(has_function_privilege('anon', 'public.admin_resolve_report(uuid, text)', 'EXECUTE') = false, 'anon cannot resolve reports');
select ok(has_function_privilege('authenticated', 'public.admin_resolve_report(uuid, text)', 'EXECUTE') = false, 'authenticated cannot resolve reports');
select ok(has_function_privilege('service_role', 'public.admin_resolve_report(uuid, text)', 'EXECUTE') = true, 'service_role can resolve reports');
select ok(has_function_privilege('authenticated', 'public.admin_overview_counts()', 'EXECUTE') = false, 'authenticated cannot call admin overview counts');
select ok(has_function_privilege('service_role', 'public.admin_overview_counts()', 'EXECUTE') = true, 'service_role can call admin overview counts');
select ok(has_function_privilege('anon', 'public.get_or_create_invite()', 'EXECUTE') = false, 'anon cannot create invites');
select ok(has_function_privilege('authenticated', 'public.get_or_create_invite()', 'EXECUTE') = true, 'authenticated can create invites');
select ok(has_function_privilege('anon', 'public.mark_chat_seen(uuid)', 'EXECUTE') = false, 'anon cannot mark chat seen');
select ok(has_function_privilege('authenticated', 'public.mark_chat_seen(uuid)', 'EXECUTE') = true, 'authenticated can mark chat seen');
select ok(has_function_privilege('anon', 'public.has_unread_chat()', 'EXECUTE') = false, 'anon cannot check unread chat');
select ok(has_function_privilege('authenticated', 'public.has_unread_chat()', 'EXECUTE') = true, 'authenticated can check unread chat');
select ok(has_function_privilege('anon', 'public.create_match_if_mutual()', 'EXECUTE') = false, 'anon cannot create matches');
select ok(has_function_privilege('service_role', 'public.create_match_if_mutual()', 'EXECUTE') = true, 'service can create matches');
select ok(has_function_privilege('anon', 'public.enforce_chat_read_state_immutable_fields()', 'EXECUTE') = false, 'anon cannot enforce chat read state');
select ok(has_function_privilege('authenticated', 'public.enforce_chat_read_state_immutable_fields()', 'EXECUTE') = false, 'authenticated cannot enforce chat read state');
select ok(has_function_privilege('anon', 'public.resolve_invite_token(text)', 'EXECUTE') = true, 'anon can resolve invite tokens (public)');

-- SECURITY DEFINER hardening: pinned search_path includes pg_temp.
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_match_if_mutual'
      and p.prosecdef
      and coalesce(p.proconfig::text, '') ilike '%pg_temp%'
  ),
  'create_match_if_mutual must pin search_path with pg_temp'
);
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_or_create_invite'
      and p.prosecdef
      and coalesce(p.proconfig::text, '') ilike '%pg_temp%'
  ),
  'get_or_create_invite must pin search_path with pg_temp'
);
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'has_unread_chat'
      and p.prosecdef
      and coalesce(p.proconfig::text, '') ilike '%pg_temp%'
  ),
  'has_unread_chat must pin search_path with pg_temp'
);
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'mark_chat_seen'
      and p.prosecdef
      and coalesce(p.proconfig::text, '') ilike '%pg_temp%'
  ),
  'mark_chat_seen must pin search_path with pg_temp'
);
select ok(
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'resolve_invite_token'
      and p.prosecdef
      and coalesce(p.proconfig::text, '') ilike '%pg_temp%'
  ),
  'resolve_invite_token must pin search_path with pg_temp'
);

select * from finish();

rollback;
