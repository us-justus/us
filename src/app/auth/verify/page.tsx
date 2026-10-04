import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeVerificationToken, isWellFormedToken } from "@/lib/email-verification/tokens";

/**
 * Email-ownership verification (staging slice).
 *
 * GET /auth/verify?token=<opaque 256-bit secret>
 *
 * The token is the ONLY secret needed — no user id, email, or USN in the
 * URL. On success the token is atomically consumed, email_verified_at is
 * set, and control passes to /onboarding (getOnboardingState decides the
 * next step — never hardcoded here). Every failure mode (malformed,
 * unknown, expired, consumed, invalidated, superseded) renders the same
 * quiet, enumeration-safe message with one way back. Nothing here logs the
 * token, and no new token is ever minted from this GET — resend stays an
 * explicit POST to /api/verification/request.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  // NOTE: redirect() throws (NEXT_REDIRECT) — it must never sit inside a
  // try/catch, or the catch swallows the redirect and renders the failure
  // UI instead. Resolve success first, redirect after.
  let verified = false;
  if (isWellFormedToken(token)) {
    try {
      const service = createServiceRoleClient();
      verified = (await consumeVerificationToken(service, token)).ok;
    } catch {
      verified = false;
    }
  }
  if (verified) redirect("/onboarding");

  return (
    <main className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10 sm:py-14">
      <p className="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        email verification
      </p>
      <h1 className="mt-2 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none">
        this link didn&apos;t work.
      </h1>
      <p className="mt-3 text-[13px] leading-6 text-ink-soft max-w-[38ch]">
        It may have expired, already been used, or been replaced by a newer
        email. Request a fresh link and try again.
      </p>
      <div className="my-6 h-px bg-line" aria-hidden />
      <Link
        href="/onboarding"
        className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        continue
      </Link>
    </main>
  );
}
