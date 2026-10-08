"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { preparePhotoForUpload } from "@/lib/photos/compress";
import { perfLog, perfStart } from "@/lib/utils/perf";

export type QueuedStatus = "selected" | "optimizing" | "uploading" | "failed";

export type QueuedPhoto = {
  /** Client-only id. Never sent anywhere; never a file path. */
  localId: string;
  /** Browser-local object URL — instant preview. */
  previewUrl: string;
  file: File;
  status: QueuedStatus;
  error: string | null;
  /**
   * True when the file already went through the crop → resize → encode
   * pipeline (PhotoCropDialog). The queue uploads it directly instead of
   * re-encoding a second time (which would only add generation loss).
   */
  preprocessed: boolean;
};

/**
 * Preview-first photo upload queue, shared by onboarding + profile edit.
 *
 * Cropped flow (MVP-1): the crop dialog processes the image (crop → resize
 * → high-quality encode) BEFORE upload, shows a true preview of the exact
 * bytes, and hands the result to `enqueueReady` — uploaded directly with no
 * second encode pass.
 *
 * - The preview shows BEFORE upload starts and always renders the exact
 *   bytes that will be uploaded (never the unprocessed original).
 * - Uploads run sequentially in the background so concurrent picks can't
 *   collide on server display_order — but the UI never blocks: picking,
 *   deleting, and reordering stay interactive throughout.
 * - One failure never stalls the queue; failed tiles offer retry/remove.
 * - `onUploaded` receives the server's authoritative photo list per success.
 */
export function usePhotoUploadQueue(opts: {
  endpoint: string;
  onUploaded: (photos: never[]) => void;
  /**
   * Optional server-owned completion state. The onboarding photos endpoint
   * reports the permanent-spot outcome alongside the photo list
   * ({spot, spotPending}); when present it is forwarded here so the page
   * can reflect pending finalization without a new UX step. Endpoints that
   * never finalize (profile edit) simply omit this callback.
   */
  onSpotState?: (s: { spot: number | null; spotPending: boolean }) => void;
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
        // Preprocessed files (crop dialog output) upload directly — a
        // second encode would only add generation loss. Anything else goes
        // through client optimization; the server re-validates regardless.
        const prepared = next.preprocessed
          ? {
              file: next.file,
              originalBytes: next.file.size,
              processedBytes: next.file.size,
              compressionMs: 0,
              resized: true,
              passthrough: false,
            }
          : await preparePhotoForUpload(next.file);
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
          // Forward completion state when the endpoint reports it (onboarding
          // photos: spot minted at the completion boundary, or pending when
          // finalization must be retried by re-entry). Never blocks uploads.
          if (j && typeof j === "object" && ("spot" in j || "spotPending" in j)) {
            const jj = j as { spot?: unknown; spotPending?: unknown };
            optsRef.current.onSpotState?.({
              spot: typeof jj.spot === "number" ? jj.spot : null,
              spotPending: jj.spotPending === true,
            });
          }
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
        { localId, previewUrl, file, status: "selected", error: null, preprocessed: false },
      ];
      sync();
      void pump();
    },
    [pump, sync],
  );

  /**
   * Enqueue an already-processed file (crop dialog output). The preview is
   * the exact upload bytes; the queue skips optimization and uploads
   * directly. Sequential pumping still applies (no display_order races).
   */
  const enqueueReady = useCallback(
    (file: File) => {
      seqRef.current += 1;
      const localId = `local-${Date.now()}-${seqRef.current}`;
      itemsRef.current = [
        ...itemsRef.current,
        {
          localId,
          previewUrl: URL.createObjectURL(file),
          file,
          status: "selected",
          error: null,
          preprocessed: true,
        },
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

  return { pending: items, enqueue, enqueueReady, retry, removePending: remove };
}
