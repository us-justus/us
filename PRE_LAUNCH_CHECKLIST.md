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
- [ ] Campus status
- [x] Permanent #spot (STEP 2: minimal identity panel on `/`)
- [ ] Profile summary
- [ ] Search entry
- [ ] Invite entry
- [ ] Countdown
- [ ] Launch state
- [x] Locked feature messaging (STEP 2: minimal "locked until launch" line; full home deferred)

## E. Search
- [ ] Username search
- [ ] Public-field-only results
- [ ] Debouncing
- [ ] Pagination
- [ ] Result limit
- [ ] DB index
- [ ] Empty state
- [ ] Loading state
- [ ] Error state
- [ ] Abuse/rate-limit handling

## F. Invite
- [ ] Public URL design
- [ ] Invite landing page
- [ ] Referrer tracking design
- [ ] Duplicate invite handling
- [ ] Abuse prevention
- [ ] Mobile share behavior
- [ ] Privacy audit

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
- [ ] Full fresh registration tested
- [ ] Existing user login tested
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
