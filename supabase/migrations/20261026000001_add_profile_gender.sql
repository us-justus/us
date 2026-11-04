-- Add an optional gender field to profiles.
-- Existing profiles remain NULL until their owners choose a value.

alter table public.profiles
  add column if not exists gender text null;

alter table public.profiles
  drop constraint if exists profiles_gender_allowed;

alter table public.profiles
  add constraint profiles_gender_allowed
  check (
    gender is null
    or gender in ('Male', 'Female')
  );

comment on column public.profiles.gender is
  'Public user-selected profile gender: Male or Female. NULL means not selected (legacy profiles).';

-- Keep the discoverable projection explicit: gender is visible, while
-- auth IDs, USNs, email addresses, and moderation fields remain excluded.
create or replace view public.discoverable_profiles
with (security_barrier = true) as
select
  username,
  spot,
  nickname,
  age,
  year,
  branch,
  bio,
  interests,
  gender
from public.profiles
where is_active is true
  and username is not null;

-- This projection has no block/product-state predicates. Do not grant it to
-- client roles: direct PostgREST reads would bypass the guarded search and
-- public-profile routes. Public display is served through those server paths.
revoke all on table public.discoverable_profiles from public, anon, authenticated;
grant select on table public.discoverable_profiles to service_role;
