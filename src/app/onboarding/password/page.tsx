import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";
import { Shell } from "@/components/onboarding/shell";
import { PasswordForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * Server-side completion guard: a completed user opening this step URL is
 * bounced to /home (waiting home). Incomplete sessions render the step normally.
 */
export default async function PasswordPage() {
  const { step } = await getOnboardingState();
  if (step === "complete") redirect("/home");
  return (
    <Shell title="check your inbox." subtitle="We sent a verification link." step="03 — password">
      <Suspense fallback={<p className="text-[13px] text-ink-soft">loading…</p>}>
        <PasswordForm />
      </Suspense>
    </Shell>
  );
}
