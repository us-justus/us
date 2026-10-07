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
      if (String(process.env.NODE_ENV) !== "production") console.error("[invite] resolve failed", error.code);
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

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center px-6 sm:px-8 py-10 sm:py-14 text-center">
        <Wordmark size="md" />
        <p className="mt-3 font-display text-[24px] sm:text-[28px] tracking-[-0.02em] text-ink-soft">
          just us.
        </p>
        {children}
      </section>
    </div>
  );
}

const CTA_LINK =
  "mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[14px] text-[12.5px] tracking-[0.16em] uppercase font-medium text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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
    <InviteShell>
      <p className="mt-10 flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        you&apos;ve been invited
      </p>
      <h1 className="mt-3 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
        @{username}
      </h1>
      {spot !== null && (
        <p className="mt-2 text-[11px] tracking-[0.14em] uppercase text-ink-soft">
          #{spot} · {nickname}
        </p>
      )}

      <div aria-hidden className="mt-8 h-px w-12 bg-line-strong" />

      <p className="mt-6 text-[14px] leading-7 text-ink-soft">
        join us. just us.
      </p>

      <form
        action={`/api/invite/enter?token=${encodeURIComponent(token)}`}
        method="POST"
        className="mt-8 flex w-full flex-col items-center"
      >
        <Button type="submit">enter the campus</Button>
      </form>
    </InviteShell>
  );
}

function InvalidView() {
  return (
    <InviteShell>
      <h1 className="mt-10 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
        this invite isn&apos;t valid.
      </h1>
      <p className="mt-4 max-w-[32ch] text-[14px] leading-7 text-ink-soft">
        the link may be incomplete or the invite may have been disabled.
      </p>
      <Link href="/" className={CTA_LINK}>
        go to us
      </Link>
    </InviteShell>
  );
}

function DisabledView() {
  return (
    <InviteShell>
      <h1 className="mt-10 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
        this invite is no longer active.
      </h1>
      <p className="mt-4 max-w-[32ch] text-[14px] leading-7 text-ink-soft">
        ask your friend to share a fresh link.
      </p>
      <Link href="/" className={CTA_LINK}>
        go to us
      </Link>
    </InviteShell>
  );
}

function SelfView() {
  return (
    <InviteShell>
      <h1 className="mt-10 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
        this is your invite.
      </h1>
      <p className="mt-4 max-w-[32ch] text-[14px] leading-7 text-ink-soft">
        share it with friends — you can&apos;t join your own invite.
      </p>
      <Link href="/" className={CTA_LINK}>
        back home
      </Link>
    </InviteShell>
  );
}

function AuthenticatedView() {
  return (
    <InviteShell>
      <h1 className="mt-10 font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none text-ink">
        you&apos;re already in.
      </h1>
      <p className="mt-4 max-w-[32ch] text-[14px] leading-7 text-ink-soft">
        you already have an account. share your own invite with friends.
      </p>
      <Link href="/" className={CTA_LINK}>
        back home
      </Link>
    </InviteShell>
  );
}
