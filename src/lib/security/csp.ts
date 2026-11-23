const SUPABASE_ORIGIN_ERROR = "NEXT_PUBLIC_SUPABASE_URL must be an absolute HTTPS origin";

export function parseSupabaseOrigin(value: string | undefined): string {
  if (!value) throw new Error(SUPABASE_ORIGIN_ERROR);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(SUPABASE_ORIGIN_ERROR);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(SUPABASE_ORIGIN_ERROR);
  }
  return url.origin;
}

export function buildReportOnlyCsp(supabaseOrigin: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: " + supabaseOrigin,
    "font-src 'self'",
    "connect-src 'self' " + supabaseOrigin,
  ].join("; ");
}
