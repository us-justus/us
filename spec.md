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
