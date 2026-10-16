// Writes a small synthetic dataset in the layout step's output format, so
// the site runs end to end without the real artifacts.
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
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
  JSON.stringify({
    version,
    build: "fixture",
    count: COUNT,
    families: FAMILIES,
    snapshot: "2026-01-01",
  }),
);

const centers = [
  [-4, -3],
  [3, 4],
  [5, -4],
];
const labels = ["fibonacci lucas", "primes congruent", "decimal expansion"];

function layout(family: string): void {
  const points = new Uint16Array(COUNT * 2);
  const clusters = new Uint16Array(COUNT);
  const sums = centers.map(() => [0, 0, 0]);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    const c = i % 3;
    const shift = family === "all" ? 0 : FAMILIES.indexOf(family);
    const x = centers[c]![0]! + (rand() - 0.5) * 2 + shift * 0.3;
    const y = centers[c]![1]! + (rand() - 0.5) * 2 - shift * 0.2;
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

const color = new Uint8Array(COUNT * 3);
for (let i = 0; i < COUNT; i++) {
  const c = i % 3;
  color[i * 3] = c + 1;
  color[i * 3 + 1] = c === 0 ? 2 : 0;
  color[i * 3 + 2] = c === 0 ? 1 : 8;
}
writeFileSync(join(dir, "color.u8"), Buffer.from(color.buffer));

const columns = ["growth rate", "parity balance", "recurrence order"];
writeFileSync(
  join(dir, "features.json"),
  JSON.stringify(
    Object.fromEntries(
      FAMILIES.map((f) => [f, columns.map((phrase, i) => ({ name: `c${i}`, phrase }))]),
    ),
  ),
);

// Shards of a kind are gzip members in one pack, with an index of byte ranges.
mkdirSync(join(dir, "shards"), { recursive: true });
const packs: Record<
  string,
  { parts: Buffer[]; index: Record<string, [number, number]>; offset: number }
> = {};
function addShard(kind: string, name: string, doc: unknown): void {
  const pack = (packs[kind] ??= { parts: [], index: {}, offset: 0 });
  const body = gzipSync(JSON.stringify(doc));
  pack.index[name] = [pack.offset, body.length];
  pack.parts.push(body);
  pack.offset += body.length;
}
for (let start = 0; start <= COUNT; start += 100) {
  const name = String(start / 100).padStart(5, "0");
  const baseDoc: Record<string, unknown> = {};
  const near: Record<string, Record<string, unknown>> = Object.fromEntries(
    FAMILIES.map((f) => [f, {}]),
  );
  for (let n = Math.max(1, start); n < start + 100 && n <= COUNT; n++) {
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
      color: [c + 1, c === 0 ? 2 : 0, c === 0 ? 1 : 8],
    };
    for (const f of FAMILIES) {
      near[f]![id] = Array.from({ length: 5 }, (_, k) => [
        ((n + 3 * (k + 1) - 1) % COUNT) + 1,
        k % 3,
        (k + 1) % 3,
      ]);
    }
  }
  addShard("base", name, baseDoc);
  for (const f of FAMILIES) addShard(f, name, near[f]);
}
for (const [kind, pack] of Object.entries(packs)) {
  writeFileSync(join(dir, "shards", `${kind}.pack`), Buffer.concat(pack.parts));
  writeFileSync(join(dir, "shards", `${kind}.index.json`), JSON.stringify(pack.index));
}
console.log(`fixture data for ${COUNT} sequences written to ${out}`);
