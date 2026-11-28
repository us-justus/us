-- Server-side revocation for copied inside-admin cookies. The raw cookie is
-- never stored; only a SHA-256 digest is retained until the cookie expires.
create table if not exists public.inside_session_revocations (
  token_hash text primary key,
  expires_at timestamptz not null,
  revoked_at timestamptz not null default now()
);

alter table public.inside_session_revocations enable row level security;
revoke all on table public.inside_session_revocations from public, anon, authenticated;

create or replace function public.revoke_inside_session(p_token text, p_expires_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' or p_token is null or p_expires_at is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.inside_session_revocations(token_hash, expires_at)
  values (encode(extensions.digest(p_token, 'sha256'), 'hex'), p_expires_at)
  on conflict (token_hash) do update set expires_at = excluded.expires_at;
end;
$$;

create or replace function public.is_inside_session_revoked(p_token text)
returns boolean
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.inside_session_revocations
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
      and expires_at > now()
  );
$$;

revoke all on function public.revoke_inside_session(text, timestamptz) from public, anon, authenticated;
grant execute on function public.revoke_inside_session(text, timestamptz) to service_role;
revoke all on function public.is_inside_session_revoked(text) from public, anon;
grant execute on function public.is_inside_session_revoked(text) to authenticated;
