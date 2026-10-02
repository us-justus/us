============================================================
PRE-FLIGHT — READ THE DESIGN CONTRACT FIRST
============================================================

Before touching any code:

1. Read AGENTS.md completely.
2. Read the VISUAL IDENTITY CONTRACT in AGENTS.md.
3. Read the relevant sections of spec.md.
4. Inspect the current landing page in the browser.
5. Inspect the current shared shell/header and at least:
   - onboarding
   - discover
   - matches
   - notifications
   - chat
6. Inspect the existing design tokens and global CSS.

AGENTS.md is the authoritative visual implementation contract.

Do not begin implementation until you understand the existing
visual language.

IMPORTANT:

The current AGENTS.md audit identified two existing MUST-FIX
visual issues:

1. onboarding shell motion does not currently respect reduced motion
2. the notification avatar/hit target needs verification against
   the 44px touch-target rule

Do NOT turn this task into a broad cleanup.

However, if either issue directly intersects with the ambient
visual implementation, fix it as part of this task.

Otherwise leave them untouched and report them.

Also resolve any contradiction between AGENTS.md and spec.md
before implementation.

If spec.md contains older wording saying Three.js is not part of
the product, treat that as historical/architecture guidance and
follow the current approved visual identity direction for this
task.

Do not silently reinterpret the design contract.

You are making a production-quality visual system for `us` — a campus-only social/dating product with the brand:

    us
    just us.

This is a high-priority visual pass.

You have ONE SHOT at this implementation.

Do NOT rush into writing a generic Three.js particle demo.

The goal is to create a distinctive, restrained, premium ambient 3D motion system that feels native to the existing `us` design language and is consistent across the entire application.

============================================================
REFERENCE / EXISTING DESIGN LANGUAGE
============================================================

The existing product follows a very specific visual language:

- warm cream surfaces
- thin warm borders
- dark ink typography
- muted warm/coral accent
- soft accent wash
- editorial / romantic typography
- generous whitespace
- understated supporting text
- minimal controls
- no loud gradients
- no neon
- no generic SaaS dashboard styling
- no excessive rounded cards
- no visual clutter

Existing design rules from the project:

13.2 Applied patterns (landing, header, onboarding)

- Inputs: cream surface, thin warm border, dark text; focus is
  `border-accent` + soft coral ring.
  Grey focus borders are removed.

- Errors AND notices: boxed
  `border-accent-soft bg-accent-wash`
  with `text-accent-deep`
  (or `text-ink` for neutral notices).

- No green/red one-off boxes.

- Bright coral is never used as body text.

- Secondary actions:
  transparent/cream + warm border + dark text;
  coral only on hover/focus:
  `hover:bg-accent-wash`
  `hover:border-accent-soft`
  `hover:text-accent-deep`

- Progress/context text stays understated.
  Coral is allowed only as a tiny step marker dot.

- Hamburger/menu buttons stay cream/unfilled.
  Coral appears only as hover wash and focus ring.

- Every interactive element keeps a visible coral keyboard-focus
  outline through global `:focus-visible`.

- Components must NOT opt out with:
  `focus-visible:outline-none`

- Minimum 44px touch target everywhere, including icon-only buttons.

Treat these as hard design constraints.

============================================================
CORE CREATIVE DIRECTION
============================================================

Create a subtle 3D "chemistry field" around the product.

The visual metaphor:

people / chemistry / connection / moments appearing and disappearing.

The animation should feel like something is quietly happening around `us`.

NOT:

- Valentine's Day
- floating emoji hearts
- falling hearts
- confetti
- a particle explosion
- a generic Three.js showcase
- glowing cyberpunk particles
- flashy dating-app animation
- a background that competes with the content

Think:

"editorial website with a living atmosphere"

rather than:

"website with a Three.js animation."

============================================================
THE HEARTS
============================================================

Use Three.js.

Create an elegant minimal heart form.

Do NOT use a stock emoji ❤️.

Do NOT use a colorful 3D heart model.

The heart should be an abstract, refined geometric/line form that belongs to the visual system.

Possible visual treatment:

- thin heart outline
- extremely subtle filled/translucent heart
- soft warm/coral material
- very low opacity
- slight depth/parallax
- extremely subtle bloom/glow ONLY if it genuinely improves the design

The exact geometry is up to you.

The result must look good at:

- 12px
- 20px
- 32px
- 48px

because hearts will exist at different distances/scales.

============================================================
HEART BEHAVIOR
============================================================

Hearts should not simply float around continuously.

Each heart has a lifecycle:

    dormant
       ↓
    appear
       ↓
    subtle heartbeat
       ↓
    drift
       ↓
    fade
       ↓
    disappear
       ↓
    respawn later

The heartbeat should feel organic.

For example:

    0.00  scale 0.70 / opacity 0
    0.20  scale 1.00 / opacity subtle
    0.35  scale 1.07
    0.47  scale 0.96
    0.60  scale 1.02
    1.00  scale 1.00
    later → fade away

Do NOT literally use these timings if another approach looks better.

The important thing is that it feels like:

    a heartbeat

not:

    an animation loop.

Each heart should have slight variation in:

- spawn time
- scale
- opacity
- lifetime
- drift
- rotation
- heartbeat timing

Never synchronize all hearts.

============================================================
SPAWNING
============================================================

Hearts should appear naturally around the content.

Do NOT have them constantly visible.

There should usually only be a handful visible.

Desktop:
approximately 3–7 visible at a time.

Mobile:
approximately 2–4 visible at a time.

The exact number should be adaptive.

Use a protected content region.

Never allow a heart to obscure important UI.

============================================================
LANDING PAGE
============================================================

The landing page is the strongest expression of the animation.

The composition should feel approximately like:

                  ·

          ♡

                    ·

                us

             just us.

       supporting copy

       ENTER THE CAMPUS

             LOG IN

              ♡

      ·

The `us` logo remains the visual anchor.

The animation lives around it.

Some hearts should occasionally appear closer to the logo, but never cover the logo.

The hero should feel alive immediately, but the user should only notice the animation after looking at the page for a moment.

That subtlety is important.

============================================================
DEPTH / 3D
============================================================

This should genuinely use Three.js, not simply place CSS hearts on the page.

Use depth meaningfully but subtly.

Potential techniques:

- perspective camera
- tiny Z differences
- subtle rotation
- depth-dependent opacity
- depth-dependent scale
- slight parallax based on pointer movement
- very subtle camera movement

Pointer interaction should be extremely restrained.

The entire field may shift by only a few pixels in response to pointer movement.

Never make the page feel like a game.

On mobile, replace pointer interaction with extremely subtle autonomous motion.

============================================================
CONSISTENCY ACROSS ROUTES
============================================================

This is CRITICAL.

Do not make a landing-only Three.js component that disappears when navigating through the app.

Create a reusable ambient visual system.

For example:

    src/components/ambient/
        ambient-heart-field.tsx
        ...

or an equivalent structure appropriate to the existing codebase.

The exact file structure is your decision.

The visual system should be usable across:

- landing
- onboarding
- discover
- search
- matches
- notifications
- profile
- settings
- chat

BUT:

The density and visibility should adapt by route.

Landing:
    strongest / most expressive

Onboarding:
    very subtle
    calm
    sparse

Discover:
    subtle background atmosphere
    must NEVER interfere with cards/swiping

Search:
    subtle

Matches:
    subtle

Notifications:
    subtle

Profile:
    subtle

Settings:
    extremely subtle

Chat:
    extremely subtle
    prioritize readability

The app should feel like one coherent visual world.

It should NOT look like each page has a separate animation.

============================================================
ROUTE TRANSITIONS
============================================================

Avoid the animation visibly resetting whenever the user changes routes.

If the architecture permits it, mount the ambient field at the appropriate persistent layout level so the same visual atmosphere survives navigation.

Do NOT introduce a global loading screen just for this.

Do NOT add artificial page transitions.

The animation should feel continuous.

If a persistent mount is incompatible with the current Next.js architecture, use the cleanest existing layout boundary and preserve continuity as much as reasonably possible.

============================================================
CONTENT / Z-INDEX
============================================================

The Three.js layer must ALWAYS be decorative.

It must never intercept interaction.

Use:

    pointer-events: none

where appropriate.

The layering should be:

    background
        ↓
    ambient Three.js field
        ↓
    page surface/content
        ↓
    interactive UI

The animation must never prevent:

- buttons
- links
- swiping
- inputs
- scrolling
- menus
- dialogs

from working.

============================================================
COLOR
============================================================

Do not invent a new color palette.

Inspect the project's existing Tailwind/theme/design tokens first.

Use the existing:

- accent
- accent-soft
- accent-wash
- accent-deep
- ink
- cream/background

tokens where appropriate.

The animation should feel like it belongs to the existing palette.

Do NOT introduce:

- bright red
- saturated pink
- purple
- blue
- neon
- rainbow gradients

The hearts should generally be darker/muted or extremely soft coral.

============================================================
MATERIAL / RENDERING
============================================================

Prefer elegance over complexity.

The hearts do not need photorealistic 3D.

A refined low-poly/line/transparent form is better than a detailed model.

If using custom geometry, make it mathematically clean.

If using SVG/path-derived geometry, convert it appropriately for Three.js rather than overlaying SVG/CSS animation.

Use antialiasing appropriately.

Keep transparency correct.

Avoid expensive post-processing unless necessary.

Do NOT add a large post-processing stack just to make the effect "cool."

============================================================
PERFORMANCE
============================================================

This is a production mobile web app.

Performance is a HARD REQUIREMENT.

Target:

- smooth 60fps where possible
- graceful degradation on weaker devices
- very low GPU load
- no unnecessary React renders
- no memory leaks
- no animation-frame leaks
- no WebGL context leaks

Cap device pixel ratio.

Do not blindly render at full devicePixelRatio on high-density phones.

Use a sensible cap.

Reduce particle/heart count on mobile.

Pause or reduce animation when:

- page/tab is hidden
- reduced motion is requested
- component is not visible if practical

Clean up:

- renderer
- geometry
- materials
- animation frame
- resize listeners
- observers
- pointer listeners

on unmount.

============================================================
RESPONSIVE DESIGN
============================================================

This must be designed intentionally for:

- iPhone Safari
- Android Chrome
- desktop Safari
- desktop Chrome

Do NOT simply scale the desktop scene down.

Mobile should have:

- fewer hearts
- smaller movement
- less depth
- less pointer/parallax interaction
- more breathing room

The landing page screenshot shown in this conversation is the visual reference for the mobile composition.

The animation should complement the large central `us` mark without crowding it.

============================================================
REDUCED MOTION
============================================================

Respect:

    @media (prefers-reduced-motion: reduce)

If reduced motion is enabled:

- do not run continuous animation
- use a static subtle composition OR hide the animated field
- do not continuously spawn hearts

Do not circumvent user motion preferences.

============================================================
ACCESSIBILITY
============================================================

The animation is decorative.

It must:

- not contain meaningful text
- not be announced by screen readers
- not interfere with focus
- not interfere with keyboard navigation
- not interfere with touch interaction

Do not remove the existing global focus-visible treatment.

Do not add:

    focus-visible:outline-none

anywhere.

Preserve the 44px minimum touch target requirement.

============================================================
ARCHITECTURE
============================================================

Before writing code:

1. Inspect the current Next.js App Router structure.
2. Inspect the root layout(s).
3. Inspect the landing page.
4. Inspect the shared site header.
5. Inspect the existing Tailwind/theme tokens.
6. Inspect existing client/server boundaries.
7. Determine the correct persistent mount point.

Then implement.

Do not duplicate Three.js scenes unnecessarily.

Ideally there is ONE reusable ambient visual system with route-specific configuration.

For example conceptually:

    <AmbientHeartField
        intensity="landing"
    />

    <AmbientHeartField
        intensity="subtle"
    />

But use the architecture that best fits the existing application.

Do not create a huge abstraction framework for one animation.

============================================================
NEXT.JS / SSR
============================================================

Three.js must only initialize in the browser.

Do not access:

- window
- document
- WebGL
- requestAnimationFrame

during server rendering.

Use a clean client boundary.

Avoid hydration mismatches.

The page must build correctly.

============================================================
DEPENDENCY
============================================================

Inspect package.json first.

If Three.js is not already installed, add the appropriate dependency.

Prefer the minimal dependency set.

Do NOT add:

- react-three-fiber
- drei
- GSAP
- Framer Motion replacements
- a large animation library

unless the existing architecture already uses them and there is a compelling reason.

For this effect, plain Three.js is preferred.
============================================================
VISUAL ITERATION GATE — MANDATORY
============================================================

Do NOT consider the implementation complete immediately after
the first working render.

After the first implementation:

1. Open the actual landing page.
2. Inspect it at desktop width.
3. Inspect it at an iPhone-sized viewport.
4. Let the animation run for at least several seconds.
5. Navigate through multiple routes.
6. Inspect the ambient field at different densities.
7. Check whether the hearts feel repetitive or procedurally
   generated.
8. Check whether the animation competes with the `us` logo.
9. Check whether it feels romantic without becoming Valentine's
   themed.
10. Check whether it looks like a deliberate brand effect rather
    than a Three.js demo.

If the result looks generic, cheesy, overly visible, repetitive,
or technically impressive but aesthetically weak:

STOP.

Iterate on:
- heart geometry
- opacity
- scale
- timing
- spawn distribution
- depth
- movement
- rotation
- color
- density
- route intensity

before finalizing.

The goal is not maximum visible animation.

The goal is maximum brand identity per pixel.

A successful implementation should make the user notice:

    "this place feels alive."

not:

    "there are animated hearts."

============================================================
NO FAKE 3D
============================================================

The effect should have genuine spatial/depth behavior.

Do not simply create 2D sprites and call them 3D.

At minimum, the system should use:
- perspective/depth
- actual Three.js geometry
- meaningful Z positioning
- subtle rotation/depth response

However, do not add complexity merely to satisfy this requirement.

If a technically simpler solution produces a substantially better
visual result, prefer the simpler solution.

============================================================
VISUAL QUALITY BAR
============================================================

This is the most important section.

Do NOT stop at:

"Three.js is installed and hearts appear."

The result must feel intentionally art-directed.

Evaluate:

1. Does the animation immediately feel like `us`?
2. Does it make the landing page feel alive?
3. Is the `us` logo still the primary visual focus?
4. Are the hearts subtle enough that they don't feel cheesy?
5. Does the animation look good when there are only 2–3 hearts?
6. Does it look good when there are 5–7?
7. Do hearts feel organic rather than procedurally repetitive?
8. Is the motion slow enough to feel premium?
9. Does the animation remain beautiful on mobile?
10. Does it still look good when the page is mostly empty?
11. Does it interfere with any interaction?
12. Does it remain visually coherent across routes?

If the answer to any of these is no, iterate before declaring the task complete.

============================================================
DO NOT REDESIGN THE PRODUCT
============================================================

Do NOT change:

- brand typography
- logo
- copy
- button labels
- authentication
- onboarding logic
- Discover logic
- notification logic
- database
- Supabase
- launch gating
- routing
- navbar structure

unless a minimal integration change is required for the ambient field.

The purpose of this task is to introduce a high-quality visual motion layer.

============================================================
PERSISTENT CANVAS / PAGE SURFACES
============================================================

Before mounting the ambient field globally, inspect whether
individual route surfaces are opaque.

Do not create a persistent Three.js canvas that is technically
mounted across routes but visually hidden behind opaque page
backgrounds.

The final architecture must actually allow the ambient field to
be visible where intended.

Prefer one persistent ambient canvas at the appropriate layout
boundary with transparent rendering, with page content layered
above it.

Do not duplicate one WebGL renderer per route.

There should be ONE ambient renderer/scene where practical,
with route-specific configuration.

Route changes should primarily change:

- density
- opacity
- movement
- allowed region

rather than destroy and recreate the entire visual system.
============================================================
VALIDATION
============================================================

After implementation:

Run:

    pnpm lint

Run:

    pnpm build

Then manually verify:

- landing
- onboarding
- discover
- search
- matches
- notifications
- profile
- settings
- chat

Verify:

- no console errors
- no hydration errors
- no WebGL errors
- no blocked clicks
- no scrolling issues
- no broken focus states
- no layout shift caused by canvas
- no obvious frame-rate problems
- no animation when reduced motion is enabled

Test both:

- desktop
- mobile viewport

============================================================
FINAL REPORT
============================================================

Report:

1. files changed
2. dependencies added
3. where the persistent ambient field is mounted
4. how the heart geometry is generated
5. how the heartbeat lifecycle works
6. how route-specific intensity works
7. mobile optimizations
8. reduced-motion behavior
9. cleanup/resource management
10. lint result
11. build result

Do not claim success merely because the build passes.

This is a visual implementation task. The final result must be judged visually as well as technically.