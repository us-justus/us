import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProductSession } from "@/lib/auth/product-state";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type InviteState =
  | { kind: "valid"; username: string; spot: number | null; nickname: string }
  | { kind: "invalid" }
  | { kind: "disabled" }
  | { kind: "self" }
  | { kind: "authenticated" };

async function resolveInvite(
  token: string,
  currentUserId: string | null,
): Promise<InviteState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_invite_token", {
    p_token: token,
  });
  if (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[invite] resolve error", error.code, error.message);
    }
    return { kind: "invalid" };
  }
  const row = (data as { username: string; spot: number | null; nickname: string }[])[0];
  if (!row) {
    return { kind: "invalid" };
  }
  // Self-invite check: if the current user is the inviter
  if (currentUserId) {
    const { data: inviterCheck } = await supabase
      .from("invites")
      .select("inviter_user_id")
      .eq("token", token)
      .maybeSingle();
    if (inviterCheck && inviterCheck.inviter_user_id === currentUserId) {
      return { kind: "self" };
    }
  }
  return { kind: "valid", ...row };
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already authenticated user
  if (user) {
    const session = await getProductSession(user);
    if (session.state === "campus" || session.state === "permanent") {
      return <AuthenticatedView />;
    }
  }

  const state = await resolveInvite(token, user?.id ?? null);

  if (state.kind === "invalid") {
    return <InvalidView />;
  }
  if (state.kind === "disabled") {
    return <DisabledView />;
  }
  if (state.kind === "self") {
    return <SelfView />;
  }
  if (state.kind === "authenticated") {
    return <AuthenticatedView />;
  }

  // Valid invite — show landing page
  return <ValidView token={token} username={state.username} spot={state.spot} nickname={state.nickname} />;
}

function ValidView({
  token,
  username,
  spot,
  nickname,
}: {
  token: string;
  username: string;
  spot: number | null;
  nickname: string;
}) {
  return (
    <div className="flex flex-1 flex-col bg-accent-wash">
      <section className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <Wordmark size="hero" />
        <p className="mt-3 text-[24px] sm:text-[28px] font-display tracking-[-0.02em] text-ink-soft">
          just us.
        </p>
        <p className="mt-3 flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          you&apos;ve been invited
        </p>

        <div className="mt-8 flex flex-col items-center">
          <p className="text-[13px] tracking-[0.14em] uppercase text-ink-faint">invited by</p>
          <h1 className="mt-2 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
            @{username}
          </h1>
          {spot !== null && (
            <p className="mt-2 text-[13px] tracking-[0.14em] uppercase text-ink-soft">
              #{spot} · {nickname}
            </p>
          )}
        </div>

        <p className="mt-8 max-w-[32ch] text-[14px] leading-7 text-ink-faint">
          join us. just us.
        </p>

        <form
          action={`/api/invite/enter?token=${encodeURIComponent(token)}`}
          method="POST"
          className="mt-8 w-full"
        >
          <Button type="submit" className="w-full rounded-full">
            enter the campus
          </Button>
        </form>

        <p className="mt-4 text-[11px] leading-4 text-ink-faint">
          campus-only · verified · private
        </p>
      </section>

      <div className="border-t border-accent-soft bg-paper">
        <div className="mx-auto flex max-w-[1080px] flex-col items-center justify-between gap-3 px-6 py-6 sm:flex-row sm:px-8 text-[11px] tracking-[0.12em] uppercase text-ink-faint">
          <span>est. 2026 — built for your campus</span>
          <span className="flex items-center gap-2">
            <span className="h-px w-6 bg-accent-soft hidden sm:block" />
            private by design
          </span>
        </div>
      </div>
    </div>
  );
}

function InvalidView() {
  return (
    <div className="flex flex-1 flex-col bg-accent-wash">
      <section className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <Wordmark size="hero" />
        <p className="mt-3 text-[24px] sm:text-[28px] font-display tracking-[-0.02em] text-ink-soft">
          just us.
        </p>
        <h1 className="mt-8 font-display text-[28px] sm:text-[32px] tracking-[-0.03em] leading-none text-ink">
          this invite isn&apos;t valid.
        </h1>
        <p className="mt-4 max-w-[32ch] text-[14px] leading-7 text-ink-faint">
          the link may be incomplete or the invite may have been disabled.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[14px] text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          go to us
        </Link>
      </section>
    </div>
  );
}

function DisabledView() {
  return (
    <div className="flex flex-1 flex-col bg-accent-wash">
      <section className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <Wordmark size="hero" />
        <p className="mt-3 text-[24px] sm:text-[28px] font-display tracking-[-0.02em] text-ink-soft">
          just us.
        </p>
        <h1 className="mt-8 font-display text-[28px] sm:text-[32px] tracking-[-0.03em] leading-none text-ink">
          this invite is no longer active.
        </h1>
        <p className="mt-4 max-w-[32ch] text-[14px] leading-7 text-ink-faint">
          ask your friend to share a fresh link.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[14px] text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          go to us
        </Link>
      </section>
    </div>
  );
}

function SelfView() {
  return (
    <div className="flex flex-1 flex-col bg-accent-wash">
      <section className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <Wordmark size="hero" />
        <p className="mt-3 text-[24px] sm:text-[28px] font-display tracking-[-0.02em] text-ink-soft">
          just us.
        </p>
        <h1 className="mt-8 font-display text-[28px] sm:text-[32px] tracking-[-0.03em] leading-none text-ink">
          this is your invite.
        </h1>
        <p className="mt-4 max-w-[32ch] text-[14px] leading-7 text-ink-faint">
          share it with friends — you can&apos;t join your own invite.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[14px] text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          back home
        </Link>
      </section>
    </div>
  );
}

function AuthenticatedView() {
  return (
    <div className="flex flex-1 flex-col bg-accent-wash">
      <section className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
        <Wordmark size="hero" />
        <p className="mt-3 text-[24px] sm:text-[28px] font-display tracking-[-0.02em] text-ink-soft">
          just us.
        </p>
        <h1 className="mt-8 font-display text-[28px] sm:text-[32px] tracking-[-0.03em] leading-none text-ink">
          you&apos;re already in.
        </h1>
        <p className="mt-4 max-w-[32ch] text-[14px] leading-7 text-ink-faint">
          you already have an account. share your own invite with friends.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[14px] text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          back home
        </Link>
      </section>
    </div>
  );
}