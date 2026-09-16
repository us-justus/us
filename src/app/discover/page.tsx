import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";
import { getDiscoverProfiles } from "@/lib/discover/queries";
import { DiscoverDeck } from "@/components/discover/DiscoverDeck";

export default async function Page() {
  const { step } = await getOnboardingState();
  if (step !== "complete") {
    const { stepPath } = await import("@/lib/onboarding/state");
    redirect(stepPath(step));
  }
  const profiles = await getDiscoverProfiles();
  return <DiscoverDeck initialProfiles={profiles} />;
}
