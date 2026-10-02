-- us notifications: actionable LIKE state (like-back / ignore).
--
-- Adds resolved_at for actionable notifications. Semantics:
--   unread:     read_at IS NULL AND resolved_at IS NULL AND deleted_at IS NULL
--   actionable: type = 'LIKE' AND resolved_at IS NULL AND deleted_at IS NULL
--   resolved:   resolved_at IS NOT NULL (stays in history; actions hidden)
--   deleted:    deleted_at IS NOT NULL (excluded from history)
--
-- On like-back / ignore the server sets resolved_at = now() (plus read_at
-- when still unread so the badge clears). The underlying like/match rows are
-- never touched by resolution; ignore never creates a pass.
--
-- No trigger change needed: enforce_notification_immutable_fields() only
-- freezes (user_id, actor_id, type, reference_id, created_at), so the new
-- column is mutable under the existing recipient-only UPDATE policy.

alter table public.notifications
  add column if not exists resolved_at timestamptz null;

create index if not exists idx_notifications_user_resolved
  on public.notifications (user_id, resolved_at, created_at desc);
