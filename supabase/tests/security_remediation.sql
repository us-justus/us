-- Direct database privilege assertions for the security remediation and the
-- least-privilege tightening migration.
-- Run with `supabase test db` against a disposable local Supabase database.
-- Read-only: no fixtures or production data are inserted or changed.

create extension if not exists pgtap;

begin;

select plan(135);

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
select ok(has_function_privilege('anon', 'public.admin_list_reports(uuid, text, integer, integer)', 'EXECUTE') = false, 'anon cannot list reports');
select ok(has_function_privilege('authenticated', 'public.admin_list_reports(uuid, text, integer, integer)', 'EXECUTE') = false, 'authenticated cannot list reports');
select ok(has_function_privilege('service_role', 'public.admin_list_reports(uuid, text, integer, integer)', 'EXECUTE') = true, 'service_role can list reports');
select ok(has_function_privilege('anon', 'public.admin_resolve_report(uuid, text, uuid)', 'EXECUTE') = false, 'anon cannot resolve reports');
select ok(has_function_privilege('authenticated', 'public.admin_resolve_report(uuid, text, uuid)', 'EXECUTE') = false, 'authenticated cannot resolve reports');
select ok(has_function_privilege('service_role', 'public.admin_resolve_report(uuid, text, uuid)', 'EXECUTE') = true, 'service_role can resolve reports');
select ok(has_function_privilege('authenticated', 'public.admin_overview_counts(uuid)', 'EXECUTE') = false, 'authenticated cannot call admin overview counts');
select ok(has_function_privilege('service_role', 'public.admin_overview_counts(uuid)', 'EXECUTE') = true, 'service_role can call admin overview counts');
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



-- ===========================================================================
-- Least-privilege grant matrix (table-driven explicit assertions)
-- ===========================================================================

-- profiles: server-only (service_role only).
select ok(has_table_privilege('anon', 'public.profiles', 'SELECT') = false, 'profiles: anon SELECT denied');
select ok(has_table_privilege('anon', 'public.profiles', 'INSERT') = false, 'profiles: anon INSERT denied');
select ok(has_table_privilege('anon', 'public.profiles', 'UPDATE') = false, 'profiles: anon UPDATE denied');
select ok(has_table_privilege('anon', 'public.profiles', 'DELETE') = false, 'profiles: anon DELETE denied');
select ok(has_table_privilege('anon', 'public.profiles', 'TRUNCATE') = false, 'profiles: anon TRUNCATE denied');
select ok(has_table_privilege('anon', 'public.profiles', 'REFERENCES') = false, 'profiles: anon REFERENCES denied');
select ok(has_table_privilege('anon', 'public.profiles', 'TRIGGER') = false, 'profiles: anon TRIGGER denied');
select ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT') = false, 'profiles: authenticated SELECT denied');
select ok(has_table_privilege('authenticated', 'public.profiles', 'INSERT') = false, 'profiles: authenticated INSERT denied');
select ok(has_table_privilege('authenticated', 'public.profiles', 'UPDATE') = false, 'profiles: authenticated UPDATE denied');
select ok(has_table_privilege('authenticated', 'public.profiles', 'DELETE') = false, 'profiles: authenticated DELETE denied');
select ok(has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE') = false, 'profiles: authenticated TRUNCATE denied');
select ok(has_table_privilege('service_role', 'public.profiles', 'SELECT') = true, 'profiles: service_role SELECT allowed');
select ok(has_table_privilege('service_role', 'public.profiles', 'INSERT') = true, 'profiles: service_role INSERT allowed');
select ok(has_table_privilege('service_role', 'public.profiles', 'UPDATE') = true, 'profiles: service_role UPDATE allowed');
select ok(has_table_privilege('service_role', 'public.profiles', 'DELETE') = true, 'profiles: service_role DELETE allowed');

-- profile_photos: authenticated read/write own rows only; no DDL-ish privileges.
select ok(has_table_privilege('anon', 'public.profile_photos', 'SELECT') = false, 'profile_photos: anon SELECT denied');
select ok(has_table_privilege('anon', 'public.profile_photos', 'INSERT') = false, 'profile_photos: anon INSERT denied');
select ok(has_table_privilege('anon', 'public.profile_photos', 'UPDATE') = false, 'profile_photos: anon UPDATE denied');
select ok(has_table_privilege('anon', 'public.profile_photos', 'DELETE') = false, 'profile_photos: anon DELETE denied');
select ok(has_table_privilege('anon', 'public.profile_photos', 'TRUNCATE') = false, 'profile_photos: anon TRUNCATE denied');
select ok(has_table_privilege('anon', 'public.profile_photos', 'REFERENCES') = false, 'profile_photos: anon REFERENCES denied');
select ok(has_table_privilege('anon', 'public.profile_photos', 'TRIGGER') = false, 'profile_photos: anon TRIGGER denied');
select ok(has_table_privilege('authenticated', 'public.profile_photos', 'SELECT') = true, 'profile_photos: authenticated SELECT allowed');
select ok(has_table_privilege('authenticated', 'public.profile_photos', 'INSERT') = true, 'profile_photos: authenticated INSERT allowed');
select ok(has_table_privilege('authenticated', 'public.profile_photos', 'UPDATE') = true, 'profile_photos: authenticated UPDATE allowed');
select ok(has_table_privilege('authenticated', 'public.profile_photos', 'DELETE') = true, 'profile_photos: authenticated DELETE allowed');
select ok(has_table_privilege('authenticated', 'public.profile_photos', 'TRUNCATE') = false, 'profile_photos: authenticated TRUNCATE denied');
select ok(has_table_privilege('authenticated', 'public.profile_photos', 'REFERENCES') = false, 'profile_photos: authenticated REFERENCES denied');
select ok(has_table_privilege('authenticated', 'public.profile_photos', 'TRIGGER') = false, 'profile_photos: authenticated TRIGGER denied');
select ok(has_table_privilege('service_role', 'public.profile_photos', 'SELECT') = true, 'profile_photos: service_role SELECT allowed');
select ok(has_table_privilege('service_role', 'public.profile_photos', 'INSERT') = true, 'profile_photos: service_role INSERT allowed');
select ok(has_table_privilege('service_role', 'public.profile_photos', 'UPDATE') = true, 'profile_photos: service_role UPDATE allowed');
select ok(has_table_privilege('service_role', 'public.profile_photos', 'DELETE') = true, 'profile_photos: service_role DELETE allowed');

-- feedback: exact column-level client privileges.
select ok(has_column_privilege('authenticated', 'public.feedback', 'user_id', 'INSERT') = true, 'feedback: authenticated can set user_id');
select ok(has_column_privilege('authenticated', 'public.feedback', 'category', 'INSERT') = true, 'feedback: authenticated can set category');
select ok(has_column_privilege('authenticated', 'public.feedback', 'message', 'INSERT') = true, 'feedback: authenticated can set message');
select ok(has_column_privilege('authenticated', 'public.feedback', 'status', 'INSERT') = false, 'feedback: authenticated cannot set status');
select ok(has_column_privilege('authenticated', 'public.feedback', 'suspension_related', 'INSERT') = false, 'feedback: authenticated cannot set suspension_related');
select ok(has_column_privilege('authenticated', 'public.feedback', 'related_suspension_at', 'INSERT') = false, 'feedback: authenticated cannot set related_suspension_at');
select ok(has_column_privilege('authenticated', 'public.feedback', 'admin_reply', 'INSERT') = false, 'feedback: authenticated cannot set admin_reply');
select ok(has_column_privilege('authenticated', 'public.feedback', 'resolved_at', 'INSERT') = false, 'feedback: authenticated cannot set resolved_at');
select ok(has_table_privilege('authenticated', 'public.feedback', 'UPDATE') = false, 'feedback: authenticated UPDATE denied');
select ok(has_table_privilege('authenticated', 'public.feedback', 'DELETE') = false, 'feedback: authenticated DELETE denied');
select ok(has_table_privilege('authenticated', 'public.feedback', 'TRUNCATE') = false, 'feedback: authenticated TRUNCATE denied');
select ok(has_table_privilege('service_role', 'public.feedback', 'INSERT') = true, 'feedback: service_role INSERT allowed');
select ok(has_table_privilege('service_role', 'public.feedback', 'SELECT') = true, 'feedback: service_role SELECT allowed');
select ok(has_table_privilege('service_role', 'public.feedback', 'UPDATE') = true, 'feedback: service_role UPDATE allowed');
select ok(has_table_privilege('anon', 'public.feedback', 'INSERT') = false, 'feedback: anon INSERT denied');

-- service_role feedback column-level privileges (submission + admin reply).
select ok(has_column_privilege('service_role', 'public.feedback', 'id', 'SELECT') = true, 'feedback: service_role can SELECT id for INSERT ... RETURNING');
select ok(has_column_privilege('service_role', 'public.feedback', 'user_id', 'SELECT') = true, 'feedback: service_role can SELECT user_id for INSERT ... RETURNING');
select ok(has_column_privilege('service_role', 'public.feedback', 'category', 'SELECT') = true, 'feedback: service_role can SELECT category for INSERT ... RETURNING');
select ok(has_column_privilege('service_role', 'public.feedback', 'status', 'SELECT') = true, 'feedback: service_role can SELECT status for INSERT ... RETURNING');
select ok(has_column_privilege('service_role', 'public.feedback', 'admin_reply', 'UPDATE') = true, 'feedback: service_role can UPDATE admin_reply');
select ok(has_column_privilege('service_role', 'public.feedback', 'replied_at', 'UPDATE') = true, 'feedback: service_role can UPDATE replied_at');
select ok(has_column_privilege('service_role', 'public.feedback', 'replied_by', 'UPDATE') = true, 'feedback: service_role can UPDATE replied_by');
select ok(has_column_privilege('service_role', 'public.feedback', 'brevo_message_id', 'UPDATE') = true, 'feedback: service_role can UPDATE brevo_message_id');

-- Client-facing feedback UPDATE/DELETE policies remain absent.
select ok(
  not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'feedback' and cmd in ('UPDATE', 'DELETE')
  ),
  'feedback: no client UPDATE/DELETE RLS policy exists'
);

-- server-only tables: TRUNCATE/REFERENCES/TRIGGER denied to clients.
select ok(has_table_privilege('authenticated', 'public.admin_users', 'TRUNCATE') = false, 'admin_users: authenticated TRUNCATE denied');
select ok(has_table_privilege('authenticated', 'public.waitlist_email_queue', 'TRUNCATE') = false, 'waitlist_email_queue: authenticated TRUNCATE denied');
select ok(has_table_privilege('anon', 'public.login_rate_buckets', 'SELECT') = false, 'login_rate_buckets: anon SELECT denied');

-- ===========================================================================
-- RLS helper EXECUTE grants: sufficient for authenticated, no anon/public
-- ===========================================================================

select ok(has_function_privilege('authenticated', 'public.profile_owns_photo_path(uuid, text)', 'EXECUTE') = true, 'profile_owns_photo_path executable by authenticated for RLS');
select ok(has_function_privilege('authenticated', 'public.owns_profile(uuid)', 'EXECUTE') = true, 'owns_profile executable by authenticated for RLS');
select ok(has_function_privilege('anon', 'public.profile_owns_photo_path(uuid, text)', 'EXECUTE') = false, 'profile_owns_photo_path not executable by anon');
select ok(has_function_privilege('public', 'public.profile_owns_photo_path(uuid, text)', 'EXECUTE') = false, 'profile_owns_photo_path not executable by public');
select ok(has_function_privilege('anon', 'public.owns_profile(uuid)', 'EXECUTE') = false, 'owns_profile not executable by anon');
select ok(has_function_privilege('public', 'public.owns_profile(uuid)', 'EXECUTE') = false, 'owns_profile not executable by public');
select ok(has_function_privilege('service_role', 'public.profile_owns_photo_path(uuid, text)', 'EXECUTE') = true, 'profile_owns_photo_path executable by service_role');

-- ===========================================================================
-- Profile-photo storage_path ownership protections
-- ===========================================================================

-- Seed two users + profiles (transactional, rolled back by finish).
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111'::uuid, 'authenticated', 'authenticated', 'pp1@test', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222'::uuid, 'authenticated', 'authenticated', 'pp2@test', now(), now());

insert into public.profiles (id, user_id, nickname, age, year, branch)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'PhotoUserOne', 20, '2nd', 'CSE'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'PhotoUserTwo', 21, '3rd', 'ECE');

-- DB-level trigger blocks a mismatched path even for service_role.
set role service_role;
select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '22222222-2222-2222-2222-222222222222/evil.jpg', 0)$$,
  '23514',
  'invalid profile photo storage path',
  'trigger rejects storage_path owned by another user (as service_role)'
);
reset role;

-- Valid path insert succeeds.
select lives_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111/ok.jpg', 0)$$,
  'valid own-path photo metadata insert succeeds'
);

-- Path validation edge cases (trigger is the authority; run as service_role).
set role service_role;

-- empty segment (repeated slash) rejected
select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111//empty.jpg', 10)$$,
  '23514',
  'invalid profile photo storage path',
  'rejects empty path segment (repeated separator)'
);

-- repeated separators rejected
select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111///triple.jpg', 11)$$,
  '23514',
  'invalid profile photo storage path',
  'rejects repeated separators'
);

-- malformed UUID prefix rejected
select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'not-a-uuid/file.jpg', 12)$$,
  '23514',
  'invalid profile photo storage path',
  'rejects malformed UUID prefix'
);
select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '1111/file.jpg', 13)$$,
  '23514',
  'invalid profile photo storage path',
  'rejects short malformed UUID prefix'
);

-- traversal attempts rejected
select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111/../secret.jpg', 14)$$,
  '23514',
  'invalid profile photo storage path',
  'rejects parent traversal segment'
);
select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111/a/../b.jpg', 15)$$,
  '23514',
  'invalid profile photo storage path',
  'rejects embedded traversal'
);

-- trailing / leading slash rejected
select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111/folder/', 16)$$,
  '23514',
  'invalid profile photo storage path',
  'rejects trailing slash'
);
select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '/11111111-1111-1111-1111-111111111111/file.jpg', 17)$$,
  '23514',
  'invalid profile photo storage path',
  'rejects leading slash'
);

-- valid nested object path accepted (real storage key may include folders)
select lives_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111/folder/sub/file.jpg', 1)$$,
  'accepts valid nested object path'
);

-- valid application storage key format accepted
select lives_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111/1700000000000-abc123.jpg', 2)$$,
  'accepts application storage key format'
);

reset role;

-- RLS: user1 cannot claim user2's path prefix.
set local role authenticated;
set local request.jwt.claim.sub to '11111111-1111-1111-1111-111111111111';
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '22222222-2222-2222-2222-222222222222/claim.jpg', 1)$$,
  null,
  'authenticated cannot claim another user photo path'
);

select throws_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '22222222-2222-2222-2222-222222222222/claim.jpg', 2)$$,
  null,
  'authenticated cannot insert metadata into another user profile'
);

select lives_ok(
  $$insert into public.profile_photos (profile_id, storage_path, display_order)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111/own.jpg', 3)$$,
  'authenticated valid own-path insert succeeds'
);

select throws_ok(
  $$update public.profile_photos set storage_path = '22222222-2222-2222-2222-222222222222/hijack.jpg'
    where profile_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid$$,
  null,
  'authenticated cannot re-point own photo to another user path'
);

reset role;

-- ===========================================================================
-- Default-privilege scoping
-- ===========================================================================

-- postgres-owned future tables: no client access (migration owner).
create table public._dp_owner_test (id int);
select ok(has_table_privilege('anon', 'public._dp_owner_test', 'SELECT') = false, 'default: anon no SELECT on postgres-created table');
select ok(has_table_privilege('authenticated', 'public._dp_owner_test', 'SELECT') = false, 'default: authenticated no SELECT on postgres-created table');
select ok(has_table_privilege('service_role', 'public._dp_owner_test', 'SELECT') = true, 'default: service_role SELECT on postgres-created table');
drop table public._dp_owner_test;

-- supabase_admin defaults still grant anon/authenticated (documented limitation).
select ok(
  exists (
    select 1 from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    join pg_roles r on r.oid = d.defaclrole
    where r.rolname = 'supabase_admin' and n.nspname = 'public' and d.defaclobjtype = 'r'
      and d.defaclacl::text ilike '%anon=%'
  ),
  'default: supabase_admin future tables still grant anon (documented limitation)'
);
select ok(
  not exists (
    select 1 from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    join pg_roles r on r.oid = d.defaclrole
    where r.rolname = 'postgres' and n.nspname = 'public' and d.defaclobjtype = 'r'
      and d.defaclacl::text ilike '%anon=%'
  ),
  'default: postgres future tables do not grant anon'
);

-- ===========================================================================
-- SECURITY DEFINER search_path: all pinned with pg_catalog + pg_temp
-- ===========================================================================

select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proconfig is null or p.proconfig::text not ilike '%pg_temp%')
  ),
  'all SECURITY DEFINER functions in public pin pg_temp'
);
select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proconfig is null or p.proconfig::text not ilike '%pg_catalog%')
  ),
  'all SECURITY DEFINER functions in public pin pg_catalog'
);

select * from finish();

rollback;
