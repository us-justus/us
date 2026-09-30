/**
 * Username validation + normalization (STEP 2).
 *
 * Single rule shared by client and server so the UI and the API agree:
 * - trim surrounding whitespace (normalization)
 * - reject any whitespace inside (the DB check `^[A-Za-z0-9_]{3,30}$`
 *   rejects it too — this surfaces the same rule as a friendly message)
 * - preserve the chosen display casing; uniqueness is case-insensitive
 *   via the `idx_profiles_username_lower` partial unique index
 * - the database unique index remains authoritative for taken-ness;
 *   this helper only checks format, never availability (no COUNT(*),
 *   no frontend availability check as truth)
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;

export function normalizeUsername(v: string): string {
  return v.trim();
}

export function validateUsername(v: string): string | null {
  const s = normalizeUsername(v);
  if (!s) return "Choose a username.";
  if (/\s/.test(s)) return "No spaces — letters, numbers and _ only.";
  if (s.length < USERNAME_MIN) return "At least 3 characters.";
  if (s.length > USERNAME_MAX) return "Keep it under 30 characters.";
  if (!USERNAME_RE.test(s)) return "Letters, numbers and _ only.";
  return null;
}
