insert into public.verification_records (user_id, email, email_skipped, email_verified_at)
select
  u.id,
  btrim(u.email),
  false,
  coalesce(u.email_confirmed_at, u.confirmed_at)
from auth.users u
where u.email is not null
  and (u.email_confirmed_at is not null or u.confirmed_at is not null)
  and char_length(btrim(u.email)) between 3 and 254
  and btrim(u.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  and lower(btrim(u.email)) not like '%@us.signin.invalid'
on conflict (user_id) do update
set
  email = excluded.email,
  email_skipped = false,
  email_verified_at = excluded.email_verified_at
where public.verification_records.email is null
   or lower(btrim(public.verification_records.email)) is distinct from lower(btrim(excluded.email))
   or public.verification_records.email_verified_at is null;
