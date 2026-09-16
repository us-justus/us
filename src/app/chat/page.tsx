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
      caption="chat"
      title="say hello."
      note="private conversations with your matches. calm, warm, and yours alone."
    />
  );
}
