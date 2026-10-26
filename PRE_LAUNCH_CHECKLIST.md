# us — Pre-Launch Checklist

## A. Architecture
- [x] Repository audit complete
- [x] Auth/product-state model documented
- [x] Launch state architecture decided
- [x] Server-side launch enforcement points identified
- [x] Database changes reviewed
- [x] RLS impact reviewed
- [x] Load strategy reviewed

## B. Identity
- [x] Unique username schema designed
- [x] Username normalization defined
- [x] Username uniqueness constraint defined
- [x] Username validation defined
- [x] Username API/query design defined
- [x] Username privacy verified
- [x] Username persistence implemented (STEP 2: single writer POST /api/onboarding/profile)
- [x] Username case-insensitive rejection verified (index-authoritative, 409)
- [x] Username immutability enforced (STEP 2 product decision; change UX deferred)

## C. Permanent #spot
- [x] Allocation mechanism designed
- [x] Atomic/concurrency-safe allocation verified (STEP 2: existing allocate_campus_spot(), row-locked; pre-check + 23505→409, gaps acceptable)
- [x] Unique constraint defined
- [x] Stability across logout/login verified (STEP 2: stored on profiles, idempotent reuse; survives relogin by construction)
- [ ] Deletion behavior defined
- [x] Public exposure rules defined
- [x] #spot assignment wired (STEP 2: one request with profile save, retry-safe)

## D. Pre-Launch Home
- [x] Campus status (STEP 3A: "pre-launch · you're in" + gathering copy on `/`)
- [x] Permanent #spot (STEP 2: minimal identity panel on `/`)
- [x] Profile summary (STEP 3A: @username + #spot identity with profile/settings actions)
- [x] Search entry (STEP 3B: /search in pre-launch nav + panel link)
- [x] Invite entry (STEP 3D: "invite friends" action on pre-launch home with Web Share API)
- [ ] Countdown
- [ ] Launch state
- [x] Locked feature messaging (STEP 2: minimal "locked until launch" line; full home deferred)

## E. Search
- [x] Username search (STEP 3B: prefix, case-insensitive, username-only)
- [x] Public-field-only results (STEP 3B: explicit projection, no user_id/USN/email)
- [x] Debouncing (STEP 3B: 250ms, no dependency, stale-guard)
- [ ] Pagination (not needed: hard cap 20, no paged UX)
- [x] Result limit (STEP 3B: SEARCH_LIMIT = 20)
- [x] DB index (STEP 3B: reused idx_profiles_username_lower, no migration)
- [x] Empty state
- [x] Loading state
- [x] Error state
- [ ] Abuse/rate-limit handling

## F. Invite
- [x] Public URL design (STEP 3D: /invite/<token>, opaque 32-char hex)
- [x] Invite landing page (STEP 3D: server-resolved, valid/invalid/disabled/self/auth states)
- [x] Referrer tracking design (STEP 3D: stable user-linked, cookie attribution, immutable referral record)
- [x] Duplicate invite handling (STEP 3D: one active per user, concurrency-safe RPC)
- [x] Abuse prevention (STEP 3D: no public token exposure, server-side resolution only)
- [x] Mobile share behavior (STEP 3D: Web Share API + clipboard fallback; STEP 3D.1: share-card sheet with dynamic username/#spot, canvas image for native file share)
- [x] Privacy audit (STEP 3D: public fields only, no USN/email/auth ID exposed)

## G. Countdown
- [ ] Authoritative launch timestamp
- [ ] UTC handling
- [ ] Client countdown
- [ ] Refresh behavior
- [ ] Device-clock independence
- [ ] Launch transition
- [ ] No unnecessary polling

## H. Three.js Launch Experience
- [ ] Existing renderer/dependencies audited
- [ ] Heart implementation
- [ ] Lazy loading
- [ ] Low-GPU budget
- [ ] Reduced-motion fallback
- [ ] Static fallback
- [ ] Mobile performance
- [ ] No duplicate WebGL context

## I. Pre-Launch Lock
- [x] Discover locked
- [x] Like locked
- [x] Pass locked
- [x] Match locked
- [x] Chat locked
- [x] Server/API enforcement
- [x] Direct URL enforcement
- [ ] Device-clock manipulation tested

## J. Launch Transition
- [ ] Launch state flips correctly
- [ ] Discover unlocks
- [ ] Like/Pass unlocks
- [ ] Match creation works
- [ ] Chat unlocks
- [ ] Search remains available
- [ ] Existing pre-launch users retain identity
- [ ] #spot remains permanent
- [ ] Before enabling matching, prompt completed users with NULL gender to select Male or Female.
- [ ] Do not re-run onboarding or modify existing user data.
- [ ] Verify server-side matching access is gated until gender is set.
  (see spec.md §14.10 — existing completed users at matching time)

## K. Performance
- [ ] Physical iPhone test
- [ ] Auth timings measured
- [ ] Search timings measured
- [ ] Profile timings measured
- [ ] Image timings measured
- [ ] Discover timings measured
- [ ] Bundle sizes measured
- [ ] Animation frame behavior checked
- [ ] Slow-network behavior tested

## L. Load Handling
- [ ] Bounded queries
- [ ] Database indexes
- [ ] Search pagination
- [ ] Image strategy
- [ ] Rate limits
- [ ] Launch traffic review
- [ ] Supabase capacity review
- [ ] Realtime capacity review
- [ ] Error/retry behavior

## M. Security / Privacy
- [ ] USN private
- [ ] Email private
- [ ] Phone private
- [ ] Auth ID private
- [ ] Verification metadata private
- [ ] Public profile fields audited
- [ ] Search responses audited
- [ ] Invite responses audited
- [ ] RLS reviewed
- [ ] API authorization reviewed

## N. Post-Launch Features
- [ ] Discover
- [ ] Like/Pass
- [ ] Match
- [ ] Matches UI
- [ ] Chat
- [ ] Realtime messaging
- [ ] Block
- [ ] Report

## O. Final Launch Gate
- [ ] Full fresh registration tested (email + no-email paths untested live)
- [ ] Existing user login tested (USN + password untested live)
- [ ] Logout/login tested
- [ ] Pre-launch lock tested
- [ ] Launch transition tested
- [ ] Mobile tested
- [ ] Desktop tested
- [ ] Slow network tested
- [ ] Build clean
- [ ] Lint clean
- [ ] Security audit complete
- [ ] Load review complete
- [ ] Production environment verified

## Q. Production Release (required sequence — spec.md §12.1)
- [ ] `pnpm release:build` (frozen-lockfile install → tests → tsc → lint → OpenNext build)
- [ ] Validation green (no skips)
- [ ] Upload / traffic cutover (record the live Worker version ID)
- [ ] `pnpm release:smoke` against LIVE production → PASS = healthy
- [ ] On FAIL: record version, do NOT edit auth/DB/secrets first (spec.md §12.1); manual rollback if necessary (`pnpm release:rollback` prints the command)
- [ ] Smoke again after any rollback

## P. Optional email (STEP 3C)
- [x] Email optional in onboarding (skip path, internal sign-in identity + password)
- [x] Skipped-email password conversion (POST /api/onboarding/password attaches confirmed internal identity, same UID)
- [x] Internal identity never displayed (displayAccountEmail suppression in UI + /api/account/state)
- [x] USN + password login route (password-gated USN → email RPC, server-only; covers internal identities)
- [x] Skip-state migration written (20261001000001_optional_email.sql)
- [x] Recovery copy truthful for no-email accounts (email-add-in-Settings only)
- [x] Search / username / #spot untouched
- [ ] Migration applied to hosted Supabase (code ships fallbacks; skip unavailable until applied)
- [ ] Live E2E: email account (onboarding → verify → login → relogin → search)
- [ ] Live E2E: no-email account (skip → complete → on-device access → search)
