-- us local development seed data (deterministic, minimal).
--
-- Auth users, profiles, and photos are intentionally NOT seeded here:
-- Supabase Auth users require bcrypt-hashed passwords, auth.identities rows,
-- and matching encrypted_password/confirmation columns. Seeding them by hand
-- is brittle, so bootstrap is done through the app's normal anonymous flow
-- (see README / AGENTS: local admin bootstrap procedure).
--
-- This seed keeps the one singleton the app reads on every pre-launch load
-- (public.launch_config) deterministically pinned to "not launched".

insert into public.launch_config (id, launched, launched_at, prelaunch_version)
values (1, false, null, 'v1')
on conflict (id) do update
  set launched = excluded.launched,
      launched_at = excluded.launched_at,
      prelaunch_version = excluded.prelaunch_version;
