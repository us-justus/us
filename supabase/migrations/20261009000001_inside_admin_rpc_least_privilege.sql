-- us INSIDE Step 1 (admin security hardening): least-privilege EXECUTE on the
-- password-gated login resolvers.
--
-- TRACE (verified in src/ — the only callers):
--   - public.resolve_login_email(text, text)
--       called ONLY via the server-only service-role client in
--       POST /api/auth/login and POST /api/inside/login. No session-client,
--       client-component, or anon call path exists.
--   - public.resolve_phone_login_email(text, text)
--       called ONLY via the server-only service-role client in
--       POST /api/inside/login. No other call path exists.
--
-- CHANGE: revoke EXECUTE from `authenticated` on both resolvers, leaving
-- `service_role` (granted in 20261006000001_login_abuse_protection) as the
-- sole executor. A compromised/logged-in student session can no longer
-- invoke either resolver directly through PostgREST — even with valid auth.
--
-- INTENTIONALLY UNCHANGED (fail-closed by internal is_admin() checks, and
-- required by live server code through the user's session client):
--   - public.is_admin() — called via the session client in
--     requireInsideAdmin() (src/lib/inside/auth.ts) and
--     POST /api/inside/login. Revoking `authenticated` would break the gate
--     itself; narrowing it would require a second auth architecture, which
--     is out of scope. Direct calls by non-admins return false, never data.
--   - public.admin_overview_counts() — called via the session client in
--     GET /inside (src/app/inside/page.tsx). Raises 42501 for non-admins.
--   - public.admin_set_launch(boolean, text) — called via the session client
--     in POST /api/inside/launch. Raises 42501 for non-admins.
-- Keeping those EXECUTE grants while the functions re-check is_admin()
-- inside is deliberate defense-in-depth, not exposure.
--
-- ROLLBACK: re-grant execute ... to authenticated (no data change involved).

revoke all on function public.resolve_login_email(text, text) from authenticated;
revoke all on function public.resolve_phone_login_email(text, text) from authenticated;

-- service_role retains EXECUTE on both resolvers (sole sanctioned caller).
-- No grant statement needed: granted in 20261006000001 and untouched above.
