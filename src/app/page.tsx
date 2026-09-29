import { redirect } from "next/navigation";
import { LandingHero } from "@/components/landing/landing-hero";
import { getProductSession } from "@/lib/auth/product-state";
import { destinationForStep } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getProductSession();
  if (session.state === "public") {
    return <LandingHero />;
  }
  if (session.state === "onboarding") {
    redirect(destinationForStep(session.step ?? "usn"));
  }
  redirect("/discover");
}
