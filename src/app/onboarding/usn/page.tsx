import { redirect } from "next/navigation";
import { getOnboardingState, stepPath } from "@/lib/onboarding/state";
import { Shell } from "@/components/onboarding/shell";
import { UsnForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Server-authoritative step guard: the server session (cookies) decides.
 * Anyone not on the USN step — including a returning authenticated account
 * whose browser still holds a stale anonymous session — is bounced to their
 * actual step instead of seeing a USN form backed by the wrong UID.
 */
export default async function USNPage() {
  const { step } = await getOnboardingState();
  if (step !== "usn") redirect(stepPath(step));
  return (
    <Shell title="your USN." subtitle="Campus-only. Your USN is never shown on your profile or to anyone else." step="01 — verification">
      <UsnForm />
    </Shell>
  );
}
