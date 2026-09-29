<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# us — Agent Rules (STRICT)

These rules encode the measured 2026-09 performance + mobile-first audit
(see spec.md §4–§12 for rationale). Follow them automatically. SPEC.md is the
source of truth; this file is its enforcement checklist. If the two ever
conflict, SPEC.md wins — flag the conflict, do not silently pick one.

## DO

- Measure before optimizing: use the `[perf]` instrumentation
  (`src/lib/utils/perf.ts`, dev-only, labels + durations only) and test on a
  physical phone over LAN at 360 / 390 / 430px before claiming an improvement.
- Preserve the session architecture: `ensureAnonymousSession()` is the only
  place that may create a session; `useAnonymousSession()` for onboarding,
  `useExistingSession()` (never creates) for login/settings/auth pages.
- Follow the product state model (SPEC.md §5.1): PUBLIC (log in + enter, no
  product nav) / ONBOARDING (minimal header, no product nav, no
  "isn't secured yet") / CAMPUS PRODUCT SESSION (full nav; secure-account
  messaging lives in Settings) / PERMANENT ACCOUNT (full nav + sign out).
  Never derive navigation from raw `is_anonymous`; use
  `getProductSession()`/`guardProductSession()` server-side and
  `/api/account/state` client-side. Protected routes redirect public → 
  `/login` and incomplete → `stepPath()`; `/profile/edit` and
  `/settings/account` must use `useExistingSession()` (never mint anonymous
  sessions on protected pages).
- Reuse the known user within a request (`getOnboardingState(user)` in
  API routes); never pay for a second `auth.getUser()` on one request.
- Preserve the onboarding order usn → email → password → profile → photos:
  email is required (no skip), the password step converts the CURRENT
  anonymous user via `updateUser()` (never `signUp`, UID preserved), and
  login verifies USN server-side (`/api/auth/verify-usn`) with one generic
  failure message. USN/email stay private and immutable.
- Keep server/client boundaries: server components by default; client only
  for gesture, form state, or browser APIs. Never convert a whole page to a
  client component for convenience.
- Keep swipe on Motion values + CSS transforms; keep swipe config centralized
  in `src/lib/discover/constants.ts`; animate first, persist async after.
- Respect `prefers-reduced-motion` in JS animations too (`useReducedMotion()`);
  CSS reset alone does not cover motion/react.
- Optimize images per spec.md §7: aspect boxes always, eager+high-priority
  only for the visible photo, lazy + async-decode everywhere else, preload
  only the next discover card. Photo picks preview instantly from a local
  object URL (original quality) via `usePhotoUploadQueue`; compression
  before upload, server validation authoritative.
- Preserve RLS and the public/private data split: USN, email, auth IDs, and
  verification metadata never leave server-side queries.
- Batch independent same-phase DB updates with `Promise.all`; keep genuinely
  dependent steps sequential.
- Test every change at 360px with keyboard, safe areas, loading/error states,
  and reduced motion before finishing.

## DO NOT

- Do not add Three.js/R3F without meeting every constraint in spec.md §9.
  Never use it for swipe mechanics, onboarding, discovery, or auth.
- Do not turn pages into client components, add global state libraries, or
  add dependencies without a measured benefit on a physical device.
- Do not add animations, blur, shadows, or overlays that regress the §11
  budgets or block interaction on mobile.
- Do not ship desktop-first UI, in-flow menus/overlays that shift layout, or
  touch targets under 44px.
- Do not create duplicate auth/session logic, duplicate onboarding-state
  fetches (one resolution per navigation), duplicate `getUser()` calls, or
  `router.refresh()` after mutations.
- Do not bypass RLS, weaken policies to make a feature work, trust
  client-proved user IDs, or expose private fields in public queries.
- Do not log passwords, tokens, keys, USNs, emails, or user data — `[perf]`
  labels and durations only.
- Do not optimize from assumptions, present targets as measured results, or
  add Cloudflare/edge complexity without a measured benefit (spec.md §12).
- Do not build Matches/Chat-scope features inside unrelated tasks, and do not
  create parallel rule docs — SPEC.md + this file are the only rule sources.

