import { redirect } from "next/navigation";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { getLaunchState, guardLaunch } from "@/lib/auth/launch";
import { getDiscoverProfiles } from "@/lib/discover/queries";
import { DiscoverDeck } from "@/components/discover/DiscoverDeck";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Independent queries — one resolution, no waterfall (§6).
  const [session, launch] = await Promise.all([getProductSession(), getLaunchState()]);
  const guard = guardProductSession(session);
  if (guard) {
    redirect(guard);
  }
  // PRE_LAUNCH lock: server-side, direct URL access cannot bypass it.
  const launchGuard = guardLaunch(launch);
  if (launchGuard) {
    redirect(launchGuard);
  }
  const profiles = await getDiscoverProfiles();
  return <DiscoverDeck initialProfiles={profiles} />;
}
