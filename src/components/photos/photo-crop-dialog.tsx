"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { renderCroppedPhoto } from "@/lib/photos/process";

const MIN_SCALE = 1;
const MAX_SCALE = 3;

type Stage = "crop" | "processing" | "preview" | "error";

/**
 * Lightweight 3:4 crop editor shared by onboarding + profile edit.
 * Browser-native only: <img> + pointer events + Canvas (via process.ts).
 * No animation libraries, no transitions — reduced-motion safe by
 * construction. No upload happens here; the parent uploads only after
 * `onConfirm` fires with the processed File.
 */
export function PhotoCropDialog({
  file,
  queueLabel,
  onCancel,
  onConfirm,
}: {
  file: File;
  queueLabel?: string;
  onCancel: () => void;
  onConfirm: (processed: File) => void;
}) {
  const [srcUrl, setSrcUrl] = useState<string | null>(null);

  // Blob URL lifecycle (STEP 1–3): the display URL is created inside an
  // effect — never during render — and revoked only when the file changes or
  // the dialog unmounts, so it stays alive for the entire crop session.
  //
  // Why not useMemo: under React StrictMode (Next `next dev`), mount effects
  // run setup → cleanup → setup while useMemo is NOT recomputed. A
  // memo-created URL would be revoked by the simulated-unmount cleanup and
  // then reused dead, so <img> gets a revoked blob: URL → onError →
  // "We couldn't read that photo." Effect-created URLs are re-created after
  // the remount, so the final URL is always live.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[photo-crop] selected file", {
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        isFile: file instanceof File,
      });
    }
    const url = URL.createObjectURL(file);
    if (process.env.NODE_ENV !== "production") {
      console.log("[photo-crop] object URL created", { url });
      // STEP 2 diagnostic: prove this exact File decodes outside the crop
      // <img>. Uses its OWN probe URL, revoked only after the test settles
      // — the display URL above is never touched by this probe.
      try {
        const probeUrl = URL.createObjectURL(file);
        const probe = new Image();
        probe.onload = () => {
          console.log("[photo-crop] DIRECT IMAGE LOAD OK", {
            width: probe.naturalWidth,
            height: probe.naturalHeight,
            type: file.type,
            size: file.size,
            url: probeUrl,
          });
          URL.revokeObjectURL(probeUrl);
        };
        probe.onerror = (event) => {
          console.error("[photo-crop] DIRECT IMAGE LOAD FAILED", {
            type: file.type,
            size: file.size,
            name: file.name,
            url: probeUrl,
            event,
          });
          URL.revokeObjectURL(probeUrl);
        };
        probe.src = probeUrl;
      } catch (e) {
        console.error("[photo-crop] DIRECT IMAGE probe threw", e);
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- blob URL is external-system sync; effect recreation is what keeps it alive across StrictMode remounts.
    setSrcUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const boxRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number } | null>(null);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [stage, setStage] = useState<Stage>("crop");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processed, setProcessed] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards double-tap on "use photo": the parent unmounts this dialog on
  // confirm, but a second tap could land before unmount completes.
  const confirmedRef = useRef(false);

  // Measure the interaction box (ResizeObserver is native + cheap).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Lock page scroll + Escape to cancel while the dialog is open.
  // NOTE: callers pass key={file identity} so each queued file remounts this
  // dialog with fresh crop state (no setState-in-effect reset needed).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);

  // Frame rect (3:4, centered, fully inside the box).
  const frame = useMemo(() => {
    if (box.w <= 0 || box.h <= 0) return { w: 0, h: 0, x: 0, y: 0 };
    const w = Math.min(box.w, (box.h * 3) / 4);
    const h = (w * 4) / 3;
    return { w, h, x: (box.w - w) / 2, y: (box.h - h) / 2 };
  }, [box]);

  // Displayed image size at cover + user zoom.
  const disp = useMemo(() => {
    if (!natural || frame.w <= 0) return null;
    const k = Math.max(frame.w / natural.w, frame.h / natural.h);
    return { w: natural.w * k * scale, h: natural.h * k * scale };
  }, [natural, frame, scale]);

  const clampWith = useCallback(
    (s: number, x: number, y: number) => {
      if (!natural || frame.w <= 0) return { x, y };
      const k = Math.max(frame.w / natural.w, frame.h / natural.h);
      const dw = natural.w * k * s;
      const dh = natural.h * k * s;
      const mx = Math.max(0, (dw - frame.w) / 2);
      const my = Math.max(0, (dh - frame.h) / 2);
      return {
        x: Math.max(-mx, Math.min(mx, x)),
        y: Math.max(-my, Math.min(my, y)),
      };
    },
    [natural, frame],
  );

  const clampOffset = useCallback(
    (x: number, y: number) => clampWith(scale, x, y),
    [clampWith, scale],
  );

  // Render-time clamp: display + crop math always stay in bounds even right
  // after a zoom step, without cascading setState-in-effect renders.
  const view = useMemo(
    () => clampWith(scale, offset.x, offset.y),
    [clampWith, scale, offset],
  );

  function zoomBy(factor: number) {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
    setScale(next);
    setOffset((o) => clampWith(next, o.x, o.y));
  }

  function resetView() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  // Single-pointer drag pans; two-pointer pinch zooms + pans by midpoint.
  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const prev = pointersRef.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointersRef.current.set(e.pointerId, cur);
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const last = pinchRef.current?.dist ?? dist;
      pinchRef.current = { dist };
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      setScale((s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, (s * dist) / last)));
      setOffset((o) => clampOffset(o.x + dx / 2, o.y + dy / 2));
      return;
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    setOffset((o) => clampOffset(o.x + dx, o.y + dy));
  }

  function onPointerUp(e: React.PointerEvent) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    // Best-effort normalize after pinch (display is always clamped via
    // `view` regardless, so this only removes drag dead-zone).
    setOffset((o) => clampOffset(o.x, o.y));
  }

  // Wheel zooms centered; preventDefault stops the page scrolling.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * Math.exp(-e.deltaY * 0.0015)));
      setScale(next);
      setOffset((o) => clampWith(next, o.x, o.y));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale, clampWith]);

  // (removed: no setState-in-effect — `view` clamps at render time)

  async function handleDone() {
    if (!natural || !disp || stage === "processing") return;
    setStage("processing");
    setError(null);
    try {
      // Map the centered 3:4 frame back into natural-image pixels.
      const imgLeft = (box.w - disp.w) / 2 + view.x;
      const imgTop = (box.h - disp.h) / 2 + view.y;
      const crop = {
        sx: ((frame.x - imgLeft) / disp.w) * natural.w,
        sy: ((frame.y - imgTop) / disp.h) * natural.h,
        sw: (frame.w / disp.w) * natural.w,
        sh: (frame.h / disp.h) * natural.h,
      };
      const out = await renderCroppedPhoto(file, crop);
      const url = URL.createObjectURL(out.file);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setProcessed(out.file);
      setStage("preview");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "We couldn't process that photo.");
      setStage("error");
    }
  }

  function backToCrop() {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setProcessed(null);
    setError(null);
    setStage("crop");
  }

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const busy = stage === "processing";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="crop photo"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-[400px] rounded-t-[28px] border border-line bg-paper p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-[28px]">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
            {stage === "preview" ? "preview" : "crop your photo"}
          </p>
          {queueLabel && <p className="text-[11px] tracking-[0.08em] text-ink-faint">{queueLabel}</p>}
        </div>

        {stage === "preview" && previewUrl ? (
          <div className="mt-4">
            <div className="relative mx-auto aspect-[3/4] w-full max-w-[280px] overflow-hidden rounded-2xl border border-line bg-paper-2">
              <img src={previewUrl} alt="cropped photo preview" className="h-full w-full object-cover" />
            </div>
            <p className="mt-3 text-center text-[12px] text-ink-soft">This is what will be uploaded.</p>
          </div>
        ) : stage === "error" ? (
          <div className="mt-4 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-4">
            <p className="text-[13px] leading-5 text-accent-deep">{error ?? "We couldn't process that photo."}</p>
            <p className="mt-1 text-[12px] leading-5 text-accent-deep">Try another photo.</p>
          </div>
        ) : (
          <div className="mt-4">
            <div
              ref={boxRef}
              className="relative h-[min(46dvh,400px)] min-h-[300px] w-full cursor-grab touch-none overflow-hidden rounded-2xl bg-ink select-none active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* The source image must mount unconditionally: `disp` is derived
                  from `natural`, which is only known after this <img> fires
                  onLoad. Gating the <img> on `disp` deadlocks the editor
                  (black viewport). Before geometry is ready the image stays
                  invisible but mounted so it can load. */}
              <img
                src={srcUrl ?? undefined}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (process.env.NODE_ENV !== "production") {
                    console.log("[photo-crop] crop <img> loaded", {
                      src: srcUrl,
                      naturalWidth: el.naturalWidth,
                      naturalHeight: el.naturalHeight,
                    });
                  }
                  if (el.naturalWidth > 0) setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                }}
                onError={() => {
                  if (process.env.NODE_ENV !== "production") {
                    console.error("[photo-crop] crop <img> failed", {
                      src: srcUrl,
                      type: file.type,
                      size: file.size,
                      name: file.name,
                    });
                  }
                  setError("We couldn't read that photo. Try another photo.");
                  setStage("error");
                }}
                style={
                  disp
                    ? {
                        position: "absolute",
                        left: `${(box.w - disp.w) / 2 + view.x}px`,
                        top: `${(box.h - disp.h) / 2 + view.y}px`,
                        width: `${disp.w}px`,
                        height: `${disp.h}px`,
                        maxWidth: "none",
                        opacity: 1,
                      }
                    : {
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: "100%",
                        height: "100%",
                        opacity: 0,
                      }
                }
              />
              {/* Darkened outside area + clean crop frame. */}
              {frame.w > 0 && (
                <div className="pointer-events-none absolute inset-0" aria-hidden>
                  <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: frame.y }} />
                  <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: frame.y }} />
                  <div className="absolute top-0 bottom-0 left-0 bg-black/55" style={{ top: frame.y, height: frame.h, width: frame.x }} />
                  <div className="absolute top-0 bottom-0 right-0 bg-black/55" style={{ top: frame.y, height: frame.h, width: frame.x }} />
                  <div
                    className="absolute rounded-lg border-2 border-white"
                    style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
                  />
                </div>
              )}
              {busy && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                  <p className="text-[12px] uppercase tracking-[0.14em] text-white">processing…</p>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-[11px] leading-4 text-ink-faint">Drag to frame · pinch or scroll to zoom</p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => zoomBy(1 / 1.25)}
                  disabled={busy}
                  aria-label="zoom out"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-paper text-[18px] text-ink transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => zoomBy(1.25)}
                  disabled={busy}
                  aria-label="zoom in"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-paper text-[18px] text-ink transition-colors hover:bg-accent-wash hover:border-accent-soft hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={resetView}
              disabled={busy}
              className="mt-1 inline-flex min-h-[44px] items-center rounded-full text-[11px] uppercase tracking-[0.12em] text-ink-faint transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
            >
              reset framing
            </button>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {stage === "preview" ? (
            <>
              <Button variant="subtle" onClick={backToCrop} className="flex-1 rounded-full">
                re-edit
              </Button>
              <Button
                onClick={() => {
                  if (processed && !confirmedRef.current) {
                    confirmedRef.current = true;
                    const f = processed;
                    setPreviewUrl((prev) => {
                      if (prev) URL.revokeObjectURL(prev);
                      return null;
                    });
                    onConfirm(f);
                  }
                }}
                className="flex-1 rounded-full"
              >
                use photo
              </Button>
            </>
          ) : stage === "error" ? (
            <>
              <Button variant="subtle" onClick={backToCrop} className="flex-1 rounded-full">
                back to crop
              </Button>
              <Button onClick={onCancel} className="flex-1 rounded-full">
                choose another
              </Button>
            </>
          ) : (
            <>
              <Button variant="subtle" onClick={onCancel} disabled={busy} className="flex-1 rounded-full">
                cancel
              </Button>
              <Button onClick={handleDone} disabled={busy || !natural} className="flex-1 rounded-full">
                {busy ? "processing…" : "done"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
