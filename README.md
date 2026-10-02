This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

# us

## Local development (local Supabase, never production)

Architecture: Next.js → `http://127.0.0.1:54321` (Supabase CLI) → Docker containers.

```bash
pnpm install
pnpm exec supabase start      # first run pulls Docker images
pnpm exec supabase db reset   # apply all migrations + supabase/seed.sql
pnpm dev                      # uses .env.local → local Supabase only
```

Environment-variable precedence (Next.js): `.env.{NODE_ENV}.local` > `.env.local` > `.env.{NODE_ENV}` > `.env`, and real `process.env` set by the host always wins over files.

- `.env.local` → local Supabase URL/anon key. Loaded by `pnpm dev`. Gitignored.
- `.env.production.local` → production credentials, preserved from the old `.env`. Loaded ONLY when `NODE_ENV=production` (e.g. `pnpm build` + `pnpm start` on a production server, or as fallback). On Vercel, project env vars override files.
- NEVER create a plain `.env` again: it would be loaded in every mode and could silently point dev at production.

Local database lifecycle:

```bash
pnpm exec supabase db reset   # clean reset: all migrations + seed
pnpm exec supabase stop       # stop the local stack
pnpm exec supabase status     # URLs and keys
```

Local admin bootstrap (INSIDE v1):

1. Create a local user (any email/password, e.g. through the app's onboarding
   flow or `curl -X POST http://127.0.0.1:54321/auth/v1/signup -H "apikey: <local anon key>" -H "Content-Type: application/json" -d '{"email":"you@example.com","password":"password123"}'`).
2. Find its id: `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "select id, email from auth.users;"`
3. Grant local admin:
   `PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "insert into public.admin_users (user_id) values ('<id>');"`
4. Sign in at `/inside` with `ADMIN_SECRET_KEY` from `.env.local` and that user.

Never copy the production admin credentials into any local file.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
