-- Make report resolution + optional student moderation one database transaction.
-- Audit rows are inserted in the same transaction as their state changes.
create or replace function public.admin_resolve_report_with_moderation(
  p_actor_id uuid,
  p_report_id uuid,
  p_resolution text,
  p_moderation text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare
  v_previous_status text;
  v_reported_id uuid;
  v_report_changed boolean := false;
  v_previous_active boolean;
  v_new_active boolean;
  v_moderation_changed boolean := false;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_actor_id is null or not exists (
    select 1 from public.admin_users where user_id = p_actor_id
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_report_id is null or p_resolution not in ('resolved', 'dismissed') then
    raise exception 'invalid report resolution' using errcode = '22000';
  end if;
  if p_moderation is not null and p_moderation not in ('suspend', 'restore') then
    raise exception 'invalid moderation action' using errcode = '22000';
  end if;
  if p_moderation = 'suspend' and (v_reason is null or char_length(v_reason) > 280) then
    raise exception 'suspension reason is required and must be at most 280 characters' using errcode = '22000';
  end if;

  select r.status, r.reported_id
    into v_previous_status, v_reported_id
    from public.reports r
   where r.id = p_report_id
   for update;
  if not found then
    raise exception 'report not found' using errcode = '02000';
  end if;

  if v_previous_status = p_resolution then
    return jsonb_build_object(
      'ok', true, 'changed', false, 'status', v_previous_status,
      'moderation', jsonb_build_object('ok', true, 'changed', false,
        'isActive', (select p.is_active from public.profiles p where p.user_id = v_reported_id))
    );
  end if;

  if p_moderation is not null then
    select p.is_active into v_previous_active
      from public.profiles p
     where p.user_id = v_reported_id
     for update;
    if not found then
      raise exception 'student not found' using errcode = '02000';
    end if;
  end if;

  update public.reports set status = p_resolution where id = p_report_id;
  v_report_changed := true;

  insert into public.inside_audit_events
    (actor_user_id, action, target_type, target_id, metadata)
  values
    (p_actor_id, 'REPORT_RESOLVED', 'report', p_report_id::text,
      jsonb_build_object('previous_status', v_previous_status,
                         'new_status', p_resolution,
                         'reported_id', v_reported_id));

  if p_moderation = 'suspend' and v_previous_active is distinct from false then
    update public.profiles
       set is_active = false, suspension_reason = v_reason,
           suspended_at = now(), suspended_by = p_actor_id, updated_at = now()
     where user_id = v_reported_id;
    v_new_active := false;
    v_moderation_changed := true;
  elsif p_moderation = 'restore' and v_previous_active is distinct from true then
    update public.profiles
       set is_active = true, suspension_reason = null,
           suspended_at = null, suspended_by = null, updated_at = now()
     where user_id = v_reported_id;
    v_new_active := true;
    v_moderation_changed := true;
  else
    v_new_active := v_previous_active;
  end if;

  if v_moderation_changed then
    insert into public.inside_audit_events
      (actor_user_id, action, target_type, target_id, metadata)
    values
      (p_actor_id,
       case when v_new_active then 'STUDENT_RESTORED' else 'STUDENT_SUSPENDED' end,
       'student', v_reported_id::text,
       jsonb_build_object('previous_active', v_previous_active,
                          'new_active', v_new_active,
                          'report_id', p_report_id,
                          'reason', case when v_new_active then null else v_reason end));
  end if;

  return jsonb_build_object(
    'ok', true, 'changed', v_report_changed, 'status', p_resolution,
    'moderation', case when p_moderation is null then null else
      jsonb_build_object('ok', true, 'changed', v_moderation_changed, 'isActive', v_new_active)
    end
  );
end;
$$;

revoke all on function public.admin_resolve_report_with_moderation(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_resolve_report_with_moderation(uuid, uuid, text, text, text)
  to service_role;
