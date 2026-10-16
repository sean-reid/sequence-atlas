import { parseANumber } from "./anumber.ts";

export type Query =
  | { kind: "anumber"; number: number }
  | { kind: "terms"; terms: string[] }
  | { kind: "text"; words: string[] }
  | { kind: "empty" };

const MAX_WORDS = 8;
const MAX_TERMS = 24;

/** Decide what the search box holds: an A-number, a run of terms, or words. */
export function classify(raw: string): Query {
  const text = raw.trim();
  if (!text) return { kind: "empty" };
  const number = parseANumber(text);
  if (number !== null && /^a/i.test(text)) return { kind: "anumber", number };
  if (/^[-\d\s,;]+$/.test(text)) {
    const terms = text
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map((t) => t.replace(/^-/, "").replace(/^0+(?=\d)/, ""))
      .filter((t) => /^\d+$/.test(t))
      .slice(0, MAX_TERMS);
    if (terms.length === 1 && number !== null && text.length <= 7) {
      return { kind: "anumber", number };
    }
    return terms.length ? { kind: "terms", terms } : { kind: "empty" };
  }
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).slice(0, MAX_WORDS);
  return words.length ? { kind: "text", words } : { kind: "empty" };
}

/** FTS5 MATCH expression: every word as a prefix, all required. */
export function nameMatch(words: string[]): string {
  return words.map((w) => `"${w}"*`).join(" ");
}

/** FTS5 phrase over consecutive terms. */
export function termsMatch(terms: string[]): string {
  return `"${terms.join(" ")}"`;
}
