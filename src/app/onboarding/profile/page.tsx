"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shell, FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import { BRANCHES, YEARS, validateNickname, validateAge, validateYear, validateBranch, validateBio } from "@/lib/validation/profile";

export default function ProfilePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [age, setAge] = useState("");
  const [year, setYear] = useState("");
  const [branch, setBranch] = useState("");
  const [bio, setBio] = useState("");
  const [interests, setInterests] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(false);

  async function submit() {
    const fe: Record<string,string> = {};
    const nErr = validateNickname(nickname); if (nErr) fe.nickname = nErr;
    const aNum = parseInt(age,10);
    const aErr = validateAge(aNum); if (aErr) fe.age = aErr;
    const yErr = validateYear(year); if (yErr) fe.year = yErr;
    const bErr = validateBranch(branch); if (bErr) fe.branch = bErr;
    const bioErr = validateBio(bio); if (bioErr) fe.bio = bioErr;
    if (!agreed) fe.agreed = "Confirm you're 18 or older.";
    setFieldErr(fe);
    if (Object.keys(fe).length) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/onboarding/profile", { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify({ nickname: nickname.trim(), age: aNum, year, branch, bio: bio.trim() || null, interests: interests.split(",").map(s=>s.trim()).filter(Boolean).slice(0,8) }) });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      router.push("/onboarding/photos");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Try again."); } finally { setLoading(false); }
  }

  return (
    <Shell title="create your profile." subtitle="This is what people will see. Keep it honest, keep it you." step="03 — profile">
      <div className="space-y-5">
        <div><label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">nickname</label>
          <input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="what should we call you?" className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint" />
          {fieldErr.nickname && <FieldError msg={fieldErr.nickname} />}</div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">age</label>
            <input value={age} onChange={e=>setAge(e.target.value)} inputMode="numeric" placeholder="20" className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint" />
            {fieldErr.age && <FieldError msg={fieldErr.age} />}</div>
          <div><label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">year</label>
            <select value={year} onChange={e=>setYear(e.target.value)} className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint">
              <option value="">select</option>{YEARS.map(y=><option key={y} value={y}>{y} year</option>)}
            </select>{fieldErr.year && <FieldError msg={fieldErr.year} />}</div>
        </div>
        <div><label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">branch</label>
          <select value={branch} onChange={e=>setBranch(e.target.value)} className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[15px] outline-none focus:border-ink-faint">
            <option value="">select</option>{BRANCHES.map(b=><option key={b} value={b}>{b}</option>)}
          </select>{fieldErr.branch && <FieldError msg={fieldErr.branch} />}</div>
        <div><label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">bio <span className="normal-case tracking-normal lowercase text-ink-faint">— optional</span></label>
          <textarea value={bio} onChange={e=>setBio(e.target.value)} rows={3} placeholder="a line or two about you" className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[14px] outline-none focus:border-ink-faint resize-none" />
          {fieldErr.bio && <FieldError msg={fieldErr.bio} />}</div>
        <div><label className="text-[11px] tracking-[0.14em] uppercase text-ink-faint">interests <span className="normal-case tracking-normal lowercase text-ink-faint">— comma separated</span></label>
          <input value={interests} onChange={e=>setInterests(e.target.value)} placeholder="music, football, books" className="mt-2 w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-[14px] outline-none focus:border-ink-faint" /></div>
        <label className="flex gap-3 items-start text-[13px] leading-5 text-ink-soft">
          <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} className="mt-1 accent-ink" />
          I confirm I am 18 years or older.
        </label>
        {fieldErr.agreed && <FieldError msg={fieldErr.agreed} />}
        {error && <FieldError msg={error} />}
        <Button onClick={submit} disabled={loading} className="w-full rounded-full">{loading ? "saving…" : "continue"}</Button>
      </div>
    </Shell>
  );
}
