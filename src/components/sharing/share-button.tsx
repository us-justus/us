"use client";

/**
 * STEP 3D.1 — reusable share primitives.
 *
 * Kept dependency-free and UI-agnostic so the same infrastructure can later
 * power "share my profile" from Settings/Profile without duplication.
 * No auth calls, no Supabase, no token handling here — callers pass the
 * absolute URL they already resolved.
 */

/** Legacy clipboard fallback for non-secure origins (http over LAN). */
export function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Absolutize a root-relative invite path against the current origin.
 * Sharing "/invite/<token>" verbatim breaks outside the app — the
 * absolute URL fix must remain for LAN + production alike.
 */
export function absolutizeUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, window.location.href).toString();
}

export function inviteShareTitle(): string {
  return "just us.";
}

export function inviteShareText(spot: number | null): string {
  return `i'm #${spot ?? "—"}.`;
}

export type NativeShareSupport = {
  share: boolean;
  fileShare: boolean;
};

export function detectShareSupport(): NativeShareSupport {
  if (typeof navigator === "undefined") return { share: false, fileShare: false };
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };
  const share = typeof nav.share === "function";
  let fileShare = false;
  try {
    fileShare =
      share &&
      typeof nav.canShare === "function" &&
      nav.canShare({ files: [new File(["x"], "probe.png", { type: "image/png" })] });
  } catch {
    fileShare = false;
  }
  return { share, fileShare };
}

export async function copyTextWithFallbacks(text: string): Promise<"copied" | "manual"> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      // Fall through to legacy.
    }
  }
  if (legacyCopy(text)) return "copied";
  return "manual";
}
