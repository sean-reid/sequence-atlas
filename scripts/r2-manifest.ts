// Publishes the artifact directory's manifest as the bucket's live manifest,
// which is the moment the site switches to a new snapshot.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env, r2Put } from "./cloudflare.ts";

const dir = process.argv[2] ?? "";
const prefix = process.argv[3] ?? "";
if (!dir || !prefix) {
  console.error("usage: node scripts/r2-manifest.ts <artifact-dir> <key-prefix>");
  process.exit(2);
}
env("usage: node scripts/r2-manifest.ts <artifact-dir> <key-prefix>");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<
  string,
  unknown
>;
manifest.version = prefix.replace(/^v\//, "");
const hashes = join(dir, "hashes.json");
if (!existsSync(hashes)) {
  console.error(
    "hashes.json is missing; run r2-sync first so the build id reflects what was uploaded",
  );
  process.exit(1);
}
manifest.build = createHash("md5").update(readFileSync(hashes)).digest("hex").slice(0, 12);
await r2Put("manifest.json", JSON.stringify(manifest), "application/json");
console.log(
  `manifest now points at ${manifest.version} build ${manifest.build} with ${manifest.count} sequences`,
);
