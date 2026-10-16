// Uploads the artefact directory to the R2 bucket through the Cloudflare REST
// API, sending only objects whose content hash differs from the hashes.json
// recorded by the previous sync, then writes the new hashes.json last.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const dir = process.argv[2] ?? "";
const prefix = process.argv[3] ?? "";
if (!dir || !prefix) {
  console.error("usage: node scripts/r2-sync.ts <artefact-dir> <key-prefix>");
  process.exit(2);
}
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET ?? "sequence-atlas";
if (!token || !account) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
  process.exit(2);
}
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/`;
const headers = { authorization: `Bearer ${token}` };
const CONCURRENCY = 6;

function walk(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (
      !/\.(npz|npy|log)$/.test(entry) &&
      entry !== "hashes.json" &&
      entry !== "manifest.json"
    ) {
      out.push(path);
    }
  }
  return out;
}

async function remoteHashes(): Promise<Record<string, string>> {
  const res = await fetch(`${base}${encodeURIComponent(`${prefix}/hashes.json`)}`, { headers });
  if (res.status === 404) return {};
  if (!res.ok) throw new Error(`hashes.json: ${res.status}`);
  return (await res.json()) as Record<string, string>;
}

async function put(key: string, body: Buffer, type: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${base}${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { ...headers, "content-type": type },
      body: new Blob([Uint8Array.from(body)]),
    });
    if (res.ok) return;
    if (attempt >= 12) throw new Error(`${key}: ${res.status} ${await res.text()}`);
    // The API allows about 1,200 requests per five minutes; back off and retry.
    const wait = res.status === 429 ? 15_000 : 1000 * attempt;
    await new Promise((r) => setTimeout(r, wait));
  }
}

const files = walk(dir);
const previous = await remoteHashes();
const next: Record<string, string> = {};
const changed: string[] = [];
for (const path of files) {
  const rel = relative(dir, path).split("\\").join("/");
  const hash = createHash("md5").update(readFileSync(path)).digest("hex");
  next[rel] = hash;
  if (previous[rel] !== hash) changed.push(rel);
}
console.log(`${files.length} files, ${changed.length} changed since the last sync`);

let cursor = 0;
let done = 0;
async function worker(): Promise<void> {
  while (cursor < changed.length) {
    const rel = changed[cursor++]!;
    const type = rel.endsWith(".json") ? "application/json" : "application/octet-stream";
    await put(`${prefix}/${rel}`, readFileSync(join(dir, rel)), type);
    done++;
    if (done % 500 === 0) console.log(`${done}/${changed.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
await put(`${prefix}/hashes.json`, Buffer.from(JSON.stringify(next)), "application/json");
console.log(`uploaded ${done} objects under ${prefix}`);
