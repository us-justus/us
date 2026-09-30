import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PublicPhoto = { url: string };

/**
 * Minimal public profile (STEP 3B).
 *
 * `/u/[username]` — the URL carries the username only, never an auth ID or
 * USN. The username → internal profile resolution happens server-side
 * (case-insensitive equality via the existing `idx_profiles_username_lower`
 * index); only public fields render. Blocked in either direction, inactive,
 * or missing → notFound. Product-guarded like /search, never launch-gated.
 */
export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const session = await getProductSession();
  const guard = guardProductSession(session);
  if (guard) {
    redirect(guard);
  }
  const me = session.user!.id;
  const { username: rawParam } = await params;
  const handle = decodeURIComponent(rawParam).trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{3,30}$/.test(handle)) {
    notFound();
  }

  const supabase = await createClient();
  // LIKE-escape (`_` is legal in usernames but a LIKE wildcard); ilike
  // without wildcards is a case-insensitive equality match.
  const likePattern = handle.replace(/[\\%_]/g, (m) => `\\${m}`);
  const { data: row } = await supabase
    .from("profiles")
    .select("id, user_id, username, spot, nickname, age, year, branch, bio, interests, is_active")
    .ilike("username", likePattern)
    .eq("is_active", true)
    .maybeSingle();

  const profile = row as {
    id: string;
    user_id: string;
    username: string | null;
    spot: number | null;
    nickname: string;
    age: number;
    year: string;
    branch: string;
    bio: string | null;
    interests: string[] | null;
  } | null;

  if (!profile?.username) {
    notFound();
  }

  // Blocked in either direction → not discoverable. Independent queries,
  // resolved together.
  const [blockedRes, blockedByRes] = await Promise.all([
    supabase
      .from("blocks")
      .select("id")
      .eq("blocker_id", me)
      .eq("blocked_id", profile.user_id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("blocks")
      .select("id")
      .eq("blocker_id", profile.user_id)
      .eq("blocked_id", me)
      .limit(1)
      .maybeSingle(),
  ]);
  if (blockedRes.data || blockedByRes.data) {
    notFound();
  }

  const { data: photos } = await supabase
    .from("profile_photos")
    .select("storage_path, display_order")
    .eq("profile_id", profile.id)
    .order("display_order", { ascending: true });

  const urls: PublicPhoto[] = ((photos ?? []) as { storage_path: string }[]).map((p) => ({
    url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }));
  const primary = urls[0];
  const rest = urls.slice(1, 4);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-10 sm:py-14">
        <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">campus profile</p>
        <h1 className="mt-2 font-display text-[30px] tracking-[-0.03em] leading-none">
          @{profile.username}
        </h1>
        <p className="mt-2 text-[13px] tracking-[0.04em] text-ink-soft">
          {profile.nickname}, {profile.age} · {profile.branch} · {profile.year} year
        </p>
        {profile.spot !== null && (
          <p className="mt-1 text-[13px] tracking-[0.04em] text-ink-soft">spot #{profile.spot}</p>
        )}

        {primary ? (
          <div className="mt-8 overflow-hidden rounded-[24px] border border-line bg-paper-2">
            <div className="aspect-[3/4]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={primary.url}
                alt={`${profile.nickname} photo`}
                className="h-full w-full object-cover"
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
            </div>
          </div>
        ) : null}
        {rest.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-3">
            {rest.map((p) => (
              <div
                key={p.url}
                className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-line bg-paper-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        )}

        {profile.bio && <p className="mt-6 text-[14px] leading-7 text-ink">{profile.bio}</p>}
        {profile.interests && profile.interests.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {profile.interests.map((t) => (
              <span
                key={t}
                className="rounded-full border border-line bg-paper-2 px-3 py-1.5 text-[12px] text-ink-soft"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <p className="mt-8 text-center text-[11px] leading-4 text-ink-faint">
          matching opens at launch — for now, just names and faces.
        </p>
        <Link
          href="/search"
          className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-line bg-paper px-8 py-[14px] text-[12px] tracking-[0.14em] uppercase font-medium text-ink-soft transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          back to search
        </Link>
      </div>
    </div>
  );
}
