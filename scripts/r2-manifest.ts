// Publishes the artifact directory's manifest as the bucket's live manifest,
// which is the moment the site switches to a new snapshot.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "";
const prefix = process.argv[3] ?? "";
if (!dir || !prefix) {
  console.error("usage: node scripts/r2-manifest.ts <artifact-dir> <key-prefix>");
  process.exit(2);
}
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET ?? "sequence-atlas";
if (!token || !account) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Record<
  string,
  unknown
>;
manifest.version = prefix.replace(/^v\//, "");
const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/manifest.json`,
  {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(manifest),
  },
);
if (!res.ok) {
  console.error(`manifest: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`manifest now points at ${manifest.version} with ${manifest.count} sequences`);
