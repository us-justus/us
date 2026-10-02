"use client";

/**
 * STEP 3D.1 — dependency-free share-card image generation.
 *
 * Browser-native Canvas only (no libraries, no network, no remote fonts).
 * Fixed 1080×1350 (4:5 portrait) export so output is deterministic and
 * sharp on all densities — HiDPI by construction rather than by scaling
 * to the host device's devicePixelRatio at render time.
 *
 * Mirrors InviteShareCard closely: warm paper, dark editorial serif type,
 * restrained coral accent, hairline border. Contains username + #spot only —
 * never the invite token or any private identity data.
 */

const W = 1080;
const H = 1350;
const PAPER = "#fffdf9";
const INK = "#171615";
const INK_SOFT = "#6f6862";
const INK_FAINT = "#9a948f";
const ACCENT = "#ff6666";
const ACCENT_DEEP = "#a63d2f";
const LINE = "#e9e0dc";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function generateInviteCardImage({
  username,
  spot,
}: {
  username: string;
  spot: number | null;
}): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable.");

  // Paper field.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Hairline inset border.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  roundRect(ctx, 28, 28, W - 56, H - 56, 44);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const cx = W / 2;
  // System serif stack — no remote font fetch. Georgia approximates the
  // editorial display face used in the React preview.
  const serif = 'Georgia, "Times New Roman", serif';
  const sans =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

  // "us" wordmark.
  ctx.fillStyle = INK;
  ctx.font = `400 150px ${serif}`;
  ctx.fillText("us", cx, 300);

  // "just us."
  ctx.fillStyle = INK_SOFT;
  ctx.font = `400 54px ${serif}`;
  ctx.fillText("just us.", cx, 420);

  // Coral dot.
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(cx, 560, 12, 0, Math.PI * 2);
  ctx.fill();

  // "join us." / "i'm #N."
  ctx.fillStyle = INK;
  ctx.font = `400 108px ${serif}`;
  ctx.fillText("join us.", cx, 700);
  const spotLabel = `i'm #${spot ?? "—"}.`;
  // Paint the spot portion in accent-deep for identity emphasis.
  // Measure split: draw full line in ink, then overdraw the "#N." part.
  const fullW = ctx.measureText(spotLabel).width;
  ctx.fillText(spotLabel, cx, 830);
  const hashPart = `#${spot ?? "—"}.`;
  const prefix = spotLabel.slice(0, spotLabel.indexOf("#"));
  const prefixW = ctx.measureText(prefix).width;
  const hashW = ctx.measureText(hashPart).width;
  const hashX = cx - fullW / 2 + prefixW + hashW / 2;
  ctx.fillStyle = ACCENT_DEEP;
  ctx.fillText(hashPart, hashX, 830);

  // "secure your spot."
  ctx.fillStyle = INK_FAINT;
  ctx.font = `500 34px ${sans}`;
  const spaced = "SECURE YOUR SPOT.";
  // Manual letterspacing for small-caps feel (canvas has no CSS tracking).
  const tracking = 8;
  let total = 0;
  for (const ch of spaced) total += ctx.measureText(ch).width + tracking;
  total -= tracking;
  let sx = cx - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (const ch of spaced) {
    ctx.fillText(ch, sx, 950);
    sx += ctx.measureText(ch).width + tracking;
  }
  ctx.textAlign = prevAlign;

  // Divider + username.
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 48, 1050);
  ctx.lineTo(cx + 48, 1050);
  ctx.stroke();

  ctx.fillStyle = INK_SOFT;
  ctx.font = `400 52px ${sans}`;
  ctx.fillText(`@${username}`, cx, 1120);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) throw new Error("Could not render card image.");
  return blob;
}

export function inviteCardFileName(username: string): string {
  const safe = username.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "invite";
  return `us-invite-${safe}.png`;
}
