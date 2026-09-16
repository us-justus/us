export function normalizeUSN(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function validateUSN(usn: string): boolean {
  const normalized = normalizeUSN(usn);
  if (!normalized) return false;
  if (normalized.length < 6 || normalized.length > 20) return false;
  if (!/^[A-Z0-9]+$/.test(normalized)) return false;
  // TODO: Replace with final college-specific USN regex.
  // Example placeholder: require at least 2 letters and 2 digits.
  const hasLetters = (normalized.match(/[A-Z]/g) ?? []).length >= 2;
  const hasDigits = (normalized.match(/[0-9]/g) ?? []).length >= 2;
  return hasLetters && hasDigits;
}
