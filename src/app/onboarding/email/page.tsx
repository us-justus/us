import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";
import { Shell } from "@/components/onboarding/shell";
import { EmailForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Server-side completion guard: a completed user opening this step URL is
 * bounced to /home (waiting home). Incomplete sessions
 * render the step normally.
 *
 * EMAIL IS REQUIRED FOR EVERY ACCOUNT on both tracks: the normal USN path
 * (USN → email → verification → password → …) and the first-year
 * email-first path (email → verification → password → …). There is no
 * skip path.
 *
 * Recovery: `/onboarding/email?edit=1` (from the password step's "use a
 * different email" action after a duplicate rejection) intentionally renders
 * the same editable entry UI — the guard stays complete-only so the current
 * onboarding user can replace the rejected address on the same UID.
 * Verification + password remain required; no guard is weakened.
 */
export default async function EmailPage({
  searchParams,
}: {
  searchParams?: Promise<{ edit?: string }>;
}) {
  const { step } = await getOnboardingState();
  if (step === "complete") redirect("/home");
  // `edit` is a UI-only recovery hint (the client form shows the "couldn't
  // be used" notice); routing authority stays with getOnboardingState().
  // Awaited only to keep the explicit intent server-visible — never a bypass.
  void searchParams;
  return (
    <Shell title="where should we reach you?" subtitle="Your email is required — we'll verify it next, then use it for sign-in, recovery, and to let you know when us launches." step="02 — email">
      <EmailForm />
    </Shell>
  );
}
