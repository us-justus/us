import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";
import { Shell } from "@/components/onboarding/shell";
import { EmailForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Server-side completion guard: a completed user opening this step URL is
 * bounced to /discover. Incomplete sessions render the step normally.
 */
export default async function EmailPage() {
  const { step } = await getOnboardingState();
  if (step === "complete") redirect("/discover");
  return (
    <Shell title="student email." subtitle="Optional. An email lets you sign back in from another device and recover your account. No email? Skip — you'll still set a password next to secure your account." step="02 — email · optional">
      <EmailForm />
    </Shell>
  );
}
