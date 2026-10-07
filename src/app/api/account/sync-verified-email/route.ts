import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** Synchronize only the authenticated, Auth-confirmed address after link return. */
export async function POST() {
  const session = await createClient();
  const { data: { user } } = await session.auth.getUser();
  const email = user?.email?.trim();
  if (!user || !email || !user.email_confirmed_at) {
    return NextResponse.json({ error: "Could not synchronize account email." }, { status: 400 });
  }
  try {
    const service = createServiceRoleClient();
    const { error } = await service.from("verification_records").upsert({
      user_id: user.id,
      email,
      email_skipped: false,
      email_verified_at: user.email_confirmed_at,
    }, { onConflict: "user_id" });
    if (error) return NextResponse.json({ error: "Could not synchronize account email." }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not synchronize account email." }, { status: 500 });
  }
}
