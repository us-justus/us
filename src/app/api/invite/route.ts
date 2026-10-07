import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { perfLog, perfStart } from "@/lib/utils/perf";

/**
 * GET /api/invite
 *
 * Returns the current user's stable invite URL.
 * Only completed campus/permanent users may access.
 * Uses the server-side get_or_create_invite() function for concurrency safety.
 */
export async function GET() {
  const t = perfStart();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Reuse the known user — no second auth.getUser()
  const session = await getProductSession(user);
  const guard = guardProductSession(session);
  if (guard) {
    if (session.suspended) {
      return NextResponse.json({ error: "This account is suspended.", suspended: true }, { status: 403 });
    }
    return NextResponse.json({ error: "Finish onboarding to invite friends." }, { status: 403 });
  }

  // Only campus/permanent (completed) users can invite
  if (session.state !== "campus" && session.state !== "permanent") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("get_or_create_invite");
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      if (String(process.env.NODE_ENV) !== "production") console.error("[invite] get_or_create_invite failed", error.code);
    }
    return NextResponse.json({ error: "Could not create invite." }, { status: 500 });
  }

  const result = (data as { token: string; invite_url: string }[])[0];
  if (!result?.token) {
    return NextResponse.json({ error: "Could not create invite." }, { status: 500 });
  }

  perfLog("invite.create", t);
  return NextResponse.json({ token: result.token, inviteUrl: result.invite_url });
}
