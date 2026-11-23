import { NextResponse } from "next/server";
import { clearInsideCookieHeader } from "@/lib/inside/auth";
import { recordInsideAuditEvent } from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";
import { cookies } from "next/headers";
import { INSIDE_COOKIE } from "@/lib/inside/cookie";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * POST /api/inside/logout — clears the signed inside cookie.
 *
 * Origin-vs-Host checked first so a foreign site cannot log an admin out
 * via credentialed cross-site POST (annoyance-grade CSRF, rejected with a
 * generic 403 before the cookie is touched). Requests without an Origin
 * header (curl, tests, server-to-server) still clear normally; clearing is
 * idempotent and reveals nothing.
 *
 * Audit (Step 2): records ADMIN_LOGOUT attributed to the verified admin
 * identity available BEFORE clearing. Best-effort — the cookie is always
 * cleared and logout always succeeds even if audit storage is down. Calls
 * with no verified session record nothing (there is no actor to
 * attribute); clearing stays idempotent.
 */
export async function POST(req: Request) {
  if (!verifySameOrigin(req).ok) {
    return NextResponse.json({ error: "Not available." }, { status: 403 });
  }
  const raw = (await cookies()).get(INSIDE_COOKIE)?.value;
  if (raw) {
    try {
      const parts = raw.split(".");
      const exp = Number(parts[1]);
      const service = createServiceRoleClient();
      const { error } = await service.rpc("revoke_inside_session", {
        p_token: raw,
        p_expires_at: new Date(Number.isFinite(exp) ? exp : Date.now()).toISOString(),
      });
      if (error) {
        return NextResponse.json({ error: "Could not end the admin session." }, { status: 503 });
      }
    } catch {
      return NextResponse.json({ error: "Could not end the admin session." }, { status: 503 });
    }
  }
  try {
    await recordInsideAuditEvent("ADMIN_LOGOUT");
  } catch {}
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearInsideCookieHeader());
  return res;
}
