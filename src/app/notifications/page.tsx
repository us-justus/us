import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { getLaunchState, guardLaunch } from "@/lib/auth/launch";
import { getNotifications } from "@/lib/notifications/queries";
import { NotificationsList } from "@/components/notifications/notifications-list";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Same guards as /matches + /chat: product session server-side, then the
  // server-authoritative launch gate (never navigation-hiding alone).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const session = await getProductSession(user ?? null);
  const guard = guardProductSession(session);
  if (guard) redirect(guard);
  const launchGuard = guardLaunch(await getLaunchState());
  if (launchGuard) redirect(launchGuard);
  if (!user) redirect("/login");

  // DB is the source of truth — history survives offline/re-login.
  const { notifications, unread_count } = await getNotifications(supabase, user.id);

  return (
    <div className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10 sm:py-14">
      <p className="flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-ink-faint">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
        notifications
      </p>
      <h1 className="mt-3 font-display text-[32px] sm:text-[40px] tracking-[-0.03em] leading-none text-ink">
        just for you.
      </h1>
      <p className="mt-3 text-[14px] leading-6 text-ink-soft">
        likes and matches live here until you clear them.
      </p>
      <div className="mt-8">
        <NotificationsList initial={notifications} initialUnread={unread_count} />
      </div>
    </div>
  );
}
