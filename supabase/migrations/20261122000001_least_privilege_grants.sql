-- us — Least privilege: tighten client-facing grants and SECURITY DEFINER defaults.
--
-- Additive to the applied migration history (historical migrations are untouched).
-- This migration is the source of truth for the client-facing grant matrix in
-- docs/database-access.md and is asserted by the pgTAP tests added in PR 5.

-- ---------------------------------------------------------------------------
-- 1) Server-only tables: no client-facing role may read or write.
-- ---------------------------------------------------------------------------

revoke all on table public.admin_users from public, anon, authenticated;
revoke all on table public.inside_audit_events from public, anon, authenticated;
revoke all on table public.inside_audit_events_history from public, anon, authenticated;
revoke all on table public.campus_spot_allocator from public, anon, authenticated;
revoke all on table public.campus_spot_claims from public, anon, authenticated;
revoke all on table public.discoverable_profiles from public, anon, authenticated;
revoke all on table public.email_provider_state from public, anon, authenticated;
revoke all on table public.email_verification_queue from public, anon, authenticated;
revoke all on table public.email_verification_tokens from public, anon, authenticated;
revoke all on table public.waitlist_email_queue from public, anon, authenticated;
revoke all on table public.login_rate_buckets from public, anon, authenticated;

-- Admin, referral, and future-product tables are server-only. Referral
-- attribution writes happen through the SECURITY DEFINER record_referral RPC;
-- reports live behind the admin service-role path.
revoke all on table public.reports from public, anon, authenticated;
revoke all on table public.referrals from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Client-usable tables: default-deny, then re-grant only the access the
--    product currently needs (all remaining access is scoped by RLS to the
--    caller's own rows).
-- ---------------------------------------------------------------------------

-- Own blocks: select + insert + delete on own rows.
revoke all on table public.blocks from public, anon, authenticated;
grant select, insert, delete on table public.blocks to authenticated;

-- Own notifications: read own rows + update own read state.
revoke all on table public.notifications from public, anon, authenticated;
grant select, update on table public.notifications to authenticated;

-- Own chat read-state cursor rows.
revoke all on table public.chat_read_state from public, anon, authenticated;
grant select, update on table public.chat_read_state to authenticated;

-- Own matches: read own match list (unread derivation, inbox).
revoke all on table public.matches from public, anon, authenticated;
grant select on table public.matches to authenticated;

-- Student feedback: insert only the student-authored columns, read own rows.
revoke all on table public.feedback from public, anon, authenticated;
grant insert (user_id, category, message) on table public.feedback to authenticated;
grant select on table public.feedback to authenticated;

-- Own invites: read the caller's own invite; creation/attribution is RPC-only.
revoke all on table public.invites from public, anon, authenticated;
grant select on table public.invites to authenticated;

-- Own profile photos: validated server routes perform CRUD on the user's own rows.
revoke all on table public.profile_photos from public, anon, authenticated;
grant select, insert, update, delete on table public.profile_photos to authenticated;

-- Onboarding verification records are already in the intended posture
-- (authenticated: SELECT/INSERT/UPDATE for owner-RLS writes via
-- 20250916000006; service_role: SELECT/INSERT/UPDATE via
-- 20261025000001; DELETE revoked server-side) — no statements are made here.

-- Like/pass/match write surfaces are server (trigger/RPC) only until a user-facing
-- feature ships; no client write path is granted yet.
revoke all on table public.likes from public, anon, authenticated;
revoke all on table public.passes from public, anon, authenticated;
revoke all on table public.messages from public, anon, authenticated;

-- Profiles are server-only (service_role only), including the public projection.
revoke all on table public.profiles from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Function EXECUTE grants: admin and launch-era surfaces are server-only.
-- ---------------------------------------------------------------------------

-- Admin RPCs: service-role only (admin access still gated in-app via is_admin()).
revoke all on function public.admin_list_reports(text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_reports(text, integer, integer) to service_role;
revoke all on function public.admin_resolve_report(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_resolve_report(uuid, text) to service_role;
revoke all on function public.admin_list_feedback(text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_feedback(text, integer, integer) to service_role;
revoke all on function public.admin_resolve_feedback(uuid) from public, anon, authenticated;
grant execute on function public.admin_resolve_feedback(uuid) to service_role;
revoke all on function public.admin_list_students(text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.admin_list_students(text, integer, integer, text) to service_role;
revoke all on function public.admin_overview_counts() from public, anon, authenticated;
grant execute on function public.admin_overview_counts() to service_role;
revoke all on function public.admin_prepare_waitlist_email_queue() from public, anon, authenticated;
grant execute on function public.admin_prepare_waitlist_email_queue() to service_role;
revoke all on function public.admin_waitlist_email_queue_summary() from public, anon, authenticated;
grant execute on function public.admin_waitlist_email_queue_summary() to service_role;
revoke all on function public.admin_set_student_active(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_student_active(uuid, boolean, text) to service_role;

-- Launch-era launch/invite/chat surfaces: no anon execution; the invite resolver
-- stays public, the user-context RPCs stay authenticated.
revoke all on function public.enforce_chat_read_state_immutable_fields() from public, anon, authenticated;
revoke all on function public.create_match_if_mutual() from public, anon, authenticated;
revoke all on function public.get_or_create_invite() from public, anon;
grant execute on function public.get_or_create_invite() to authenticated, service_role;
revoke all on function public.has_unread_chat() from public, anon;
grant execute on function public.has_unread_chat() to authenticated, service_role;
revoke all on function public.mark_chat_seen(uuid) from public, anon;
grant execute on function public.mark_chat_seen(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) SECURITY DEFINER hardening: pin search_path to an explicit, non-public set.
-- ---------------------------------------------------------------------------

alter function public.create_match_if_mutual() set search_path = pg_catalog, public, auth, pg_temp;
alter function public.get_or_create_invite() set search_path = pg_catalog, public, auth, pg_temp;
alter function public.has_unread_chat() set search_path = pg_catalog, public, auth, pg_temp;
alter function public.mark_chat_seen(uuid) set search_path = pg_catalog, public, auth, pg_temp;
alter function public.resolve_invite_token(text) set search_path = pg_catalog, public, auth, pg_temp;

-- ---------------------------------------------------------------------------
-- 5) Default privileges: deny client-facing roles on future public tables.
--    New migrations must grant explicitly before a client-facing table exists.
-- ---------------------------------------------------------------------------

alter default privileges in schema public
revoke all on tables from anon, authenticated;
