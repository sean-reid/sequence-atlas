// OEIS identifiers are the letter A followed by six digits, zero padded.
const PATTERN = /^A?(\d{1,7})$/i;

export function parseANumber(text: string): number | null {
  const match = PATTERN.exec(text.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 ? n : null;
}

export function formatANumber(n: number): string {
  return `A${String(n).padStart(6, "0")}`;
}
