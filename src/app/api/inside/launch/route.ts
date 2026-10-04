import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLaunchState } from "@/lib/auth/launch";
import { requireInsideAdmin } from "@/lib/inside/auth";
import { recordInsideAuditEvent } from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";

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
 *
 * Audit (Step 2) — ordering is authenticate → authorize → mutate → audit
 * → return:
 *   - LAUNCH_ENABLED / LAUNCH_DISABLED when `launched` actually flips,
 *     LAUNCH_VERSION_CHANGED when the version actually changes (both when
 *     one call changes both). A no-op call (nothing changed) records
 *     nothing. Failed mutations record nothing.
 *   - Target is the singleton (launch_config / 1); metadata carries
 *     previous + new state, never secrets.
 *   - FAIL CLOSED: if the mutation succeeds but an audit write fails, the
 *     route restores the pre-mutation snapshot (best-effort compensation
 *     via the same sanctioned writer) and returns 500 instead of success —
 *     never a silent "launch changed + no audit record".
 */
const GENERIC = "Not available.";

export async function POST(req: Request) {
  // CSRF layer only — same generic failure as an unauthenticated call.
  // `requireInsideAdmin()` below remains the authoritative check.
  if (!verifySameOrigin(req).ok) {
    return NextResponse.json({ error: GENERIC }, { status: 403 });
  }
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

  // Snapshot for audit metadata + fail-closed compensation below.
  const prev = await getLaunchState();
  const versionChanged =
    typeof version === "string" && version !== prev.prelaunchVersion;
  const launchedChanged = launched !== prev.launched;

  // Reuse the verified session — admin_set_launch() enforces is_admin()
  // itself, so authorization holds even if membership changed mid-session.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_launch", {
    p_launched: launched,
    p_version: typeof version === "string" ? version : null,
  });
  if (error) {
    // Failed mutation: no success event is recorded.
    return NextResponse.json({ error: "Could not update launch state." }, { status: 500 });
  }
  const row = data as { launched: boolean; launched_at: string | null; prelaunch_version: string };
  const next = {
    launched: row.launched === true,
    version: row.prelaunch_version ?? "v1",
  };

  // No-op call (mutation succeeded but nothing changed): no event.
  if (!launchedChanged && !versionChanged) {
    return NextResponse.json({
      ok: true,
      launched: next.launched,
      launchedAt: row.launched_at ?? null,
      version: next.version,
    });
  }

  // Mutation succeeded — attribute it. Sequential writes; any failure
  // aborts to compensation below (partial rows, if any, remain as evidence
  // of the attempt — the server log notes the rollback).
  const target = { targetType: "launch_config", targetId: "1" };
  let audited = true;
  if (launchedChanged) {
    const r = await recordInsideAuditEvent(launched ? "LAUNCH_ENABLED" : "LAUNCH_DISABLED", {
      ...target,
      metadata: {
        previous_launched: prev.launched,
        new_launched: next.launched,
        version: next.version,
      },
    });
    audited = r.ok;
  }
  if (audited && versionChanged) {
    const r = await recordInsideAuditEvent("LAUNCH_VERSION_CHANGED", {
      ...target,
      metadata: {
        previous_version: prev.prelaunchVersion,
        new_version: next.version,
        launched: next.launched,
      },
    });
    audited = r.ok;
  }

  if (!audited) {
    // Fail closed: restore the snapshot so there is no unattributed state
    // change. Best-effort — even if the restore fails, report 500 (never
    // success without an audit record).
    console.error("[inside] launch audit failed; restoring previous state");
    try {
      await supabase.rpc("admin_set_launch", {
        p_launched: prev.launched,
        p_version: prev.prelaunchVersion,
      });
    } catch {}
    return NextResponse.json({ error: "Could not update launch state." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    launched: next.launched,
    launchedAt: row.launched_at ?? null,
    version: next.version,
  });
}
