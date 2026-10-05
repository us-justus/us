-- The single authoritative waitlist population: active (or unset-active)
-- profiles with at least one photo. Only the aggregate leaves this function.
create or replace function public.get_waitlist_count()
returns integer
language sql
security definer
set search_path = public, auth, pg_temp
as $$
  select count(*)::integer
    from public.profiles p
   where p.is_active is distinct from false
     and exists (
       select 1
         from public.profile_photos ph
        where ph.profile_id = p.id
     );
$$;

revoke all on function public.get_waitlist_count() from public;
revoke all on function public.get_waitlist_count() from anon;
grant execute on function public.get_waitlist_count() to authenticated;

comment on function public.get_waitlist_count() is
  'Current count of active photo-complete profiles; returns only the aggregate integer.';

-- Keep the INSIDE overview on exactly the same population definition.
create or replace function public.admin_overview_counts()
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_waiting integer;
  v_suspended integer;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_waiting := public.get_waitlist_count();

  select count(*)::integer into v_suspended
    from public.profiles p
   where p.is_active = false;

  return jsonb_build_object('waiting', v_waiting, 'suspended', v_suspended);
end;
$$;

revoke all on function public.admin_overview_counts() from public;
revoke all on function public.admin_overview_counts() from anon;
grant execute on function public.admin_overview_counts() to authenticated;

comment on function public.admin_overview_counts() is
  'INSIDE dashboard: { waiting, suspended } aggregates. waiting uses get_waitlist_count(); suspended = profiles with is_active = false. Admin-only; exposes no private fields.';
