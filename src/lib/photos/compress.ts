/**
 * Client-side profile-photo preparation (browser-native, no dependencies).
 *
 * Goal: "smaller upload, same perceived quality" — never "smallest possible
 * file". Phone photos (typically 3024–4032px, 3–8MB) are downscaled only when
 * larger than the upload ceiling and re-encoded at high quality; already
 * small images pass through untouched so no generation loss is introduced.
 *
 * Ceiling rationale: the largest rendered surface is the profile hero
 * (~528×704 CSS px in a max-w-[560px] column; discover cards are ~348px
 * wide). 1440px on the long edge ≈ 2× the hero at retina density — above the
 * maximum rendered requirement, so no visible difference in profile, discover,
 * or the photo carousel — while cutting source pixels 4–8× for phone photos.
 *
 * - Preserves aspect ratio, never upscales.
 * - Applies EXIF orientation (createImageBitmap `from-image`, <img> fallback
 *   which also auto-orients in modern browsers).
 * - Re-encoding strips camera metadata (no EXIF/GPS in the upload).
 * - JPEG in → JPEG out (universal); PNG/WebP in → WebP out (alpha-safe and
 *   much smaller than PNG for photos). Transparent pixels are flattened onto
 *   white when the output has no alpha channel.
 * - Never returns a larger file than the original; never throws — on any
 *   failure the original file is uploaded unchanged (server validation stays
 *   authoritative regardless).
 *
 * Diagnostics are development-only `[perf]` logs of labels + sizes/durations.
 * Never logs image contents, metadata, or user data.
 */

export const PHOTO_MAX_LONG_EDGE = 1440;
export const PHOTO_ENCODE_QUALITY = 0.88;
/** Files at/below this size that need no resize upload untouched (zero loss). */
export const PHOTO_PASSTHROUGH_MAX_BYTES = 1.5 * 1024 * 1024;

export type PreparedPhoto = {
  /** The file to upload: processed output, or the original on passthrough/fallback. */
  file: File;
  originalBytes: number;
  processedBytes: number;
  compressionMs: number;
  resized: boolean;
  /** True when the original is uploaded untouched (small enough or fallback). */
  passthrough: boolean;
};

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.round(n / 1024)}KB`;
}

function devLog(label: string, value: string): void {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[perf] ${label} ${value}`);
}

function outputTypeFor(inputType: string): { mime: string; ext: string } {
  if (inputType === "image/png" || inputType === "image/webp") return { mime: "image/webp", ext: "webp" };
  return { mime: "image/jpeg", ext: "jpg" };
}

type DecodedImage = { source: CanvasImageSource; width: number; height: number; close?: () => void };

async function decodeImage(file: File): Promise<DecodedImage | null> {
  // Preferred path: honors EXIF orientation, decodes off the caller's stack.
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          close: () => bitmap.close(),
        };
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

export async function preparePhotoForUpload(source: File): Promise<PreparedPhoto> {
  const started = performance.now();
  const originalBytes = source.size;
  devLog("photo.original-size", fmtBytes(originalBytes));

  const passthrough = (reason: string): PreparedPhoto => {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[perf] photo.compression skipped (${reason}) ${Math.round(performance.now() - started)}ms`);
    }
    devLog("photo.processed-size", fmtBytes(originalBytes));
    return {
      file: source,
      originalBytes,
      processedBytes: originalBytes,
      compressionMs: Math.round(performance.now() - started),
      resized: false,
      passthrough: true,
    };
  };

  if (!source.type.startsWith("image/")) return passthrough("not-an-image");
  if (originalBytes === 0) return passthrough("empty");

  const decoded = await decodeImage(source);
  if (!decoded) return passthrough("decode-failed");

  try {
    const scale = Math.min(1, PHOTO_MAX_LONG_EDGE / Math.max(decoded.width, decoded.height));
    const resized = scale < 1;
    const targetW = Math.max(1, Math.round(decoded.width * scale));
    const targetH = Math.max(1, Math.round(decoded.height * scale));

    // Small-enough image that needs no resize: re-encoding would only add
    // generation loss (or grow the file), so upload the original untouched.
    if (!resized && originalBytes <= PHOTO_PASSTHROUGH_MAX_BYTES) {
      return passthrough("already-optimal");
    }

    const { mime, ext } = outputTypeFor(source.type);
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return passthrough("no-2d-context");
    // JPEG has no alpha: flatten transparency onto white instead of black.
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(decoded.source, 0, 0, targetW, targetH);

    let blob = await canvasToBlob(canvas, mime, PHOTO_ENCODE_QUALITY);
    // Encoder fallback: WebP encode can fail on older browsers — retry JPEG.
    if (!blob && mime !== "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(decoded.source, 0, 0, targetW, targetH);
      blob = await canvasToBlob(canvas, "image/jpeg", PHOTO_ENCODE_QUALITY);
    }
    if (!blob || blob.size === 0) return passthrough("encode-failed");

    const outMime = blob.type || (mime === "image/webp" ? "image/webp" : "image/jpeg");
    const outExt = outMime === "image/webp" ? "webp" : outMime === "image/png" ? "png" : "jpg";
    // Never upload a larger file than the original.
    if (blob.size >= originalBytes) return passthrough("not-smaller");

    const base = source.name.replace(/\.[a-z0-9]+$/i, "") || "photo";
    const file = new File([blob], `${base}.${ext === outExt ? ext : outExt}`, {
      type: outMime,
      lastModified: Date.now(),
    });
    const ms = Math.round(performance.now() - started);
    devLog("photo.processed-size", fmtBytes(file.size));
    if (process.env.NODE_ENV !== "production") {
      console.log(`[perf] photo.compression ${ms}ms`);
    }
    return {
      file,
      originalBytes,
      processedBytes: file.size,
      compressionMs: ms,
      resized,
      passthrough: false,
    };
  } finally {
    decoded.close?.();
  }
}
