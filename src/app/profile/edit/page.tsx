/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/onboarding/shell";
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
  const [uploading, setUploading] = useState(false);
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
    setLoading(true);
    try {
      const res = await fetch("/api/profile", { cache: "no-store" });
      const j = await res.json();
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
  }, [router]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

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

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validatePhotoFile(file);
    if (err) {
      setPhotoError(err);
      e.target.value = "";
      return;
    }
    if (photos.length >= MAX_PHOTOS) {
      setPhotoError(`Max ${MAX_PHOTOS} photos.`);
      e.target.value = "";
      return;
    }
    setUploading(true);
    setPhotoError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/profile/photos", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed");
      setPhotos(j.photos);
    } catch (err: unknown) {
      setPhotoError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      e.target.value = "";
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

  if (loading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-[560px] px-6 sm:px-8 py-10">
          <p className="text-[11px] tracking-[0.18em] uppercase text-ink-faint">edit profile</p>
          <p className="mt-6 text-[13px] text-ink-soft">loading your profile…</p>
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
            className="inline-flex items-center gap-1 text-[11px] tracking-[0.14em] uppercase text-ink-faint hover:text-ink-soft transition-colors"
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
                  <img src={p.url} alt={`photo ${idx + 1}`} className="h-full w-full object-cover" />
                  {idx === 0 && (
                    <span className="absolute left-2 top-2 rounded-full bg-paper/90 px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-medium text-ink backdrop-blur">
                      primary
                    </span>
                  )}
                  <button
                    onClick={() => remove(p.id)}
                    aria-label="delete photo"
                    className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink text-paper text-[16px] leading-none hover:bg-black transition-colors"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-1.5">
                  <button
                    onClick={() => reorder(idx, idx - 1)}
                    disabled={idx === 0 || reordering}
                    className="flex h-8 flex-1 items-center justify-center rounded-full border border-line bg-paper text-[13px] tracking-wide text-ink disabled:opacity-40 disabled:pointer-events-none hover:bg-paper-2 transition-colors"
                    aria-label="move left"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => reorder(idx, idx + 1)}
                    disabled={idx === photos.length - 1 || reordering}
                    className="flex h-8 flex-1 items-center justify-center rounded-full border border-line bg-paper text-[13px] tracking-wide text-ink disabled:opacity-40 disabled:pointer-events-none hover:bg-paper-2 transition-colors"
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

            {photos.length < MAX_PHOTOS && (
              <label className="flex aspect-[3/4] flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-paper-2 hover:bg-paper cursor-pointer text-ink-soft transition-colors min-h-[140px]">
                <span className="text-[22px] leading-none">+</span>
                <span className="mt-1 text-[11px] tracking-[0.12em] uppercase">add</span>
                <span className="mt-1 text-[10px] text-ink-faint">{uploading ? "uploading…" : "JPG/PNG/WEBP"}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={upload}
                  className="hidden"
                  disabled={uploading}
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
              className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint placeholder:text-ink-faint"
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
                className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint"
              />
              {fieldErr.age && <FieldError msg={fieldErr.age} />}
            </div>
            <div>
              <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">year</label>
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint"
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
              className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint"
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
              className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[14px] outline-none focus:border-ink-faint resize-none"
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
              className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[14px] outline-none focus:border-ink-faint"
            />
            <p className="mt-1 text-[11px] text-ink-faint">up to 8 · shown as pills on your profile</p>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-[13px] text-[#a63d2f]">{error}</p>
            </div>
          )}

          {success && (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
              <p className="text-[13px] text-green-800">saved — returning to profile…</p>
            </div>
          )}

          <div className="pt-2">
            <Button onClick={save} disabled={saving || uploading} className="w-full rounded-full">
              {saving ? "saving…" : success ? "saved ✓" : "save changes"}
            </Button>
            <Link
              href="/profile"
              className="mt-3 flex w-full justify-center rounded-full border border-line bg-paper px-8 py-[14px] text-[12px] tracking-[0.14em] uppercase font-medium text-ink-soft hover:bg-paper-2 transition-colors"
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
