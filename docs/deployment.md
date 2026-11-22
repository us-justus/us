# Deployment guide

Status: **authoritative for the current deployment model.** Source of truth:
this file, `docs/staging-deployment.md`, `spec.md` §12, and
`scripts/smoke-prod.mjs`.

## 1. Deployment model

- **Production (`us`)** is deployed by **Cloudflare Workers Builds on every push
  to `main`**. There is no repository-owned production deploy workflow, by
  design: the deploy path holds Cloudflare credentials that a PR-controlled
  workflow must never hold. The repository cannot gate or observe the deploy
  directly (finding G-06).
- **Staging** is the `us-staging` Worker, deployed through
  `.github/workflows/staging-candidate.yml` + `deploy-staging.yml`, and verified
  via `docs/staging-deployment.md`.

## 2. Post-deploy smoke gate (production)

- Command: `pnpm release:smoke` (or `node scripts/smoke-prod.mjs [base-url]`).
- Default base URL: `https://us-justus.in`; override with `SMOKE_BASE_URL` or the
  argument.
- Gate checks (read-only GETs): `GET /` (200 + landing title marker), `GET /login`
  (200), `GET /inside` unauthenticated (200 + admin markers), `GET /api/account/state`
  signed-out (200), `GET /api/inside/health` anonymous (403 + denial body).
- Retries with backoff for ~2.5 minutes before failing.
- Exit 0 = release healthy; exit 1 = **do not treat the deployment as healthy**.
- The gate is manual-only via `.github/workflows/production-smoke.yml`
  (`workflow_dispatch`; inputs: `base-url`). It holds no secrets and writes
  nothing.

## 3. Rollback

- Command: `pnpm release:rollback` (wrangler version list; manual rollback only).
- Rollback restores code, not secret values (see `spec.md` §12.1).
- After any rollback: re-run the production smoke gate and record the version ID.

## 4. Secret rotation

- Rotate secrets only through the hosting provider's secret store; the
  repository does not hold production secret values.
- Rotate procedure and operational notes: `docs/staging-deployment.md`,
  `scripts/smoke-prod.mjs` header, `spec.md` §12.1.
- No real credentials, emails, USNs, auth IDs, or verification metadata are
  recorded in this repository.

## 5. Operational verification checklist (post-deploy)

1. Run `pnpm release:smoke` against the production URL; record exit code.
2. Confirm the deployed version ID / commit SHA (`scripts/verify-worker-version.mjs`).
3. Confirm required CI check `validate` (and `staging/verified` where applicable) completed on the deploying commit.
4. Record the deploy outcome in the release notes / runbook.
5. If any smoke check fails: do NOT mark the release healthy; follow the rollback runbook.

## 6. Limitations (honest gaps)

- Deployment observability (deploy status → smoke) is not automated end-to-end
  by the repository (G-06).
- Required status checks / merge queue enforcement could not be confirmed
  unauthenticated (G-04); see the open-source readiness tracker.
