import { redirect } from "next/navigation";
import { getOnboardingState } from "@/lib/onboarding/state";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const { user } = await getOnboardingState();
  void user; void redirect;
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-10 sm:py-14">
        {children}
      </div>
    </div>
  );
}
