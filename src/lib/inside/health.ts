/**
 * INSIDE Step 4 — System Health helpers (display-only).
 *
 * resolveEnvironment() maps the current deployment to
 * local | staging | production | unknown. An explicit APP_ENV (or
 * NEXT_PUBLIC_APP_ENV / VERCEL_ENV) wins when set; otherwise the known
 * Supabase project refs distinguish staging from production and
 * localhost stays local. This value is DISPLAY-ONLY and must never
 * affect authorization — the /inside gate stays requireInsideAdmin().
 */

export type HealthEnvironment = "local" | "staging" | "production" | "unknown";

/** Static application version (package.json). No versioning system. */
export const APP_VERSION = "0.1.0";

export function resolveAppVersion(): string {
  const override = (process.env.NEXT_PUBLIC_APP_VERSION ?? "").trim();
  return override || APP_VERSION;
}

export function resolveEnvironment(): HealthEnvironment {
  const explicit = (
    process.env.APP_ENV ??
    process.env.NEXT_PUBLIC_APP_ENV ??
    process.env.VERCEL_ENV ??
    ""
  )
    .toLowerCase()
    .trim();
  if (explicit) {
    if (explicit === "local" || explicit === "development" || explicit === "test") return "local";
    if (explicit === "staging" || explicit === "preview") return "staging";
    if (explicit === "production") return "production";
    return "unknown";
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (/localhost|127\.0\.0\.1/.test(url)) return "local";
  if (url.includes("ietruyukgqwkmsyfvxxi")) return "staging";
  if (url.includes("drhticapxbhpqosrkngy")) return "production";
  return "unknown";
}
