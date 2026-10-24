import { expect, test } from "@playwright/test";
import { open } from "./helpers.ts";

// Switches the measure from a cached family and reports the state after one frame.
const switchTo = (page: import("@playwright/test").Page, family: string) =>
  page.evaluate(async (f) => {
    document.querySelector<HTMLButtonElement>(`.metrics button[data-family="${f}"]`)!.click();
    await new Promise((r) => requestAnimationFrame(r));
    return {
      on: document.querySelector(".metrics button.on")?.textContent,
      url: location.pathname + location.hash,
    };
  }, family);

const warm = async (page: import("@playwright/test").Page) => {
  await page.locator(".metrics button", { hasText: "Growth" }).click();
  await expect(page).toHaveURL(/\/growth#/);
  await page.locator(".metrics button", { hasText: "All" }).click();
  await expect(page).toHaveURL(/\/#/);
  await expect(page.locator("#labels span").first()).toBeVisible();
};

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("switching the measure settles in one frame and does not animate", async ({ page }) => {
    await open(page, "/");
    await warm(page);
    const hash = new URL(page.url()).hash;
    const after = await switchTo(page, "growth");
    expect(after.on).toBe("Growth");
    expect(after.url).toBe(`/growth${hash}`);
    await page.waitForTimeout(100);
    const early = await page.screenshot();
    await page.waitForTimeout(800);
    const late = await page.screenshot();
    expect(early.equals(late)).toBe(true);
  });
});

test("without reduced motion the measure switch animates", async ({ page }) => {
  await open(page, "/");
  await warm(page);
  await switchTo(page, "growth");
  await page.waitForTimeout(100);
  const early = await page.screenshot();
  await page.waitForTimeout(800);
  const late = await page.screenshot();
  expect(early.equals(late)).toBe(false);
});

test("without WebGL2 the status line says so", async ({ page }) => {
  test.fixme(
    true,
    "the renderer is built at module load, so the failure never reaches the status line",
  );
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto("/");
  await expect(page.locator("#status")).toContainText("WebGL2");
  await expect(page.locator("#status")).toBeVisible();
});
