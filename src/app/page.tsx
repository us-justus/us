import { redirect } from "next/navigation";
import { LandingHero } from "@/components/landing/landing-hero";
import { PrelaunchPanel } from "@/components/prelaunch/prelaunch-panel";
import { getProductSession } from "@/lib/auth/product-state";
import { getLaunchState } from "@/lib/auth/launch";
import { stepPath } from "@/lib/onboarding/state";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Independent queries — one resolution, no waterfall (§6).
  const [session, launch] = await Promise.all([getProductSession(), getLaunchState()]);
  if (session.state === "onboarding") {
    // Incomplete users keep the existing onboarding destination.
    redirect(stepPath(session.step ?? "usn"));
  }
  if (session.state === "campus" || session.state === "permanent") {
    if (launch.launched) {
      redirect("/discover");
    }
    // PRE_LAUNCH: stay here and show the permanent identity. Redirecting to
    // /discover would bounce straight back (guardLaunch → "/") — a loop.
    // Discover/Match/Chat stay server-locked. Reuses the session user ID
    // directly — no second auth.getUser() on this request.
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("username, spot")
      .eq("user_id", session.user!.id)
      .maybeSingle();
    const row = profile as { username: string | null; spot: number | null } | null;
    return <PrelaunchPanel username={row?.username ?? null} spot={row?.spot ?? null} />;
  }
  return <LandingHero />;
}
