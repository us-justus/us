/**
 * Per-photo framing state for the 3:4 crop editor.
 *
 * Each queued photo owns its own {@link PhotoFraming} (`scale` + `x`/`y`),
 * keyed by file identity in the caller. The dialog never shares one global
 * x/y/scale across photos: a newly added photo always starts from
 * {@link FRESH_FRAMING} (centered cover), and switching photos restores the
 * selected photo's saved framing.
 *
 * The math mirrors `PhotoCropDialog` exactly (cover-fit + centered frame +
 * symmetric clamp); this module is the pure, testable core of it.
 */

export type PhotoFraming = {
  /** User zoom on top of cover-fit. 1 = fit, up to 3. */
  scale: number;
  /** Pixel offset of the displayed image from center (positive = right/down). */
  x: number;
  /** Pixel offset of the displayed image from center (positive = right/down). */
  y: number;
};

export const MIN_CROP_SCALE = 1;
export const MAX_CROP_SCALE = 3;

/** Fresh framing for a newly added photo: centered cover, no zoom. */
export const FRESH_FRAMING: PhotoFraming = { scale: 1, x: 0, y: 0 };

export type Size = { w: number; h: number };

/** Stable per-photo key — never a user id, only file identity. */
export function framingKeyForFile(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

/**
 * Deterministic initial framing for a new image.
 *
 * Always centered cover regardless of orientation: portrait images fit
 * naturally inside the portrait crop, landscape/square images center-crop
 * with the subject centered. No AI, no randomness — the user then refines
 * with drag/zoom. Never inherits another photo's transform.
 */
export function initialFramingForPhoto(): PhotoFraming {
  return { ...FRESH_FRAMING };
}

/** Cover scale: smallest scale filling `frame` with `natural` (aspect kept). */
export function coverScale(natural: Size, frame: Size): number {
  if (natural.w <= 0 || natural.h <= 0 || frame.w <= 0 || frame.h <= 0) return 1;
  return Math.max(frame.w / natural.w, frame.h / natural.h);
}

/**
 * Clamp a framing so the image always covers the fixed crop frame.
 * Symmetric bounds: the image may shift at most (displayed - frame) / 2
 * in each axis.
 */
export function clampFraming(framing: PhotoFraming, natural: Size, frame: Size): PhotoFraming {
  const scale = Math.max(MIN_CROP_SCALE, Math.min(MAX_CROP_SCALE, framing.scale));
  if (natural.w <= 0 || natural.h <= 0 || frame.w <= 0 || frame.h <= 0) {
    return { scale, x: 0, y: 0 };
  }
  const k = coverScale(natural, frame);
  const dw = natural.w * k * scale;
  const dh = natural.h * k * scale;
  const mx = Math.max(0, (dw - frame.w) / 2);
  const my = Math.max(0, (dh - frame.h) / 2);
  const cx = Math.max(-mx, Math.min(mx, framing.x));
  const cy = Math.max(-my, Math.min(my, framing.y));
  // Normalize -0 so per-photo snapshots compare cleanly.
  return { scale, x: cx === 0 ? 0 : cx, y: cy === 0 ? 0 : cy };
}

export type CropRectPx = { sx: number; sy: number; sw: number; sh: number };

/**
 * Map the current framing back into natural-image pixels for
 * `renderCroppedPhoto`. Uses only the given photo's own framing — never
 * another photo's transform.
 */
export function framingToCropRect(
  framing: PhotoFraming,
  natural: Size,
  box: Size,
  frame: Size,
): CropRectPx {
  const clamped = clampFraming(framing, natural, frame);
  const k = coverScale(natural, frame);
  const dispW = natural.w * k * clamped.scale;
  const dispH = natural.h * k * clamped.scale;
  // The crop frame is always centered in the interaction box (the dialog's
  // invariant); the image is centered plus the user's offset.
  const frameX = (box.w - frame.w) / 2;
  const frameY = (box.h - frame.h) / 2;
  const imgLeft = (box.w - dispW) / 2 + clamped.x;
  const imgTop = (box.h - dispH) / 2 + clamped.y;
  return {
    sx: ((frameX - imgLeft) / dispW) * natural.w,
    sy: ((frameY - imgTop) / dispH) * natural.h,
    sw: (frame.w / dispW) * natural.w,
    sh: (frame.h / dispH) * natural.h,
  };
}
