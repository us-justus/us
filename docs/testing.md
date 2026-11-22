# Testing Guide

This guide explains how to run and add tests for the `us` repository.

## Quick reference

| Goal | Command |
| --- | --- |
| Unit tests (Node) | `pnpm test:inside` |
| Test registration guard | `pnpm test:registration` |
| Database tests (pgTAP) | `pnpm test:db` |
| Lint | `pnpm lint` |
| TypeScript | `pnpm exec tsc --noEmit` |

Database tests require the local Supabase stack:

```bash
pnpm exec supabase start
pnpm exec supabase db reset --local
pnpm test:db
```

Never run database tests (or any database command) against staging or production.

## Unit tests

Node.js tests live next to the code they cover, in files named `*.test.ts` under `src/`.

- Run all registered tests with `pnpm test:inside`.
- Register every new test file in the `test:inside` script in `package.json`. The `scripts/check-test-registration.mjs` guard fails CI when a discovered test file is missing from that list.
- Keep tests dependency-free where possible and prefer pure helpers.

## Database tests

Database tests live in `supabase/tests/` and use pgTAP.

- They run against a disposable local database.
- They are read-only by design; do not insert production-like data.
- Add new database tests alongside the migration they validate.

## CI

CI runs lint, TypeScript, unit tests, the test-registration guard, and (after the database-validation PR lands) database tests. The `validate` job is the repository-level gate.

## Adding tests

1. Add the test file.
2. Register it in `package.json` (`test:inside`) for unit tests, or place it in `supabase/tests/` for database tests.
3. Run the relevant commands above and record results.
4. If a test cannot run in your environment, note why instead of claiming it passed.
