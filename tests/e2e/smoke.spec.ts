import { expect, test } from "@playwright/test";

test("the front page loads the map", async ({ page }, info) => {
  await page.goto("/");
  await expect(page).toHaveTitle("sequence atlas");
  await expect(page.locator("h1")).toHaveText("sequence atlas");
  await expect(page.locator("body[data-ready]")).toBeVisible();
  await expect(page.locator("#labels span").first()).toBeVisible();
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /og\.jpg$/);
  expect((await page.request.get("/og.jpg")).status()).toBe(200);
  await page.screenshot({ path: info.outputPath("front.png") });
});

test("health answers and unknown api routes answer 404 as json", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true });
  const missing = await request.get("/api/nothing");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "not found" });
});

test("security headers are set and the inline script is allowed", async ({ request }) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("data files come with long cache headers under a version", async ({ request }) => {
  const manifest = await request.get("/data/manifest.json");
  expect(manifest.status()).toBe(200);
  const { version } = (await manifest.json()) as { version: string };
  const layout = await request.get(`/data/v/${version}/all.layout.bin`);
  expect(layout.status()).toBe(200);
  expect((await layout.body()).subarray(0, 4).toString()).toBe("ATL1");
  expect((await request.get(`/data/v/${version}/nothing.bin`)).status()).toBe(404);
});
