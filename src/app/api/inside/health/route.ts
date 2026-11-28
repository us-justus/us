import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { resolveAppVersion, resolveEnvironment } from "@/lib/inside/health";

/**
 * GET /api/inside/health — admin-only System Health (INSIDE Step 4).
 *
 * Server-authorized via requireInsideAdmin() (signed inside cookie + live
 * Supabase session + current admin_users membership). Anonymous and student
 * sessions get the same generic 403 — no public /health endpoint exists.
 *
 * Each dependency is checked in isolation: a down service reports "error"
 * for that field while the route still returns 200 to the admin. Realtime
 * reports "not_checked" — no live channel infrastructure exists to probe,
 * and a false "ok" would be worse than no signal. The response carries
 * status literals + display-only environment/version only: no secrets, no
 * keys, no credentials, no connection details.
 */
const GENERIC = "Not available.";

type Status = "ok" | "error" | "not_checked";

export async function GET() {
  const gate = await requireInsideAdmin();
  if (!gate) return NextResponse.json({ error: GENERIC }, { status: 403 });

  const supabase = await createClient();

  // Database: lightweight is_admin() RPC through the session client.
  // Success proves the database is reachable; the function returns a
  // boolean only and carries no data, so nothing private can leak.
  let database: Status = "error";
  try {
    const { error } = await supabase.rpc("is_admin");
    if (!error) database = "ok";
  } catch {
    database = "error";
  }

  // requireInsideAdmin() already performed the live Auth user lookup and
  // current admin membership check for this request. Reusing that successful
  // gate avoids a second auth.getUser() call.
  const auth: Status = "ok";

  // Storage: lightweight list of the existing profile-photos bucket.
  // No uploads, no permanent files, no writes of any kind.
  let storage: Status = "error";
  try {
    const { error } = await supabase.storage
      .from("profile-photos")
      .list("", { limit: 1 });
    if (!error) storage = "ok";
  } catch {
    storage = "error";
  }

  // Realtime: no safe live probe exists without creating channel
  // infrastructure, so report "not_checked" instead of a false signal.
  const realtime: Status = "not_checked";

  return NextResponse.json({
    database,
    auth,
    storage,
    realtime,
    environment: resolveEnvironment(),
    version: resolveAppVersion(),
  });
}
