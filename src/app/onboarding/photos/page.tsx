import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";
import { Shell } from "@/components/onboarding/shell";
import { PhotosForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Server-side completion guard: a completed user opening this step URL is
 * bounced to /discover. Incomplete sessions render the step normally.
 */
export default async function PhotosPage() {
  const { step } = await getOnboardingState();
  if (step === "complete") redirect("/discover");
  return (
    <Shell title="add your photos." subtitle="At least one. Up to six. You can reorder and change them anytime." step="05 — photos">
      <PhotosForm />
    </Shell>
  );
}
