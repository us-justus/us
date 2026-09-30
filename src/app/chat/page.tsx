import { redirect } from "next/navigation";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { getLaunchState, guardLaunch } from "@/lib/auth/launch";
import { Placeholder } from "@/components/layout/placeholder";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [session, launch] = await Promise.all([getProductSession(), getLaunchState()]);
  const guard = guardProductSession(session);
  if (guard) {
    redirect(guard);
  }
  const launchGuard = guardLaunch(launch);
  if (launchGuard) {
    redirect(launchGuard);
  }
  return (
    <Placeholder
      caption="chat"
      title="say hello."
      note="private conversations with your matches. calm, warm, and yours alone."
    />
  );
}
