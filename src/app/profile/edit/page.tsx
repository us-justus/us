/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/onboarding/shell";
import { useExistingSession } from "@/lib/auth/use-existing-session";
import { usePhotoUploadQueue } from "@/lib/photos/use-photo-upload-queue";
import {
  BRANCHES,
  YEARS,
  MAX_PHOTOS,
  validateNickname,
  validateAge,
  validateYear,
  validateBranch,
  validateBio,
  validatePhotoFile,
} from "@/lib/validation/profile";

type Photo = { id: string; storage_path: string; display_order: number; url: string };

export default function EditProfilePage() {
  const router = useRouter();
  // Protected product route: read-only session, NEVER creates one. A
  // logged-out visitor is sent to /login; an incomplete-onboarding session is
  // sent to its /onboarding/* step (resolved server-side, single source).
  const { status: sessionStatus, user: sessionUser, refresh: refreshSession } = useExistingSession();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  const [nickname, setNickname] = useState("");
  const [age, setAge] = useState("");
  const [year, setYear] = useState("");
  const [branch, setBranch] = useState("");
  const [bio, setBio] = useState("");
  const [interests, setInterests] = useState("");

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Preview-first uploads: the original selection renders instantly as a
  // local tile; compression + upload run sequentially in the background so
  // the page (save, delete, reorder) never blocks on network.
  const { pending, enqueue, retry, removePending } = usePhotoUploadQueue({
    endpoint: "/api/profile/photos",
    onUploaded: (next: Photo[]) => setPhotos(next),
  });
  const [reordering, setReordering] = useState(false);

  const [initial, setInitial] = useState<Record<string, string> | null>(null);

  const dirty =
    initial !== null &&
    (nickname !== initial.nickname ||
      age !== initial.age ||
      year !== initial.year ||
      branch !== initial.branch ||
      bio !== initial.bio ||
      interests !== initial.interests);

  const fetchProfile = useCallback(async () => {
    // Never fetch before the session is restored — the API authenticates via
    // cookies, so fetching early would 401 and could not distinguish
    // "no session yet" from "no profile". Never auto-creates a profile.
    // Product guard: logged-out → /login, incomplete onboarding → its step.
    if (sessionStatus !== "ready") return;
    if (!sessionUser) {
      router.replace("/login");
      return;
    }
    try {
      const st = await fetch("/api/account/state", { cache: "no-store" });
      const sj = await st.json().catch(() => null);
      if (!sj?.signedIn) {
        router.replace("/login");
        return;
      }
      if (sj.onboardingStep !== "complete" && typeof sj.next === "string") {
        router.replace(sj.next);
        return;
      }
    } catch {
      // If the state check itself fails, fall through to the profile fetch —
      // the API 401s safely and the error state below handles it.
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("We couldn't start your session. Please try again.");
      if (!res.ok) throw new Error(j.error || "Failed to load profile");
      if (!j.profile) {
        router.replace("/onboarding/profile");
        return;
      }
      const p = j.profile as { nickname: string; age: number; year: string; branch: string; bio: string | null; interests: string[] };
      setNickname(p.nickname);
      setAge(String(p.age));
      setYear(p.year);
      setBranch(p.branch);
      setBio(p.bio ?? "");
      setInterests((p.interests ?? []).join(", "));
      setPhotos(j.photos ?? []);
      setInitial({
        nickname: p.nickname,
        age: String(p.age),
        year: p.year,
        branch: p.branch,
        bio: p.bio ?? "",
        interests: (p.interests ?? []).join(", "),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, [router, sessionStatus, sessionUser]);

  useEffect(() => {
    if (sessionStatus === "signed-out") router.replace("/login");
    else if (sessionStatus === "ready") void fetchProfile();
  }, [sessionStatus, fetchProfile, router]);

  // Warn about unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function save() {
    const fe: Record<string, string> = {};
    const nErr = validateNickname(nickname);
    if (nErr) fe.nickname = nErr;
    const aNum = parseInt(age, 10);
    const aErr = validateAge(aNum);
    if (aErr) fe.age = aErr;
    const yErr = validateYear(year);
    if (yErr) fe.year = yErr;
    const bErr = validateBranch(branch);
    if (bErr) fe.branch = bErr;
    const bioErr = validateBio(bio);
    if (bioErr) fe.bio = bioErr;
    setFieldErr(fe);
    if (Object.keys(fe).length) return;

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nickname.trim(),
          age: aNum,
          year,
          branch,
          bio: bio.trim() || null,
          interests: interests
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 8),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.field) setFieldErr((prev) => ({ ...prev, [j.field]: j.error }));
        throw new Error(j.error || "Could not save.");
      }
      setSuccess(true);
      setInitial({
        nickname: nickname.trim(),
        age: String(aNum),
        year,
        branch,
        bio: bio.trim(),
        interests: interests
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(", "),
      });
      // slight delay to show success then navigate back
      setTimeout(() => router.push("/profile"), 700);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function selectPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    let slots = MAX_PHOTOS - (photos.length + pending.length);
    for (const file of files) {
      if (slots <= 0) {
        setPhotoError(`Max ${MAX_PHOTOS} photos.`);
        break;
      }
      const err = validatePhotoFile(file);
      if (err) {
        setPhotoError(err);
        continue;
      }
      setPhotoError(null);
      enqueue(file);
      slots -= 1;
    }
  }

  async function remove(id: string) {
    setPhotoError(null);
    try {
      const res = await fetch(`/api/profile/photos?id=${id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setPhotos(j.photos);
    } catch (err: unknown) {
      setPhotoError(err instanceof Error ? err.message : "Failed to delete.");
    }
  }

  async function reorder(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= photos.length) return;
    const next = [...photos];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const orderedIds = next.map((p) => p.id);
    setReordering(true);
    setPhotoError(null);
    // optimistic update
    setPhotos(next);
    try {
      const res = await fetch("/api/profile/photos/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not reorder");
      setPhotos(j.photos);
    } catch (err: unknown) {
      setPhotoError(err instanceof Error ? err.message : "Could not reorder");
      // refetch to revert
      fetchProfile();
    } finally {
      setReordering(false);
    }
  }

  if (sessionStatus === "signed-out") {
    return (
      <div className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10">
          <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">edit profile</p>
          <p className="mt-6 text-[13px] text-ink-soft">You&apos;re signed out. Sign in to edit your profile.</p>
          <Button onClick={() => router.replace("/login")} className="mt-6 w-full rounded-full">
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  if (sessionStatus !== "ready" || loading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10">
          <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">edit profile</p>
          <p className="mt-6 text-[13px] text-ink-soft">
            {sessionStatus !== "ready" ? "checking your session…" : "loading your profile…"}
          </p>
        </div>
      </div>
    );
  }

  if (error && initial === null) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10">
          <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">edit profile</p>
          <div className="mt-6">
            <FieldError msg={error} />
          </div>
          <Button
            onClick={() => {
              // Re-restores the existing session (never mints a second one);
              // the effect above refetches once the session is ready.
              void refreshSession();
            }}
            className="mt-6 w-full rounded-full"
          >
            Try again
          </Button>
          <Link
            href="/profile"
            className="mt-3 flex w-full justify-center rounded-full border border-line bg-paper px-8 py-[14px] text-[12px] tracking-[0.14em] uppercase font-medium text-ink-soft hover:bg-paper-2 transition-colors"
          >
            back to profile
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[560px] flex-1 px-4 sm:px-8 py-8 sm:py-10">
        <div className="px-2 sm:px-0">
          <Link
            href="/profile"
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full text-[11px] tracking-[0.14em] uppercase text-ink-faint transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ← back to profile
          </Link>
          <p className="mt-6 text-[11px] tracking-[0.18em] uppercase text-ink-faint">edit profile</p>
          <h1 className="mt-2 font-display text-[28px] sm:text-[32px] tracking-[-0.03em] leading-none">make it you.</h1>
          <p className="mt-3 text-[13px] leading-6 text-ink-soft max-w-[38ch]">
            Your USN is never editable here and never shown publicly.
          </p>
        </div>

        {/* Photos */}
        <div className="mt-8 px-2 sm:px-0">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">photos</h2>
            <span className="text-[11px] text-ink-faint">
              {photos.length}/{MAX_PHOTOS}
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-4 text-ink-faint">
            First photo is your primary. Drag with arrows to reorder.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {photos.map((p, idx) => (
              <div
                key={p.id}
                className="group relative flex flex-col"
              >
                <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-line bg-paper-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`photo ${idx + 1}`} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  {idx === 0 && (
                    <span className="absolute left-2 top-2 rounded-full bg-paper/90 px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-medium text-ink backdrop-blur">
                      primary
                    </span>
                  )}
                  <button
                    onClick={() => remove(p.id)}
                    aria-label="delete photo"
                    className="absolute right-1.5 top-1.5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-ink text-paper text-[16px] leading-none transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-1.5">
                  <button
                    onClick={() => reorder(idx, idx - 1)}
                    disabled={idx === 0 || reordering}
                    className="flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-line bg-paper text-[13px] tracking-wide text-ink disabled:opacity-40 disabled:pointer-events-none transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    aria-label="move left"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => reorder(idx, idx + 1)}
                    disabled={idx === photos.length - 1 || reordering}
                    className="flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-line bg-paper text-[13px] tracking-wide text-ink disabled:opacity-40 disabled:pointer-events-none transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    aria-label="move right"
                  >
                    →
                  </button>
                </div>
                <span className="mt-1 text-center text-[10px] tracking-[0.08em] text-ink-faint">
                  {idx === 0 ? "primary" : `#${idx + 1}`}
                </span>
              </div>
            ))}

            {pending.map((q) => (
              <div key={q.localId} className="group relative flex flex-col">
                <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-line bg-paper-2">
                  {/* Local preview of the ORIGINAL selection — instant, full
                      quality, before compression/upload finish. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={q.previewUrl} alt="upload preview" className="h-full w-full object-cover" />
                  <span className="absolute left-2 top-2 rounded-full border border-accent-soft bg-accent-wash/95 px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-medium text-accent-deep">
                    {q.status === "failed" ? "failed" : q.status === "optimizing" ? "optimizing…" : q.status === "uploading" ? "uploading…" : "selected"}
                  </span>
                  {q.status === "failed" ? (
                    <span className="absolute inset-x-1.5 bottom-1.5 flex gap-1.5">
                      <button
                        onClick={() => retry(q.localId)}
                        aria-label="retry upload"
                        className="flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-ink text-paper text-[11px] tracking-[0.08em] uppercase transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        retry
                      </button>
                      <button
                        onClick={() => removePending(q.localId)}
                        aria-label="remove photo"
                        className="flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-line bg-paper text-ink text-[11px] tracking-[0.08em] uppercase transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        remove
                      </button>
                    </span>
                  ) : (
                      <button
                      onClick={() => removePending(q.localId)}
                      aria-label="cancel upload"
                      className="absolute right-1.5 top-1.5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-ink text-paper text-[16px] leading-none transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      ×
                    </button>
                  )}
                </div>
                <span className="mt-1 text-center text-[10px] tracking-[0.08em] text-ink-faint">
                  {q.status === "failed" ? (q.error ?? "failed") : q.status === "selected" ? "queued" : q.status === "optimizing" ? "optimizing" : "uploading"}
                </span>
              </div>
            ))}

            {photos.length + pending.length < MAX_PHOTOS && (
              <label className="flex aspect-[3/4] min-h-[140px] flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-paper-2 cursor-pointer text-ink-soft transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
                <span className="text-[22px] leading-none">+</span>
                <span className="mt-1 text-[11px] tracking-[0.12em] uppercase">add</span>
                <span className="mt-1 text-[10px] text-ink-faint">JPG/PNG/WEBP</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={selectPhotos}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {photoError && (
            <div className="mt-3">
              <FieldError msg={photoError} />
            </div>
          )}
          {reordering && <p className="mt-2 text-[11px] text-ink-faint">reordering…</p>}
          <p className="mt-3 text-[11px] leading-4 text-ink-faint">
            Tip: use ← → to reorder. Primary photo appears first in discover.
          </p>
        </div>

        <div className="mt-10 h-px bg-line mx-2 sm:mx-0" />

        {/* Fields */}
        <div className="mt-8 space-y-5 px-2 sm:px-0">
          <div>
            <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">nickname</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="what should we call you?"
              className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
            {fieldErr.nickname && <FieldError msg={fieldErr.nickname} />}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">age</label>
              <input
                value={age}
                onChange={(e) => setAge(e.target.value)}
                inputMode="numeric"
                placeholder="20"
                className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
              />
              {fieldErr.age && <FieldError msg={fieldErr.age} />}
            </div>
            <div>
              <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">year</label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft"
              >
                <option value="">select</option>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y} year
                  </option>
                ))}
              </select>
              {fieldErr.year && <FieldError msg={fieldErr.year} />}
            </div>
          </div>

          <div>
            <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">branch</label>
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft"
            >
              <option value="">select</option>
              {BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            {fieldErr.branch && <FieldError msg={fieldErr.branch} />}
          </div>

          <div>
            <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
              bio <span className="normal-case tracking-normal lowercase text-ink-faint">— optional</span>
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              placeholder="a line or two about you"
              className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft resize-none"
            />
            <div className="mt-1 flex justify-between">
              <div>{fieldErr.bio && <FieldError msg={fieldErr.bio} />}</div>
              <span className="text-[11px] text-ink-faint">{bio.length}/300</span>
            </div>
          </div>

          <div>
            <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
              interests <span className="normal-case tracking-normal lowercase text-ink-faint">— comma separated</span>
            </label>
            <input
              value={interests}
              onChange={(e) => setInterests(e.target.value)}
              placeholder="music, football, books"
              className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
            <p className="mt-1 text-[11px] text-ink-faint">up to 8 · shown as pills on your profile</p>
          </div>

          {error && (
            <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
              <p className="text-[13px] text-accent-deep">{error}</p>
            </div>
          )}

          {success && (
            <div className="rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
              <p className="text-[13px] text-accent-deep">saved — returning to profile…</p>
            </div>
          )}

          <div className="pt-2">
            <Button onClick={save} disabled={saving} className="w-full rounded-full">
              {saving ? "saving…" : success ? "saved ✓" : "save changes"}
            </Button>
            <Link
              href="/profile"
              className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-full border border-line bg-paper px-8 py-[14px] text-[12px] tracking-[0.14em] uppercase font-medium text-ink-soft transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              cancel
            </Link>
            {dirty && !saving && <p className="mt-3 text-center text-[11px] text-ink-faint">you have unsaved changes</p>}
          </div>

          <p className="pb-4 text-center text-[11px] leading-4 text-ink-faint">
            USN and verification details cannot be changed here.
          </p>
        </div>
      </div>
    </div>
  );
}
