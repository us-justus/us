import { redirect } from "next/navigation";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { SearchClient } from "@/components/search/search-client";

export const dynamic = "force-dynamic";

/**
 * Pre-launch campus search (STEP 3B).
 *
 * Product-guarded (public → /login, incomplete → step path) but NOT
 * launch-gated: search is a pre-launch feature that remains available once
 * launched. Discover/Matches/Chat stay server-locked separately.
 */
export default async function SearchPage() {
  const session = await getProductSession();
  const guard = guardProductSession(session);
  if (guard) {
    redirect(guard);
  }
  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-10 sm:py-14">
        <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">search</p>
        <h1 className="mt-2 font-display text-[30px] tracking-[-0.03em] leading-none">
          find your campus.
        </h1>
        <div className="mt-8">
          <SearchClient />
        </div>
      </div>
    </div>
  );
}
