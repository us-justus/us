import { redirect } from "next/navigation";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import AccountClient from "./client";

export const dynamic = "force-dynamic";

/**
 * Server-side product guard (same pattern as /settings): public (no session)
 * → /login, incomplete onboarding → its /onboarding/* step. The client keeps
 * its useExistingSession() check for back/forward cache and client-side
 * navigation, but protected HTML is never server-rendered to signed-out
 * visitors. No launch gate here — account pages stay accessible pre-launch.
 */
export default async function AccountPage() {
  const session = await getProductSession();
  const guard = guardProductSession(session);
  if (guard) {
    redirect(guard);
  }
  return <AccountClient />;
}
