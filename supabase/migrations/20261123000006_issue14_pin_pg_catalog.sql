-- Issue #14 follow-up: explicitly pin pg_catalog first in every SECURITY DEFINER
-- function introduced by migrations 00002-00005. This preserves immutable
-- migration history for staging environments where those migrations have
-- already been applied.
ALTER FUNCTION public.admin_claim_feedback_reply(uuid, uuid, text, uuid)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_finalize_feedback_reply(uuid, uuid, text, uuid)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_settle_feedback_reply_claim(uuid, uuid, text, text, uuid)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_recover_feedback_reply(uuid, text, uuid)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;

ALTER FUNCTION public.check_inside_rate_limit(text, text)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;

ALTER FUNCTION public.revoke_inside_session(text, timestamptz)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.is_inside_session_revoked(text)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;

ALTER FUNCTION public.inside_admin_actor_ok(uuid)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_overview_counts(uuid)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_list_students(uuid, text, integer, integer, text)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_list_reports(uuid, text, integer, integer)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_list_feedback(uuid, text, integer, integer)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_waitlist_email_queue_summary(uuid)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_prepare_waitlist_email_queue(uuid)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_set_student_active(uuid, uuid, boolean, text)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_resolve_report(uuid, text, uuid)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
ALTER FUNCTION public.admin_resolve_feedback(uuid, uuid)
  SET search_path = pg_catalog, public, auth, extensions, pg_temp;
