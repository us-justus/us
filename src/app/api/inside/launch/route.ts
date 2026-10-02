import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInsideAdmin } from "@/lib/inside/auth";

/**
 * POST /api/inside/launch — the only sanctioned launch_config writer.
 *
 * Body: { launched: boolean, version?: string }.
 *
 * Server-authorized: verifies the signed inside cookie + live Supabase
 * session for the same user + current admin_users membership, then runs the
 * admin_set_launch() SECURITY DEFINER function (which re-checks is_admin()
 * inside the database). No service-role key, no RLS weakening, no
 * client-trusted flags. launch_config id = 1 semantics preserved:
 * launching stamps launched_at = now(); un-launching keeps launched_at as
 * the historical record.
 */
const GENERIC = "Not available.";

export async function POST(req: Request) {
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });

  const { launched, version } = await req.json().catch(() => ({}));
  if (typeof launched !== "boolean") {
    return NextResponse.json({ error: "Pass launched as true or false." }, { status: 400 });
  }
  if (version !== undefined && (typeof version !== "string" || !/^v[0-9]{1,3}$/.test(version))) {
    return NextResponse.json(
      { error: "Version looks like v1, v2, … (up to v999)." },
      { status: 400 },
    );
  }

  // Reuse the verified session — admin_set_launch() enforces is_admin()
  // itself, so authorization holds even if membership changed mid-session.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_launch", {
    p_launched: launched,
    p_version: typeof version === "string" ? version : null,
  });
  if (error) {
    return NextResponse.json({ error: "Could not update launch state." }, { status: 500 });
  }
  const row = data as { launched: boolean; launched_at: string | null; prelaunch_version: string };
  return NextResponse.json({
    ok: true,
    launched: row.launched === true,
    launchedAt: row.launched_at ?? null,
    version: row.prelaunch_version ?? "v1",
  });
}
