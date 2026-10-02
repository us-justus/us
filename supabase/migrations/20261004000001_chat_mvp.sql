-- Chat MVP: allow Realtime delivery of message inserts + support the
-- bounded history query (match_id, created_at).
--
-- Additive only: no table/column/constraint/grant/RLS changes. The
-- supabase_realtime publication is the standard Supabase Realtime
-- publication (local config enables realtime; hosted projects expose the
-- same publication name).

alter publication supabase_realtime
add table public.messages;

create index if not exists idx_messages_match_created
on public.messages(match_id, created_at);
