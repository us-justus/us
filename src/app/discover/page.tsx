import { redirect } from "next/navigation";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { getDiscoverProfiles } from "@/lib/discover/queries";
import { DiscoverDeck } from "@/components/discover/DiscoverDeck";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getProductSession();
  const guard = guardProductSession(session);
  if (guard) {
    redirect(guard);
  }
  const profiles = await getDiscoverProfiles();
  return <DiscoverDeck initialProfiles={profiles} />;
}
