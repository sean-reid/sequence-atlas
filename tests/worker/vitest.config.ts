import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const root = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const migrations = await readD1Migrations(root("migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: root("wrangler.jsonc") },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
        dataBlobBindings: { PACK: root("tests/fixtures/pack/base.pack") },
        textBlobBindings: { PACK_INDEX: root("tests/fixtures/pack/base.index.json") },
      },
    }),
  ],
  test: {
    include: ["tests/worker/**/*.test.ts"],
    setupFiles: ["tests/worker/setup.ts"],
  },
});
