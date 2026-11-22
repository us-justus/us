# Database Guide

Contributor-facing database conventions for the `us` repository.

## Local database

```bash
pnpm exec supabase start
pnpm exec supabase db reset --local
pnpm test:db
```

- Migrations live in `supabase/migrations/` and are applied in order by `db reset`.
- Never edit an applied migration; add a new timestamped migration instead.
- Never run `supabase db push` or point a reset at a hosted project.

## Access control and privacy

- Row Level Security is required for any user-scoped table.
- Private fields (`USN`, email, auth IDs, verification metadata) must not leave server-side queries.
- Database grants should follow least privilege; see the database access review and `docs/database-access.md` once merged.

## Adding a database change

1. Write an additive, timestamped migration.
2. Add or update Row Level Security policies where user-scoped data is involved.
3. Tighten grants; do not widen them.
4. Add database tests under `supabase/tests/`.
5. Run `pnpm test:db` and `pnpm test:inside`.
6. Keep migrations reviewable and additive where possible.

## Notes

- Historical migrations are never rewritten.
- Security-relevant migrations are treated as release blockers for the relevant change.
