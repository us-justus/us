import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";
import { Shell } from "@/components/onboarding/shell";
import { ProfileForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Server-side completion guard: a completed user opening this step URL is
 * bounced to /discover. Incomplete sessions render the step normally.
 */
export default async function ProfilePage() {
  const { step } = await getOnboardingState();
  if (step === "complete") redirect("/discover");
  return (
    <Shell title="create your profile." subtitle="This is what people will see. Keep it honest, keep it you." step="04 — profile">
      <ProfileForm />
    </Shell>
  );
}
