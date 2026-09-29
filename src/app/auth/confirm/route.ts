import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/settings/account";
}

/**
 * Handles all Supabase Auth email-link callbacks: email-change verification
 * (anonymous conversion), and password-recovery links.
 *
 * Exchanges the code (PKCE / email link) or verifies the token_hash, which
 * sets the session cookies, then redirects to `next`. On failure redirects to
 * `next` with ?error=link-expired so the page can offer a resend.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(`${next}?verified=1`);
  } else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) redirect(`${next}?verified=1`);
  }

  const sep = next.includes("?") ? "&" : "?";
  redirect(`${next}${sep}error=link-expired`);
}
