# Database Access Guide

Contributor-facing rules for database access in the `us` repository.

## Current posture (2026-11-22, least-privilege remediation)

The repository uses Supabase (Postgres) with Row Level Security and explicit
least-privilege grants. The latest tightening migration is
`supabase/migrations/20261122000001_least_privilege_grants.sql`.

- Client-facing roles (`anon`, `authenticated`) get default-deny first; only
  the exact access the product needs is granted.
- `service_role` is the server-only key and is never exposed to the browser.
- Server-only tables have no client access at all: `profiles`,
  `admin_users`, `inside_audit_events`, `inside_audit_events_history`,
  `referrals`, `reports`, `likes`, `passes`, `messages`, `discoverable_profiles`,
  `campus_spot_*`, `email_*`, `waitlist_email_queue`, `login_rate_buckets`.
- Client-accessible tables currently grant:

  | Table | `authenticated` grants |
  | --- | --- |
  | `blocks` | SELECT, INSERT, DELETE (own rows) |
  | `chat_read_state` | SELECT, UPDATE (own cursor) |
  | `feedback` | INSERT (user_id, category, message) + SELECT (own rows) |
  | `invites` | SELECT (own rows) |
  | `matches` | SELECT (own rows) |
  | `notifications` | SELECT, UPDATE (own rows) |
  | `profile_photos` | SELECT, INSERT, UPDATE, DELETE (own rows) |
  | `verification_records` | SELECT, INSERT, UPDATE (owner-RLS writes; no DELETE) |

- Sensitive function EXECUTE grants were tightened:

  - Admin RPCs (`admin_*`) are `service_role` only.
  - `create_match_if_mutual`, `enforce_chat_read_state_immutable_fields`:
    no client EXECUTE.
  - `get_or_create_invite`, `has_unread_chat`, `mark_chat_seen`,
    `resolve_invite_token`: invite resolver stays public; user-context RPCs
    stay `authenticated` + `service_role`.

- `SECURITY DEFINER` functions use an explicit `search_path` that includes
  `pg_temp`.

## Adding database access

1. Add a new timestamped migration (never edit applied migrations).
2. Prefer RLS + least-privilege grants over broad grants.
3. Grant explicitly; do not rely on platform defaults.
4. Add database tests under `supabase/tests/`.

## Testing

- Unit tests: `pnpm test:inside`.
- Database tests: `pnpm test:db` against the local Supabase stack.
- See `docs/testing.md`.

## Security

- Never bypass RLS, weaken policies, or expose private fields
  (`USN`, email, auth IDs, verification metadata) through public queries.
- Report issues privately via `SECURITY.md`.
