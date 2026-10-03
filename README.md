# us

> *just us.*
>
> 🏛️ campus-only, private, and romantic.

`us` is a private, campus-only dating web app designed to bring students together with sincerity, warmth, and intimacy. No social network noise, no generic corporate feel, no algorithmic clutter. Just a quiet, beautiful corner for you to meet someone special from your college.

**Discover → Like → Match → Chat**

---

## 🌸 The Experience

`us` is built with a commitment to simplicity, elegance, and tactile delight:

- **Campus-Only & Verified:** Immutable USN verification secures the boundary of your college community. Your space, your peers.
- **Warm & Editorial:** Designed with cream papers, deep ink, and warm coral accents. Beautiful typography and intentional whitespace.
- **Whisper & Speak:** Discover others, send a quiet like, and when it's mutual—*it's a match.* Open a safe, private conversation.
- **Quietly Private:** We protect student privacy with absolute care. USNs and verification emails never leave secure server boundaries.

---

## 🛠️ Local Development

While the product is deeply romantic, the architecture is precise, robust, and modern.

### Quick Start
`us` uses a Next.js frontend with local Supabase services powered by Docker.

```bash
pnpm install
pnpm exec supabase start      # Starts the local Supabase Docker stack (pulls images on first run)
pnpm exec supabase db reset   # Applies all database migrations & seed data (clean reset)
pnpm dev                      # Starts Next.js with local dev env (.env.local)
```

*Open [http://localhost:3000](http://localhost:3000) to feel the experience.*

### Configuration & Precedence
We use local-first development files. Next.js environment variable resolution:
`.env.{NODE_ENV}.local` > `.env.local` > `.env.{NODE_ENV}` > `.env`

- `.env.local` is gitignored and contains local credentials.
- `.env.production.local` is preserved for production releases.
- **Never** create a plain `.env` file to prevent pointing dev environments to production.

### Database Lifecycle
```bash
pnpm exec supabase db reset   # Clean reset of all database migrations and seeds
pnpm exec supabase stop       # Stop local containers
pnpm exec supabase status     # View URLs and service keys
```

### Administrative Dashboard (`/inside`)
To access the local administrative tools (INSIDE v1):
1. **Create a local user:** Create an account via onboarding in your browser or run:
   ```bash
   curl -X POST http://127.0.0.1:54321/auth/v1/signup \
     -H "apikey: <local-anon-key>" \
     -H "Content-Type: application/json" \
     -d '{"email":"you@example.com","password":"password123"}'
   ```
2. **Find the user ID:**
   ```bash
   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "SELECT id, email FROM auth.users;"
   ```
3. **Elevate to Local Admin:**
   ```bash
   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "INSERT INTO public.admin_users (user_id) VALUES ('<id>');"
   ```
4. **Sign In:** Navigate to `/inside` using the `ADMIN_SECRET_KEY` from `.env.local` and your credentials.

---

## 💌 Join the Journey

Interested in helping us craft this space? 

- Read our **[Contribution Guidelines](CONTRIBUTING.md)** to see how we build with care.
- Read our **[Code of Conduct](CODE_OF_CONDUCT.md)** to understand how we maintain a safe, welcoming, and warm community.

---

> *it's a match.*
>
> *you both liked each other.*
