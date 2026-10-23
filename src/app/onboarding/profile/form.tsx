
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import {
  BRANCHES,
  YEARS,
  GENDERS,
  validateNickname,
  validateAge,
  validateYear,
  validateBranch,
  validateGender,
  validateBio,
} from "@/lib/validation/profile";
import { validateUsername } from "@/lib/validation/username";

export function ProfileForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [usernameLocked, setUsernameLocked] = useState(false);
  const [nickname, setNickname] = useState("");
  const [age, setAge] = useState("");
  const [year, setYear] = useState("");
  const [branch, setBranch] = useState("");
  const [gender, setGender] = useState("");
  const [bio, setBio] = useState("");
  const [interests, setInterests] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Prefill an existing profile without creating one.
  useEffect(() => {
    fetch("/api/profile", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: unknown) => {
        const p = (j as { profile?: unknown } | null)?.profile as
          | {
              nickname?: unknown;
              age?: unknown;
              year?: unknown;
              branch?: unknown;
              gender?: unknown;
              bio?: unknown;
              interests?: unknown;
              username?: unknown;
            }
          | undefined;

        if (!p) return;

        if (typeof p.nickname === "string" && p.nickname) {
          setNickname(p.nickname);
        }
        if (typeof p.age === "number") setAge(String(p.age));
        if (typeof p.year === "string") setYear(p.year);
        if (typeof p.branch === "string") setBranch(p.branch);
        if (typeof p.gender === "string") setGender(p.gender);
        if (typeof p.bio === "string") setBio(p.bio);

        if (Array.isArray(p.interests)) {
          setInterests((p.interests as unknown[]).join(", "));
        }

        if (typeof p.username === "string" && p.username) {
          setUsername(p.username);
          setUsernameLocked(true);
        }
      })
      .catch(() => {});
  }, []);

  async function submit() {
    const fe: Record<string, string> = {};

    const uErr = validateUsername(username);
    if (uErr) fe.username = uErr;

    const nErr = validateNickname(nickname);
    if (nErr) fe.nickname = nErr;

    const aNum = parseInt(age, 10);
    const aErr = validateAge(aNum);
    if (aErr) fe.age = aErr;

    const yErr = validateYear(year);
    if (yErr) fe.year = yErr;

    const bErr = validateBranch(branch);
    if (bErr) fe.branch = bErr;

    const gErr = validateGender(gender);
    if (gErr) fe.gender = gErr;

    const bioErr = validateBio(bio);
    if (bioErr) fe.bio = bioErr;

    if (!agreed) fe.agreed = "Confirm you're 18 or older.";

    setFieldErr(fe);
    if (Object.keys(fe).length) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/onboarding/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          nickname: nickname.trim(),
          age: aNum,
          year,
          branch,
          gender,
          bio: bio.trim() || null,
          interests: interests
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 8),
        }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: unknown;
          field?: unknown;
        } | null;

        const errMsg: unknown = j?.error;
        const msg =
          typeof errMsg === "string" && errMsg ? errMsg : "Failed";
        const field: unknown = j?.field;

        if (typeof field === "string" && field) {
          setFieldErr((prev) => ({ ...prev, [field]: msg }));
        }

        throw new Error(msg);
      }

      router.push("/onboarding/photos");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
          username
        </label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={usernameLocked}
          placeholder="your_unique_name"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:opacity-60"
        />
        <p className="mt-1 text-[11px] leading-4 text-ink-faint">
          3-30 characters; letters, numbers, and _. Permanent once set - your
          spot stays yours.
        </p>
        {fieldErr.username && <FieldError msg={fieldErr.username} />}
      </div>

      <div>
        <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
          nickname
        </label>
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
          <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
            age
          </label>
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
          <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
            year
          </label>
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
        <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
          branch
        </label>
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
          gender
        </label>
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          required
          aria-invalid={Boolean(fieldErr.gender)}
          aria-describedby={fieldErr.gender ? "gender-error" : undefined}
          className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent-soft"
        >
          <option value="">select</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        {fieldErr.gender && (
          <div id="gender-error">
            <FieldError msg={fieldErr.gender} />
          </div>
        )}
      </div>

      <div>
        <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
          bio{" "}
          <span className="normal-case tracking-normal lowercase text-ink-faint">
            - optional
          </span>
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          placeholder="a line or two about you"
          className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft resize-none"
        />
        {fieldErr.bio && <FieldError msg={fieldErr.bio} />}
      </div>

      <div>
        <label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">
          interests{" "}
          <span className="normal-case tracking-normal lowercase text-ink-faint">
            - comma separated
          </span>
        </label>
        <input
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          placeholder="music, football, books"
          className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
      </div>

      <label className="flex gap-3 items-start text-[13px] leading-5 text-ink-soft">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1 accent-accent"
        />
        I confirm I am 18 years or older.
      </label>

      {fieldErr.agreed && <FieldError msg={fieldErr.agreed} />}
      {error && <FieldError msg={error} />}

      <Button
        onClick={submit}
        disabled={loading}
        className="w-full rounded-full"
      >
        {loading ? "Saving..." : "continue"}
      </Button>
    </div>
  );
}
