import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  getProductSession,
  guardProductSession,
} from "@/lib/auth/product-state";
import { FeedbackClient } from "./client";

export const dynamic = "force-dynamic";

/**
 * /feedback — student feedback entry point (product session only).
 * Server-guarded like other product routes: public → /login, incomplete
 * onboarding → its step. Suspended accounts stay on this page
 * ({ allowSuspended: true }): the appeal flow IS this page (?appeal=1
 * presets ACCOUNT). The client keeps its useExistingSession() check
 * for back/forward cache; protected HTML is never server-rendered to
 * signed-out visitors.
 */
export default async function FeedbackPage() {
  const session = await getProductSession();
  const guard = guardProductSession(session, { allowSuspended: true });
  if (guard) {
    redirect(guard);
  }
  return (
    <Suspense fallback={<p className="mt-8 text-[13px] text-ink-soft">loading…</p>}>
      <FeedbackClient />
    </Suspense>
  );
}
