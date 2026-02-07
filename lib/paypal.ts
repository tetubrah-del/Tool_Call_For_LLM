export function normalizePaypalEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return isValid ? email : null;
}
