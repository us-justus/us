# Contributing to us

> *building a safe, warm, and romantic space.*

Thank you for your interest in helping us build `us`. This is a private, campus-only dating web app created to foster genuine connections. Because `us` is highly intentional, we ask that all contributors respect our core brand principles, design constraints, and engineering workflows.

---

## 🎨 Our Design Principles

We are extremely protective of the feel of `us`. Before writing any UI code, please review our visual guidelines:

1. **Intimate, Quiet, and Warm:** The interface is built with warm cream backgrounds (`--paper` `#fffdf9`), deep charcoal ink (`--ink` `#171615`), and soft coral accents (`--accent` `#ff6666`).
2. **Confidence through Restraint:** Whitespace is deliberate. Avoid heavy cards, decorative gradients, neon colors, glassmorphism, or busy animations.
3. **Typography Contrast:** Use editorial serif/display typography (`Instrument Serif`) only for key emotional moments (such as `"it's a match."` or branding wordmarks), and clean, minimalist sans-serif (`Geist`) for body text and micro-labels.
4. **Physical and Tactile:** Elements have low-contrast, thin warm borders. Radii are locked to our scale (e.g., `rounded-full` for pill-shaped controls/buttons, `rounded-[28px]` for large profile photos).
5. **No Corporate/SaaS Clichés:** Avoid generic dashboard patterns, floating panels, or blue/green status badges. Success and connection are communicated through copy and feel, not neon hues.

---

## 🛠️ Engineering Workflows

### 1. Local Setup
Please refer to the [README](README.md) to set up your Next.js and Supabase environments. Ensure all tests pass locally before submitting changes.

### 2. Branch Naming
Keep branch names simple and evocative:
- Features: `feature/onboarding-flow`, `feature/love-letters`
- Bug fixes: `fix/broken-heart`, `fix/chat-scrolling`
- Documentation: `docs/Conduct`

### 3. Safety & Privacy First
- **Supabase Row-Level Security (RLS):** Ensure that every database migration includes strict RLS policies. No client should ever be able to read another student's USN, email, or private messages without absolute authorization.
- **Credential Safety:** Never print or log credentials, user emails, or passwords.
- **Performance Budget:** Test code changes on simulated mobile viewports (360px–430px) with touch inputs. Avoid importing large libraries that bloat the bundle size.

### 4. Pull Request Guidelines
When opening a PR, include a brief, romantic/warm note detailing:
- What this contribution brings to the community.
- How you verified the change (including screen size, testing scenarios, or unit tests).
- Keep descriptions clear, concise, and professional.

---

> *just us.*
