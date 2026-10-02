import { createClient } from "@/lib/supabase/server";
import { getLaunchState } from "@/lib/auth/launch";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { InsideClient } from "./inside-client";

/**
 * /inside — internal admin entry (INSIDE v1). Never linked from product UI.
 *
 * Server-gated three ways (see src/lib/inside/auth.ts): signed inside
 * cookie (proves the admin key was presented at login) + live Supabase
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

  // Verified admin session — independent reads resolve together.
  const supabase = await createClient();
  const [countsRes, launch] = await Promise.all([
    supabase.rpc("admin_overview_counts"),
    getLaunchState(),
  ]);
  const counts = countsRes.data as { total_users: number; waiting: number } | null;

  return (
    <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 py-10 sm:px-8 sm:py-14">
        <InsideClient
          mode="dashboard"
          initial={{
            launched: launch.launched,
            launchedAt: launch.launchAt,
            version: launch.prelaunchVersion,
            totalUsers: counts?.total_users ?? 0,
            waiting: counts?.waiting ?? 0,
            countsLive: !countsRes.error && counts !== null,
          }}
        />
      </div>
    </div>
  );
}
