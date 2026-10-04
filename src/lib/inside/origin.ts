/**
 * INSIDE — Origin-vs-Host check for state-changing `/inside` APIs.
 *
 * Server-only helper (no framework imports) shared by
 * `POST /api/inside/login|launch|logout`. It is defense-in-depth ONLY:
 * `requireInsideAdmin()` remains the authoritative authorization check.
 *
 * DESIGN (no canonical-URL config exists in this repo, and none is added):
 * the request's own `Host` (or `x-forwarded-host` behind a proxy) IS the
 * canonical origin for this deployment, so the check compares the `Origin`
 * header's host against it. This behaves correctly in every environment
 * without hardcoding origins:
 *   - local dev (`localhost:3000`, LAN `192.168.x:3000`) — matches.
 *   - staging / production — matches their own host; a foreign site never
 *     matches, so cross-site credentialed fetch/form POSTs are rejected.
 *
 * ABSENT Origin: ALLOWED. Same-origin browser `fetch` POSTs always send
 * `Origin`, but curl, server-to-server calls, and the existing test
 * harnesses omit it — rejecting absent-Origin would break legitimate
 * non-browser callers while adding no authorization (auth is enforced
 * independently by `requireInsideAdmin()` / the login ceremony). A
 * cross-origin attacker cannot strip the header from a victim's browser,
 * so allowing absent-Origin does not weaken the CSRF property.
 *
 * MALFORMED Origin (unparseable, non-http(s) scheme such as `null` from a
 * sandboxed frame): REJECTED — sameness cannot be established.
 * MISSING Host (cannot establish sameness server-side): REJECTED.
 */

export type OriginVerdict =
  | { ok: true }
  | { ok: false; reason: "malformed" | "missing-host" | "mismatch" };

export function verifySameOrigin(req: Request): OriginVerdict {
  const origin = req.headers.get("origin");
  if (!origin) return { ok: true };

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "malformed" };
  }

  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = (forwarded || req.headers.get("host") || "").trim().toLowerCase();
  if (!host) return { ok: false, reason: "missing-host" };

  if (url.host.toLowerCase() !== host) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
