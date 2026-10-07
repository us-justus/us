-- Restore server-side profile photo reads.
-- RLS and Storage policies are intentionally unchanged.
grant select on table public.profile_photos to service_role;
