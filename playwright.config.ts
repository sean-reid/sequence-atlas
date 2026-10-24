import { defineConfig, devices } from "@playwright/test";

const port = 8787;
const apiPort = 8789;

// Each wrangler dev gets its own persisted state: the API suite spends the
// per-minute search budget, which is keyed on 127.0.0.1 and would otherwise
// be shared with every page test.
const pageState = ".wrangler/page-state";
const apiState = ".wrangler/api-state";

// One fixture feeds both stores: the data files the page loads and the
// meta.tsv the search loader reads come from the same run.
const seed = (state: string, data: string) =>
  [
    `rm -rf ${state}`,
    `npx wrangler d1 migrations apply sequence-atlas --local --persist-to ${state}`,
    `node scripts/fixture-data.ts ${data}`,
    `node scripts/search-sql.ts ${data}/meta.tsv ${state}/fixture.sql`,
    `npx wrangler d1 execute sequence-atlas --local --persist-to ${state} --file ${state}/fixture.sql`,
  ].join(" && ");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  projects: [
    {
      name: "mobile",
      testIgnore: /api\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 740 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "tablet",
      testIgnore: /api\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: "desktop",
      testIgnore: /api\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "api",
      testMatch: /api\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${apiPort}` },
    },
  ],
  webServer: [
    {
      command: [
        "npm run build",
        seed(pageState, "dist/data"),
        `npx wrangler dev --port ${port} --ip 127.0.0.1 --persist-to ${pageState}`,
      ].join(" && "),
      url: `http://127.0.0.1:${port}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: [
        seed(apiState, `${apiState}/data`),
        `npx wrangler dev --port ${apiPort} --ip 127.0.0.1 --persist-to ${apiState}`,
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
