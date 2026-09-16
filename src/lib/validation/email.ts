export function validateOptionalEmail(email: string): string | null {
  const s = email.trim();
  if (!s) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "Enter a valid email.";
  if (s.length > 254) return "Email too long.";
  return null;
}
