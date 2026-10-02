"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FieldError } from "@/components/onboarding/shell";
import { Button } from "@/components/ui/button";
import { MAX_PHOTOS, validatePhotoFile } from "@/lib/validation/profile";
import { usePhotoUploadQueue } from "@/lib/photos/use-photo-upload-queue";
import { PhotoCropDialog } from "@/components/photos/photo-crop-dialog";

type Photo = { id: string; storage_path: string; url: string };

export function PhotosForm() {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { pending, enqueueReady, retry, removePending } = usePhotoUploadQueue({
    endpoint: "/api/onboarding/photos",
    onUploaded: (next: Photo[]) => setPhotos(next),
  });
  // Files waiting to be framed. Each opens the crop editor in turn; nothing
  // uploads until the user confirms the crop and preview (SELECT → crop →
  // DONE → preview → upload). One at a time keeps mobile memory bounded.
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const activeCrop = cropQueue[0] ?? null;
  const occupied = photos.length + pending.length + cropQueue.length;
  const full = occupied >= MAX_PHOTOS;

  useEffect(() => { fetch("/api/onboarding/photos").then(r=>r.json()).then(j=>{ if(j.photos) setPhotos(j.photos); }); }, []);

  async function select(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    setError(null);
    let slots = MAX_PHOTOS - (photos.length + pending.length + cropQueue.length);
    const valid: File[] = [];
    for (const file of files) {
      if (slots <= 0) { setError(`Max ${MAX_PHOTOS} photos.`); break; }
      const err = validatePhotoFile(file);
      if (err) { setError(err); continue; }
      valid.push(file);
      slots -= 1;
    }
    if (valid.length) setCropQueue((q) => [...q, ...valid]);
  }

  function dropActiveCrop() {
    setCropQueue((q) => q.slice(1));
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/onboarding/photos?id=${id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok) setError(j.error || "Failed");
    else setPhotos(j.photos);
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {photos.map(p=> (
          <div key={p.id} className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-paper-2 border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            <button onClick={()=>remove(p.id)} aria-label="remove photo" className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-full bg-ink text-paper text-[16px] transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">×</button>
          </div>
        ))}
        {pending.map(q => (
          <div key={q.localId} className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-paper-2 border border-line">
            {/* Local preview of the PROCESSED photo — the exact bytes being
                uploaded. Visible immediately, before the upload finishes. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={q.previewUrl} alt="" className="h-full w-full object-cover" />
            <span className="absolute left-2 top-2 rounded-full border border-accent-soft bg-accent-wash/95 px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase font-medium text-accent-deep">
              {q.status === "failed" ? "failed" : q.status === "optimizing" ? "optimizing…" : q.status === "uploading" ? "uploading…" : "selected"}
            </span>
            {q.status === "failed" && (
              <span className="absolute inset-x-1.5 bottom-1.5 flex gap-1.5">
                <button onClick={() => retry(q.localId)} aria-label="retry upload" className="flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-ink text-paper text-[11px] tracking-[0.08em] uppercase transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">retry</button>
                <button onClick={() => removePending(q.localId)} aria-label="remove photo" className="flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-line bg-paper text-ink text-[11px] tracking-[0.08em] uppercase transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">remove</button>
              </span>
            )}
          </div>
        ))}
        {!full && (
          <label className="aspect-[3/4] flex min-h-[44px] flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-paper-2 cursor-pointer text-ink-soft transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            <span className="text-[22px]">+</span><span className="text-[11px] tracking-[0.12em] uppercase">add</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={select} className="hidden" />
          </label>
        )}
      </div>
      {error && <div className="mt-4"><FieldError msg={error} /></div>}
      {pending.filter(q => q.status === "failed").map(q => q.error).filter(Boolean)[0] && (
        <div className="mt-4"><FieldError msg={pending.find(q => q.status === "failed")?.error ?? "Upload failed."} /></div>
      )}
      <p className="mt-4 text-[11px] text-ink-faint">{photos.length}/{MAX_PHOTOS} · JPG, PNG or WEBP · max 5 MB</p>
      <Button disabled={photos.length < 1} onClick={()=>router.push("/discover")} className="mt-6 w-full rounded-full">enter us →</Button>
      {activeCrop && (
        <PhotoCropDialog
          key={`${activeCrop.name}-${activeCrop.size}-${activeCrop.lastModified}`}
          file={activeCrop}
          queueLabel={cropQueue.length > 1 ? `${cropQueue.length} to frame` : undefined}
          onCancel={dropActiveCrop}
          onConfirm={(processed) => {
            enqueueReady(processed);
            dropActiveCrop();
          }}
        />
      )}
    </>
  );
}
