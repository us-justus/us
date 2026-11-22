# Contributing

Contributions are welcome. Please follow the existing project conventions and keep changes focused.

Before you start, please read the [code of conduct](CODE_OF_CONDUCT.md).

## Development setup

Follow the setup instructions in the [README](README.md).

Quick summary:

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Start the local Supabase stack: `pnpm exec supabase start`.
3. Reset the local database: `pnpm exec supabase db reset --local`.
4. Copy the committed [`.env.example`](.env.example) to `.env.local` and fill in local placeholders. Never commit `.env.local`.
5. Add LAN dev origins you actually use via `ALLOWED_DEV_ORIGINS` (comma-separated), or leave it empty for localhost-only development.

## Common commands

- `pnpm dev` — start the Next.js dev server.
- `pnpm lint` — ESLint.
- `pnpm exec tsc --noEmit` — TypeScript check without emitting.
- `pnpm test:inside` — run the registered Node.js test files.
- `pnpm test:registration` — fail if a test file is missing from `test:inside`.
- `pnpm test:db` — run pgTAP database tests against the local Supabase stack (requires the local stack running).

Database-only changes: `pnpm exec supabase db reset --local`, then `pnpm test:db`.

## Testing requirements

- Add tests for changed behavior where practical.
- Every `src/**/*.test.ts` file must be registered in the `test:inside` script in `package.json`. The `test:registration` guard enforces this; CI runs it.
- Database tests live under `supabase/tests/` and use pgTAP. They run against a disposable local database; never against staging or production.
- Do not add production data, real credentials, or real identifiers to tests or fixtures.

## Database changes

- Migrations are append-only under `supabase/migrations/`. Never edit an applied migration.
- Add a new timestamped migration for any schema change.
- Database changes must include appropriate access controls, including Row Level Security policies where applicable, and least-privilege grants.
- Never bypass RLS, weaken policies, or expose private fields (`USN`, email, auth IDs, verification metadata) through public queries.

## Security

- Do not commit secrets, credentials, personal data, or environment files.
- Protect user data and preserve the project's access-control and privacy requirements.
- Report suspected vulnerabilities privately via the [security policy](SECURITY.md). Never open a public issue or PR for a security problem.
- Avoid adding dependencies unless they are needed.

## Pull requests

- Keep each pull request focused on one change.
- Describe what changed and why.
- Include the tests or checks you ran and note any that could not be run.
- Include screenshots for user-interface changes where useful.
- Link related issues or discussions when applicable.
- Database PRs must include a migration and the matching tests.

## Release and deployment

Deployment and rollback are maintainer-only processes. Contributors should not run deployment, smoke, or rollback commands unless explicitly asked.
