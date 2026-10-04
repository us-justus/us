import { NextResponse } from "next/server";
import { clearInsideCookieHeader } from "@/lib/inside/auth";
import { recordInsideAuditEvent } from "@/lib/inside/audit";
import { verifySameOrigin } from "@/lib/inside/origin";

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
  try {
    await recordInsideAuditEvent("ADMIN_LOGOUT");
  } catch {}
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearInsideCookieHeader());
  return res;
}
