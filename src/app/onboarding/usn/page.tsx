import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";
import { Shell } from "@/components/onboarding/shell";
import { UsnForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Server-side completion guard: a completed user opening this step URL is
 * bounced to /discover. Incomplete sessions render the step normally.
 */
export default async function USNPage() {
  const { step } = await getOnboardingState();
  if (step === "complete") redirect("/discover");
  return (
    <Shell title="your USN." subtitle="Campus-only. Your USN is never shown on your profile or to anyone else." step="01 — verification">
      <UsnForm />
    </Shell>
  );
}
