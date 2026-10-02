import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { getLaunchState, guardLaunch } from "@/lib/auth/launch";
import { getChatHistory } from "@/lib/chat/queries";
import { Conversation } from "@/components/chat/conversation";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function displayName(username: string | null, nickname: string | null): string {
  if (username) return `@${username}`;
  return nickname ?? "someone";
}

function identityLine(
  nickname: string | null,
  age: number | null,
  year: string | null,
  branch: string | null,
): string | null {
  const parts: string[] = [];
  if (nickname && age !== null) parts.push(`${nickname}, ${age}`);
  else if (nickname) parts.push(nickname);
  else if (age !== null) parts.push(`${age}`);
  if (branch) parts.push(branch);
  if (year) parts.push(`${year} year`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * /chat/[matchId] — private conversation for one match.
 *
 * Server Component: guards (product + launch), explicit match membership
 * (id + caller in user_a/user_b — never RLS alone for page logic), other
 * participant public fields + primary photo, bounded initial history.
 * Realtime + composer live in the Conversation client island.
 */
export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Reuse the known user — no second auth.getUser() on this request.
  const session = await getProductSession(user ?? null);
  const guard = guardProductSession(session);
  if (guard) redirect(guard);
  const launchGuard = guardLaunch(await getLaunchState());
  if (launchGuard) redirect(launchGuard);
  if (!user) redirect("/login");

  // Invalid UUID: clean redirect, never a database error surface.
  if (typeof matchId !== "string" || !UUID_RE.test(matchId)) redirect("/matches");

  // Explicit ownership: the caller must be user_a OR user_b of this match.
  const { data: match } = await supabase
    .from("matches")
    .select("id, user_a_id, user_b_id")
    .eq("id", matchId)
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
    .maybeSingle();
  const row = match as { id: string; user_a_id: string; user_b_id: string } | null;
  if (!row) redirect("/matches");

  const otherId = row.user_a_id === user.id ? row.user_b_id : row.user_a_id;

  // Other participant: public fields only — never USN/email/auth metadata.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, nickname, age, year, branch")
    .eq("user_id", otherId)
    .maybeSingle();
  const prof = profile as {
    id: string;
    username: string | null;
    nickname: string | null;
    age: number | null;
    year: string | null;
    branch: string | null;
  } | null;
  if (!prof) redirect("/matches");

  // Primary photo only (first by display_order) — never the full set.
  let photoUrl: string | null = null;
  const { data: photo } = await supabase
    .from("profile_photos")
    .select("storage_path")
    .eq("profile_id", prof.id)
    .order("display_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  const storagePath = (photo as { storage_path: string } | null)?.storage_path;
  if (storagePath) {
    photoUrl = supabase.storage.from("profile-photos").getPublicUrl(storagePath).data.publicUrl ?? null;
  }

  const { messages } = await getChatHistory(supabase, matchId);

  const name = displayName(prof.username, prof.nickname);
  const line = identityLine(prof.nickname, prof.age, prof.year, prof.branch);
  const initial = (prof.username ?? prof.nickname ?? "?").replace(/^@/, "").charAt(0).toUpperCase() || "?";

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-[560px] flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-paper px-6 py-3 sm:px-8">
        <Link
          href="/matches"
          aria-label="back to matches"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-[18px] text-ink transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span aria-hidden>←</span>
        </Link>
        <span
          aria-hidden
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-paper-2"
        >
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              width={44}
              height={44}
              loading="eager"
              decoding="async"
              className="h-11 w-11 object-cover"
            />
          ) : (
            <span className="text-[18px] text-ink-soft">{initial}</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-6 text-ink">{name}</span>
          {line && <span className="block truncate text-[13px] leading-5 text-ink-soft">{line}</span>}
        </span>
      </header>

      <Conversation matchId={matchId} currentUserId={user.id} initialMessages={messages} />
    </div>
  );
}
