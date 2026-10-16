import { defineConfig, devices } from "@playwright/test";

const port = 8787;
const apiPort = 8789;

// The API suite gets its own wrangler dev with its own state, since the rate
// limit is keyed on 127.0.0.1 and would be shared with every page test.
const apiState = ".wrangler/api-state";

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
      command: `npm run build && node scripts/fixture-data.ts dist/data && npx wrangler dev --port ${port} --ip 127.0.0.1`,
      url: `http://127.0.0.1:${port}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: [
        `rm -rf ${apiState}`,
        `npx wrangler d1 migrations apply sequence-atlas --local --persist-to ${apiState}`,
        `node scripts/search-sql.ts --fixture ${apiState}/fixture.sql`,
        `npx wrangler d1 execute sequence-atlas --local --persist-to ${apiState} --file ${apiState}/fixture.sql`,
        `npx wrangler dev --port ${apiPort} --ip 127.0.0.1 --persist-to ${apiState}`,
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
