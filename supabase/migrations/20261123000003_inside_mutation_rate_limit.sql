-- Independent inside-admin mutation limiter. Login abuse protection keeps its
-- own thresholds and buckets; this RPC only shares the existing bucket table.
create or replace function public.check_inside_rate_limit(
  p_ip_key text,
  p_identity_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_window interval := make_interval(secs => 900);
  v_ip_count integer;
  v_identity_count integer;
  v_ip_window timestamptz;
  v_identity_window timestamptz;
  v_retry integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_ip_key is null or p_ip_key = '' or p_identity_key is null or p_identity_key = '' then
    return jsonb_build_object('allowed', false, 'retry_after_seconds', 60);
  end if;

  delete from public.login_rate_buckets
   where window_start < v_now - v_window;

  insert into public.login_rate_buckets (bucket_key, attempt_count, window_start, updated_at)
  values (p_ip_key, 1, v_now, v_now)
  on conflict (bucket_key) do update set
    attempt_count = case when login_rate_buckets.window_start < v_now - v_window then 1 else login_rate_buckets.attempt_count + 1 end,
    window_start = case when login_rate_buckets.window_start < v_now - v_window then v_now else login_rate_buckets.window_start end,
    updated_at = v_now
  returning attempt_count, window_start into v_ip_count, v_ip_window;

  insert into public.login_rate_buckets (bucket_key, attempt_count, window_start, updated_at)
  values (p_identity_key, 1, v_now, v_now)
  on conflict (bucket_key) do update set
    attempt_count = case when login_rate_buckets.window_start < v_now - v_window then 1 else login_rate_buckets.attempt_count + 1 end,
    window_start = case when login_rate_buckets.window_start < v_now - v_window then v_now else login_rate_buckets.window_start end,
    updated_at = v_now
  returning attempt_count, window_start into v_identity_count, v_identity_window;

  if v_ip_count > 100 or v_identity_count > 10 then
    if v_ip_count > 100 then
      v_retry := ceil(extract(epoch from ((v_ip_window + v_window) - v_now)));
    else
      v_retry := ceil(extract(epoch from ((v_identity_window + v_window) - v_now)));
    end if;
    return jsonb_build_object('allowed', false, 'retry_after_seconds', greatest(v_retry, 1));
  end if;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

revoke all on function public.check_inside_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.check_inside_rate_limit(text, text) to service_role;

comment on function public.check_inside_rate_limit(text, text) is
  'Inside-admin mutation limiter: 100 requests per IP and 10 per IP+identity per 15 minutes. Independent from login rate-limit calls; service-role only.';
