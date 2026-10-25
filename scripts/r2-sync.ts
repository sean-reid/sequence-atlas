// Uploads the artifact directory to the R2 bucket, sending only objects whose
// content hash differs from the hashes.json recorded by the previous sync,
// then writes the new hashes.json last.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { env, GZIP_KINDS, r2Get, r2Put } from "./cloudflare.ts";

const dir = process.argv[2] ?? "";
const prefix = process.argv[3] ?? "";
if (!dir || !prefix) {
  console.error("usage: node scripts/r2-sync.ts <artifact-dir> <key-prefix>");
  process.exit(2);
}
env("usage: node scripts/r2-sync.ts <artifact-dir> <key-prefix>");
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
  const res = await r2Get(`${prefix}/hashes.json`);
  return res ? ((await res.json()) as Record<string, string>) : {};
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
    const body = readFileSync(join(dir, rel));
    if (GZIP_KINDS.test(rel)) {
      await r2Put(`${prefix}/${rel}`, gzipSync(body), type, { "content-encoding": "gzip" });
    } else {
      await r2Put(`${prefix}/${rel}`, body, type);
    }
    done++;
    if (done % 500 === 0) console.log(`${done}/${changed.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const hashes = JSON.stringify(next);
await r2Put(`${prefix}/hashes.json`, hashes, "application/json");
// The manifest step digests this file into the build id that keys every data URL.
writeFileSync(join(dir, "hashes.json"), hashes);
console.log(`uploaded ${done} objects under ${prefix}`);
