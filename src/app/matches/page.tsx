import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";
import { Placeholder } from "@/components/layout/placeholder";

export default async function Page() {
  const { step } = await getOnboardingState();
  if (step !== "complete") {
    const { stepPath } = await import("@/lib/onboarding/state");
    redirect(stepPath(step));
  }
  return (
    <Placeholder
      caption="matches"
      title={`it's a match.`}
      note="you both liked each other. when it happens, it will live here."
    />
  );
}
