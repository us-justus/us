-- us notifications (spec/3D3.md) — persistent in-app LIKE / MATCH notifications.
--
-- Source of truth for in-app history. Browser/OS push is NOT implemented;
-- a future push_subscriptions delivery layer can read this same table.
-- MESSAGE is reserved (CHECK allows it) but nothing generates it yet.
--
-- Creation happens server-side only, via create_notification() (SECURITY
-- DEFINER): there is deliberately NO insert policy, so clients cannot forge
-- notifications. Clients may SELECT their own rows and UPDATE read/deleted
-- state only; immutable columns are enforced by trigger.
--
-- MIGRATION CREATED — NOT YET APPLIED to hosted Supabase.

create extension if not exists "pgcrypto";

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid null references auth.users(id) on delete set null,
  type text not null check (type in ('LIKE', 'MATCH', 'MESSAGE')),
  reference_id uuid null,
  read_at timestamptz null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  check (actor_id is null or actor_id <> user_id)
);

-- Idempotency: one notification per (recipient, type, reference).
-- reference_id is always set by create_notification(), so NULL-index
-- semantics never come into play for app-generated rows.
create unique index if not exists idx_notifications_dedupe
  on public.notifications (user_id, type, reference_id);

create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

-- Recipient-only reads. Actor identity is resolved to public profile fields
-- (username/nickname) server-side; raw actor_id never leaves the server.
drop policy if exists "own notifications select" on public.notifications;
create policy "own notifications select" on public.notifications
  for select to authenticated using (auth.uid() = user_id);

-- Recipient-only state updates (read / soft-delete). Column immutability
-- (actor_id, type, reference_id, user_id, created_at) is enforced by the
-- trigger below, so this policy cannot be abused to rewrite history.
-- No delete policy: clients soft-delete via deleted_at, never hard-delete.
drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update" on public.notifications
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Least privilege: reach the table for read/state updates only.
-- No INSERT/DELETE grant — writes go through create_notification().
grant select, update on table public.notifications to authenticated;

-- Freeze history columns: only read_at / deleted_at may change.
create or replace function public.enforce_notification_immutable_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if NEW.user_id is distinct from OLD.user_id
    or NEW.actor_id is distinct from OLD.actor_id
    or NEW.type is distinct from OLD.type
    or NEW.reference_id is distinct from OLD.reference_id
    or NEW.created_at is distinct from OLD.created_at then
    raise exception 'notification history is immutable';
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_notifications_immutable on public.notifications;
create trigger trg_notifications_immutable
  before update on public.notifications
  for each row execute function public.enforce_notification_immutable_fields();

-- Server-side idempotent creation (called from swipeAction with the
-- authenticated caller's context; bypasses RLS as owner).
-- LIKE:   (recipient B, actor A, 'LIKE', like.id)
-- MATCH:  (recipient A, actor B, 'MATCH', match.id) +
--         (recipient B, actor A, 'MATCH', match.id)
create or replace function public.create_notification(
  p_user_id uuid,
  p_actor_id uuid,
  p_type text,
  p_reference_id uuid
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_type not in ('LIKE', 'MATCH', 'MESSAGE') then
    raise exception 'invalid notification type';
  end if;
  if p_reference_id is null then
    raise exception 'notification reference is required';
  end if;
  if p_actor_id is not null and p_actor_id = p_user_id then
    raise exception 'self notification';
  end if;

  insert into public.notifications (user_id, actor_id, type, reference_id)
  values (p_user_id, p_actor_id, p_type, p_reference_id)
  on conflict (user_id, type, reference_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.notifications
    where user_id = p_user_id
      and type = p_type
      and reference_id = p_reference_id
    limit 1;
  end if;

  return v_id;
end; $$;

revoke all on function public.create_notification(uuid, uuid, text, uuid) from anon, authenticated;
grant execute on function public.create_notification(uuid, uuid, text, uuid) to authenticated;
