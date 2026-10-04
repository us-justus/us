-- us INSIDE Step 2: immutable admin audit log (foundation only).
--
-- ADDS (nothing existing is modified or weakened):
--   1. inside_audit_events — append-only record of privileged /inside
--      actions plus security-sensitive admin authentication events. Every
--      row is attributable to a specific admin (actor_user_id) except
--      ADMIN_LOGIN_FAILURE, where no session exists by definition: the
--      actor is NULL and only a salted-context-free sha256 of the
--      normalized identifier is kept (same privacy approach as the
--      login-abuse buckets — raw identifiers never persist).
--
-- SECURITY MODEL (fail-closed, mirrors admin_users):
--   - RLS enabled with NO policies: every client role (anon,
--     authenticated) is denied SELECT / INSERT / UPDATE / DELETE.
--   - NO table grants to anon / authenticated / public. The ONLY writer is
--     the server-only service-role client inside src/lib/inside/audit.ts
--     (service_role bypasses RLS; the key never leaves the server).
--   - The actor is derived server-side from the authenticated admin
--     context (requireInsideAdmin() / the just-verified login session) —
--     never from browser/client input. There is no code path that accepts
--     an arbitrary actor_user_id.
--   - Append-only by construction: no UPDATE/DELETE path exists for any
--     role; immutability is enforced by the absence of policies/grants,
--     not by application discipline.
--   - Controlled actions enforced at the DB level via CHECK: only the six
--     Step 2 actions can be stored. Arbitrary action strings are rejected
--     even by the privileged writer.
--
-- WHAT IS NEVER STORED: passwords, admin keys, SMTP credentials,
-- service-role keys, session tokens, recovery/email-verification tokens,
-- or other auth secrets. Metadata carries only hashed identifiers and
-- launch state transitions (see src/lib/inside/audit.ts).
--
-- FUTURE /inside/audit UI (not built here): newest-first pagination via
-- the created_at DESC index; actor/action/target/date filtering via the
-- supporting indexes. Reads must go through an authorized server-side
-- path (service-role client behind requireInsideAdmin(), or a future
-- SECURITY DEFINER reader that re-checks is_admin()) — never broad
-- direct table access for the browser.
--
-- ROLLBACK: drop table public.inside_audit_events (audit history is lost;
-- product tables are untouched).

create table if not exists public.inside_audit_events (
  id uuid primary key default gen_random_uuid(),
  -- NULL only for ADMIN_LOGIN_FAILURE (no authenticated session exists to
  -- attribute). All other actions require a verified admin actor.
  actor_user_id uuid null references auth.users(id) on delete set null,
  action text not null check (action in (
    'ADMIN_LOGIN_SUCCESS',
    'ADMIN_LOGIN_FAILURE',
    'ADMIN_LOGOUT',
    'LAUNCH_ENABLED',
    'LAUNCH_DISABLED',
    'LAUNCH_VERSION_CHANGED'
  )),
  target_type text null,
  target_id text null,
  metadata jsonb null,
  -- Server-generated. The writer never sets this column, so client clocks
  -- and client input cannot influence event ordering.
  created_at timestamptz not null default now()
);

alter table public.inside_audit_events enable row level security;

-- Intentionally NO policies and NO grants to anon / authenticated /
-- public: RLS denies every client role all operations. Writes happen only
-- via the server-only service-role client (see src/lib/inside/audit.ts).

-- Newest-first pagination for the future /inside/audit UI.
create index if not exists inside_audit_events_created_at_idx
  on public.inside_audit_events (created_at desc);

-- Actor / action / target filtering for the future /inside/audit UI.
create index if not exists inside_audit_events_actor_idx
  on public.inside_audit_events (actor_user_id);

create index if not exists inside_audit_events_action_idx
  on public.inside_audit_events (action);

create index if not exists inside_audit_events_target_idx
  on public.inside_audit_events (target_type, target_id);

comment on table public.inside_audit_events is
  'INSIDE Step 2: append-only admin audit log. RLS with no policies (no client access); writes only via the server-only service-role client in src/lib/inside/audit.ts. Never stores secrets.';
