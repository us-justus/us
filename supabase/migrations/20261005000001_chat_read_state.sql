-- us chat unread activity — per-user/per-match read cursors.
--
-- Chat and the notification bell are intentionally SEPARATE systems: a message
-- never creates a notification row (notifications.type = 'MESSAGE' stays
-- reserved and unused; create_notification() is untouched). Realtime delivers
-- activity; THIS table remembers what the user has seen across sessions.
--
-- Read semantics (MVP): a conversation is READ for a user when they open
-- /chat/[matchId] and it loads successfully. Opening advances their cursor
-- (user_id, match_id) to the match's latest message id. Derivation (code):
--   unread = latest message exists
--        AND latest.sender_id <> viewer
--        AND (no cursor row OR cursor.last_seen_message_id <> latest.id)
-- Own-only or never-messaged conversations are never unread.
--
-- Writes are server-side only via mark_chat_seen() (SECURITY DEFINER): there
-- is deliberately NO insert policy, so clients cannot forge cursors — the
-- same RPC-over-policy shape as notifications/create_notification(). Clients
-- may SELECT their own rows; identity columns are frozen by trigger.
--
-- Additive only: no change to messages, matches, notifications, existing
-- policies, functions, or publication.

create table if not exists public.chat_read_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  last_seen_message_id uuid null references public.messages(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One cursor per (user, match). The leading user_id column also serves
-- user-scoped unread lookups — no second index needed.
create unique index if not exists idx_chat_read_state_user_match
  on public.chat_read_state (user_id, match_id);

alter table public.chat_read_state enable row level security;

-- Private user state: a user sees only their own cursors.
drop policy if exists "own chat read state select" on public.chat_read_state;
create policy "own chat read state select" on public.chat_read_state
  for select to authenticated using (auth.uid() = user_id);

-- Recipient-only state updates (same posture as notifications). Column
-- immutability (user_id, match_id, created_at) is enforced by the trigger
-- below. No insert/delete policy: rows are written via mark_chat_seen().
drop policy if exists "own chat read state update" on public.chat_read_state;
create policy "own chat read state update" on public.chat_read_state
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Least privilege: reach the table for read/state updates only.
grant select, update on table public.chat_read_state to authenticated;

-- updated_at maintenance (reuses the existing handle_updated_at()).
drop trigger if exists trg_chat_read_state_updated on public.chat_read_state;
create trigger trg_chat_read_state_updated before update on public.chat_read_state
for each row execute function public.handle_updated_at();

-- Freeze identity columns: only last_seen_* / updated_at may change.
create or replace function public.enforce_chat_read_state_immutable_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if NEW.user_id is distinct from OLD.user_id
    or NEW.match_id is distinct from OLD.match_id
    or NEW.created_at is distinct from OLD.created_at then
    raise exception 'chat read state identity is immutable';
  end if;
  return NEW;
end; $$;

drop trigger if exists trg_chat_read_state_immutable on public.chat_read_state;
create trigger trg_chat_read_state_immutable
  before update on public.chat_read_state
  for each row execute function public.enforce_chat_read_state_immutable_fields();

-- Server-side read-cursor advance (called from the /chat/[matchId] server
-- page and the mark-seen server action with the caller's context; bypasses
-- RLS as owner). Verifies match membership explicitly, resolves the latest
-- message itself, and upserts the caller's cursor. Idempotent: opening an
-- already-seen conversation rewrites the same cursor.
create or replace function public.mark_chat_seen(p_match_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_latest uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.matches m
    where m.id = p_match_id
      and (m.user_a_id = v_uid or m.user_b_id = v_uid)
  ) then
    raise exception 'not a match member';
  end if;

  select id into v_latest
  from public.messages
  where match_id = p_match_id
  order by created_at desc
  limit 1;

  insert into public.chat_read_state (user_id, match_id, last_seen_message_id, last_seen_at)
  values (v_uid, p_match_id, v_latest, now())
  on conflict (user_id, match_id)
  do update set
    last_seen_message_id = excluded.last_seen_message_id,
    last_seen_at = now();

  return v_latest;
end; $$;

revoke all on function public.mark_chat_seen(uuid) from anon, authenticated;
grant execute on function public.mark_chat_seen(uuid) to authenticated;

-- Global chat-activity flag for the header dot (one round-trip from
-- /api/account/state). True when any of the caller's matches has a latest
-- message from the OTHER user that the caller has not seen. Own-only and
-- never-messaged matches never count.
create or replace function public.has_unread_chat()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.matches m
    join lateral (
      select id, sender_id
      from public.messages
      where match_id = m.id
      order by created_at desc
      limit 1
    ) lm on true
    left join public.chat_read_state r
      on r.match_id = m.id and r.user_id = auth.uid()
    where (m.user_a_id = auth.uid() or m.user_b_id = auth.uid())
      and lm.sender_id <> auth.uid()
      and (r.last_seen_message_id is null or r.last_seen_message_id <> lm.id)
  );
$$;

revoke all on function public.has_unread_chat() from anon, authenticated;
grant execute on function public.has_unread_chat() to authenticated;
