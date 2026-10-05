import { redirect } from "next/navigation";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import EditProfileClient from "./client";

export const dynamic = "force-dynamic";

/**
 * Server-side product guard (same pattern as /profile): public (no session)
 * → /login, incomplete onboarding → its /onboarding/* step. The client keeps
 * its useExistingSession() check for back/forward cache and client-side
 * navigation, but protected HTML is never server-rendered to signed-out
 * visitors. Identity pages stay accessible to completed product sessions.
 */
export default async function EditProfilePage() {
  const session = await getProductSession();
  const guard = guardProductSession(session);
  if (guard) {
    redirect(guard);
  }
  return <EditProfileClient />;
}
