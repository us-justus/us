import Link from "next/link";
import { redirect } from "next/navigation";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { getLaunchState } from "@/lib/auth/launch";
import { getOwnProfile } from "@/lib/profile/queries";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const [session, launch] = await Promise.all([getProductSession(), getLaunchState()]);
  const guard = guardProductSession(session);
  if (guard) {
    redirect(guard);
  }
  // PRE_LAUNCH lock is intentionally NOT applied here: identity/account
  // pages stay accessible while Discover/Matches/Chat stay gated.
  // The back link returns home while pre-launch, /discover once launched.
  const homeHref = launch.launched ? "/discover" : "/";
  const homeLabel = launch.launched ? "back to discover" : "back home";
  const { profile, photos, error } = await getOwnProfile();

  // Authenticated but the profile query itself failed (DB/RLS/network) — this
  // is distinct from "no profile row" and must not show the onboarding CTA.
  if (error) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-10 sm:py-14">
          <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">your profile</p>
          <h1 className="mt-2 font-display text-[30px] tracking-[-0.03em] leading-none">couldn&apos;t load.</h1>
          <p className="mt-3 text-[13px] leading-6 text-ink-soft max-w-[38ch]">
            {error} Refresh to try again — your profile was not changed.
          </p>
          <Link
            href="/profile"
            className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[14px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            try again
          </Link>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-[560px] flex-1 px-6 sm:px-8 py-10 sm:py-14">
          <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">your profile</p>
          <h1 className="mt-2 font-display text-[30px] tracking-[-0.03em] leading-none">no profile yet.</h1>
          <p className="mt-3 text-[13px] leading-6 text-ink-soft max-w-[38ch]">
            Finish onboarding to create your profile.
          </p>
          <Link
            href="/onboarding/profile"
            className="mt-8 inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-8 py-[14px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            create profile
          </Link>
        </div>
      </div>
    );
  }

  const primary = photos[0];
  const rest = photos.slice(1);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-4 sm:px-8 py-8 sm:py-10">
        {/* header */}
        <div className="px-2 sm:px-0">
          <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">your profile</p>
          <div className="mt-3 flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-[30px] sm:text-[34px] tracking-[-0.03em] leading-none">
                {profile.nickname}, {profile.age}
              </h1>
              <p className="mt-2 text-[13px] tracking-[0.04em] text-ink-soft">
                {profile.branch} · {profile.year} year
              </p>
              {(profile.username || profile.spot !== null) && (
                <p className="mt-1.5 text-[13px] tracking-[0.04em] text-ink-soft">
                  {profile.username ? `@${profile.username}` : null}
                  {profile.username && profile.spot !== null ? " · " : null}
                  {profile.spot !== null ? `spot #${profile.spot}` : null}
                </p>
              )}
            </div>
            <Link
              href="/profile/edit"
              className="shrink-0 inline-flex min-h-[44px] items-center justify-center rounded-full border border-line bg-paper px-5 py-2.5 text-[11px] tracking-[0.14em] uppercase font-medium text-ink transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              edit profile
            </Link>
          </div>
        </div>

        {/* photos */}
        <div className="mt-8">
          {photos.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-line-strong bg-paper-2 px-6 py-10 text-center">
              <p className="text-[13px] text-ink-soft">No photos yet.</p>
              <Link
                href="/profile/edit"
                className="mt-3 inline-flex min-h-[44px] items-center rounded-full text-[11px] tracking-[0.12em] uppercase text-ink underline underline-offset-4 transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                add photos
              </Link>
            </div>
          ) : (
            <>
              <div className="relative overflow-hidden rounded-[28px] border border-line bg-paper-2">
                <div className="aspect-[3/4] sm:aspect-[4/5]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={primary.url}
                    alt={`${profile.nickname} primary photo`}
                    className="h-full w-full object-cover"
                    decoding="async"
                    loading="eager"
                    fetchPriority="high"
                  />
                </div>
                <span className="absolute left-3 top-3 rounded-full bg-paper/90 px-2.5 py-1 text-[10px] tracking-[0.14em] uppercase font-medium text-ink backdrop-blur">
                  primary
                </span>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[36%] bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                  <p className="font-display text-[22px] leading-none tracking-[-0.02em] text-white">
                    {profile.nickname}, {profile.age}
                  </p>
                  <p className="mt-1 text-[12px] tracking-wide text-white/80">
                    {profile.branch} · {profile.year} year
                  </p>
                </div>
              </div>

              {rest.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-3">
                  {rest.map((p) => (
                    <div
                      key={p.id}
                      className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-line bg-paper-2"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-3 text-center text-[11px] tracking-[0.08em] text-ink-faint">
                {photos.length} photo{photos.length !== 1 ? "s" : ""} · tap edit to manage
              </p>
            </>
          )}
        </div>

        {/* details */}
        <div className="mt-8 px-2 sm:px-0">
          <div className="h-px bg-line" />
          <div className="py-6 space-y-5">
            <div>
              <p className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">about</p>
              {profile.bio ? (
                <p className="mt-2 text-[14px] leading-6 text-ink">{profile.bio}</p>
              ) : (
                <p className="mt-2 text-[14px] leading-6 text-ink-faint">No bio yet — add a line or two about you.</p>
              )}
            </div>

            <div>
              <p className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">interests</p>
              {profile.interests && profile.interests.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {profile.interests.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-line bg-paper-2 px-3 py-1.5 text-[12px] text-ink-soft"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-ink-faint">No interests added.</p>
              )}
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] leading-6 text-ink-soft">
              <span className="inline-flex gap-2">
                <span className="text-ink-faint">nickname</span>
                <span className="text-ink">{profile.nickname}</span>
              </span>
              <span className="inline-flex gap-2">
                <span className="text-ink-faint">age</span>
                <span className="text-ink">{profile.age}</span>
              </span>
              <span className="inline-flex gap-2">
                <span className="text-ink-faint">year</span>
                <span className="text-ink">{profile.year}</span>
              </span>
              <span className="inline-flex gap-2">
                <span className="text-ink-faint">branch</span>
                <span className="text-ink">{profile.branch}</span>
              </span>
            </div>
          </div>
          <div className="h-px bg-line" />
        </div>

        <div className="mt-8 flex flex-col gap-3 px-2 sm:px-0">
          <Link
            href="/profile/edit"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full bg-ink px-8 py-[15px] text-[13px] tracking-[0.14em] uppercase font-medium text-paper hover:bg-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            edit profile
          </Link>
          <Link
            href={homeHref}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-line bg-paper px-8 py-[14px] text-[12px] tracking-[0.14em] uppercase font-medium text-ink-soft transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {homeLabel}
          </Link>
          <Link
            href="/settings"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-full py-2 text-[12px] tracking-[0.12em] uppercase text-ink-soft transition-colors hover:text-accent-deep hover:bg-accent-wash focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            account settings
          </Link>
          <p className="text-center text-[11px] leading-4 text-ink-faint">
            USN and email are never shown on your public profile.
          </p>
        </div>
      </div>
    </div>
  );
}
