"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preparePhotoForUpload } from "@/lib/photos/compress";
import { perfLog, perfStart } from "@/lib/utils/perf";

export type QueuedStatus = "selected" | "optimizing" | "uploading" | "failed";

export type QueuedPhoto = {
  /** Client-only id. Never sent anywhere; never a file path. */
  localId: string;
  /** Browser-local object URL of the ORIGINAL file — instant preview. */
  previewUrl: string;
  file: File;
  status: QueuedStatus;
  error: string | null;
};

/**
 * Preview-first photo upload queue, shared by onboarding + profile edit.
 *
 * original File
 *   ├── local preview (URL.createObjectURL) → immediate UI, full quality
 *   └── compression (compress.ts) → optimized Blob → upload
 *
 * - The preview shows BEFORE compression/upload start and always renders the
 *   original selection (never the compressed output).
 * - Uploads run sequentially in the background so concurrent picks can't
 *   collide on server display_order — but the UI never blocks: picking,
 *   deleting, and reordering stay interactive throughout.
 * - One failure never stalls the queue; failed tiles offer retry/remove.
 * - `onUploaded` receives the server's authoritative photo list per success.
 */
export function usePhotoUploadQueue(opts: {
  endpoint: string;
  onUploaded: (photos: never[]) => void;
}) {
  const [items, setItems] = useState<QueuedPhoto[]>([]);
  const itemsRef = useRef<QueuedPhoto[]>([]);
  const activeRef = useRef(false);
  const seqRef = useRef(0);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const sync = useCallback(() => {
    setItems([...itemsRef.current]);
  }, []);

  const pump = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === "selected");
        if (!next) break;
        next.status = "optimizing";
        next.error = null;
        sync();
        // Client optimization only — the server re-validates type/size/count.
        const prepared = await preparePhotoForUpload(next.file);
        // The tile may have been removed while compressing.
        if (!itemsRef.current.some((i) => i.localId === next.localId)) continue;
        next.status = "uploading";
        sync();
        const t = perfStart();
        try {
          const fd = new FormData();
          fd.append("file", prepared.file);
          const res = await fetch(optsRef.current.endpoint, { method: "POST", body: fd });
          perfLog("photo.upload", t);
          const j = await res.json().catch(() => null);
          if (!res.ok) throw new Error((j as { error?: string } | null)?.error || "Upload failed");
          optsRef.current.onUploaded(((j as { photos?: never[] } | null)?.photos ?? []) as never[]);
          URL.revokeObjectURL(next.previewUrl);
          itemsRef.current = itemsRef.current.filter((i) => i.localId !== next.localId);
          sync();
        } catch (e: unknown) {
          if (!itemsRef.current.some((i) => i.localId === next.localId)) continue;
          next.status = "failed";
          next.error = e instanceof Error ? e.message : "Upload failed.";
          sync();
          // Continue with the next queued pick — one failure never stalls
          // the queue.
        }
      }
    } finally {
      activeRef.current = false;
    }
  }, [sync]);

  /** Show the preview immediately, then compress + upload in the background. */
  const enqueue = useCallback(
    (file: File) => {
      const t = perfStart();
      const previewUrl = URL.createObjectURL(file);
      perfLog("photo.preview", t);
      seqRef.current += 1;
      const localId = `local-${Date.now()}-${seqRef.current}`;
      itemsRef.current = [
        ...itemsRef.current,
        { localId, previewUrl, file, status: "selected", error: null },
      ];
      sync();
      void pump();
    },
    [pump, sync],
  );

  const retry = useCallback(
    (localId: string) => {
      const item = itemsRef.current.find((i) => i.localId === localId);
      if (!item || item.status !== "failed") return;
      item.status = "selected";
      item.error = null;
      sync();
      void pump();
    },
    [pump, sync],
  );

  const remove = useCallback(
    (localId: string) => {
      const item = itemsRef.current.find((i) => i.localId === localId);
      if (item) URL.revokeObjectURL(item.previewUrl);
      itemsRef.current = itemsRef.current.filter((i) => i.localId !== localId);
      sync();
    },
    [sync],
  );

  // Never leak object URLs if the page unmounts mid-upload.
  useEffect(() => {
    const ref = itemsRef;
    return () => {
      for (const item of ref.current) URL.revokeObjectURL(item.previewUrl);
      ref.current = [];
    };
  }, []);

  return { pending: items, enqueue, retry, removePending: remove };
}
