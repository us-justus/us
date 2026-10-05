-- us cleanup Step 1: remove the launch system.
--
-- CONTEXT: the product no longer has a launch state. There is no countdown,
-- no go-live, and no launched/not-launched routing — the application
-- operates permanently in its waiting experience. This migration removes
-- every launch-only database object while preserving all unrelated
-- functionality. Historical migrations are left untouched; this cleanup
-- migration supersedes them.
--
-- STAGING COMPATIBILITY: staging already holds legitimate historical audit
-- rows with LAUNCH_ENABLED / LAUNCH_DISABLED / LAUNCH_VERSION_CHANGED (7
-- rows at the time of writing). Adding the strict six-action CHECK while
-- those rows still live in the active table fails. This migration therefore
-- archives those rows first, then tightens the active constraint:
--
-- REMOVES (exclusively launch-specific):
--   1. public.admin_set_launch(boolean, text) — the only sanctioned
--      launch_config writer (INSIDE v1). No remaining caller: POST
--      /api/inside/launch and src/lib/auth/launch.ts are deleted in the
--      same change.
--   2. public.launch_config — the singleton launch flag table (foundation
--      migration PART 1 + INSIDE v1 prelaunch_version column). Dropping the
--      table removes its SELECT policy ("launch config readable"), its
--      anon/authenticated SELECT grants, its updated-at trigger, and the
--      prelaunch_version field in one step.
--   3. Launch-only audit actions (LAUNCH_ENABLED, LAUNCH_DISABLED,
--      LAUNCH_VERSION_CHANGED) from the inside_audit_events CHECK
--      constraint. The remaining actions (ADMIN_LOGIN_SUCCESS,
--      ADMIN_LOGIN_FAILURE, ADMIN_LOGOUT, STUDENT_SUSPENDED,
--      STUDENT_RESTORED, REPORT_RESOLVED) are kept exactly.
--
-- ARCHIVES (history is preserved, never deleted or renamed):
--   4. public.inside_audit_events_history — minimal archive table for the
--      three historical launch action types. There is no pre-existing
--      audit-history/archive mechanism (verified: no other migration or
--      helper reads or archives audit rows; the only audit reader/writer
--      is src/lib/inside/audit.ts, which targets inside_audit_events),
--      so a dedicated table is used. It mirrors every useful audit column
--      (id, actor_user_id, action, target_type, target_id, metadata,
--      created_at) plus archived_at, and its own CHECK admits ONLY the
--      three launch actions — historical rows stay clearly identifiable
--      as launch events and the archive can never become a second live
--      audit table. RLS posture mirrors the active table (enabled, no
--      policies, no grants).
--   5. Existing launch rows are copied into the archive (idempotent: rows
--      whose id is already archived are skipped), then removed from the
--      active table — so the strict active CHECK can be added without
--      touching the permanent events. No launch action is renamed into an
--      unrelated action; no launch action remains valid for future writes
--      to the active table.
--
-- PRESERVES (nothing below is modified or weakened):
--   - public.profiles username / spot, profiles_username_format,
--     idx_profiles_username_lower, profiles_spot_positive,
--     idx_profiles_spot_unique (foundation PARTs 7–8: public identity).
--   - public.campus_spot_allocator + allocate_campus_spot() (permanent
--     #spot allocation).
--   - public.admin_users, is_admin(), resolve_phone_login_email(),
--     admin_overview_counts() (inside auth + overview).
--   - public.inside_audit_events RLS posture (no policies, no
--     grants), indexes, and fail-closed writer contract.
--   - All permanent audit events (ADMIN_LOGIN_SUCCESS,
--     ADMIN_LOGIN_FAILURE, ADMIN_LOGOUT, STUDENT_SUSPENDED,
--     STUDENT_RESTORED, REPORT_RESOLVED) — untouched in place.
--   - Student moderation + report RPCs (admin_list_students,
--     admin_set_student_active, admin_list_reports, admin_resolve_report).
--
-- TRANSACTIONALITY: Supabase runs each migration file in a single
-- transaction, so the archive copy + active delete + constraint rewrite
-- below apply atomically. No explicit BEGIN/COMMIT (consistent with every
-- other migration in this repo). Every statement is idempotent and handles
-- both a fresh database (zero launch rows: copy/delete touch nothing) and
-- the staging state (7 historical launch rows: preserved in history).
--
-- ROLLBACK: re-apply the dropped objects from their original migrations
-- (20250930000001_prelaunch_foundation.sql PART 1,
-- 20261002000004_inside_admin_v1.sql PARTs 1+6). Any rows written to
-- launch_config after this migration are discarded by the rollback.
-- Archived launch rows stay in inside_audit_events_history; to restore the
-- pre-cleanup audit shape, copy them back before re-adding the nine-action
-- CHECK from 20261011000001.

-- ============================================================
-- PART 1 — drop the launch writer (no remaining caller)
-- ============================================================
drop function if exists public.admin_set_launch(boolean, text);

-- ============================================================
-- PART 2 — drop the launch singleton (policy, grants, trigger go with it)
-- ============================================================
drop table if exists public.launch_config;

-- ============================================================
-- PART 3 — archive table for historical launch audit events
-- (no pre-existing archive mechanism; kept minimal and clearly named)
-- ============================================================
create table if not exists public.inside_audit_events_history (
  -- Original event id: preserved so an archived row is traceable 1:1.
  id uuid primary key,
  actor_user_id uuid null references auth.users(id) on delete set null,
  -- Launch-only: historical rows stay identifiable as launch events.
  action text not null,
  target_type text null,
  target_id text null,
  metadata jsonb null,
  -- Original event time: preserved, never rewritten.
  created_at timestamptz not null,
  archived_at timestamptz not null default now(),
  constraint inside_audit_events_history_action_check check (action in (
    'LAUNCH_ENABLED',
    'LAUNCH_DISABLED',
    'LAUNCH_VERSION_CHANGED'
  ))
);

alter table public.inside_audit_events_history enable row level security;

-- Intentionally NO policies and NO grants to anon / authenticated /
-- public: mirrors the active audit table. Reads go through an authorized
-- server-side path only; there is no application writer to this table
-- (backfill below is the sole writer).
create index if not exists inside_audit_events_history_created_at_idx
  on public.inside_audit_events_history (created_at desc);

create index if not exists inside_audit_events_history_action_idx
  on public.inside_audit_events_history (action);

comment on table public.inside_audit_events_history is
  'Historical launch audit events (LAUNCH_ENABLED / LAUNCH_DISABLED / LAUNCH_VERSION_CHANGED) archived by 20261012000001. Read-only history; the active table inside_audit_events no longer accepts launch actions.';

-- ============================================================
-- PART 4 — copy launch rows to history (idempotent), then remove them
-- from the active table so the strict CHECK below can be added.
-- Fresh database: the SELECT matches zero rows; both statements are
-- no-ops. Staging: the 7 historical launch rows move, permanent events
-- are untouched.
-- ============================================================
insert into public.inside_audit_events_history
  (id, actor_user_id, action, target_type, target_id, metadata, created_at)
select
  e.id, e.actor_user_id, e.action, e.target_type, e.target_id,
  e.metadata, e.created_at
from public.inside_audit_events e
where e.action in (
  'LAUNCH_ENABLED',
  'LAUNCH_DISABLED',
  'LAUNCH_VERSION_CHANGED'
)
-- Re-runnable: never duplicate a row archived by an earlier attempt.
and not exists (
  select 1 from public.inside_audit_events_history h where h.id = e.id
);

delete from public.inside_audit_events
where action in (
  'LAUNCH_ENABLED',
  'LAUNCH_DISABLED',
  'LAUNCH_VERSION_CHANGED'
);

-- ============================================================
-- PART 5 — strict active CHECK: exactly the six permanent actions
-- (Postgres cannot ALTER a CHECK list in place: drop + re-add).
-- Launch actions are rejected for all future application writes.
-- ============================================================
alter table public.inside_audit_events
  drop constraint if exists inside_audit_events_action_check;

alter table public.inside_audit_events
  add constraint inside_audit_events_action_check check (action in (
    'ADMIN_LOGIN_SUCCESS',
    'ADMIN_LOGIN_FAILURE',
    'ADMIN_LOGOUT',
    'STUDENT_SUSPENDED',
    'STUDENT_RESTORED',
    'REPORT_RESOLVED'
  ));
