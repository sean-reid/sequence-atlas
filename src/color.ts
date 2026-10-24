import type { Color } from "../shared/url.ts";

export interface Legend {
  swatch: string;
  label: string;
}

/** Legend text per color variable, as features.json publishes it. */
export interface LabelTables {
  /** Eight growth classes in code order; the last is the irregular bucket. */
  growth: string[];
  /** Eight recurrence buckets in palette slot order, the none bucket last. */
  order: string[];
  /** Nine keyword groups in code order, "none of these" at index 0. */
  keyword: string[];
}

export interface ColorScheme {
  /** Nine hex colors: slot 0 for points outside the scheme, then eight classes. */
  palette: string[];
  legend: Legend[];
  /** Palette slot for one sequence given its three color codes. */
  slot: (growth: number, order: number, keyword: number) => number;
}

/** What the client shows when features.json carries no label tables. */
export const DEFAULT_LABELS: LabelTables = {
  growth: [
    "constant or periodic",
    "linear",
    "quadratic",
    "cubic or quartic",
    "higher polynomial",
    "exponential",
    "factorial or faster",
    "irregular",
  ],
  order: [
    "order 1",
    "order 2",
    "order 3",
    "order 4",
    "order 5 or 6",
    "order 7 to 9",
    "order 10 to 12",
    "none up to order 12",
  ],
  keyword: [
    "none of these",
    "core",
    "nice",
    "hard",
    "base",
    "mult",
    "tabl or tabf",
    "cons",
    "easy",
  ],
};

const ORDER_BUCKETS: ((o: number) => boolean)[] = [
  (o) => o === 1,
  (o) => o === 2,
  (o) => o === 3,
  (o) => o === 4,
  (o) => o === 5 || o === 6,
  (o) => o >= 7 && o <= 9,
  (o) => o >= 10,
];

// Palette slot per recurrence order, 0 to 12, built once from the buckets.
const ORDER_SLOT = Array.from({ length: 13 }, (_, o) => {
  const i = ORDER_BUCKETS.findIndex((test) => test(o));
  return i < 0 ? 0 : i + 1;
});

export const SLOTS: Record<Color, ColorScheme["slot"]> = {
  cluster: () => 0,
  growth: (g) => (g >= 0 && g < 7 ? g + 1 : 0),
  order: (_g, o) => ORDER_SLOT[Math.min(o, ORDER_SLOT.length - 1)] ?? 0,
  keyword: (_g, _o, k) => (k >= 1 && k <= 8 ? k : 0),
};

export function scheme(
  color: Color,
  css: (name: string) => string,
  labels: LabelTables = DEFAULT_LABELS,
): ColorScheme {
  const noise = css("--noise");
  const categorical = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7", "--c8"].map(css);
  const ramp = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7"].map(css);
  const legend = (swatches: string[], names: string[]): Legend[] =>
    names.map((label, i) => ({ swatch: swatches[i] ?? noise, label }));
  const slot = SLOTS[color];
  switch (color) {
    case "growth":
      return { palette: [noise, ...ramp, noise], legend: legend(ramp, labels.growth), slot };
    case "order":
      return { palette: [noise, ...ramp, noise], legend: legend(ramp, labels.order), slot };
    case "keyword":
      return {
        palette: [noise, ...categorical],
        legend: legend(categorical, [...labels.keyword.slice(1), labels.keyword[0] ?? ""]),
        slot,
      };
    default:
      return { palette: [noise, ...categorical], legend: [], slot };
  }
}
