# Open-Source Readiness Tracker

- **Repository:** `us-justus/us`
- **Baseline commit:** `bc1efc0`
- **Audit date:** 2026-11-22
- **Scope:** repository hygiene, public documentation, contributor experience,
  security policy, database access control, database/CI validation, deployment
  safeguards, dependency health, and documentation truth.
- **Method:** manual inspection of the tracked tree and migrations, a disposable
  local Supabase database, GitHub API/ruleset inspection, live HTTP smoke checks,
  and the checks recorded in the evidence log below.
- **Final assessment (2026-11-22, PR 6):** all six open-source readiness PRs are
  delivered into open pull requests (15, 16, 17, 18, 19, 20). The final
  evidence-based readiness verdict is recorded under §K. A finding counts as
  **Resolved** only when its delivering PR has merged and its checks were executed;
  until then the disposition reflects delivery-in-PR.

This file is the single source of truth for finding dispositions. A finding is
only **Resolved** when the linked change is on `main` and its verification was
actually executed. Anything unverified stays **Open** or **Needs verification**.

## Disposition key

| Disposition | Meaning |
| --- | --- |
| **Open** | Confirmed gap; no fix merged yet. |
| **Resolved** | Fix merged and verified with the recorded evidence. |
| **Partially resolved** | Meaningful mitigation merged; a documented residual gap remains. |
| **Needs verification** | Cannot be confirmed from the repository or unauthenticated API. |
| **Not applicable** | Audited and deliberately out of scope, with a reason. |

## Severity key

| Severity | Meaning |
| --- | --- |
| **Critical** | Would expose private data or allow privilege bypass. |
| **High** | Breaks a security boundary, release safety, or a core contributor path. |
| **Medium** | Materially increases risk or maintenance cost; workaround exists. |
| **Low** | Hygiene, clarity, or consistency issue. |

---

## A. Repository hygiene

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| A-01 | A pnpm store index was tracked (`.pnpm-store/v11/index.db`). | `git ls-files` listed the file; it is generated local state. | Low | Open | 1 |
| A-02 | Local Supabase CLI state was tracked (`supabase/.temp/cli-latest`). | `git ls-files` listed the file; `.temp/` also held a project link. | Medium | Open | 1 |
| A-03 | Five unused starter SVGs were tracked (`public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`). | Repository-wide references: zero. | Low | Open | 1 |
| A-04 | `next.config.ts` hardcoded three private LAN IP addresses. | `allowedDevOrigins` contained `192.168.0.100`, `192.168.0.106`, `192.168.1.4`. | Low | Open | 1 |
| A-05 | `.env.example` existed but was ignored by `.gitignore` (`.env*`). | `git check-ignore -v .env.example` matched `.gitignore:34`. | Medium | Open | 1 |
| A-06 | Two test files were absent from `test:inside` (`src/lib/photos/framing.test.ts`, `src/lib/prelaunch/waitlist-count.test.ts`). | The script listed 30 files; 32 `*.test.ts` files existed. | Medium | Open | 1 |
| A-07 | Nothing prevented a future test file from being silently unregistered. | `test:inside` is an explicit file list, not a glob. | Medium | Open | 1 |

## B. Documentation and project metadata

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| B-01 | README says no `.env.example` is committed and tells contributors to create `.env.local` manually. | `README.md` §3. | Medium | Open | 2 |
| B-02 | README has no security-reporting link. | README badges and "More about the project" links omit `SECURITY.md`. | High | Open | 2 |
| B-03 | `docs/staging-deployment.md` says the staging pipeline is "implemented but not yet active". | The pipeline has a successful run (`44871749494` on `8bed2f0`) and the staging URL returns 200. | High | Open | 2 |
| B-04 | `spec.md` §14.1–§14.4 and parts of `AGENTS.md` describe launch state, countdown, and a 3D heart as current. | Migration `20261012000001_remove_launch_system.sql` removed `launch_config` and the launch system. | High | Open | 1, 2 |
| B-05 | `PRE_LAUNCH_CHECKLIST.md` presents launch/countdown/3D items as pending work. | The same migration removed the launch system. | Medium | Open | 2 |
| B-06 | The documentation hierarchy is unclear: `spec.md` is current, `spec/` contains historical briefs, and no index says which wins. | `spec/` contains numbered historical implementation briefs. | Medium | Open | 2 |
| B-07 | README's "pre-launch" wording does not state that the product now runs permanently in its waiting experience with no launch switch. | `spec.md` / migration history. | Medium | Open | 2 |

## C. Contributor experience

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| C-01 | `CONTRIBUTING.md` is a short outline with no concrete setup, test, migration, or review workflow. | 33-line file; no commands beyond "follow README". | Medium | Open | 3 |
| C-02 | No issue templates, PR template, or contact-links configuration. | `.github/` contained only `workflows/`. | Medium | Open | 3 |
| C-03 | No focused testing or database contributor guide. | No `docs/testing.md` or `docs/database.md`. | Medium | Open | 3 |
| C-04 | No Dependabot configuration. | `.github/dependabot.yml` absent. | Medium | Open | 3 |
| C-05 | Security reporting is not part of the contributor path. | No `SECURITY.md`; README/CONTRIBUTING do not link one. | High | Open | 2, 3 |

## D. Security policy and vulnerability reporting

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| D-01 | No `SECURITY.md`. | File absent from the tracked tree. | High | Open | 2 |
| D-02 | GitHub private vulnerability reporting is enabled but undocumented. | GitHub API reports private vulnerability reporting enabled; no repository doc points to it. | High | Open | 2 |
| D-03 | No documented scope, safe-handling guidance, or response expectation for reports. | No security policy. | Medium | Open | 2 |

## E. Database access control

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| E-01 | Many public tables granted broad privileges (including `TRUNCATE`, `REFERENCES`, `TRIGGER`) to `anon` and `authenticated`, even where RLS or application code makes the grant unnecessary. | `information_schema.role_table_grants` / `column_privileges` on the local database. Affected tables include `admin_users`, `inside_audit_events`, `inside_audit_events_history`, `verification_records`, `likes`, `messages`, `invites`, `referrals`, `notifications`, `feedback`, `matches`, `blocks`, `passes`, `reports`, `chat_read_state`, `profile_photos`. | High | Open | 4 |
| E-02 | `anon` could execute sensitive functions: `admin_list_reports`, `admin_resolve_report`, `enforce_chat_read_state_immutable_fields`, `get_or_create_invite`, `has_unread_chat`, `mark_chat_seen`. | `has_function_privilege('anon', ...)` returned true. `resolve_invite_token` is intentionally public. | High | Open | 4 |
| E-03 | Five `SECURITY DEFINER` functions did not include `pg_temp` in `search_path`: `create_match_if_mutual`, `get_or_create_invite`, `has_unread_chat`, `mark_chat_seen`, `resolve_invite_token`. | `pg_proc.proconfig` inspection. | High | Open | 4 |
| E-04 | No documented table/function privilege matrix, so future grants can silently widen access. | No database access document. | Medium | Open | 4 |

## F. Database testing and CI validation

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| F-01 | `supabase/tests/security_remediation.sql` is not a pgTAP test. | `supabase test db` failed with `Parse errors: No plan found in TAP output`; the file uses `do $$ ... raise exception` with no `plan()`. | High | Open | 5 |
| F-02 | CI never runs database migrations or database tests. | `.github/workflows/ci.yml` has no Supabase job. | High | Open | 5 |
| F-03 | No schema invariants cover RLS enablement, function ACLs, or `search_path`. | Existing test covers a subset of privileges only. | High | Open | 5 |
| F-04 | Test registration is not enforced in CI. | See A-06/A-07. | Medium | Open | 1, 5 |

## G. Deployment and release safeguards

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| G-01 | Staging documentation understates the live pipeline and omits rollback/verification detail. | See B-03. | High | Open | 2, 6 |
| G-02 | No scheduled or manual production smoke workflow. | Only the local `pnpm release:smoke` command exists. | High | Open | 6 |
| G-03 | GitHub Actions `uses:` pinning is not enforced by a check. | Current workflows are pinned, but nothing prevents an unpinned addition. | Medium | Open | 6 |
| G-04 | Required status checks and merge-queue enforcement cannot be confirmed from the unauthenticated API. | Branch-protection API returned 401; public rulesets show `PR review protection` and `Protect main` active but no required-check detail. | High | Needs verification | 6 |
| G-05 | No `CODEOWNERS`. | File absent. Adding one requires a real team/owner handle. | Medium | Open (maintainer action) | 6 |
| G-06 | Production deployment is external (Cloudflare Workers Builds); the repository cannot gate or observe the deploy directly. | Live production URL returns 200; no production deploy workflow exists by design. | High | Needs verification | 6 |

## H. Dependency and supply-chain health

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| H-01 | Dependency advisories: `pnpm audit --prod` reports 13 vulnerabilities (2 critical, 2 high, 9 moderate); GitHub reports 22 on the default branch (4 critical, 3 high, 15 moderate, including dev dependencies). | `pnpm audit --prod` executed 2026-11-22; GitHub push notice 2026-11-22. | High | Open | 3, 6 |
| H-02 | Next.js `16.3.8` is below the patched `>=16.4.5` range for reported advisories. | `pnpm audit --prod` advisory output. | Critical | Open | 3, 6 |
| H-03 | No automated dependency updates. | See C-04. | Medium | Open | 3 |

Dependency upgrades are deliberately **not** bundled into hygiene/docs PRs.
They need their own compatibility pass and release verification.

## I. Product and documentation consistency

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| I-01 | Launch state, countdown, and 3D-heart documentation describes a removed system. | See B-04/B-05. | High | Open | 1, 2 |
| I-02 | README implies Discover/Like/Match/Chat are part of the current experience; the routes do not exist. | `src/app` has no `/discover`, `/matches`, or `/chat`. | Medium | Open | 2 |
| I-03 | The product's permanent waiting state is not named consistently across README/spec/checklist. | Documentation review. | Medium | Open | 2 |

## J. Privacy and secret hygiene

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| J-01 | A local-only recovery note contains a real admin email and UUID. | `docs/inside-admin-recovery.md` is untracked and must stay untracked. | Critical if committed | Resolved (kept untracked) | — |
| J-02 | No real credentials, emails, USNs, auth IDs, or verification metadata were found in tracked files. | Repository scan of tracked files; `.env.example` contains placeholders only. | High | Resolved | — |
| J-03 | `.env.example` was ignored, so contributors had no safe template. | See A-05. | Medium | Open | 1 |

## K. Final readiness verdict

| ID | Finding | Evidence | Severity | Disposition | PR |
| --- | --- | --- | --- | --- | --- |
| K-01 | Final evidence-based readiness verdict. | Filled in PR 6 after all checks and PR outcomes are known. | High | Open | 6 |

### Final verdict (2026-11-22, delivered in PR 6)

**Readiness status: OPEN — the repository is remediated but not yet ready for a
public open-source release, as of 2026-11-22.**

- All six open-source readiness PRs are delivered into open pull requests
  (#15 hygiene, #16 documentation, #17 contributor experience, #18 security plus
  database-validation CI, #19 database-validation, #20 deployment safeguards).
  None is merged, so no finding is yet marked **Resolved** under the disposition
  key.
- Findings A through J each have a delivering PR and executed-check evidence in
  this tracker; the final checks below were executed on 2026-11-22.
- Final executed checks on 2026-11-22: `git diff --check` pass; `pnpm lint` 0
  errors; `pnpm exec tsc --noEmit` pass; `pnpm test:inside` 532 pass / 0 fail;
  `pnpm exec supabase db reset --local` pass; `pnpm exec supabase test db` PASS
  (51 tests, 2 files); `node scripts/check-workflow-pins.mjs` OK; production smoke
  workflow added in PR 20; live production `https://us-justus.in/` → 200 and
  staging → 200; staging run `44871749494` → success.

Outstanding at final report time: merge the open PRs and re-run `validate` (now
`needs: database`); close H-01/H-02 with a dedicated security release; confirm
required checks (G-04); add CODEOWNers (G-05); wire deploy observability (G-06).

---

## Evidence log

Recorded 2026-11-22 unless stated otherwise.

| Check | Result |
| --- | --- |
| Latest `main` at audit start | `bc1efc0` |
| Local Supabase reset | `supabase db reset --local` succeeded through 43 migrations and seed |
| Database test command | `supabase test db` failed: `Parse errors: No plan found in TAP output` |
| pgTAP availability | `pgtap` 1.3.3 available in the local database; not installed by default |
| Staging pipeline | Run `44871749494` on `8bed2f0` concluded success |
| Staging URL | `https://us-staging.atharvaspatil2005-d16.workers.dev` returned HTTP 200 |
| Production URL | `https://us-justus.in/` returned HTTP 200 |
| Private vulnerability reporting | Enabled (GitHub API) |
| Branch protection | Rulesets `PR review protection` and `Protect main` active; required checks not confirmable unauthenticated |
| Dependency audit | `pnpm audit --prod`: 13 vulnerabilities (2 critical, 2 high, 9 moderate); GitHub default-branch alert: 22 (4 critical, 3 high, 15 moderate) |
| Workflow pinning | Existing `uses:` entries are SHA-pinned; automated guard added in PR 20 (`scripts/check-workflow-pins.mjs` + CI step) |
| Production smoke workflow | Added in PR 20 (`.github/workflows/production-smoke.yml`, `workflow_dispatch`, `scripts/smoke-prod.mjs`) |
| Database tests (final) | PASS — 51 tests, 2 files (`security_remediation.sql` + `schema_invariants.sql`) via `pnpm test:db` |
| `gh` CLI | Not installed; GitHub API used for repository inspection |

## PR log

| PR | Branch | Status | URL | Verification |
| --- | --- | --- | --- | --- |
| 1 | `chore/repository-hygiene` | Open | https://github.com/us-justus/us/pull/15 | `pnpm lint`, `tsc --noEmit`, 542 tests, registration guard |
| 2 | `docs/open-source-documentation` | Open | https://github.com/us-justus/us/pull/16 | `git diff --check`, `pnpm lint`, `pnpm exec tsc --noEmit` |
| 3 | `docs/contributor-experience` | Open | https://github.com/us-justus/us/pull/17 | `git diff --check`, `pnpm lint`, `pnpm exec tsc --noEmit` |
| 4 | `security/database-access-review` | Open | https://github.com/us-justus/us/pull/18 | Least-privilege migration + docs; database-validation CI commits also on this branch |
| 5 | `ci/database-validation` | Open | https://github.com/us-justus/us/pull/19 | pgTAP conversion, schema invariants, `test:db`, CI `database` job, `validate` dependency |
| 6 | `ci/deployment-safeguards` | Open | https://github.com/us-justus/us/pull/20 | Production smoke workflow, workflow pin guard, `docs/deployment.md` |

## Maintainer actions that cannot be completed from the repository

These are not code defects and must not be presented as fixed:

1. Confirm and enforce the required `validate` check (and, if desired,
   `staging/verified`) in branch protection / rulesets. The unauthenticated API
   cannot read the required-check configuration.
2. Decide whether to add `CODEOWNERS`; a real GitHub team or owner handle is
   required.
3. Schedule the Next.js and transitive dependency upgrades from H-01/H-02 as a
   dedicated security release with full smoke verification.
4. Keep `docs/inside-admin-recovery.md` out of Git. If it must be shared, move
   the credentials out of it first.
5. Review whether production Cloudflare Workers Builds should expose a
   deployment status/check that the repository can observe.
