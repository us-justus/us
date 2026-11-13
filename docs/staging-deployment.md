# Staging deployment runbook

Status: `.github/workflows/deploy-staging.yml` deploys an approved `main`
commit to the `us-staging` Worker only. Production (`us`) is deployed by
Cloudflare Workers Builds and is **not** handled by this workflow — every
Wrangler call in it passes `--env staging`, which resolves the Worker name to
`us-staging` and can never resolve the top-level `us`.

No secrets live in this file. Identifiers below are non-secret.

## 1. Prerequisites

### GitHub environment `staging`

Environment variables (not secrets):

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ietruyukgqwkmsyfvxxi.supabase.co` — exact, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging project anon key |
| `STAGING_BASE_URL` | `https://staging.us-justus.in` or `https://us-staging.<subdomain>.workers.dev` |
| `STAGING_REQUIRED_CHECKS` | optional; defaults to `validate` |

Environment secrets:

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN_STAGING` | token scoped to the staging account/Worker |
| `CLOUDFLARE_ACCOUNT_ID_STAGING` | staging account ID |

Environment protection rules (both required):

1. **Deployment branch policy: `main` only.** The workflow job also refuses any
   other ref (`if: github.ref == 'refs/heads/main'`), but the environment rule
   is the server-side half of that guarantee and must be set to "Selected
   branches" → `main`.
2. **Required reviewers: at least one.** This is the explicit human approval
   before a staging deploy starts. Without it, `workflow_dispatch` alone is the
   only gate.

### Cloudflare Worker `us-staging` secrets

`wrangler deploy` deletes dashboard plaintext variables when the config
declares none, but it keeps secrets. These must already exist, or the deploy
step aborts before replacing code:

```bash
pnpm exec wrangler secret put ADMIN_SECRET_KEY --env staging
pnpm exec wrangler secret put BREVO_API_KEY --env staging
pnpm exec wrangler secret put BREVO_SENDER_EMAIL --env staging
pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
```

### Supabase staging project

Add the staging origin (`STAGING_BASE_URL`) to the staging project's Auth
redirect allowlist — signup/verification links are built from
`window.location.origin`.

## 2. CI source of truth

The staging gate requires a successful `validate` check run on the target
commit. That check is produced by the repository-owned
`.github/workflows/ci.yml` (job `validate`, runs on push to `main`, on PRs
targeting `main`, and on demand). It is deliberately **not** dependent on
Cloudflare Workers Builds publishing check runs: whether that integration
emits them is not something this repository can assert or rely on.

To confirm the check name GitHub actually records for a commit:

```bash
gh api "repos/us-justus/us/commits/<sha>/check-runs" \
  --jq '.check_runs[] | "\(.name)  \(.status)  \(.conclusion)"'
```

If the recorded name ever differs, set the repository variable
`STAGING_REQUIRED_CHECKS` to the exact name (comma-separated for several
names; names may contain spaces). The gate stays fail-closed: an unset,
empty, or non-matching requirement blocks the deploy.

## 3. Deploying

1. Pick the full 40-character SHA of a commit already on `main`.
2. Actions → `deploy-staging` → Run workflow → branch `main` → paste the SHA.
3. Approve the `staging` environment prompt.
4. The run ends with the smoke suite against `STAGING_BASE_URL`.

Gates, in order — all fail closed: run is from `main`; SHA is one 40-hex
token; checkout matches the SHA; the SHA is an ancestor of `origin/main`; every
check run and commit status on it is finished and green **and** `validate`
actually ran; staging variables/credentials exist; the Supabase URL is exactly
the staging origin; the staging base URL is an allowed staging host; tests,
`tsc`, lint pass; the OpenNext build succeeds; the Worker already has its
runtime secrets; the live Worker answers the smoke suite.

## 4. Production gating (proposal — not implemented)

Gap: Workers Builds deploys every push to the production branch immediately,
while this workflow only accepts commits that are already on `main`. So a
commit can be live in production before staging has ever seen it. Closing that
gap requires a change outside this repository; two options, smallest first.

**Option A — require a staging status before merge (no Cloudflare changes).**
1. Let the workflow also accept the head SHA of an open PR targeting `main`
   (verify via `GET /repos/{repo}/pulls?head={owner}:{branch}`), instead of
   `main` ancestry only.
2. On success, post a commit status `staging/verified` on that SHA
   (add `statuses: write`).
3. In branch protection for `main`, require `validate` and `staging/verified`.

Result: nothing reaches `main` — and therefore production — without a green
staging deploy plus a human approval of the `staging` environment. No
Cloudflare dashboard change, no new secrets, ~15 lines of workflow.

**Option B — stop Workers Builds from deploying on push.**
Switch the Worker's build command from `wrangler deploy` to
`wrangler versions upload`, then promote a version explicitly
(`wrangler versions deploy <id>`) from an approved `production` environment in
GitHub Actions. Strongest guarantee (production deploy becomes a reviewed
action), but it changes the production deploy path and needs a Cloudflare
dashboard change — do it only with explicit sign-off.

Recommendation: Option A now, Option B if production deploys need their own
approval step rather than relying on merge review.
