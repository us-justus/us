# Database Access Guide

Contributor-facing rules for database access in the `us` repository.

## Current posture (2026-11-23, least-privilege remediation)

The repository uses Supabase (Postgres) with Row Level Security and explicit
least-privilege grants. The latest tightening migrations are
`supabase/migrations/20261122000001_least_privilege_grants.sql` and
`supabase/migrations/20261123000001_profile_photo_path_security.sql`.

### Effective role boundaries

- `anon`: no access to product data tables. Only public invite-token
  resolution (`resolve_invite_token`) is executable.
- `authenticated`: owns-row read/write on a small allow-list of tables
  (below), scoped by RLS to `auth.uid()`. No DDL-ish privileges
  (TRUNCATE / REFERENCES / TRIGGER) on any client table.
- `service_role`: server-only key used by Next.js route handlers after
  `auth.getUser()`. Full CRUD on server-owned tables; never exposed to the
  browser.

### Server-only tables (no client access)

`profiles`, `admin_users`, `inside_audit_events`,
`inside_audit_events_history`, `referrals`, `reports`, `likes`, `passes`,
`messages`, `discoverable_profiles`, `campus_spot_allocator`,
`campus_spot_claims`, `email_provider_state`, `email_verification_queue`,
`email_verification_tokens`, `waitlist_email_queue`, `login_rate_buckets`.

These are reachable only through `service_role` (and SECURITY DEFINER RPCs
where explicitly granted).

### Authenticated operations intentionally allowed

| Table | `authenticated` grants | Notes |
| --- | --- | --- |
| `blocks` | SELECT, INSERT, DELETE | own rows only |
| `chat_read_state` | SELECT, UPDATE | own cursor only |
| `feedback` | INSERT (user_id, category, message) + SELECT | own rows; moderation metadata is server-managed |
| `invites` | SELECT | own rows; creation/attribution is RPC-only |
| `matches` | SELECT | own rows |
| `notifications` | SELECT, UPDATE | own rows; read-state only |
| `profile_photos` | SELECT, INSERT, UPDATE, DELETE | own rows + owned storage paths (see below) |
| `verification_records` | SELECT, INSERT, UPDATE | owner-RLS writes; no DELETE |

### RLS assumptions

- RLS is enabled on every client-facing table; policies key off `auth.uid()`
  and the owning profile (`owns_profile` / `can_read_profile_photos`).
- `profiles` is server-only, so authenticated clients read profiles only
  through the `discoverable_profiles` view and SECURITY DEFINER helpers.
- Authenticated writes are additionally constrained by column-level grants
  (e.g. `feedback` cannot set moderation columns).
- Service role bypasses RLS by design; route handlers are responsible for
  re-checking ownership after `auth.getUser()`.

### Profile-photo metadata / storage-path security boundary

`profile_photos.storage_path` is user-controlled metadata. To prevent a user
from claiming or repointing a row at another user's storage object, the
database enforces:

- RLS (`own photos insert` / `own photos update`) requires
  `owns_profile(profile_id)` AND `profile_owns_photo_path(profile_id,
  storage_path)`, where the path's first segment must equal the owning
  profile's `user_id`.
- A `BEFORE INSERT/UPDATE` trigger
  (`trg_guard_profile_photo_storage_path`) re-checks the same rule for every
  role, including `service_role`.
- A CHECK constraint (`profile_photos_storage_path_format`) requires a
  non-empty `{uuid}/...` shape.

Server upload routes generate paths as `${user.id}/...` and validate bytes
before persisting metadata; clients never supply paths.

### Migration ownership and default privileges

- Migrations run as the `postgres` role, so
  `ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM anon, authenticated` in
  `20261122000001_least_privilege_grants.sql` is scoped to objects created
  by `postgres` in the `public` schema only.
- It does **not** cover objects created by other roles (e.g.
  `supabase_admin`, which still grants `anon` / `authenticated` on future
  tables). Do not assume one default-privilege statement protects every
  object; add explicit grants/revokes in each migration.
- New tables must be granted explicitly before any client-facing use.

### Sensitive RPCs

- Admin RPCs (`admin_*`) are `service_role` only.
- `create_match_if_mutual`, `enforce_chat_read_state_immutable_fields`:
  no client EXECUTE.
- `get_or_create_invite`, `has_unread_chat`, `mark_chat_seen`,
  `resolve_invite_token`: invite resolver stays public; user-context RPCs
  stay `authenticated` + `service_role`.
- All SECURITY DEFINER functions pin `search_path` (including `pg_catalog`
  and `pg_temp`).

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
