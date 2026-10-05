import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";
import { Shell } from "@/components/onboarding/shell";
import { PhotosForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Server-side completion guard: a completed user opening this step URL is
 * bounced to /home (waiting home). Incomplete sessions render the step normally.
 */
export default async function PhotosPage() {
  const { step } = await getOnboardingState();
  if (step === "complete") redirect("/home");
  return (
    <Shell title="add your photos." subtitle="Get your photos ready for when us launches. At least one, up to six." step="05 — photos">
      <PhotosForm />
    </Shell>
  );
}
