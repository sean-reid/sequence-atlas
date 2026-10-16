import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const LIMIT_KB = 16;
const dir = "dist/assets";

let total = 0;
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
  const path = join(dir, name);
  const gz = gzipSync(readFileSync(path)).length;
  total += gz;
  const raw = (statSync(path).size / 1024).toFixed(1);
  console.log(`${name}: ${raw} KB raw, ${(gz / 1024).toFixed(1)} KB gzip`);
}
for (const name of readdirSync("public/fonts")) {
  if (!name.endsWith(".woff2")) continue;
  const bytes = statSync(join("public/fonts", name)).size;
  console.log(`${name}: ${(bytes / 1024).toFixed(1)} KB preloaded (not in the budget)`);
}
const kb = total / 1024;
console.log(`total gzip: ${kb.toFixed(1)} KB (limit ${LIMIT_KB} KB)`);
if (kb > LIMIT_KB) {
  console.error("bundle over budget");
  process.exit(1);
}
