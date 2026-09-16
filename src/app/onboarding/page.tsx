import { redirect } from "next/navigation";
import { getOnboardingState, stepPath } from "@/lib/onboarding/state";

export default async function OnboardingIndex() {
  const { step } = await getOnboardingState();
  redirect(stepPath(step));
}
