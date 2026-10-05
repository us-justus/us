import { redirect } from "next/navigation";
import Link from "next/link";
import {
  getProductSession,
  guardProductSession,
} from "@/lib/auth/product-state";
import { createClient } from "@/lib/supabase/server";
import { stepPath } from "@/lib/onboarding/state";

export const dynamic = "force-dynamic";

/**
 * /suspended — the dedicated suspended-account screen.
 *
 * Server-guarded with { allowSuspended: true }: public → /login,
 * incomplete onboarding → its step, active accounts → their destination
 * (a restored user lands back in the normal product). Only a currently
 * suspended session renders this page, and the reason shown is the
 * caller's own (queried server-side for the session user — no target
 * parameter, no admin internals).
 *
 * Appeal entry: "contact us" opens the existing feedback experience with
 * the ACCOUNT category pre-selected (?appeal=1). The server links the
 * submission to the suspension — the student never states which account
 * they are.
 */
export default async function SuspendedPage() {
  const session = await getProductSession();
  const guard = guardProductSession(session, { allowSuspended: true });
  if (guard) {
    redirect(guard);
  }
  if (!session.suspended) {
    redirect(stepPath(session.step ?? "usn"));
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("suspension_reason")
    .eq("user_id", session.user!.id)
    .maybeSingle();
  const reason =
    (data as { suspension_reason?: unknown } | null)?.suspension_reason &&
    typeof (data as { suspension_reason: unknown }).suspension_reason === "string"
      ? ((data as { suspension_reason: string }).suspension_reason ?? null)
      : null;

  return (
    <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 py-10 sm:px-8 sm:py-14">
        <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          account status
        </p>
        <h1 className="mt-2 font-display text-[30px] leading-none tracking-[-0.03em] sm:text-[34px]">
          your account is suspended.
        </h1>

        <div className="mt-8 rounded-[24px] border border-accent-soft bg-accent-wash px-5 py-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-accent-deep">reason</p>
          <p className="mt-2 text-[14px] leading-7 text-ink">
            {reason ?? "No reason was recorded for this suspension."}
          </p>
        </div>

        <p className="mt-6 max-w-[42ch] text-[13px] leading-6 text-ink-soft">
          Think this was a mistake? Tell us what happened — we read every appeal, and a
          real person replies to your account email.
        </p>

        <Link
          href="/feedback?appeal=1"
          className="mt-5 inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] uppercase tracking-[0.14em] font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          contact us
        </Link>
      </div>
    </div>
  );
}
