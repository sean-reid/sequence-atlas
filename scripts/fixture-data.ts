// Writes a small synthetic dataset in the layout step's output format, so
// the site runs end to end without the real artefacts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatANumber } from "../shared/anumber.ts";

const FAMILIES = ["all", "growth", "arith", "recur", "graph"];
const COUNT = 600;
const out = process.argv[2] ?? "dist/data";
const version = "fixture";
const dir = join(out, "v", version);
mkdirSync(dir, { recursive: true });

let seed = 12345;
const rand = () => {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
};

const numbers = Array.from({ length: COUNT }, (_, i) => i + 1);
writeFileSync(join(dir, "numbers.u32"), new Uint32Array(numbers));
writeFileSync(
  join(out, "manifest.json"),
  JSON.stringify({ version, count: COUNT, families: FAMILIES, snapshot: "2026-01-01" }),
);

const centres = [
  [-4, -3],
  [3, 4],
  [5, -4],
];
const labels = ["fibonacci lucas", "primes congruent", "decimal expansion"];

function layout(family: string): void {
  const points = new Uint16Array(COUNT * 2);
  const clusters = new Uint16Array(COUNT);
  const sums = centres.map(() => [0, 0, 0]);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    const c = i % 3;
    const shift = family === "all" ? 0 : FAMILIES.indexOf(family);
    const x = centres[c]![0]! + (rand() - 0.5) * 2 + shift * 0.3;
    const y = centres[c]![1]! + (rand() - 0.5) * 2 - shift * 0.2;
    xs.push(x);
    ys.push(y);
    clusters[i] = i % 50 === 49 ? 65535 : c;
    if (clusters[i] !== 65535) {
      sums[c]![0]! += x;
      sums[c]![1]! += y;
      sums[c]![2]! += 1;
    }
  }
  // Wide fixed bounds keep the clusters near the middle of the default view.
  const bounds = [-12, -12, 12, 12];
  for (let i = 0; i < COUNT; i++) {
    points[i * 2] = Math.round(((xs[i]! - bounds[0]!) / (bounds[2]! - bounds[0]!)) * 65535);
    points[i * 2 + 1] = Math.round(((ys[i]! - bounds[1]!) / (bounds[3]! - bounds[1]!)) * 65535);
  }
  const header = new ArrayBuffer(24);
  const view = new DataView(header);
  view.setUint8(0, 0x41);
  view.setUint8(1, 0x54);
  view.setUint8(2, 0x4c);
  view.setUint8(3, 0x31);
  view.setUint32(4, COUNT, true);
  bounds.forEach((b, i) => view.setFloat32(8 + i * 4, b, true));
  writeFileSync(
    join(dir, `${family}.layout.bin`),
    Buffer.concat([Buffer.from(header), Buffer.from(points.buffer)]),
  );
  writeFileSync(join(dir, `${family}.cluster.u16`), Buffer.from(clusters.buffer));
  writeFileSync(
    join(dir, `${family}.clusters.json`),
    JSON.stringify(
      sums.map((s, id) => ({
        id,
        label: labels[id],
        size: s[2],
        cx: s[0]! / s[2]!,
        cy: s[1]! / s[2]!,
      })),
    ),
  );
}
FAMILIES.forEach(layout);

const columns = ["growth rate", "parity balance", "recurrence order"];
writeFileSync(
  join(dir, "features.json"),
  JSON.stringify(
    Object.fromEntries(
      FAMILIES.map((f) => [f, columns.map((phrase, i) => ({ name: `c${i}`, phrase }))]),
    ),
  ),
);

const shardDir = (kind: string) => {
  const d = join(dir, "shards", kind);
  mkdirSync(d, { recursive: true });
  return d;
};
const base = shardDir("base");
const perFamily = Object.fromEntries(FAMILIES.map((f) => [f, shardDir(f)]));
for (let start = 1; start <= COUNT; start += 100) {
  const file = `${String(Math.floor(start / 100)).padStart(5, "0")}.json`;
  const baseDoc: Record<string, unknown> = {};
  const near: Record<string, Record<string, unknown>> = Object.fromEntries(
    FAMILIES.map((f) => [f, {}]),
  );
  for (let n = start; n < start + 100 && n <= COUNT; n++) {
    const id = formatANumber(n);
    const c = (n - 1) % 3;
    baseDoc[id] = {
      name:
        n === 45
          ? "Fibonacci numbers: F(n) = F(n-1) + F(n-2)."
          : `Fixture sequence ${n} of ${labels[c]}.`,
      terms: Array.from({ length: 12 }, (_, k) => String((k + 1) * n)).join(","),
      offset: 1,
      keywords: ["nonn", c === 0 ? "core" : "easy"],
      cluster: Object.fromEntries(FAMILIES.map((f) => [f, c])),
      colour: [c + 1, c === 0 ? 2 : 0, c === 0 ? 1 : 8],
    };
    for (const f of FAMILIES) {
      near[f]![id] = Array.from({ length: 5 }, (_, k) => [
        ((n + 3 * (k + 1) - 1) % COUNT) + 1,
        k % 3,
        (k + 1) % 3,
      ]);
    }
  }
  writeFileSync(join(base, file), JSON.stringify(baseDoc));
  for (const f of FAMILIES) writeFileSync(join(perFamily[f]!, file), JSON.stringify(near[f]));
}
console.log(`fixture data for ${COUNT} sequences written to ${out}`);
