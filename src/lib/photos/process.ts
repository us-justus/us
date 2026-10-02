/**
 * Shared crop → resize → encode pipeline (browser-native, no dependencies).
 *
 * Single canvas pass: the user's crop rectangle is drawn once onto an output
 * canvas sized for display (long edge ≤ PHOTO_MAX_LONG_EDGE, never upscaled)
 * and encoded at high quality. One pass means one generation of loss.
 *
 * - 3:4 portrait crop matches every photo surface in the app (`aspect-[3/4]`
 *   grids, the profile hero, Discover cards with `object-cover`).
 * - Orientation is handled by `createImageBitmap(..., { imageOrientation:
 *   "from-image" })` with an auto-orienting `<img>` fallback, so rotated
 *   phone photos keep their visual orientation.
 * - Re-encoding strips camera metadata (no EXIF/GPS in the upload).
 * - JPEG in → JPEG out; PNG/WebP in → WebP out (alpha-safe, far smaller
 *   than PNG for photos). JPEG output flattens transparency onto white.
 * - If the processed file still exceeds the server ceiling after the
 *   quality ladder, this throws a product-level Error — callers show a
 *   concise message and never upload a corrupted/oversize object.
 */

import { MAX_PHOTO_BYTES } from "@/lib/validation/profile";
import { perfLog, perfStart } from "@/lib/utils/perf";

/** Portrait frame matching the app's `aspect-[3/4]` photo surfaces. */
export const PHOTO_CROP_ASPECT_W = 3;
export const PHOTO_CROP_ASPECT_H = 4;

/** Long-edge ceiling: ≈2× the largest rendered surface at retina density. */
export const PHOTO_MAX_LONG_EDGE = 1440;
/** Visually-lossless-at-display-size starting quality (spec range 0.85–0.92). */
export const PHOTO_ENCODE_QUALITY = 0.88;
/** Controlled step-down if the output still exceeds the server ceiling. */
const QUALITY_LADDER = [0.88, 0.8, 0.72] as const;

export type CropRectPx = {
  /** Source-image pixels, clamped inside the decoded image by this module. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

export type ProcessedPhoto = {
  file: File;
  width: number;
  height: number;
  originalBytes: number;
  processedBytes: number;
  processingMs: number;
};

function outputTypeFor(inputType: string): { mime: string; ext: string } {
  if (inputType === "image/png" || inputType === "image/webp") return { mime: "image/webp", ext: "webp" };
  return { mime: "image/jpeg", ext: "jpg" };
}

type DecodedImage = { source: CanvasImageSource; width: number; height: number; close?: () => void };

async function decodeImage(file: File): Promise<DecodedImage | null> {
  // Preferred: honors EXIF orientation, decodes off the caller's stack.
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      }
      bitmap.close();
    }
  } catch {
    // Fall through to the <img> path.
  }
  // Fallback: <img> auto-applies EXIF orientation in modern browsers.
  try {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode failed"));
        el.src = url;
      });
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        return { source: img, width: img.naturalWidth, height: img.naturalHeight };
      }
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), mime, quality);
  });
}

/**
 * Crop + resize + encode in one pass. The crop rect is clamped into the
 * decoded image; output keeps the crop's aspect with long edge ≤1440 and is
 * never upscaled. Throws a concise Error when decoding/encoding fails or
 * the result cannot fit under MAX_PHOTO_BYTES.
 */
export async function renderCroppedPhoto(source: File, crop: CropRectPx): Promise<ProcessedPhoto> {
  const t = perfStart();
  const originalBytes = source.size;

  if (!source.type.startsWith("image/") || originalBytes === 0) {
    throw new Error("We couldn't process that photo. Try another photo.");
  }

  const decoded = await decodeImage(source);
  if (!decoded) throw new Error("We couldn't read that photo. Try another photo.");

  try {
    // Clamp the crop into the decoded image and reject degenerate rects.
    const sx = Math.max(0, Math.min(decoded.width - 1, Math.round(crop.sx)));
    const sy = Math.max(0, Math.min(decoded.height - 1, Math.round(crop.sy)));
    const sw = Math.max(1, Math.min(decoded.width - sx, Math.round(crop.sw)));
    const sh = Math.max(1, Math.min(decoded.height - sy, Math.round(crop.sh)));
    if (sw < 8 || sh < 8) throw new Error("We couldn't process that photo. Try another photo.");

    // Display-size normalize: downscale only, never upscale small sources.
    const scale = Math.min(1, PHOTO_MAX_LONG_EDGE / Math.max(sw, sh));
    const targetW = Math.max(1, Math.round(sw * scale));
    const targetH = Math.max(1, Math.round(sh * scale));

    const { mime, ext } = outputTypeFor(source.type);
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("We couldn't process that photo. Try another photo.");
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(decoded.source, sx, sy, sw, sh, 0, 0, targetW, targetH);

    let blob: Blob | null = null;
    for (const q of QUALITY_LADDER) {
      const attempt = await canvasToBlob(canvas, mime, q);
      // Encoder fallback: WebP can fail on older browsers — retry JPEG once.
      if (!attempt && mime !== "image/jpeg") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(decoded.source, sx, sy, sw, sh, 0, 0, targetW, targetH);
        const jpeg = await canvasToBlob(canvas, "image/jpeg", q);
        if (jpeg && jpeg.size > 0 && jpeg.size <= MAX_PHOTO_BYTES) {
          blob = jpeg;
          break;
        }
        continue;
      }
      if (attempt && attempt.size > 0 && attempt.size <= MAX_PHOTO_BYTES) {
        blob = attempt;
        break;
      }
    }
    if (!blob) throw new Error("That photo is too large even after processing. Try another photo.");

    const outMime = blob.type || mime;
    const outExt = outMime === "image/webp" ? "webp" : outMime === "image/png" ? "png" : "jpg";
    const base = source.name.replace(/\.[a-z0-9]+$/i, "") || "photo";
    const file = new File([blob], `${base}.${ext === outExt ? ext : outExt}`, {
      type: outMime,
      lastModified: Date.now(),
    });
    const ms = Math.round(performance.now() - t);
    perfLog("photo.crop-process", t);
    return {
      file,
      width: targetW,
      height: targetH,
      originalBytes,
      processedBytes: file.size,
      processingMs: ms,
    };
  } finally {
    decoded.close?.();
  }
}
