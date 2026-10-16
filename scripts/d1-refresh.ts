// Loads the search tables into whichever D1 database is not live, checks the
// row count, and flips the live-db pointer in KV. D1 blocks every query on a
// database while it imports, so the live one is never written.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sql = process.argv[2] ?? "";
if (!sql) {
  console.error("usage: node scripts/d1-refresh.ts <search.sql>");
  process.exit(2);
}
const KV_ID = "872d67f5602348498d065a9c6ea86439";
const DATABASES = { a: "sequence-atlas", b: "sequence-atlas-b" } as const;
const CHUNK_STATEMENTS = 800;

const wrangler = (...args: string[]): string =>
  execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

const live =
  wrangler("kv", "key", "get", "live-db", "--namespace-id", KV_ID, "--remote").trim() === "b"
    ? "b"
    : "a";
const standby = live === "a" ? "b" : "a";
const db = DATABASES[standby];
console.log(`live is ${live}, loading ${db}`);

wrangler("d1", "migrations", "apply", db, "--remote");
const lines = readFileSync(sql, "utf8").split("\n").filter(Boolean);
const dir = mkdtempSync(join(tmpdir(), "d1-"));
for (let i = 0; i < lines.length; i += CHUNK_STATEMENTS) {
  const chunk = lines.slice(i, i + CHUNK_STATEMENTS);
  const file = join(dir, `${i}.sql`);
  writeFileSync(file, chunk.join("\n") + "\n");
  wrangler("d1", "execute", db, "--remote", "--yes", "--file", file);
  console.log(`${Math.min(i + CHUNK_STATEMENTS, lines.length)}/${lines.length} statements`);
}

const count = JSON.parse(
  wrangler(
    "d1",
    "execute",
    db,
    "--remote",
    "--yes",
    "--json",
    "--command",
    "SELECT count(*) AS n FROM seq",
  ),
) as { results: { n: number }[] }[];
const rows = count[0]?.results[0]?.n ?? 0;
console.log(`${db} holds ${rows} rows`);
if (rows < 300_000) {
  console.error("row count too low to go live");
  process.exit(1);
}
wrangler("kv", "key", "put", "live-db", standby, "--namespace-id", KV_ID, "--remote");
console.log(`live-db is now ${standby}`);
