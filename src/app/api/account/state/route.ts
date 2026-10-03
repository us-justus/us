import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountState } from "@/lib/auth/account";
import { displayAccountEmail } from "@/lib/auth/internal-email";
import { destinationForStep } from "@/lib/auth/redirect";
import { getOnboardingState } from "@/lib/onboarding/state";
import { getLaunchState } from "@/lib/auth/launch";
import { getChatMatchIds, hasUnreadChat } from "@/lib/chat/read-state";

/**
 * Server source of truth for account + onboarding state.
 *
 * Returns only safe, displayable fields — never USN, auth user ID internals,
 * verification metadata, tokens, or passwords.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ signedIn: false as const });

  const account = getAccountState(user);
  // Pass the already-authenticated user so getOnboardingState() does not
  // pay for a second auth.getUser() round-trip on this request.
  // Onboarding state, launch state, and the notification badge count are
  // independent — resolve together.
  const unreadQuery = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null)
    .is("resolved_at", null)
    .is("deleted_at", null)
    .then(
      async (r) => {
        if (!r.error && typeof r.count === "number") return r.count;
        // Pre-resolved_at migration: fall back to the read/deleted-only count.
        if (r.error && !/resolved_at/i.test(r.error.message ?? "")) return 0;
        const legacy = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .is("read_at", null)
          .is("deleted_at", null);
        return typeof legacy.count === "number" ? legacy.count : 0;
      },
      () => 0,
    );
  // Primary avatar for the bottom-nav Profile item. Bounded by construction:
  // one profile-id lookup + one photo row (first by display_order). Public
  // photo URL only — never private fields, never the full photo set. Resolved
  // inside this same per-navigation fetch so the nav adds zero extra requests.
  const avatarQuery = (async () => {
    const { data: prof } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const profileId = (prof as { id: string } | null)?.id;
    if (!profileId) return null;
    const { data: photo } = await supabase
      .from("profile_photos")
      .select("storage_path")
      .eq("profile_id", profileId)
      .order("display_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    const storagePath = (photo as { storage_path: string } | null)?.storage_path;
    if (!storagePath) return null;
    return supabase.storage.from("profile-photos").getPublicUrl(storagePath).data.publicUrl ?? null;
  })().catch(() => null);
  // Chat unread activity rides this same resolution (no second fetch, no new
  // route, no polling): the global dot (hasUnreadChat RPC) plus the match
  // IDs the header's realtime listener scopes itself to. Both degrade to
  // false/empty pre-migration. unreadCount stays exclusively notification
  // state — chat activity never touches it.
  const [{ step }, launch, unread, primaryAvatarUrl, chatUnread, chatMatchIds] = await Promise.all([
    getOnboardingState(user),
    getLaunchState(),
    unreadQuery,
    avatarQuery,
    hasUnreadChat(supabase),
    getChatMatchIds(supabase, user.id),
  ]);
  const next = destinationForStep(step);

  return NextResponse.json({
    signedIn: true as const,
    // Internal sign-in identities (u-…@us.signin.invalid) are never
    // exposed: the display projection collapses them to null.
    account: account ? { ...account, email: displayAccountEmail(account.email) } : account,
    // Authenticated email identity only (from Supabase Auth, never the
    // onboarding profile email field). Internal identities collapse to null.
    email: displayAccountEmail(user.email),
    emailConfirmed: account?.emailConfirmed ?? false,
    onboardingStep: step,
    next,
    // Server-authoritative launch flag. launchAt (UTC) is display-only for
    // a future countdown — never authorization.
    launched: launch.launched,
    launchAt: launch.launchAt,
    // Notification badge count (spec/3D3.md). Additive only — 0 until the
    // notifications migration is applied or when there is nothing unread.
    unreadCount: unread,
    // Chat activity for the 💬 dot — intentionally separate from
    // unreadCount. chatUnread is boolean (dot, never a count); chatMatchIds
    // scopes the header's realtime listener to the caller's own matches.
    chatUnread: chatUnread,
    chatMatchIds: chatMatchIds,
    // Current user's primary profile photo URL for the bottom-nav avatar.
    // Null when no profile/photos yet — the nav falls back to a generic mark.
    primaryAvatarUrl: primaryAvatarUrl,
  });
}
