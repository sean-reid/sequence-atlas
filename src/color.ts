import type { Color } from "../shared/url.ts";

export interface Legend {
  swatch: string;
  label: string;
}

export interface ColorScheme {
  /** Nine hex colors: slot 0 for points outside the scheme, then eight classes. */
  palette: string[];
  legend: Legend[];
  /** Palette slot for one sequence given its three color codes. */
  slot: (growth: number, order: number, keyword: number) => number;
}

const GROWTH = [
  "constant or periodic",
  "linear",
  "quadratic",
  "cubic or quartic",
  "higher polynomial",
  "exponential",
  "factorial or faster",
];

const ORDER_BUCKETS: [string, (o: number) => boolean][] = [
  ["order 1", (o) => o === 1],
  ["order 2", (o) => o === 2],
  ["order 3", (o) => o === 3],
  ["order 4", (o) => o === 4],
  ["order 5 or 6", (o) => o === 5 || o === 6],
  ["order 7 to 9", (o) => o >= 7 && o <= 9],
  ["order 10 to 12", (o) => o >= 10],
];

// Palette slot per recurrence order, 0 to 12, built once from the buckets.
const ORDER_SLOT = Array.from({ length: 13 }, (_, o) => {
  const i = ORDER_BUCKETS.findIndex(([, test]) => test(o));
  return i < 0 ? 0 : i + 1;
});

const KEYWORDS = ["core", "nice", "hard", "base", "mult", "tabl or tabf", "cons", "easy"];

export function scheme(color: Color, css: (name: string) => string): ColorScheme {
  const noise = css("--noise");
  const categorical = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7", "--c8"].map(css);
  const ramp = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7"].map(css);
  switch (color) {
    case "growth":
      return {
        palette: [noise, ...ramp, noise],
        legend: [
          ...GROWTH.map((label, i) => ({ swatch: ramp[i]!, label })),
          { swatch: noise, label: "irregular" },
        ],
        slot: (g) => (g >= 0 && g < 7 ? g + 1 : 0),
      };
    case "order":
      return {
        palette: [noise, ...ramp, noise],
        legend: [
          ...ORDER_BUCKETS.map(([label], i) => ({ swatch: ramp[i]!, label })),
          { swatch: noise, label: "none up to order 12" },
        ],
        slot: (_g, o) => ORDER_SLOT[Math.min(o, ORDER_SLOT.length - 1)] ?? 0,
      };
    case "keyword":
      return {
        palette: [noise, ...categorical],
        legend: [
          ...KEYWORDS.map((label, i) => ({ swatch: categorical[i]!, label })),
          { swatch: noise, label: "none of these" },
        ],
        slot: (_g, _o, k) => (k >= 1 && k <= 8 ? k : 0),
      };
    default:
      return { palette: [noise, ...categorical], legend: [], slot: () => 0 };
  }
}
