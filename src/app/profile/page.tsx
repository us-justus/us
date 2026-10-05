import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfilePhotoCarousel } from "@/components/profile/profile-photo-carousel";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { getOwnProfile } from "@/lib/profile/queries";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getProductSession();
  const guard = guardProductSession(session);
  if (guard) redirect(guard);
  const { profile, photos, error } = await getOwnProfile(session.user);

  if (error || !profile) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-[560px] flex-1 px-6 py-10 sm:px-8 sm:py-14">
          <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">your profile</p>
          <h1 className="mt-2 font-display text-[30px] tracking-[-0.03em] leading-none">{error ? "couldn't load." : "no profile yet."}</h1>
          {error ? <p className="mt-3 text-[13px] leading-6 text-ink-soft">{error} Refresh to try again.</p> : <Link href="/onboarding/profile" className="mt-6 inline-flex min-h-[44px] items-center rounded-full bg-ink px-6 text-paper">create profile</Link>}
          {error && <Link href="/profile" className="mt-6 inline-flex min-h-[44px] items-center rounded-full bg-ink px-6 text-paper">try again</Link>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-[560px] flex-1 px-4 py-8 sm:px-8 sm:py-10">
        <div className="flex items-start justify-between gap-4 px-2 sm:px-0">
          <div>
            <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">your profile</p>
            <h1 className="mt-3 font-display text-[30px] leading-none tracking-[-0.03em] sm:text-[34px]">{profile.nickname}, {profile.age}</h1>
            {(profile.username || profile.spot !== null) && <p className="mt-2 text-[13px] tracking-[0.04em] text-ink-soft">{profile.username ? `@${profile.username}` : null}{profile.username && profile.spot !== null ? " · " : null}{profile.spot !== null ? `spot #${profile.spot}` : null}</p>}
            <p className="mt-1 text-[13px] tracking-[0.04em] text-ink-soft">{profile.branch} · {profile.year} year</p>
          </div>
        </div>

        <div className="mt-7">
          {photos.length ? <ProfilePhotoCarousel photos={photos} name={profile.nickname} /> : (
            <div className="flex aspect-[3/4] items-center justify-center rounded-[28px] border border-line bg-paper-2" aria-label="Profile photo not added yet" />
          )}
        </div>

        <div className="mt-8 space-y-7 px-2 sm:px-0">
          <section>
            <h2 className="text-[11px] tracking-[0.16em] uppercase text-ink-faint">about</h2>
            {profile.bio ? <p className="mt-2 text-[14px] leading-6 text-ink">{profile.bio}</p> : <p className="mt-2 text-[14px] leading-6 text-ink-faint">Add a little about you.</p>}
          </section>
          <section>
            <h2 className="text-[11px] tracking-[0.16em] uppercase text-ink-faint">interests</h2>
            {profile.interests?.length ? <div className="mt-2 flex flex-wrap gap-2">{profile.interests.map((interest) => <span key={interest} className="rounded-full border border-line bg-paper-2 px-3 py-1.5 text-[12px] text-ink-soft">{interest}</span>)}</div> : <p className="mt-2 text-[13px] text-ink-faint">Add your interests.</p>}
          </section>
        </div>

      </main>
    </div>
  );
}
