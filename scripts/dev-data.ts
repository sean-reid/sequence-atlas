// Seeds wrangler's local R2 state from an artifact directory so wrangler dev
// serves real data through the production R2 path with nothing in public/.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { R2Bucket } from "@cloudflare/workers-types";
import { getPlatformProxy } from "wrangler";
import { GZIP_KINDS } from "./cloudflare.ts";

const dir = process.argv[2] ?? join(homedir(), ".cache", "sequence-atlas", "spike-fast");
if (!existsSync(join(dir, "manifest.json"))) {
  console.error(`usage: node scripts/dev-data.ts [artifact-dir]; ${dir} has no manifest.json`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
  version: string;
  families: string[];
  build?: string;
};
const hashes = join(dir, "hashes.json");
manifest.build ??= existsSync(hashes)
  ? createHash("md5").update(readFileSync(hashes)).digest("hex").slice(0, 12)
  : "dev";
const prefix = `v/${manifest.version}`;

const files = ["numbers.u32", "color.u8", "features.json"];
for (const family of manifest.families) {
  files.push(`${family}.layout.bin`, `${family}.cluster.u16`, `${family}.clusters.json`);
}
for (const kind of ["base", ...manifest.families]) {
  files.push(`shards/${kind}.pack`, `shards/${kind}.index.json`);
}

const { env, dispose } = await getPlatformProxy<{ DATA: R2Bucket }>({
  configPath: "wrangler.jsonc",
  persist: true,
  remoteBindings: false,
});
let bytes = 0;
for (const name of files) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    console.error(`skipping ${name}: not in ${dir}`);
    continue;
  }
  const raw = readFileSync(path);
  const gzip = GZIP_KINDS.test(name);
  const body = gzip ? gzipSync(raw) : raw;
  await env.DATA.put(`${prefix}/${name}`, body, {
    httpMetadata: {
      contentType: name.endsWith(".json") ? "application/json" : "application/octet-stream",
      ...(gzip ? { contentEncoding: "gzip" } : {}),
    },
  });
  bytes += body.length;
}
await env.DATA.put("manifest.json", JSON.stringify(manifest), {
  httpMetadata: { contentType: "application/json" },
});
await dispose();
console.log(
  `${files.length} objects, ${(bytes / 1048576).toFixed(0)} MB, under ${prefix} in .wrangler/state`,
);
