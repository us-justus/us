# Staging verification runbook

Status: **implemented but not yet active.** The staging workflows only become
live once this file and `.github/workflows/` are on `main`, because
`workflow_run` resolves its workflow definition from the default branch. Until
then, nothing here can deploy.

Production (`us`) is deployed by **Cloudflare Workers Builds on every push to
`main`** and is deliberately not touched by any workflow in this repository.
Staging is the `us-staging` Worker at
`https://us-staging.atharvaspatil2005-d16.workers.dev`, built against the
staging Supabase project `ietruyukgqwkmsyfvxxi`.

No secret values live in this file. Identifiers below are non-secret.

---

## 1. Architecture and trust boundary

```
PR opened / updated ──► staging-candidate.yml            (unprivileged)
                          checkout PR head SHA
                          install → typegen → tsc → lint → tests
                          build with staging Supabase (public values only)
                          write candidate.json (provenance)
                          upload artifact "staging-candidate"
                                     │
                                     ▼  workflow_run (completed)
                        deploy-staging.yml                (privileged)
                          checkout main  ← trusted scripts + wrangler.jsonc
                          download artifact by run id
                          verify sha256 digest GitHub recorded
                          validate ZIP central directory (symlinks, traversal,
                            absolute paths, size limits) BEFORE extracting
                          unzip OUTSIDE the repo, shape-check, no symlinks
                          cross-check candidate.json vs payload + API
                          verify PR open / base main / head SHA unchanged
                          pnpm install (main lockfile, NO cache)
                          dry-run → deploy --env staging → smoke
                          verify version id + tag == SHA, active at 100%
                          smoke again → re-verify the active version
                          re-check PR state → publish staging/verified
```

Why it is split:

- The candidate workflow runs **PR-controlled code** (package scripts, build
  config, dependencies). It therefore gets **no secrets, no environment, no
  Cloudflare credentials**, only a read-only token plus `actions: write` for the
  upload. Staging's public build values (`STAGING_SUPABASE_URL`,
  `STAGING_SUPABASE_ANON_KEY`) are repository variables, safe to expose: the
  anon key is a public client key and staging data is isolated.
- The deploying workflow runs from the **default branch** with staging-scoped
  credentials. It never checks out PR code and never executes anything from the
  artifact. The artifact is data: it is hashed, unpacked outside the repository,
  structurally validated, and handed to `wrangler deploy`.
- `opennextjs-cloudflare deploy` is **not** used in the privileged path because
  it runs a build first, which would execute PR-controlled code while the
  Cloudflare token is available. `scripts/deploy-staging.sh` calls
  `wrangler deploy` against the already-built bundle instead.
- No `actions/cache` in the privileged job. A cache written by a PR workflow
  cannot be restored by a job that holds deployment credentials.

## 2. One-time GitHub configuration

### Repository variables (Settings → Secrets and variables → Actions → Variables)

| Name | Value |
| --- | --- |
| `STAGING_SUPABASE_URL` | `https://ietruyukgqwkmsyfvxxi.supabase.co` — exact, no trailing slash |
| `STAGING_SUPABASE_ANON_KEY` | staging project anon key (public by design) |

These are read by the **candidate** workflow. They must never hold the
production project or the service-role key.

### GitHub environment `staging`

Variables:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ietruyukgqwkmsyfvxxi.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging project anon key |
| `STAGING_BASE_URL` | `https://us-staging.atharvaspatil2005-d16.workers.dev` (or `https://staging.us-justus.in`) |
| `STAGING_REQUIRED_CHECKS` | optional; defaults to `validate` |

Secrets:

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN_STAGING` | token scoped to the staging account/Worker only |
| `CLOUDFLARE_ACCOUNT_ID_STAGING` | staging account ID |

Protection rules:

1. **Deployment branch policy: `main` only.** `deploy-staging-manual.yml` also
   refuses any other ref, but the environment rule is the server-side half.
2. **Required reviewers** (optional). If set, every staging deploy — including
   automatic candidate deploys — waits for that approval. This is the strongest
   setting; it means "a human approved promoting this candidate to staging".
   Leave it unset to let candidate deploys run unattended.

### Cloudflare Worker `us-staging` runtime configuration

The Worker must already exist before the first pipeline run: the deploy
preflight deliberately refuses an unknown Worker (it cannot verify that the
runtime configuration is present). Create it once in the Cloudflare dashboard,
or with a one-off manual `wrangler deploy --env staging` from this repository,
then set the secrets below.

`wrangler deploy` treats the config file as the source of truth for **vars**:
dashboard plaintext variables are deleted when the config declares none.
**Secrets are never deleted.** This repository declares no vars, so every
runtime value below must exist as a Worker **secret**:

```bash
pnpm exec wrangler secret put ADMIN_SECRET_KEY --env staging
pnpm exec wrangler secret put BREVO_API_KEY --env staging
pnpm exec wrangler secret put BREVO_SENDER_EMAIL --env staging
pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
```

`BREVO_SENDER_EMAIL` is an email address, not a credential, but it is still a
**secret here on purpose**: no `vars` block exists in `wrangler.jsonc`, so a
dashboard variable would be removed by the next deploy and the app would lose
its sender. If it is ever moved to `env.staging.vars`, `scripts/deploy-staging.sh`
counts declared vars as present and the preflight keeps working. Optional
values (`BREVO_SENDER_NAME`, `BREVO_QUOTA_RETRY_SECONDS`) are not required.

`SUPABASE_SERVICE_ROLE_KEY` must be the **staging** project's key. Never copy the
production key into staging.

### Supabase staging project

Add `STAGING_BASE_URL` to the staging project's Auth redirect allowlist —
signup/verification links are built from `window.location.origin`.

## 3. What is verified before anything is deployed

`deploy-staging.yml` refuses to continue unless every one of these holds:

1. The run was triggered by `staging-candidate` (not another workflow).
2. The candidate run concluded `success` and its event is `pull_request` or
   `merge_group`.
3. `github.repository` is exactly `us-justus/us`.
4. The run has exactly one non-expired `staging-candidate` artifact.
5. The artifact's `sha256` digest matches the one GitHub recorded for the run.
6. The ZIP central directory is validated before extraction: no symbolic links
   (Unix file mode), no absolute, drive-letter or `..`/`.` paths, no backslashes,
   no duplicate names, no encryption, and no archive above the compressed,
   uncompressed, per-entry or member-count limits. Malformed metadata fails
   closed. Only then is the archive unpacked outside the repository.
7. The artifact contains only `.open-next/` and `candidate.json`, and the
   expected bundle paths exist.
8. `candidate.json` matches the workflow-run payload: repository, event, head
   SHA, run id and run attempt, and the worker digest matches the actual
   `worker.js` bytes. The PR / merge-group identity itself is resolved from the
   run payload and the GitHub API, never from the artifact.
9. The PR is **open**, targets **main**, and its head SHA is still exactly the
   built SHA (for merge groups: the `gh-readonly-queue` ref still points at the
   built SHA).
10. The staging URL is an allowed staging host, and both Supabase URL scopes name
    the staging project exactly.
11. `wrangler` resolves `us-staging` in a dry run of the exact bundle.
12. The Worker's required runtime secrets exist.
13. After deploy, `wrangler deploy` must report exactly one well-formed version
    ID (never `unknown`). The Cloudflare API is then queried independently: the
    version must carry `workers/tag` equal to the candidate SHA, and the latest
    deployment must serve exactly that version at 100% of traffic.
14. After deploy, the live staging URL passes `scripts/smoke-prod.mjs`.
15. Immediately before publishing, the active version is re-read and must still
    be the version that passed smoke; the PR/merge-group still points at the
    deployed SHA, and no newer candidate exists for the same ref.

Only then is `staging/verified` posted — as a **commit status on the exact SHA
that was deployed and smoke-tested**. Any failure, cancellation, supersession or
PR-head move means no status at all; the check never turns green by default.

The `candidate.json` is written by untrusted PR code, so it is never trusted on
its own: every field is compared against the `workflow_run` payload and the
GitHub API, and the artifact is only accepted because its digest matches the
run.

## 4. Concurrency and the shared Worker

There is exactly one staging Worker, so deploys are serialised:

- `concurrency: group: staging-us-staging` (no `cancel-in-progress`) in both
  deploy workflows — one deploy at a time, never a half-cancelled upload.
- `concurrency: group: staging-candidate-<pr>` (cancel-in-progress) — a push
  supersedes an in-flight build; the cancelled run never deploys.
- Before publishing, the deploy workflow checks that no newer candidate exists
  for the same ref, and re-reads the PR head SHA.

Consequence, stated plainly: `staging/verified` means "this exact SHA was
deployed to `us-staging` and passed smoke at that moment". It does **not** mean
that SHA is still live. A newer candidate from another PR replaces the Worker
content; the older status stays on its commit for audit but is no longer a
statement about the live staging Worker. The status description carries the
Cloudflare Worker **version ID** (and the version is tagged with the commit SHA,
visible via `wrangler deployments list --env staging`), so the live version can
always be traced to the SHA that produced it. Re-run the candidate (push an
empty commit or re-dispatch the manual fallback) if a PR needs fresh evidence.

## 5. Exact SHA, merge methods, and the merge queue

What is verified is the PR **head** SHA. What production deploys is the commit
that lands on `main`. Those differ unless the merge method and timing cooperate:

| Merge method | Result |
| --- | --- |
| Merge commit | New commit on `main`; its tree equals the PR head **only if `main` did not move**. |
| Squash | New commit with a new SHA; tree equals PR head only if `main` did not move. |
| Rebase | New SHAs; same tree if `main` did not move, but the commits are rewritten. |

So `staging/verified` on the PR head SHA is necessary but not sufficient to
guarantee the production commit was staged. Two mitigations:

1. **Require branches to be up to date before merging** (branch protection).
   With the PR head unchanged and `main` unchanged since verification, the merge
   result's tree matches what was staged.
2. **Enable the merge queue** (recommended). This repo already supports
   `merge_group`: `ci.yml` runs `validate` on the queue commit, the candidate
   workflow builds that exact commit, the deploy workflow publishes
   `staging/verified` on it, and the queue will not merge without both.
   Configure:
   - Ruleset → `main` → require status check `validate` on pull requests;
   - enable "Require merge queue" and add `validate` + `staging/verified` to the
     merge-queue checks.

   Keep `staging/verified` **out of the PR-level required checks**: Dependabot
   and fork PRs run with a read-only token, cannot upload the candidate artifact
   (see §8), and would be blocked forever. In the merge queue the run is created
   by GitHub, not by Dependabot, so the artifact upload works and the queue gets
   the same exact-commit verification as an in-repo PR.

Without one of those, treat production deploys as "staged candidate + untested
merge result", not as exact-commit staging verification. The merge-queue path is
implemented but has not been exercised in this repository yet; validate it with a
throwaway PR after enabling the queue.

## 6. Manual fallback

`.github/workflows/deploy-staging-manual.yml`:

1. Actions → `deploy-staging-manual` → Run workflow → branch `main`.
2. Paste a **full 40-character** SHA that is already an ancestor of `main`.
3. Approve the `staging` environment prompt (if required reviewers are set).

It re-checks the SHA, the ancestry, that every check/status on the SHA is green
and that `validate` actually ran, verifies the staging Supabase project and URL,
runs the full validation + build, then deploys with the same hard-coded
`--env staging` path and runs the same smoke suite. It publishes
`staging/verified` on that SHA.

It cannot deploy a PR branch: `workflow_dispatch` from a branch would run that
branch's workflow file with credentials. Pre-merge testing is the candidate
pipeline's job.

## 7. Required GitHub settings (manual — not applied by this PR)

- Ruleset / branch protection for `main`:
  - Pull requests: require `validate`.
  - Require branches to be up to date before merging.
  - (Recommended) Require the merge queue, with `validate` + `staging/verified`
    as queue checks (not PR checks — see §5).
  - Require review from the owner for external contributors (configured
    separately, per the repository policy).
- Do **not** remove the existing Cloudflare Workers Builds integration from
  `main`; it remains the production deploy path.
- Dependabot PRs run `validate` but their read-only token cannot upload a
  candidate artifact, so they cannot get a PR-level `staging/verified`. The
  merge queue covers them: the queue commit is built and verified normally.
  Do not make `staging/verified` a PR-level required check.

## 8. Known limitations

- `workflow_run` requires this workflow to exist on `main`, so the pipeline is
  inert until this PR merges. PRs opened before that have no candidate builds.
- Fork pull requests and Dependabot PRs receive a read-only `GITHUB_TOKEN`, so
  the artifact upload fails. Such candidates fail closed (no PR-level
  `staging/verified`). A maintainer can push a fork branch into this repository,
  or rely on the merge queue, which runs with a normal write token.
- Staging is one Worker shared by all PRs; see §4 for what a status means.
- A successful candidate build is not a staging deployment, and a successful
  deployment is not a smoke pass. Only the status means all three happened.
- The artifact guard rejects ZIP64 archives and anything above its limits
  (512 MiB compressed, 1 GiB uncompressed, 256 MiB per member, 100k members).
  If the bundle legitimately grows past those limits, raise `ZIP_LIMITS` in
  `scripts/verify-artifact.mjs` deliberately; the workflow never relaxes them.
- Worker version verification calls the Cloudflare API directly, so the staging
  token needs `Workers Scripts Read` in addition to its deploy permissions
  (the existing `wrangler secret list` preflight already requires read access).
- This pipeline verifies staging. It does not deploy production and does not
  change Cloudflare Workers Builds.
