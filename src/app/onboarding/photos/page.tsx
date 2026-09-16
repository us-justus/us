"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shell, FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import { MAX_PHOTOS, validatePhotoFile } from "@/lib/validation/profile";

type Photo = { id: string; storage_path: string; url: string };

export default function PhotosPage() {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { fetch("/api/onboarding/photos").then(r=>r.json()).then(j=>{ if(j.photos) setPhotos(j.photos); }); }, []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const err = validatePhotoFile(file);
    if (err) { setError(err); return; }
    if (photos.length >= MAX_PHOTOS) { setError(`Max ${MAX_PHOTOS} photos.`); return; }
    setUploading(true); setError(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/onboarding/photos", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed");
      setPhotos(j.photos);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Upload failed."); }
    finally { setUploading(false); e.target.value=""; }
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/onboarding/photos?id=${id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok) setError(j.error || "Failed");
    else setPhotos(j.photos);
  }

  return (
    <Shell title="add your photos." subtitle="At least one. Up to six. You can reorder and change them anytime." step="04 — photos">
      <div className="grid grid-cols-3 gap-3">
        {photos.map(p=> (
          <div key={p.id} className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-paper-2 border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="h-full w-full object-cover" />
            <button onClick={()=>remove(p.id)} className="absolute top-2 right-2 h-7 w-7 rounded-full bg-ink text-paper text-[12px]">×</button>
          </div>
        ))}
        {photos.length < MAX_PHOTOS && (
          <label className="aspect-[3/4] flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-paper-2 hover:bg-paper cursor-pointer text-ink-soft">
            <span className="text-[22px]">+</span><span className="text-[11px] tracking-[0.12em] uppercase">add</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} className="hidden" disabled={uploading} />
          </label>
        )}
      </div>
      {error && <div className="mt-4"><FieldError msg={error} /></div>}
      {uploading && <p className="mt-3 text-[12px] text-ink-soft">uploading…</p>}
      <p className="mt-4 text-[11px] text-ink-faint">{photos.length}/{MAX_PHOTOS} · JPG, PNG or WEBP · max 5 MB</p>
      <Button disabled={photos.length < 1} onClick={()=>router.push("/discover")} className="mt-6 w-full rounded-full">enter us →</Button>
    </Shell>
  );
}
