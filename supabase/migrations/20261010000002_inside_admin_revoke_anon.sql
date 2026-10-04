-- us INSIDE Step 1 follow-up (staging): revoke residual anon EXECUTE on the
-- admin RPCs.
--
-- CONTEXT: the INSIDE v1 migration (20261002000004) revoked EXECUTE from
-- PUBLIC only. Supabase auto-grants EXECUTE to anon/authenticated/
-- service_role at function-creation time, so anon retained EXECUTE on the
-- three functions below (verified live on staging via
-- information_schema.role_routine_grants). Exposure is benign today — each
-- function re-checks is_admin() internally and anon calls fail closed
-- (false / 42501, no data) — but the grant exceeds the intended
-- authenticated-only posture.
--
-- CHANGE: revoke EXECUTE from `anon` on exactly these three functions.
-- `authenticated` (session-client gate, page, and launch route),
-- `service_role`, and owner grants are untouched.
--
-- WHY SAFE: every in-repo caller runs with a signed-in session
-- (authenticated role): requireInsideAdmin() + POST /api/inside/login use
-- is_admin(); GET /inside uses admin_overview_counts(); POST
-- /api/inside/launch uses admin_set_launch(). No anon call path exists in
-- src/. The internal is_admin() checks stay as defense-in-depth.
--
-- ROLLBACK: grant execute on the same signatures to anon (no data change
-- involved). Apply to staging first; production only after staging
-- verification.

revoke all on function public.is_admin() from anon;
revoke all on function public.admin_overview_counts() from anon;
revoke all on function public.admin_set_launch(boolean, text) from anon;
