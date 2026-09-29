import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountState } from "@/lib/auth/account";
import { getOnboardingState, stepPath } from "@/lib/onboarding/state";
import { SignOutButton } from "@/components/settings/sign-out-button";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Product-only route. Product state model (see lib/auth/product-state.ts):
 * - public (no session) → /login (never render account UI to visitors)
 * - onboarding (incomplete) → appropriate /onboarding/* step (the
 *   "isn't secured yet" message must never appear mid-onboarding)
 * - campus (anonymous, complete) → "isn't secured yet" + secure action
 * - permanent → verified info + change password + sign out
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Reuse the known user — never a second getUser() on this request.
  const { step } = await getOnboardingState(user);
  if (step !== "complete") {
    redirect(stepPath(step));
  }

  return (
    <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-8 sm:py-10">
        <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">settings</p>
        <h1 className="mt-2 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none">
          your account.
        </h1>

        <AccountSettings
          kind={getAccountState(user)?.kind ?? "anonymous"}
          email={user.email ?? null}
          emailConfirmed={getAccountState(user)?.emailConfirmed ?? false}
        />
      </div>
    </div>
  );
}

function AccountSettings({
  kind,
  email,
  emailConfirmed,
}: {
  kind: "anonymous" | "permanent-unverified" | "permanent-verified";
  email: string | null;
  emailConfirmed: boolean;
}) {
  return (
    <div className="mt-8 space-y-8">
      {/* account status */}
      <section className="rounded-[24px] border border-line bg-paper-2 px-5 py-6 sm:px-6">
        <p className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">account</p>
        {kind === "anonymous" ? (
          <>
            <p className="mt-2 font-display text-[22px] tracking-[-0.02em] leading-tight">
              your account isn&apos;t secured yet.
            </p>
            <p className="mt-2 text-[13px] leading-6 text-ink-soft max-w-[38ch]">
              Secure your account to sign back in from another device. It takes a minute —
              email, verify, password.
            </p>
            <Link
              href="/settings/account"
              className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors"
            >
              secure account
            </Link>
            <p className="mt-3 text-[11px] leading-4 text-ink-faint">
              Signing out before securing your account may prevent returning to it.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 font-display text-[22px] tracking-[-0.02em] leading-tight">
              {emailConfirmed ? "secured." : "almost secured."}
            </p>
            {email && (
              <p className="mt-2 text-[14px] text-ink break-all">{email}</p>
            )}
            <p className="mt-1 text-[12px] text-ink-soft">
              {emailConfirmed
                ? "verified email · password sign-in enabled"
                : "verification pending — confirm your email to finish"}
            </p>
            {!emailConfirmed && (
              <Link
                href="/settings/account"
                className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors"
              >
                finish securing account
              </Link>
            )}
          </>
        )}
      </section>

      {/* permanent account controls */}
      {kind !== "anonymous" && emailConfirmed && (
        <section>
          <ChangePasswordForm />
        </section>
      )}

      {kind !== "anonymous" && (
        <section>
          <SignOutButton />
        </section>
      )}

      {/* profile shortcuts */}
      <section>
        <div className="h-px bg-line" />
        <div className="flex flex-col gap-1 py-4">
          <Link
            href="/profile"
            className="py-2.5 text-[14px] tracking-[0.04em] text-ink-soft hover:text-ink transition-colors"
          >
            view profile →
          </Link>
          <Link
            href="/profile/edit"
            className="py-2.5 text-[14px] tracking-[0.04em] text-ink-soft hover:text-ink transition-colors"
          >
            edit profile →
          </Link>
          {kind !== "anonymous" && (
            <Link
              href="/settings/account"
              className="py-2.5 text-[14px] tracking-[0.04em] text-ink-soft hover:text-ink transition-colors"
            >
              manage account →
            </Link>
          )}
        </div>
        <div className="h-px bg-line" />
      </section>
    </div>
  );
}
