import { redirect } from "next/navigation";
import { PrelaunchPanel } from "@/components/prelaunch/prelaunch-panel";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AuthenticatedHomePage() {
  const session = await getProductSession();
  const guard = guardProductSession(session);
  if (guard) redirect(guard);

  const service = createServiceRoleClient();
  const supabase = await createClient();
  const [{ data }, { data: waitlistCount }] = await Promise.all([
    service
      .from("profiles")
      .select("username, spot")
      .eq("user_id", session.user!.id)
      .maybeSingle(),
    supabase.rpc("get_waitlist_count"),
  ]);
  const profile = data as { username: string | null; spot: number | null } | null;
  return (
    <PrelaunchPanel
      username={profile?.username ?? null}
      spot={profile?.spot ?? null}
      waitlistCount={waitlistCount ?? null}
    />
  );
}
