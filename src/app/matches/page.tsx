import { redirect } from "next/navigation";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { Placeholder } from "@/components/layout/placeholder";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getProductSession();
  const guard = guardProductSession(session);
  if (guard) {
    redirect(guard);
  }
  return (
    <Placeholder
      caption="matches"
      title={`it's a match.`}
      note="you both liked each other. when it happens, it will live here."
    />
  );
}
