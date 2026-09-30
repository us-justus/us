# us — V1 Product & Engineering Specification

> **us**
>
> *just us.*

## 1. Product

us is a private, campus-only dating web app.

Students from the same college can:

1. Verify that they belong to the campus.
2. Create a simple dating profile.
3. Discover other verified students.
4. Like or pass on profiles.
5. Match when the like is mutual.
6. Start a private conversation.

### Core match message

> **it's a match.**
>
> *you both liked each other.*

The V1 product intentionally does not attempt to become a social network.
The core loop is:

**Discover → Like → Match → Chat**

The product ships in two phases (see §14): PRE-LAUNCH first (verify,
username, profile, permanent #spot, search, invites, countdown), then the
core loop unlocks at launch. Launch state is authoritative server-side.

---

# 2. Product Identity

## Name

**us**

## Tagline

**just us.**

## Match copy

**it's a match.**

*you both liked each other.*

## Brand principles

The interface should feel:

- Minimal
- Romantic
- Warm
- Private
- Exclusive
- Modern
- Youthful without being gimmicky
- Premium rather than over-designed

The product must NOT feel:

- Corporate
- Generic
- Like a template
- Like a "vibe-coded" project
- Overly colorful
- Over-animated
- Like a direct Tinder clone

---

# 3. V1 Scope

## Included

### Authentication / verification

- USN — mandatory private campus identity, immutable after verification
- Verified email + password — mandatory permanent authentication
  (Supabase Auth owns passwords; USN is never a password)
- USN format validation using college-specific regex
- Internal anonymous user ID (onboarding identity; UID preserved on
  conversion — never `signUp`, never a second user, never profile migration)
- Onboarding: USN → email → password → profile → photos → discover
- Login: USN + email + password → password auth, then server-side USN
  verification against the authenticated user; one generic failure message
- Verification data (USN, email, auth IDs, metadata) must never appear on
  public profiles

### Profile

A profile contains:

- Nickname
- Age
- Year
- Branch
- Profile photos
- Optional short bio/interests

### Discovery

- One profile card at a time
- Swipe right → Like
- Swipe left → Pass
- Like/pass buttons as secondary controls
- Only eligible campus users appear
- Previously processed profiles should not reappear unnecessarily

### Matching

A match occurs when:

```text
User A likes User B
        +
User B likes User A
        ↓
      MATCH
```

---

# 4. Engineering Principles

## 4.1 Mobile-first is a product requirement

`us` is used on phones over variable campus networks. Every screen must be
designed, built, and verified at 360px / 390px / 430px widths first; desktop
is a centered, max-width-constrained presentation of the same mobile
experience — never a stretched layout, never a separate design.

Reason: the entire core loop (onboarding → discover → swipe → match → chat)
happens on mobile. Desktop-first UI ships touch, safe-area, and keyboard
bugs that only surface on physical devices.

## 4.2 Performance is a product requirement

Registration latency, swipe frame rate, and image loading are product quality,
not implementation detail. A slow registration or a janky swipe loses users
the same way a broken feature does.

## 4.3 Measured optimization only

Never optimize from assumptions. The onboarding pipeline is instrumented with
safe development-only `[perf]` logs (`src/lib/utils/perf.ts`) that record
operation names and durations only — never passwords, tokens, keys, USNs,
emails, or user data. Example: `[perf] onboarding.usn 210ms`.

Every budget in §10 is labeled TARGET unless it has been measured on a
physical device over LAN. Do not present a target as a measured result.

## 4.4 Privacy separation is fundamental

Public profile data: nickname, age, year, branch, photos, bio, interests.

Private verification data: USN, email, Supabase auth/user ID, verification
metadata. Private data must never appear in profile cards, discovery
responses, public APIs, URLs, chat, or client-visible identifiers. RLS must
never be weakened to make a feature work; the smallest secure change wins.

---

# 5. Auth / Session Architecture

## 5.1 Product state model (source of truth)

Raw Supabase auth (`is_anonymous`) is internal identity only — it must NEVER
decide navigation or messaging directly. Product state is determined by
whether a session exists, whether onboarding is complete, and whether the
account is permanent. Implemented in `src/lib/auth/product-state.ts`
(`getProductSession()` / `guardProductSession()`); the header resolves it via
`GET /api/account/state`.

- PUBLIC — no session (first visit, logged-out permanent user, landing).
  Sees landing, login, sign-up/enter, public info only. Header shows `us` +
  `log in` + `enter`. Never discover/matches/chat/profile/settings.
  `ENTER` → `/onboarding` (the sign-up flow; anonymous auth is established
  internally, never presented as "anonymous login"). `LOG IN` → `/login`
  (USN + email + password; verified server-side).
- ONBOARDING — session exists, step != complete (`/onboarding/*`: usn →
  email → password → profile → photos). Minimal header (`us` + progress
  context + back nav). Never product nav, never "account isn't secured yet"
  messaging. Email is required (it secures the account and is the sign-in
  identity); the password step links it to the current anonymous user,
  verifies it, and sets the password — same `auth.uid()`, same data.
- CAMPUS PRODUCT SESSION — onboarding complete on a still-anonymous account.
  Full product nav (discover/matches/chat/profile/settings). The "secure your
  account" message belongs HERE (Settings), as an account/security action.
- PERMANENT ACCOUNT — verified email + password, non-anonymous. Full product
  nav; Settings shows verified email, change password, sign out. Sign-out →
  `/` with public navigation restored.

Protected routes (`/discover`, `/matches`, `/chat`, `/profile`,
`/profile/edit`, `/settings`) enforce this server-side: public → `/login`,
onboarding-incomplete → the `stepPath()` step, campus/permanent → allowed.
Hiding navigation alone is never sufficient; browser back after logout must
still hit the server guard (no cached authenticated content).

Two-phase mapping (see §14): `campus` / `permanent` sessions are PRE_LAUNCH
while `launch_config.launched = false` and LAUNCHED once true. The pure
`productPhaseFor()` helper (`src/lib/auth/product-state.ts`) maps the
preserved primitives to `public | onboarding | pre-launch | launched` —
onboarding, login, and account semantics are unchanged.

## 5.2 Session mechanics

- Anonymous Supabase Auth is the V1 session foundation; the email/password
  upgrade converts the CURRENT user via `updateUser()` (UID preserved) and
  must never mint a second identity (`signUp` is forbidden for conversion).
- Login requires USN + email + password: client `signInWithPassword()`, then
  `POST /api/auth/verify-usn` confirms the submitted USN belongs to the
  authenticated user (`verification_records.user_id`, server-derived —
  client user IDs never trusted, USN never returned). Every credential
  failure returns one generic message; USN is never a password and never
  authenticates alone.
- `ensureAnonymousSession()` (`src/lib/auth/session.ts`) is the single place
  that may establish a session. Pages use `useAnonymousSession()`; pages that
  must never create a session (`/login`, `/settings`, `/auth/*`) use
  `useExistingSession()`.
- `supabase.auth.getSession()` reads local storage only (no network);
  `supabase.auth.getUser()` costs a network round-trip. Never call `getUser()`
  when `getSession()` already shows there is no local session — go straight
  to `signInAnonymously()`.
- Never run the full session bootstrap twice on one user gesture (e.g. mount
  hook + submit handler). Gate the action on the hook status instead; API
  routes 401 safely if the session is ever missing.
- Middleware calls `auth.getUser()` on every request; route handlers and
  `getOnboardingState()` must therefore reuse the already-known user
  instead of re-validating (see §6).

---

# 6. Request / Waterfall Rules

Onboarding and account flows are sequential-request sensitive: each step is
Browser → Next.js → Supabase, so every redundant hop adds a full RTT.

- `getOnboardingState()` is the single source of onboarding truth (DB, never
  localStorage alone). Layouts must not fetch it when their child pages
  already do — one resolution per navigation, not two.
- Never issue the same query twice in one resolution (past bug: duplicate
  `profiles` lookup when email was skipped).
- Never call `auth.getUser()` twice on one request. `GET /api/account/state`
  passes its already-authenticated user into `getOnboardingState(user)`.
- Prefer `Promise.all` for independent queries (discover exclusions already
  do this). Sequential `await` is only for genuinely dependent steps.
- Photo `display_order` compaction must batch each phase with `Promise.all`
  (2 batches, not 2N sequential updates); the two phases themselves stay
  sequential to respect the `(profile_id, display_order)` unique constraint.
- Match detection is one lookup per like (the OR covers both orderings); no
  fallback second query. Duplicate-action tolerance checks `error.code ===
  "23505"` first, message match second.
- No `router.refresh()` after mutations; navigate or revalidate deliberately.
  No API → API → Supabase chains: route handlers talk to Supabase directly.

---

# 7. Image Strategy

Photos dominate bandwidth, decode cost, and layout stability. Rules:

- Reserve space for every image with aspect-ratio boxes (`aspect-[3/4]` cards,
  `aspect-[3/4]` grids) so images never cause layout shift.
- Current card photo: `loading="eager"` + `fetchPriority="high"` +
  `decoding="async"`. All other photos: `loading="lazy"` + `decoding="async"`.
- Discover stack: CURRENT card highest priority; NEXT card preloaded (link
  preload of its first photo while the current card is viewed); FAR cards
  never eagerly loaded.
- One photo-indicator system per card (top progress bars). No duplicate
  indicator sets.
- No client-trust shortcuts: keep server-side MIME/size limits
  (`MAX_PHOTOS = 6`, `MAX_PHOTO_BYTES = 5 MB`, JPG/PNG/WEBP). Client-side
  downscale/compression before upload is built (`src/lib/photos/compress.ts`:
  1440px long-edge ceiling, downscale-only, high-quality JPEG/WebP,
  EXIF-aware, original fallback, never larger than the source, ≤1.5MB
  passthrough) — server validation stays authoritative regardless.
- Preview-first uploads (`usePhotoUploadQueue`): the original selection
  renders instantly from a local object URL (full quality, before
  compression/upload), then tiles show selected → optimizing → uploading →
  uploaded/failed (retry/remove). Uploads run sequentially in the background
  without blocking the page; one failure never stalls the queue.
- `next.config.ts` declares Supabase Storage remote patterns with
  AVIF/WebP formats so a future `next/image` migration needs no config change.
- Never sacrifice perceived quality of the current card to save bytes; save
  bytes on cards the user cannot see yet.

---

# 8. Swipe Performance

Target: 60 FPS during drag on low-end mobile.

- Swipe physics live in Motion values + CSS transforms only
  (`useMotionValue` / `useTransform` in `DiscoverDeck`). No React state
  updates per pointer movement, no `setInterval`, no polling, no layout reads
  in the gesture path.
- Swipe configuration is centralized in `src/lib/discover/constants.ts`
  (`SWIPE_THRESHOLD`, `SWIPE_VELOCITY_THRESHOLD`, `MAX_ROTATION`,
  `EXIT_DISTANCE`, `SPRING_CONFIG`). No magic numbers in components.
- Dismissal decides on distance AND velocity (fast flick dismisses below the
  distance threshold; slow drag must cross it).
- UI responds instantly: card animation starts before persistence;
  `swipeAction()` is fire-and-forget async. Never gate animation on network.
- No network requests during pointer movement.
- Card exit animation completion and stack advancement are one event — no
  extra timeout gaps between exit and promotion.
- Avoid per-card GPU overdraw: no `backdrop-blur` inside stacked cards
  (interest pills use translucent solid backgrounds).
- Three.js must never drive swipe mechanics (§9).

---

# 9. Animation / Three.js Policy

Three.js is NOT part of the product. No Three.js code may be added without a
measured, reviewed decision, and then only under all of these constraints:

- Subtle atmospheric/background use only; never load-bearing for onboarding,
  profile editing, discovery, swiping, matching, messaging, or auth.
- Low object count, low GPU cost, no heavy post-processing.
- Never blocks interaction; static fallback always rendered first.
- Full `prefers-reduced-motion` support (JS animations included — Motion
  animations do not inherit the CSS reset; use `useReducedMotion()`).
- Automatic reduction on mobile / low-power devices.
- Zero regression to core-UI budgets (§10) on a physical device.

If a proposed effect cannot meet all of the above, it ships as static CSS or
not at all. Decorative animation must never compromise the core loop.

---

# 10. Mobile UX Standards

- Minimum touch target 44px on all interactive elements.
- Respect safe areas: `viewportFit: "cover"` + `env(safe-area-inset-*)`
  padding on fixed overlays and bottom-anchored actions.
- No horizontal overflow at 360px. No in-flow layout shifts: overlays and
  menus render absolutely positioned, never pushing page content.
- Keyboard-safe forms: focused inputs and primary actions stay visible;
  `inputMode` set for numeric fields; visible focus states everywhere.
- Mobile-first breakpoints: base styles target ~360px; `sm:` only refines.
  Card widths capped (`max-w-[380px]` discover, `max-w-[560px]` forms).
- `touch-action: pan-y` on the swipe surface: horizontal gesture captured,
  vertical scroll preserved; never block all browser gestures.
- Every network operation has loading, success, and failure states with
  human-readable errors (never raw DB/SQL errors, stack traces, or IDs).
- Gestures are primary but never exclusive: Like/Pass buttons, desktop arrow
  keys, and accessible labels (`"Like Maya"` / `"Pass Maya"`) always exist.
- Typography-led, minimal, calm. No excessive gradients, glassmorphism,
  shadows, confetti, or particle effects.

---

# 11. Performance Budgets

All values TARGET unless labeled MEASURED. Measure on a physical phone over
LAN (dev) and re-label with measured numbers when available.

- Onboarding step API (USN / email / profile save): Target: p50 < 600ms.
- Photo upload (one, ≤5 MB, campus Wi-Fi): Target: p50 < 3s including metadata write.
- Discover readiness (navigation → first card interactive): Target: < 2s.
- Swipe frame rate during drag: Target: 60 FPS, zero dropped-frame jank on target devices.
- Initial client JS (all route chunks, gzip): Measured (build 2026-09-29): ~311 KB total; Target: keep total under 350 KB gzip, per-route addition under 20 KB gzip.
- Layout stability: Target: CLS 0 from images and menus (aspect boxes + absolute overlays).
- Registration end-to-end (first paint → discover, excl. user think time): Target: < 8s on campus Wi-Fi. Not yet measured — read `[perf]` logs on device and record here.

---

# 12. Cloudflare Deployment Principles

Cloudflare is planned, not yet implemented. Do not add Cloudflare-specific
code without a measured reason. Assessment from the audit:

- GOOD EDGE CANDIDATES: static asset caching/CDN, image resizing/derivation
  (thumbnails + responsive variants at the edge), rate limiting, bot rules.
- SUPABASE-BOUND OPERATIONS (stay close to Supabase, do not proxy for
  "speed"): Auth validation (`getUser`), RLS-guarded writes (USN upsert,
  profile upsert, likes/passes), realtime session refresh. Proxying these
  through an edge worker adds a hop without removing the Supabase RTT.
- NO BENEFIT / NOT WORTH MOVING: the Next.js → Supabase request path itself
  (bottleneck is Supabase RTT + sequential queries, fixed by §6, not by edge
  execution), SMS/phone flows (out of V1 scope), local session reads.
- Cloudflare does not fix sequential waterfalls or oversized images. Apply
  §6 and §7 first; re-measure; only then evaluate edge moves.

---

# 13. Brand System Application (Steps 2–3 learnings)

Warm coral system, sampled from `src/app/favicon.ico` (`#FF6666` field,
`#FFCCCC` detail). Tokens live in `src/app/globals.css`; no parallel color
system may be created.

## 13.1 Token contract

- `--paper` / `--paper-2`: surfaces (warm cream). Page background stays cream.
- `--ink`: primary actions + headings (dark editorial). Primary CTAs
  (e.g. ENTER) stay dark — never coral-filled.
- `--accent` (`#FF6666`): decorative/interactive only. Contrast is
  insufficient for body text — never links, errors, or paragraph text on
  light backgrounds. Uses: tiny dots/markers, focus rings/borders, icon-fill
  accents.
- `--accent-deep` (`#A63D2F`): the text-safe coral. Links on hover, readable
  error text, selected-step text.
- `--accent-soft` (`#FFCCCC`) + `--accent-wash` (`#FFF0EE`): borders and
  subtle emphasis backgrounds (selected pills, error/notice boxes, hover
  washes).
- `--accent-hover` / `--accent-foreground`: the coral-filled interactive
  state (e.g. Like button) + its text.

Usage ratio: ink = primary actions; paper = surfaces; coral = accent only;
deep = readable coral text; wash = selected/error/subtle emphasis. Never make
every interactive element coral — the product should read as editorial
fashion/relationship, not generic pink dating app.

## 13.2 Applied patterns (landing, header, onboarding)

- Inputs: cream surface, thin warm border, dark text; focus is
  `border-accent` + soft coral ring (grey focus borders removed).
- Errors AND notices: boxed `border-accent-soft bg-accent-wash` with
  `text-accent-deep` (or `text-ink` for neutral notices). No green/red
  one-off boxes; bright coral never used as body text.
- Secondary actions: transparent/cream + warm border + dark text; coral only
  on hover/focus (`hover:bg-accent-wash hover:border-accent-soft
  hover:text-accent-deep`).
- Progress/context text stays understated; coral allowed only as a tiny
  step marker dot — no large progress bars.
- Hamburger/menu buttons stay cream/unfilled; coral appears only as hover
  wash and focus ring.
- Every interactive element keeps a visible coral keyboard-focus outline
  (global `:focus-visible`); components must not opt out with
  `focus-visible:outline-none`.
- 44px minimum touch targets everywhere, including icon-only buttons
  (photo remove ×) and in-card retry/remove actions.

## 13.3 Scope discipline

Steps 2–3 covered tokens, landing, header, and onboarding only. Discover,
Matches/Chat, profile editing, settings, auth/session, Supabase/RLS,
routing, and image logic were not redesigned; only token-substitution
edits that clearly conflicted (error boxes, focus states) were carried
over where the new system already existed. Later visual steps must follow
§13.1–§13.2 rather than inventing new hex values.

## 13.4 Landing warm-coral treatment (Step 4B learnings)

The landing (`/`) now reads as warm coral/blush in the first viewport via
surface color only — no layout, copy, typography, spacing, or CTA-hierarchy
changes:

- Hero root is `bg-accent-wash` (dominant blush field; `--accent` never used
  as a full-screen background). Dark `us` wordmark + ink copy keep excellent
  contrast on the wash.
- The tiny `bg-accent` dot before "campus-only · verified · private" was
  retained as the single high-intensity brand accent — no other coral
  decoration was added (no gradients, glass, shadows, blobs, or graphics).
- Primary "ENTER THE CAMPUS →" CTA stays `bg-ink` (dark); secondary "log in"
  stays `bg-paper` so it reads as a light surface on the wash. Its hover was
  retargeted `hover:bg-accent-wash` → `hover:bg-paper-2` because the old hover
  washed out to the page background in the new context (border + deep-text
  hover states unchanged).
- Blush→cream transition is one band only: footer strip is `bg-paper` with a
  `border-accent-soft` top rule (inner divider `bg-accent-soft`). Sections
  were not given individual colors.
- Landing header blends with the hero (`bg-accent-wash/80`, existing blur
  kept, `border-transparent`); non-landing header untouched. Global
  `themeColor` was deliberately left as paper — it is shared browser chrome,
  not a landing surface. Mobile menu overlay stays `bg-paper` (secondary
  surface on wash).
- Verification: `npm run lint` clean; `npm run build` clean (23 pages);
  SSR HTML of `/` (HTTP 200) contains the wash field, dark CTA, retained
  coral dot, and intact copy. Only color-token classes changed, so 360/390/
  430/desktop layout, 44px targets, focus rings, and overflow behavior are
  unchanged by construction.

## 13.5 Global consistency pass (Step 5 learnings)

Visual-only pass over `/login`, `/onboarding/*`, `/discover`, `/matches`,
`/chat`, `/profile`, `/profile/edit`, `/settings`, `/settings/account`,
plus shared header/buttons/inputs/shells/empty-loading-error states.
No auth/session/routing/Supabase/RLS/API/swipe-physics/matching/messaging
logic changed; no dependencies added; no new color system created.

- Classification used for every hardcoded color: (1) brand/UI color →
  migrated to the §13.1 token; (2) genuine semantic state → none found
  worth keeping (all green success boxes migrated — success is conveyed
  by copy, not hue); (3) intentional image/photo overlay → preserved
  (white text on photo gradients, white progress dots, translucent
  interest pills, dark pass stamp); (4) primary dark CTA (`bg-ink`,
  `hover:bg-black`) → preserved; (5) canvas JPEG fill / browser chrome /
  third-party SVG → left alone.
- Green → brand migration (7 files): `border-green-200 bg-green-50
  text-green-800` success/notice boxes in login reset-sent,
  change-password-form, settings/account (verified + pending + done),
  profile/edit saved, and auth/update-password all became
  `border-accent-soft bg-accent-wash text-accent-deep` (neutral notices
  use `text-ink` on the same wash, matching the onboarding password
  pattern). No green/red/blue state colors remain in `src/`.
- Input language unified to onboarding: every product form input is now
  `bg-paper border-line text-ink` with `focus:border-accent
  focus:ring-2 focus:ring-accent-soft` (grey `focus:border-ink-faint`
  removed from login, profile/edit, settings/account,
  change-password-form, update-password). Update-password inputs also
  fixed `text-[15px]` → `text-base` (16px+ mobile rule).
- Pure-white UI surfaces → tokens: discover card `bg-white` → `bg-paper`,
  pass-button `bg-white` → `bg-paper`, like stamp `bg-white/90` →
  `bg-paper/90`, pass stamp `border-white/20 text-white` →
  `border-paper/20 text-paper` (same look, token-correct). Card keeps
  its `border-line` + soft ink shadow; the card was deliberately NOT
  turned pink — coral appears only on like stamp, Like button, and
  focus/selection.
- Discover (most important route): swipe physics, thresholds, springs,
  mechanics, and image strategy untouched. Empty state kept editorial
  and gained the shared caption/divider language (`discover` eyebrow +
  `bg-line-strong` rule). Match overlay moved `bg-paper` →
  `bg-accent-wash` (important-surface blush) with coral period retained
  and `hover:text-accent-deep` on keep-discovering.
- Touch targets (44px): profile/edit photo delete × `h-8 w-8` → `h-11
  w-11`, reorder arrows and retry/remove `h-8` → `min-h-[44px]`,
  profile top edit link / settings shortcuts / placeholder back link /
  back-nav links gained `min-h-[44px]` + `items-center`. Swipe actions
  were already 56px; only focus rings added.
- Focus: every keyboard-interactive element touched now carries the
  coral treatment (`focus-visible:outline-accent` or the accent
  border+ring on inputs); photo carousel prev/next zones gained a
  focus outline; no component opts out with `focus-visible:outline-none`.
- Secondary-action hover unified to `hover:bg-accent-wash
  hover:border-accent-soft hover:text-accent-deep` (replacing scattered
  `hover:bg-paper-2` / `hover:text-ink`); dark primary CTAs unchanged.
- Login feels like onboarding: same `max-w-[560px]` shell with unified
  `py-10 sm:py-14` spacing, coral-dot eyebrow (`welcome back`),
  identical input/focus/error language, dark primary CTA.
- Intentionally preserved route differences: landing keeps the dominant
  `bg-accent-wash` hero (product routes stay paper/paper-2, blush only
  on the match overlay); profile keeps `px-4` photo bleed + white-on-photo
  overlay type; matches/chat placeholders keep minimal editorial form
  with `href="/"` untouched (routing freeze); settings keeps the
  structured `bg-paper-2` account card + `bg-line` dividers without
  becoming a SaaS dashboard.

---

# 14. Pre-Launch Architecture (STEP 1 rebaseline)

Status labels: IMPLEMENTED = live in code/migrations; DESIGNED = schema +
conventions decided, UI/APIs deferred; PLANNED = documented intent only.

## 14.1 Product phases — IMPLEMENTED (mapping) / UI PENDING

- PUBLIC → ONBOARDING → PRE_LAUNCH → LAUNCHED. Account state stays
  separate: `anonymous` / `permanent-unverified` / `permanent-verified`
  (via `getAccountState()`). No combined enum.
- PRE_LAUNCH includes: USN verification, permanent account, username,
  profile, permanent #spot, profile/photos, search, friend discovery,
  public profile/invite link, invite/referral, countdown, subtle
  launch-page atmosphere.
- LOCKED UNTIL LAUNCH: Discover, swiping, likes, passes, matching, chat.
- POST-LAUNCH: Discover, Like/Pass, Match, Chat, persistent history,
  realtime messaging, lightweight interaction.

## 14.2 Launch state — IMPLEMENTED

- `public.launch_config` (migration `20250930000001_prelaunch_foundation`):
  singleton `id = 1`, `launched boolean default false`,
  `launched_at timestamptz NULL` (UTC), `updated_at` via the existing
  `handle_updated_at()` trigger. Seeded `(1, false, NULL)`.
- RLS enabled; one read-only SELECT policy for `anon, authenticated`;
  no write policies — clients cannot modify launch state. No admin UI yet;
  no service-role credentials in client code.
- `getLaunchState()` (`src/lib/auth/launch.ts`) is the single helper,
  returning `{ launched, launchAt }`. No duplicated launch queries, no
  global state library, no polling, no localStorage, no cookie truth,
  no `Date.now()` authorization. `launchAt` is countdown DISPLAY only.

## 14.3 Product-state integration — IMPLEMENTED

- `getProductSession()` / `guardProductSession()` / `getOnboardingState()` /
  `destinationForStep()` / `stepPath()` are preserved exactly; onboarding
  and login semantics unchanged.
- Additive-only `productPhaseFor(session, launch)` maps to
  `public | onboarding | pre-launch | launched`.
- `/api/account/state` additionally returns `launched` + `launchAt`
  (resolved via `Promise.all` with onboarding state; single `getUser()`).
  No private fields exposed (never USN, email from profile tables,
  auth IDs, or verification metadata).

## 14.4 Server-side launch gating — IMPLEMENTED

- `/discover`, `/matches`, `/chat` resolve product session + launch state
  together (`Promise.all`) and redirect PRE_LAUNCH (`guardLaunch()` → `/`)
  server-side. Direct URL access cannot bypass.
- `swipeAction()` (like/pass) checks `getLaunchState()` server-side and
  rejects while PRE_LAUNCH. Match creation stays trigger-driven; message
  operations remain match-scoped (see §14.7). Browser clock never unlocks.

## 14.5 Permanent user identity — IMPLEMENTED (preserved)

- `auth.users.id` is the stable internal identity. `profiles.user_id`,
  `verification_records.user_id`, likes/passes/matches/messages, and future
  username/invite ownership all key off it — never username, email, USN,
  or nickname as a foreign key.

```text
auth.users.id
    ↓
stable user identity
    ↓
profile
    ↓
username / #spot / photos
    ↓
likes / passes
    ↓
match
    ↓
persistent messages
```

- `username ≠ primary relational identity`: renaming `@atharva` →
  `@atharvapatil` leaves #spot, profile, photos, likes, passes, matches,
  chat history, and invite ownership unchanged.

## 14.6 Username — IMPLEMENTED (STEP 2)

- `profiles.username TEXT NULL` with `profiles_username_format` check
  (`^[A-Za-z0-9_]{3,30}$`) and partial unique index
  `idx_profiles_username_lower ON (lower(username)) WHERE username IS NOT NULL`
  → unique, case-insensitive, URL-safe, suitable for `/u/[username]`.
- Chosen over a separate handles table: profiles already carries the
  `user_id UNIQUE` stable key and the public/private RLS split, so a new
  table adds joins without safety benefit. Lookup key only, never FK.
- Exposes no USN/email/auth ID.
- Normalization (single rule, `src/lib/validation/username.ts`, shared by
  client + server): trim surrounding whitespace, reject whitespace inside,
  preserve display casing. Uniqueness is case-insensitive via the index.
- Persistence: username is collected in the EXISTING onboarding profile step
  (`/onboarding/profile` → `POST /api/onboarding/profile`) — no new
  onboarding step, no `getOnboardingState`/`stepPath` change. That endpoint
  is the single username writer; `PATCH /api/profile` rejects `username` /
  `spot` keys so there is never a competing write path.
- Taken-ness: friendly indexed pre-check first (equality lookup, never
  `COUNT(*)`), the unique index authoritative — a `23505` race returns a
  clean 409 ("taken") with no DB detail. No frontend availability check
  is treated as truth.
- Editing rule (product decision, STEP 2): IMMUTABLE after initial set.
  Exact-casing refresh of the same name is allowed; a different name is
  rejected 409 server-side. A full username-change UX is deferred — #spot
  permanence never depends on the name either way.
- NOT YET IMPLEMENTED: username search, public `/u/[username]` profile
  page, friend search, invite links.

## 14.7 #spot — IMPLEMENTED (STEP 2, assignment wired)

- `profiles.spot INT NULL` (`profiles_spot_positive` check, partial unique
  index `idx_profiles_spot_unique`). Immutable once assigned, survives
  logout/login, username and profile changes.
- Atomic allocation via `public.campus_spot_allocator` (singleton
  `next_spot`) + `SECURITY DEFINER allocate_campus_spot()` (single
  `UPDATE … RETURNING`, row-locked). Never `COUNT(*) + 1`, never
  client-generated. Table has no grants/policies (server-only); `EXECUTE`
  granted to `authenticated` for the function only. No new allocator, no
  new privileged function, no RLS change in STEP 2.
- Assignment wiring: `POST /api/onboarding/profile` persists username +
  profile fields + spot in one request. Idempotent — `spot IS NOT NULL`
  is reused, otherwise exactly one `allocate_campus_spot()` call. A retry
  after failure reuses the existing spot; a `23505` username race costs at
  most a harmless gap number (spots are unique, never reassigned, never
  renumbered).
- Surfaced minimally: pre-launch panel on `/` (`@username` + `#spot`,
  locked-feature messaging) and one identity line on `/profile`. `/`
  renders the panel for campus/permanent sessions while PRE_LAUNCH
  (redirecting to /discover would loop back via the launch guard);
  once launched it redirects to /discover as before.

## 14.8 Profile/photos — IMPLEMENTED (existing behavior preserved)

- Unchanged: nickname/age/year/branch/bio/interests + `profile_photos`
  with server MIME/size limits. No image-compression behavior changed.
- STEP 2 extension only: `GET /api/profile` and `getOwnProfile()` also
  return `username`/`spot` (public identity fields — never USN/email/auth
  ID); `PATCH /api/profile` still edits legacy fields only and rejects
  `username`/`spot` keys.

## 14.9 Likes/passes — IMPLEMENTED (existing schema + PRE_LAUNCH lock)

- `likes` / `passes` keyed by `from_user_id → auth.users.id`; gated by
  `swipeAction()` launch check. Data model unchanged.

## 14.10 Match — IMPLEMENTED (existing persistence preserved)

- `matches(user_a_id, user_b_id)` via the `create_match_if_mutual()`
  trigger; match lifecycle stays like → mutual like → MATCH → chat.
  Messages link `match_id` + `sender_id → auth.users.id` (never username,
  email, USN). Chat UI + realtime are NOT YET IMPLEMENTED (post-launch slice).

## 14.11 Persistent chat history — DESIGNED

- `messages(match_id, sender_id, body, created_at)` with match-scoped RLS
  already exists and is untouched. History/realtime UI NOT YET IMPLEMENTED.

## 14.12 Search — DESIGNED (endpoint NOT YET IMPLEMENTED)

- Public fields only: `username` first, optional nickname/display-name only
  if explicitly approved. Never USN/email/phone/auth ID/verification
  metadata. Future endpoint must be normalized, case-insensitive (covered
  by `idx_profiles_username_lower`), indexed, paginated, bounded, and
  debounced client-side. No search endpoint created in STEP 1.

## 14.13 Invite architecture — PLANNED

- Username is the public identity; referral tracking will use stable
  internal `owner_user_id`. If persistent referral links are required, use
  a stable invite token rather than the mutable username. Conceptual:

```text
invite_links: id, owner_user_id → auth.users.id, token, created_at
```

- Table NOT created in STEP 1 (no foundation required yet). Invite UI,
  landing page, and abuse-resistance NOT YET IMPLEMENTED.

## 14.14 Image storage/compression future plan — PLANNED (deferred)

- No compression implemented in STEP 1. `compress.ts`, the photo upload
  queue, and existing image UI are untouched. Free-plan constraint holds:
  no Supabase hosted transformations.
- Future: original → browser resize to display dimensions → high-quality
  encode → size validation → Supabase Storage. Target is perceptually /
  visually lossless at `us` display sizes — never claimed as mathematically
  lossless.

## 14.15 Performance/load principles — unchanged (§4–§12 apply)

- Mobile-first, measure-before-optimizing (`[perf]` labels + durations),
  transform/opacity animations, bounded discover batches, paginated +
  debounced search, optimized images without visible quality loss.
- Launch load: concentrated traffic assumed; no unbounded queries, no
  duplicate auth per request, no per-user countdown polling, lightweight
  launch page. DB/storage/API bottlenecks to be measured before launch.

## 14.16 STEP 2 learnings (username + permanent #spot)

- Extending the existing profile step beat a new onboarding step: the
  profiles row (keyed on `user_id`) is created there already, so username
  + spot rode the same upsert with zero `getOnboardingState`/`stepPath`/
  guard changes and no extra navigation round-trip.
- One writer per field held up: `POST /api/onboarding/profile` owns
  username + spot (first set), `PATCH /api/profile` owns legacy fields
  and hard-rejects identity keys. No competing endpoint was needed, so no
  new `SECURITY DEFINER` and no RLS change.
- Pre-check-then-index pattern: a cheap indexed equality lookup catches
  the common taken-name case before a spot number is consumed; the unique
  index stays authoritative and a `23505` race maps to a clean 409. The
  worst case is a gap in spot numbering — acceptable because spots are
  never sequential-by-count, only unique + permanent.
- Prefill on the onboarding profile page (`GET /api/profile`) gave
  pre-Step-2 complete users a claim path with no new route: they land on
  the same form, see their existing values, and add only a username.
- `/` needed to stop blindly redirecting complete sessions to /discover
  while PRE_LAUNCH (redirect loop via the launch guard); rendering a
  minimal identity panel there was the smallest correct pre-launch
  experience. Post-launch redirect behavior is unchanged.

### STEP 2 status (vs. the STEP 2 brief)

IMPLEMENTED: username schema (reused), username validation/normalization
(shared helper), username persistence (single writer), case-insensitive
uniqueness (index-authoritative), #spot schema (reused), atomic allocator
(reused), idempotent assignment, profile/user linking (`user_id`),
pre-launch identity panel, PATCH guard, immutability rule.

NOT YET IMPLEMENTED: username search, public `/u/[username]` page, friend
search, invite links, countdown, Three.js, post-launch chat UI/realtime,
image compression, username-change UX (deferred product decision).
