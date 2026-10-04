-- us EMAIL QUEUE fix: reclaim crashed sends.
--
-- DIAGNOSIS (from the staging proof run): claim_email_verification_job()
-- only considered status='pending'. A worker that crashed AFTER claiming
-- left its row in status='sending' with a lapsed lease — reclaimable by
-- design, but no candidate filter ever matched it, so the row was stuck
-- until the expiry sweep (up to 15 min) instead of lease expiry (~120s).
--
-- FIX: candidates are now pending rows (due, unexpired, unleashed) PLUS
-- sending rows whose lease has lapsed (the crash-recovery path). Reclaim
-- re-stamps the lease and keeps attempts unchanged — attempts still
-- increment only when a processing attempt COMPLETES, so a crash never
-- burns an attempt. Expiry stays a pre-send gate: the claim still requires
-- expires_at > now(); lapsed sending rows are owned by
-- expire_email_verification_jobs(), and processClaimedJob() re-checks
-- expiry before any send. Grants/RLS unchanged (service_role only).
create or replace function public.claim_email_verification_job(
  p_lease_owner text,
  p_lease_seconds integer
)
returns setof public.email_verification_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lease integer;
begin
  if p_lease_owner is null or p_lease_owner = '' then
    raise exception 'lease owner required';
  end if;
  v_lease := coalesce(p_lease_seconds, 0);
  if v_lease < 10 or v_lease > 900 then
    raise exception 'lease seconds out of range (10..900)';
  end if;

  -- Global provider cooldown gate: no claims while Brevo is cooling down.
  perform 1 from public.email_provider_state
   where provider = 'brevo' and cooldown_until is not null and cooldown_until > now();
  if found then
    return;
  end if;

  return query
  with candidate as (
    select q.id
      from public.email_verification_queue q
     where (
             q.status = 'pending'
             -- Crash recovery: a sending row whose lease lapsed is work
             -- again (attempts untouched; finalize counts completions).
             or (q.status = 'sending'
                 and q.lease_expires_at is not null
                 and q.lease_expires_at <= now())
           )
       and q.next_retry_at <= now()
       and q.expires_at > now()
       and (q.status = 'sending' or q.lease_expires_at is null or q.lease_expires_at <= now())
     order by q.next_retry_at asc, q.created_at asc
     limit 1
     for update skip locked
  )
  update public.email_verification_queue q
     set status = 'sending',
         lease_owner = p_lease_owner,
         lease_expires_at = now() + make_interval(secs => v_lease),
         updated_at = now()
    from candidate c
   where q.id = c.id
  returning q.*;
end;
$$;

revoke all on function public.claim_email_verification_job(text, integer) from public;
revoke all on function public.claim_email_verification_job(text, integer) from anon;
revoke all on function public.claim_email_verification_job(text, integer) from authenticated;
grant execute on function public.claim_email_verification_job(text, integer) to service_role;

comment on function public.claim_email_verification_job(text, integer) is
  'Email queue atomic claim: pending + lapsed-lease sending (crash recovery) via SKIP LOCKED + lease stamp. Refuses work during provider cooldown. Service-role only. Never hold open across the Brevo call.';
