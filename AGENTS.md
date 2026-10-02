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
  email is optional (skippable); the password step converts the CURRENT
  anonymous user (supplied email via `updateUser()` verify-then-password,
  skipped email via POST /api/onboarding/password attaching a confirmed
  internal identity — never `signUp`, UID preserved), and
  login verifies USN server-side (`/api/auth/login` + `resolve_login_email`)
  with one generic failure message. USN/email stay private and immutable.
  Never display the internal identity (`u-…@us.signin.invalid`).
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

# VISUAL IDENTITY CONTRACT — `us / just us.`

This section is the implementation contract for visual identity. SPEC.md §2
and §13 give rationale; this section gives enforceable rules. If a requested
feature conflicts with the identity, adapt the implementation to the identity
— never silently weaken the identity to fit the feature.

## Design duties (mandatory before touching UI)

When implementing a feature, an agent MUST:

1. Read this section before changing UI.
2. Reuse existing design tokens/components (`src/app/globals.css`, `src/components/ui/button.tsx`, `src/components/onboarding/shell.tsx`).
3. Avoid inventing one-off visual styles.
4. Preserve the visual language across routes.
5. Prefer consistency over novelty.
6. Never introduce a generic component-library aesthetic without explicit approval.
7. Never "improve" the design by adding unnecessary decoration.
8. Never introduce a new color merely because it looks attractive.
9. Never introduce a new radius/shadow/gradient system casually.
10. Never replace the existing typography hierarchy without explicit approval.

## Core feel

`us` feels: intimate, quiet, warm, intentional, human — editorial, romantic,
minimal, premium, understated, spacious, tactile, slightly playful, never loud.
Confidence through restraint. Whitespace is intentional. Small details matter.

`us` must NOT feel: corporate, SaaS, fintech, enterprise, gaming, cyberpunk,
overly feminine, Valentine's-themed, childish, maximalist, AI-generated,
dashboard, startup template, generic dating app.

## Color system (tokens are the source of truth)

Tokens live in `src/app/globals.css` (`:root` → `@theme inline`); no parallel
color system may be created. Tailwind v4 CSS-first — there is no
`tailwind.config.*`.

- `--paper` `#fffdf9` / `--paper-2` `#fff9f6`: surfaces. Page background stays cream.
- `--ink` `#171615`: primary actions + headings. Primary CTAs stay dark — never coral-filled.
- `--accent` `#ff6666`: decorative/interactive only. Insufficient contrast for
  body text — never links, errors, or paragraph text on light backgrounds.
  Uses: tiny dots/markers, focus rings/borders, icon-fill accents, Like button fill.
- `--accent-deep` `#a53a32`: the text-safe deeper coral, with a restrained warm red undertone. Links on hover, readable error text, selected-step text, and muted ambient strokes.
- `--accent-soft` `#ffcccc` + `--accent-wash` `#fff0ee`: borders and subtle
  emphasis backgrounds (selected pills, error/notice boxes, hover washes, unread rows).
- `--accent-hover` `#f25555` / `--accent-foreground` `#ffffff`: coral-filled interactive state + its text.
- `--line` `#e9e0dc` / `--line-strong` `#ddd6cb` / `--ink-soft` `#6f6862` / `--ink-faint` `#9a948f`: borders, secondary text, captions.

Hard rules: no neon; no saturated rainbow palettes; no random blue/green/purple
status colors; no one-off red error boxes; no green success boxes (success is
conveyed by copy, not hue — see SPEC.md §13.5); bright coral never used as body
text. Do not introduce arbitrary hex inside components; if a genuinely new
color is needed, add a token. Known intentional exceptions (do not cargo-cult):
`hover:bg-black` darkening on ink CTAs, canvas JPEG `fillStyle #ffffff` (not CSS),
white/black photo-overlay legibility treatments.

Coral is the primary trademark accent. `--accent-deep` is the restrained deeper
end of that same coral spectrum, with a subtle red/warm undertone. Red must
never become a competing primary color or a bright standalone treatment. Do not
add arbitrary accent colors in components; reuse the existing accent tokens
everywhere, including ambient visuals. No neon or bright red treatment.

## Typography

Editorial serif/display (`Instrument_Serif`, `font-display`, weight 400 only)
is reserved for major emotional statements and brand moments: wordmark (`us`,
lowercase, `tracking-[-0.04em]`), hero/tagline, `it's a match.`, `just for you.`,
large identity lines (`@username`, `#spot`). Restrained sans (Geist) for all
supporting UI: 11px uppercase micro-labels (`tracking 0.12–0.20em`,
`text-ink-faint`), 13–16px body (`text-ink` / `text-ink-soft`), inputs `text-base`
(16px minimum — prevents iOS zoom).

Do not: introduce random fonts, use excessive weights, turn sentences into
uppercase (uppercase is micro-labels only, never paragraphs), use giant
marketing type everywhere, use excessive letter spacing, make every component
loud. Hierarchy comes from scale, weight, spacing, serif/sans contrast,
whitespace — not decoration.

## Surfaces

Warm and physical: cream backgrounds, thin warm borders, extremely restrained
elevation. Cards exist because the content benefits from containment, not
because every piece of UI needs a card (onboarding/login/search are flat —
no card). Avoid: heavy shadows, glassmorphism, frosted glass everywhere,
decorative gradients, floating SaaS panels, dark panels on the light
experience. Intentional exceptions only: sticky header translucency
(`bg-paper/80` + 8px blur — never inside stacked cards per SPEC.md §8),
photo-overlay badges/gradients for legibility, dim scrims on sheets/overlays.

## Borders / radii (locked scale)

Borders are thin, warm, low-contrast (`border-line`; `border-line-strong` for
emphasis; `border-accent-soft` for selected/error). Never thick decorative borders.

Radii scale — reuse, do not extend: `rounded-full` for buttons, pills, icon
buttons, stamps, badges; `rounded-2xl`/`rounded-[16px]` for inputs and notice/
error boxes; `rounded-[24px]` for settings/account cards; `rounded-[28px]` for
large photo cards (discover, profile). A pill communicates a deliberate
action/control — do not turn entire pages into pill UI; do not mix in
32/40/48px radii without explicit approval.

## Buttons

Primary: dark ink surface, light text, `rounded-full`, generous whitespace
(`bg-ink text-paper hover:bg-black`). Secondary: cream/transparent surface,
warm border, dark text (`border-line bg-paper`, coral only on
hover/focus: `hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep`).
Exception: on `bg-accent-wash` surfaces (pre-launch panel, invite views) the
secondary hover is `hover:bg-paper-2` — a wash hover would disappear into the
background. Canonical variants in `src/components/ui/button.tsx`
(`primary`/`ghost`/`subtle`).
Coral is an interaction accent (hover, focus, subtle active, tiny indicators,
Like fill) — do not make every button coral. No gradients on buttons. No icons
unless they improve comprehension. Buttons feel deliberate.

## Interaction states

Global `:focus-visible` (2px coral outline, 2px offset) must remain visible
everywhere. Never use `focus-visible:outline-none`. Plain `outline-none` on
text inputs is allowed ONLY when paired with the coral substitute
(`focus:border-accent focus:ring-2 focus:ring-accent-soft`) — the established
input pattern, not a loophole for other elements. Minimum 44px touch targets
on ALL interactive elements (`min-h-[44px]`, `h-11 w-11`, swipe actions 56px) —
including icon buttons, close/delete ×, photo controls, menu buttons,
notification clear, retry/remove. Hover is subtle; the product never flashes.

## Forms

Inputs: cream surface, thin warm border, dark text, `rounded-2xl`,
`focus:border-accent` + soft coral ring; labels are 11px uppercase
`text-ink-faint`; helpers 11px `text-ink-faint`. Errors AND notices share one
warm system: `border-accent-soft bg-accent-wash` with `text-accent-deep` (or
neutral `text-ink`) — canonical `FieldError` in
`src/components/onboarding/shell.tsx`. No random red/green alert systems.
Keep inputs keyboard-safe (`inputMode`, `enterKeyHint` where set) and 16px+.

## Navigation

Quiet, typography-led. Desktop: minimal lowercase links, generous spacing,
subtle active state (`text-accent-deep bg-accent-wash`). Mobile: simple
hamburger (`h-11 w-11`, cream, thin warm border, coral only on hover/focus/
active), absolutely-positioned overlay (never shifts page content — see
`site-header.tsx`). Product nav derives from `/api/account/state`
(never raw `is_anonymous`); pre-launch withholds Discover/Matches/Chat links.
No heavy nav bars, no dashboard control centers.

## Empty states (brand moments — calm and human)

Pattern (`placeholder.tsx`, discover empty, notifications empty): understated
11px uppercase caption + emotional/simple serif statement + one short
`ink-soft` explanation + subtle `bg-line-strong` divider + at most one quiet
action. No giant illustrations, generic SVGs, stock graphics, emoji,
dashboard-style panels, or excessive buttons.

## Notifications (personal, not admin)

Each notification answers: Who? What happened? What next? Use actor identity
(`@username`) and profile imagery; match notices use the product voice
(`it's a match.` / `you both liked each other.` / `continue the conversation →`).
Unread = subtle wash (`bg-accent-wash/40`) + tiny coral dot. History is a flat
divided list (personal inbox), never an admin notification center.

## Motion

Motion communicates emotion, depth, or interaction — never decoration. Subtle,
slow when ambient, responsive when interactive, organic, purposeful. No
excessive bounce, elastic-everywhere, confetti, particles, generic
landing-page motion, parallax. Swipe stays on Motion values + CSS transforms
(SPEC.md §8). JS/motion animations must honor reduced motion via
`useReducedMotion()` — the CSS reset alone does not cover them
(`MatchOverlay` is the reference; `Shell`, the landing hero, and the mobile
menu follow the same guard). Swipe springs are user-driven interaction
feedback and stay physical; decorative reveals collapse to zero-motion.

## Three.js / ambient visual system

Three.js is gated by SPEC.md §9 (all constraints must hold; never
load-bearing, never swipe physics, never on auth/onboarding/search/chat
without explicit justification). IF approved, it is a reusable ambient visual
system, not a one-off landing effect, with this identity: chemistry,
connection, moments, people appearing in each other's orbit — abstract heart
forms or related geometry. Never: heart emoji, Valentine's graphics, floating/
falling emoji hearts, neon particles, generic demos. It must feel like
"something is quietly happening," never "look at this animation." Strongest on
landing, progressively quieter elsewhere; `pointer-events: none`, performant,
responsive, reduced-motion aware, cleaned up, safe for mobile Safari.

## Route consistency

Landing, onboarding, discover, search, matches, chat, notifications, profile,
settings must read as one product. When building a screen: inspect existing
screens first; reuse tokens, patterns, components, hierarchy. Never ship a
visually independent mini-product. (`/inside` is internal admin, never linked
from product UI — exempt from product styling but still uses tokens.)

## Cross-route consistency rules (enforced)

Same visual language everywhere; route layouts stay their own. Concretely:

- Eyebrow caption: every app page opens with the same 11px uppercase
  `text-ink-faint` caption carrying the single coral dot
  (`flex items-center gap-2` + `h-1.5 w-1.5 rounded-full bg-accent`) —
  onboarding `Shell`, login, search, notifications, profile, settings,
  account, public profile, placeholders, discover empty state.
- App page shell: `mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10 sm:py-14`
  (discover uses `max-w-[380px]`; profile keeps intentional `px-4` photo
  bleed; landing/pre-launch/invite keep their own centered hero shells).
- Page titles: `font-display text-[30px] sm:text-[34px] tracking-[-0.03em]
  leading-none`. Intentional larger brand moments only: landing hero,
  placeholders (`32/40px`), notifications `just for you.`, match copy.
- Result/row hovers must visibly apply: use `group`/`group-hover` when
  children carry explicit text colors (see search results).
- Canvas-exported imagery (`share-card-image.ts`) cannot read CSS vars — its
  constants must mirror `globals.css` token values exactly.
- White/black appear ONLY as photo-overlay legibility treatments, dim scrims
  on sheets/dialogs, and the `hover:bg-black` ink-CTA darkening. Photo
  progress dots use `bg-paper` tokens, not raw white.

Intentional route differences (do not normalize away): discover is the most
immersive (swipe physics, photo cards); chat is messaging-shaped; landing and
pre-launch/invite carry the strongest atmosphere (`bg-accent-wash` fields);
settings is the quietest; notifications stay an editorial divided list;
profile prioritizes photography with photo bleed.

## Mobile-first quality

Base styles target ~360px; `sm:` only refines. Check spacing, wrapping, CTA
size, nav, 44px targets, animation density, viewport height, safe areas
(`env(safe-area-inset-*)` on fixed/bottom-anchored UI), keyboard behavior,
scrolling. Never depend on a fixed viewport height; never horizontally
overflow at 360px.

## Accessibility (never overridden by identity)

Keyboard focus, readable contrast, semantic HTML, accessible labels
(`"Like Maya"` / `"Pass Maya"`), reduced motion, 44px targets. Decorative
animation invisible to assistive tech. Never sacrifice usability for aesthetics.

## Anti-patterns (require explicit approval)

Generic shadcn/dashboard appearance; excessive cards; glassmorphism;
neon/rainbow gradients; giant shadows; random colored status badges; emoji as
decoration; stock/AI illustrations; excessive pills; excessive uppercase or
letter-spacing; arbitrary colors/radii/shadows; excessive animation;
unnecessary modals; intrusive toasts; competing hierarchies; any "modern SaaS"
pattern alien to `us`.

## Decision rule

Given multiple valid implementations, prefer the one that is simpler, quieter,
more consistent, more human, more editorial — over louder, more animated, more
decorated, more generic, more technically impressive. "More" is not better.

## Feature checklist (verify before submitting UI work)

- [ ] Existing tokens/components reused; no arbitrary colors or new visual system.
- [ ] Typography, spacing rhythm, borders/radii match existing components.
- [ ] `focus-visible` remains accessible; 44px targets respected.
- [ ] Mobile considered intentionally (360px, safe areas, keyboard, scrolling).
- [ ] Reduced motion considered where animation exists (`useReducedMotion()` for JS/motion).
- [ ] Feature feels native to `us`, not generic SaaS; existing routes still coherent.
- [ ] No unrelated UI redesigned (fix only what the task asks; record the rest as findings).

# PRE-LAUNCH / LAUNCH PRODUCT RULES

1. Product phases

PRE-LAUNCH:
- USN verification
- username creation
- profile creation
- permanent #spot
- campus/friend search
- personalized invite link
- launch countdown
- subtle launch-page 3D heart

LOCKED PRE-LAUNCH:
- Discover
- Swipe
- Like
- Match
- Chat

POST-LAUNCH:
- Discover
- Like/Pass
- Match
- Search
- Chat

2. Launch gating

- Launch state is authoritative server-side.
- Client UI hiding is never sufficient.
- Protected APIs must enforce launch state.
- Device clock must never unlock the product.
- Countdown is presentation only.

3. Permanent #spot

- Assigned once.
- Never calculated from current row count.
- Never client-generated.
- Concurrency-safe.
- Unique.
- Stable across logout/login.
- Must not expose private identity data.

4. Username

- Unique.
- URL-safe.
- Case-insensitive uniqueness.
- Must not contain/expose USN.
- Must be used instead of internal IDs in public URLs.
- Username search only exposes public profile data.

5. Privacy

Never expose:
- USN
- email
- phone
- auth.uid()
- verification metadata

through public profile/search/invite responses.

6. Search

- Search username first.
- Optional public display-name search only if explicitly approved.
- Never search USN/email/phone.
- Paginate.
- Debounce client requests.
- Never issue unbounded campus-wide queries.

7. Invite links

- Public links must use stable public identifiers.
- Never expose internal auth/database identifiers unnecessarily.
- Referral tracking must be abuse-resistant.
- Invite pages must remain lightweight.

8. Three.js

- Launch experience only.
- Lazy-loaded.
- Low GPU.
- Reduced-motion safe.
- Static fallback.
- Must not block initial render.
- Must not be used for swipe physics.
- Must not be loaded on auth/onboarding/search/chat unless explicitly justified.

9. Performance

- Mobile-first.
- Measure before optimizing.
- Prefer transform/opacity animations.
- Avoid layout-triggering animations.
- Avoid unnecessary blur/shadow/filter effects.
- Avoid animation loops when CSS/Motion is sufficient.
- Discover must use bounded batches.
- Search must be paginated/debounced.
- Images must be optimized without visibly degrading quality.

10. Launch load

- Assume concentrated traffic at launch.
- Avoid unbounded queries.
- Avoid duplicate auth requests.
- Avoid per-user polling for countdown.
- Keep launch page lightweight.
- Identify and measure DB/storage/API bottlenecks before launch.

11. Product consistency

- Landing page is the visual source of truth.
- New pre-launch screens must use existing semantic tokens.
- Do not create separate visual systems.
- Preserve route-specific information architecture.

12. Feature order

Do not implement post-launch social features before pre-launch infrastructure is complete.

Required order:

launch state
→ username
→ permanent #spot
→ pre-launch home
→ search
→ invite
→ countdown
→ launch experience
→ physical/performance QA
→ launch gating verification
→ Discover
→ Like/Pass
→ Match
→ Chat
→ Safety
→ final load/security audit
