export const YEARS = ["1st", "2nd", "3rd", "4th"] as const;
export const BRANCHES = ["CSE", "ISE", "ECE", "EEE", "ME", "CE", "AIML", "Other"] as const;

export type Year = (typeof YEARS)[number];
export type Branch = (typeof BRANCHES)[number];

export function validateNickname(v: string): string | null {
  const s = v.trim();
  if (!s) return "Choose a nickname.";
  if (s.length < 2) return "At least 2 characters.";
  if (s.length > 24) return "Keep it under 24 characters.";
  if (!/^[\p{L}\p{N} _-]+$/u.test(s)) return "Letters, numbers, spaces only.";
  return null;
}

export function validateAge(v: number): string | null {
  if (!Number.isInteger(v)) return "Enter your age.";
  if (v < 18) return "You must be 18 or older.";
  if (v > 40) return "Enter a valid age.";
  return null;
}

export function validateYear(v: string): string | null {
  if (!(YEARS as readonly string[]).includes(v)) return "Select your year.";
  return null;
}

export function validateBranch(v: string): string | null {
  if (!(BRANCHES as readonly string[]).includes(v)) return "Select your branch.";
  return null;
}

export function validateBio(v: string): string | null {
  if (v.length > 300) return "Keep bio under 300 characters.";
  return null;
}

export const MAX_PHOTOS = 6;
export const MIN_PHOTOS = 1;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function validatePhotoFile(file: File): string | null {
  if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(file.type)) return "Use JPG, PNG or WEBP.";
  if (file.size > MAX_PHOTO_BYTES) return "Max 5 MB per photo.";
  if (file.size === 0) return "Empty file.";
  return null;
}
