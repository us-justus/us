-- Schema invariants: RLS posture and SECURITY DEFINER hardening.
-- Run with `supabase test db` against a disposable local Supabase database.
-- Read-only: no fixtures or production data are inserted or changed.

create extension if not exists pgtap;

begin;

select plan(7);

-- RLS is enabled on every public table.
select ok(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = true
  ) = (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
  ),
  'every public table has RLS enabled'
);

-- No client-facing role may hold TRUNCATE/REFERENCES/TRIGGER privileges.
select ok(
  not exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
  ),
  'anon/authenticated hold no TRUNCATE/REFERENCES/TRIGGER grants'
);

-- Sensitive SECURITY DEFINER functions pin search_path with pg_temp.
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
