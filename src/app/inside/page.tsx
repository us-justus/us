import { createClient } from "@/lib/supabase/server";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { InsideClient } from "./inside-client";

// Request-scoped: reads the inside_admin cookie and the live Supabase session.
// Force dynamic so a build without ADMIN_SECRET_KEY cannot statically
// prerender the login screen — that static page fails with the generic
// Server Components 500 on the Cloudflare Worker. Matches every other
// request-dependent page in src/app.
export const dynamic = "force-dynamic";

/**
 * /inside — internal admin entry (INSIDE v1). Never linked from product UI.
 *
 * Server-gated three ways (see src/lib/inside/auth.ts): server-signed
 * inside cookie (minted only after Supabase authentication + admin_users
 * membership are verified) + live Supabase
 * session for the same user + current admin_users membership. Unverified
 * visitors get the login screen; verified admins get the dashboard with
 * server-fetched aggregates (no private fields ever reach the browser).
 */
export default async function InsidePage() {
  const gate = await requireInsideAdmin();

  if (!gate) {
    return (
      <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[560px] flex-1 px-6 py-10 sm:px-8 sm:py-14">
          <InsideClient mode="login" />
        </div>
      </div>
    );
  }

  // Verified admin session — overview aggregates resolve here.
  // Shape (see 20261013000001_inside_dashboard_refinement.sql): waiting =
  // active photo-complete profiles (the waitlist); suspended = profiles
  // with is_active = false. No total_users: a bare verification_records
  // count is broader than the waitlist and misleads the admin.
  const supabase = await createClient();
  const countsRes = await supabase.rpc("admin_overview_counts");
  const counts = countsRes.data as { waiting: number; suspended: number } | null;
  const waiting = typeof counts?.waiting === "number" ? counts.waiting : null;
  const suspended = typeof counts?.suspended === "number" ? counts.suspended : null;

  return (
    <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 py-10 sm:px-8 sm:py-14">
        <InsideClient
          mode="dashboard"
          initial={{
            waiting: waiting ?? 0,
            suspended: suspended ?? 0,
            countsLive: !countsRes.error && waiting !== null && suspended !== null,
          }}
        />
      </div>
    </div>
  );
}
