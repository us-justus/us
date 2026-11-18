# us

> *just us.*
>
> Campus-only, private, and romantic.

**us** is a campus-focused web app built to help students discover people from their college. The project is designed around a quiet, warm experience rather than a conventional social network.

> **Current product status:** the codebase includes onboarding, campus search, profiles, invitations, account tools and internal administration. Matching and chat are not currently exposed as completed user-facing flows; the product is still in its pre-launch stage.

## Project links

- [Source code](https://github.com/us-justus/us)
- [Issues and bug reports](https://github.com/us-justus/us/issues)
- [Pull requests](https://github.com/us-justus/us/pulls)
- [Product and technical specification](spec.md)
- [Pre-launch checklist](PRE_LAUNCH_CHECKLIST.md)
- [Contribution guidelines](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [MIT License](LICENSE)

## What is implemented

The current application includes:

- **Campus onboarding:** USN-based campus verification, email ownership verification, password setup, profile details and profile photos.
- **Profiles:** editable personal profiles with a username, nickname, age, branch, year, gender, bio, interests and up to six photos.
- **Campus search:** authenticated students can search active campus profiles by username.
- **Profile pages:** a student's own profile and username-based campus profile pages.
- **Pre-launch home:** a waiting/launch experience with a profile username, allocated spot and waitlist count where available.
- **Invitations:** completed accounts can create and share invite links.
- **Account tools:** account security, password management, sign-out and suspension status/appeal paths.
- **Feedback:** authenticated students can submit feedback and view their own feedback history.
- **Internal administration (/inside):** protected tools for dashboard metrics, student moderation, reports, feedback, email queues and health information.

The repository does **not** currently contain completed like, match or chat product routes. Those should not be assumed to be available just because they appear in the product vision.

## Tech stack

| Area | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| UI | React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Backend services | Supabase (Postgres, Auth and Storage) |
| Supabase integration | @supabase/ssr, @supabase/supabase-js |
| Cloud deployment | Cloudflare Workers with OpenNext and Wrangler |
| Package manager | pnpm 11.21.0 |
| Runtime | Node.js 24.7.0 or newer |
| Additional UI libraries | Motion, Three.js |

The application uses Next.js server components and route handlers alongside browser components. Supabase clients are separated for browser, server and server-only service-role use. The Cloudflare Worker is built through OpenNext; it is not a plain next start deployment.

## Architecture at a glance

- src/app/ — App Router pages and API route handlers.
- src/components/ — reusable landing, onboarding, profile, search, settings and admin UI.
- src/lib/ — authentication, onboarding, Supabase clients, profiles, photos, feedback, verification, security and admin logic.
- supabase/migrations/ — ordered database migrations.
- supabase/seed.sql — local seed data.
- scripts/ — local staging-dev launcher and production smoke-test utility.
- wrangler.jsonc, open-next.config.ts — Cloudflare Workers/OpenNext configuration.

The main user-facing routes include /, /login, /onboarding/*, /home, /search, /profile, /profile/edit, /u/[username], /invite/[token], /feedback and /settings. The /inside area is an internal admin surface and is not part of the normal student navigation.

## Local development

### Requirements

Install the following before starting:

- [Node.js](https://nodejs.org/) **24.7.0 or newer**
- [pnpm](https://pnpm.io/) **11.21.0**
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running for the local Supabase stack
- Git

### 1. Clone and install

~~~bash
git clone https://github.com/us-justus/us.git
cd us
pnpm install
~~~

The repository pins pnpm through the packageManager field in package.json.

### 2. Start local Supabase

Make sure Docker Desktop is running, then start the local services:

~~~bash
pnpm exec supabase start
~~~

On the first run, Supabase may need to download its Docker images. Apply the repository's migrations and seed data to the **local** database:

~~~bash
pnpm exec supabase db reset
~~~

This command resets the local Supabase database and reapplies the migrations and seed file. Do not point this workflow at a hosted staging or production database.

### 3. Configure local environment variables

The repository does not include a committed .env.example. Create a local .env.local file in the project root. It is ignored by Git.

Get the local API URL, anon key and service-role key from:

~~~bash
pnpm exec supabase status
~~~

Use the values printed for your **local** Supabase instance:

~~~dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key>

# Required for the /inside admin login locally (16+ characters).
ADMIN_SECRET_KEY=<random-local-secret-at-least-16-characters>

# Optional: required only for email features that send through Brevo.
BREVO_API_KEY=<brevo-api-key>
BREVO_SENDER_EMAIL=<verified-sender-address>
# Optional; defaults to "us":
BREVO_SENDER_NAME=us
~~~

Replace placeholders with your own local or authorized development values. Never commit .env.local, paste secrets into issues, or use production credentials for local development. The service-role key, admin secret and Brevo API key are server-side secrets; do not prefix them with NEXT_PUBLIC_.

### 4. Start Next.js

~~~bash
pnpm dev
~~~

Open [http://localhost:3000](http://localhost:3000).

### Useful local Supabase commands

~~~bash
pnpm exec supabase status   # Show local service URLs and keys
pnpm exec supabase db reset # Reapply migrations and seed data (destructive to local DB)
pnpm exec supabase stop     # Stop local Supabase containers
~~~

### Optional: staging-connected local development

The pnpm dev:staging script loads environment variables from .env.staging.local and then starts Next.js in development mode. This file is Git-ignored and must contain only the separately provisioned staging configuration.

Use this only when you are authorized to work against the staging project. Do not copy production values into it, and do not use it as a substitute for the isolated local Supabase setup above.

## Checks and tests

The repository provides these scripts:

~~~bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test:inside
~~~

- pnpm lint runs ESLint.
- pnpm exec tsc --noEmit runs the TypeScript type check without emitting files.
- pnpm test:inside runs the Node.js test files listed in package.json, covering admin, authentication, onboarding, feedback and related security logic.

Run the relevant checks before opening a pull request. Some tests or application flows may require local environment configuration.

## Internal admin area

The /inside area is an internal admin surface and uses the existing Supabase Auth system; it does not have a separate password or client-supplied admin-key login.

A successful /inside login requires all of the following:

- A valid Supabase email-and-password sign-in. The identifier can be an email address, phone number or USN.
- Current membership for that authenticated user in public.admin_users, checked through the is_admin() database function.
- A configured server-side ADMIN_SECRET_KEY (at least 16 characters). After the first two checks pass, the server uses this key to sign a 12-hour, HttpOnly admin-session cookie. The key itself is never entered in the login form or sent to the browser.
- On subsequent requests, the server verifies the signed cookie, its expiry, the live Supabase session for the same user and current admin membership again.

For local-only testing:

1. Start the local Supabase stack and apply the migrations as described above.
2. Create a test account in the local Supabase instance and note its user ID from the local auth.users table.
3. Add that test user's ID to public.admin_users in the **local** database. Only do this for a test account in your local database.
4. Set ADMIN_SECRET_KEY in .env.local to a random local value at least 16 characters long.
5. Open /inside and sign in with the test account's email, phone number or USN and its Supabase password. Do not enter ADMIN_SECRET_KEY in the form.

The admin login also uses the server-side service-role configuration for protected login-resolution and rate-limit operations. Do not grant admin membership to real users or run these steps against a hosted database unless the project maintainers have explicitly authorized it. The admin area is not linked from the normal product UI.

## Deployment

The production Worker configuration is maintained in wrangler.jsonc and open-next.config.ts. OpenNext generates the Worker entry point and static assets before Wrangler deploys them to Cloudflare Workers.

Deployment credentials and server-side secrets are managed outside the repository. Production deployment is a maintainer-controlled process; contributors should not run deployment or rollback commands unless explicitly asked to do so.

## Contributing

Please read the [Contribution Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before contributing. Work on a dedicated branch, keep changes focused, run the relevant checks and open a pull request for review. Do not commit environment files, credentials, generated build output or local database data.

---

> *just us.*
