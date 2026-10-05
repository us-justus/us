import { redirect } from "next/navigation";
import Link from "next/link";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { ChangePasswordForm } from "@/components/settings/change-password-form";

export const dynamic = "force-dynamic";

/**
 * Dedicated password screen (Settings → change password). Reuses the
 * existing ChangePasswordForm (Supabase `updateUser()` on the current
 * session) — no second password implementation, no auth changes.
 *
 * Campus (anonymous) accounts have no password yet; they secure via
 * /settings/account instead, so they are sent there.
 */
export default async function PasswordPage() {
  const session = await getProductSession();
  const guard = guardProductSession(session);
  if (guard) {
    redirect(guard);
  }
  if (session.state !== "permanent") {
    redirect("/settings/account");
  }

  return (
    <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-8 sm:py-10">
        <Link
          href="/settings"
          className="inline-flex min-h-[44px] items-center gap-1 rounded-full text-[11px] tracking-[0.14em] uppercase text-ink-faint transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ← settings
        </Link>
        <p className="mt-6 flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          settings
        </p>
        <h1 className="mt-2 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none">
          change your password.
        </h1>
        <div className="mt-8">
          <ChangePasswordForm title="new password" />
        </div>
      </div>
    </div>
  );
}
