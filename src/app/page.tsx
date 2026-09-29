import { redirect } from "next/navigation";
import { LandingHero } from "@/components/landing/landing-hero";
import { getProductSession } from "@/lib/auth/product-state";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getProductSession();
  if (session.state === "campus" || session.state === "permanent") {
    redirect("/discover");
  }
  return <LandingHero />;
}
