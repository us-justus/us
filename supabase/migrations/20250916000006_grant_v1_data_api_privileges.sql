-- Grant least-privilege Data API privileges to authenticated role
-- Anonymous Supabase Auth users map to the `authenticated` Postgres role.
-- RLS remains enforced; these GRANTS only allow the API to reach the tables.
-- Existing migrations created tables and RLS policies but Data API exposure
-- defaults require explicit GRANTS when automatic exposure is disabled.

-- verification_records: app does SELECT (onboarding state) + UPSERT (usn, email) => SELECT, INSERT, UPDATE
grant select, insert, update on table public.verification_records to authenticated;

-- profiles: app does SELECT (own profile, discover) + UPSERT (onboarding) => SELECT, INSERT, UPDATE
grant select, insert, update on table public.profiles to authenticated;

-- profile_photos: app does SELECT, INSERT, DELETE (GET/POST/DELETE /api/onboarding/photos, discover);
-- UPDATE included because RLS policy `own photos update` exists and display_order reordering requires it.
grant select, insert, update, delete on table public.profile_photos to authenticated;

-- likes: app does SELECT (discover exclusion) + INSERT (swipe like) => SELECT, INSERT
grant select, insert on table public.likes to authenticated;

-- passes: app does SELECT (discover exclusion) + INSERT (swipe pass) => SELECT, INSERT
grant select, insert on table public.passes to authenticated;

-- blocks: app does SELECT (discover exclusion); RLS defines INSERT/DELETE for future blocking => SELECT, INSERT, DELETE
grant select, insert, delete on table public.blocks to authenticated;

-- matches: app does SELECT (swipeAction match check); INSERT via security-definer trigger create_match_if_mutual
-- RLS defines INSERT policy for completeness; grant both SELECT and INSERT.
grant select, insert on table public.matches to authenticated;

-- messages: RLS defines SELECT + INSERT (chat, match-scoped); no app query yet but required for V1 chat
grant select, insert on table public.messages to authenticated;

-- reports: RLS defines SELECT + INSERT (user reporting); no app query yet but required for V1 moderation
grant select, insert on table public.reports to authenticated;
