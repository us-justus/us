
export const YEARS = ["1st", "2nd", "3rd", "4th"] as const;
export const BRANCHES = ["CSE", "ISE", "ECE", "EEE", "ME", "CE", "AIML", "Other"] as const;
export const GENDERS = ["Male", "Female", "Prefer not to say"] as const;

export type Year = (typeof YEARS)[number];
export type Branch = (typeof BRANCHES)[number];
export type Gender = (typeof GENDERS)[number];

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 6;

const ALLOWED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const ALLOWED_PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

export function validateNickname(v: string): string | null {
  const s = v.trim();
  if (!s) return "Choose a nickname.";
  if (s.length < 2) return "At least 2 characters.";
  if (s.length > 24) return "Keep it under 24 characters.";
  if (!/^[\p{L}\p{N} _-]+$/u.test(s)) {
    return "Letters, numbers, spaces only.";
  }
  return null;
}

export function validateAge(v: number): string | null {
  if (!Number.isInteger(v)) return "Enter your age.";
  if (v < 18) return "You must be 18 or older.";
  if (v > 40) return "Enter a valid age.";
  return null;
}

export function validateYear(v: string): string | null {
  if (!(YEARS as readonly string[]).includes(v)) {
    return "Select a valid year.";
  }
  return null;
}

export function validateBranch(v: string): string | null {
  if (!(BRANCHES as readonly string[]).includes(v)) {
    return "Select a valid branch.";
  }
  return null;
}

export function validateGender(v: string): string | null {
  if (!(GENDERS as readonly string[]).includes(v)) {
    return "Select a gender option.";
  }
  return null;
}

export function validateBio(v: string): string | null {
  if (v.length > 300) return "Keep bio under 300 characters.";
  return null;
}

export function validatePhotoFile(file: File): string | null {
  if (file.size <= 0) {
    return "The selected photo is empty.";
  }

  if (file.size > MAX_PHOTO_BYTES) {
    return "Max 5 MB per photo.";
  }

  const name = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_PHOTO_EXTENSIONS.some((ext) =>
    name.endsWith(ext),
  );

  if (
    !hasAllowedExtension ||
    !(ALLOWED_PHOTO_TYPES as readonly string[]).includes(file.type)
  ) {
    return "Use a valid JPG, PNG or WEBP image.";
  }

  return null;
}
