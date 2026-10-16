import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

// Stamps the hash of the inline theme script into the CSP in _headers.
function stampCsp(): Plugin {
  let outDir = "dist";
  let scriptHash = "";
  return {
    name: "sequence-atlas:csp",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const inline = /<script>([\s\S]*?)<\/script>/.exec(html);
        if (inline)
          scriptHash = createHash("sha256")
            .update(inline[1] ?? "")
            .digest("base64");
        return html;
      },
    },
    closeBundle() {
      const path = resolve(outDir, "_headers");
      writeFileSync(path, readFileSync(path, "utf8").replace("__THEME_SCRIPT_HASH__", scriptHash));
    },
  };
}

export default defineConfig({
  plugins: [stampCsp()],
  build: {
    target: "es2022",
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
