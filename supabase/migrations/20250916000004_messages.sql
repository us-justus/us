create extension if not exists "pgcrypto";

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_match_id on public.messages(match_id);
create index if not exists idx_messages_sender_id on public.messages(sender_id);
create index if not exists idx_messages_created_at on public.messages(created_at);

alter table public.messages enable row level security;

drop policy if exists "own messages select" on public.messages;
create policy "own messages select" on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
      and (m.user_a_id = auth.uid() or m.user_b_id = auth.uid())
    )
  );

drop policy if exists "own messages insert" on public.messages;
create policy "own messages insert" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = match_id
      and (m.user_a_id = auth.uid() or m.user_b_id = auth.uid())
    )
  );
