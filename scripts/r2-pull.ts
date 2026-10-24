// Downloads the files layout.py place reads from a generation: numbers.u32
// and every family's layout, cluster ids, and cluster labels, with the family
// list taken from the live manifest.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { env, GZIP_KINDS, r2Get } from "./cloudflare.ts";

const usage = "usage: node scripts/r2-pull.ts <key-prefix> <out-dir>";
const prefix = process.argv[2] ?? "";
const dir = process.argv[3] ?? "";
if (!prefix || !dir) {
  console.error(usage);
  process.exit(2);
}
env(usage);

const manifestRes = await r2Get("manifest.json");
if (!manifestRes) {
  console.error("the bucket has no manifest.json");
  process.exit(1);
}
const manifest = (await manifestRes.json()) as { version: string; families: string[] };
if (`v/${manifest.version}` !== prefix) {
  console.error(`the manifest points at v/${manifest.version}, not ${prefix}`);
  process.exit(1);
}

const files = ["numbers.u32"];
for (const family of manifest.families) {
  files.push(`${family}.layout.bin`, `${family}.cluster.u16`, `${family}.clusters.json`);
}
mkdirSync(dir, { recursive: true });
for (const name of files) {
  const res = await r2Get(`${prefix}/${name}`);
  if (!res) {
    console.error(`${prefix}/${name} is missing`);
    process.exit(1);
  }
  let body = new Uint8Array(await res.arrayBuffer());
  // fetch decodes a body whose response says gzip; one that arrives without
  // the header and still starts with the gzip magic needs it here.
  const encoded = body[0] === 0x1f && body[1] === 0x8b && !res.headers.has("content-encoding");
  if (GZIP_KINDS.test(name) && encoded) body = new Uint8Array(gunzipSync(body));
  writeFileSync(join(dir, name), body);
}
console.log(`${files.length} files from ${prefix} in ${dir}`);
