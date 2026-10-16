// Emits the SQL that loads the search tables from the layout step's meta.tsv,
// or a small fixture, in batches D1 accepts.
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const BATCH = 40;
const source = process.argv[2] ?? "";
const out = process.argv[3] ?? "";
if (!source || !out) {
  console.error("usage: node scripts/search-sql.ts <meta.tsv|--fixture> <out.sql>");
  process.exit(2);
}

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;

async function* rows(): AsyncGenerator<[number, string, string, number]> {
  if (source === "--fixture") {
    for (let n = 1; n <= 600; n++) {
      const name =
        n === 45 ? "Fibonacci numbers: F(n) = F(n-1) + F(n-2)." : `Fixture sequence ${n}.`;
      const terms = Array.from({ length: 12 }, (_, k) => String((k + 1) * n)).join(",");
      yield [n, name, terms, n === 45 ? 0 : 2];
    }
    return;
  }
  const lines = createInterface({ input: createReadStream(source) });
  let first = true;
  for await (const line of lines) {
    if (first) {
      first = false;
      continue;
    }
    const [number, , , keywords, name, terms] = line.split("\t");
    if (!number || name === undefined) continue;
    const tags = keywords?.split(",") ?? [];
    if (tags.includes("dead")) continue;
    // Famous sequences first: core, then nice, then the rest by A-number.
    const weight = tags.includes("core") ? 0 : tags.includes("nice") ? 1 : 2;
    yield [Number(number), name, terms ?? "", weight];
  }
}

const parts: string[] = ["DELETE FROM seq;"];
let batch: string[] = [];
let count = 0;
for await (const [number, name, terms, weight] of rows()) {
  batch.push(`(${number},${quote(name)},${quote(terms.replaceAll(",", " "))},${weight})`);
  count++;
  if (batch.length === BATCH) {
    parts.push(`INSERT INTO seq (number, name, terms, weight) VALUES ${batch.join(",")};`);
    batch = [];
  }
}
if (batch.length)
  parts.push(`INSERT INTO seq (number, name, terms, weight) VALUES ${batch.join(",")};`);
parts.push(
  "INSERT INTO name_index(name_index) VALUES ('rebuild');",
  "INSERT INTO terms_index(terms_index) VALUES ('rebuild');",
);
writeFileSync(out, parts.join("\n") + "\n");
console.log(`${count} rows in ${parts.length} statements written to ${out}`);
