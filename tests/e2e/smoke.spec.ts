import { expect, test } from "@playwright/test";

test("the front page loads", async ({ page }, info) => {
  await page.goto("/");
  await expect(page).toHaveTitle("sequence-atlas");
  await expect(page.locator("h1")).toHaveText("sequence-atlas");
  await page.screenshot({ path: info.outputPath("front.png"), fullPage: true });
});

test("health answers and unknown api routes answer 404 as json", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ ok: true });
  const missing = await request.get("/api/nothing");
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: "not found" });
});

test("security headers are set", async ({ request }) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});
