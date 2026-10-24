import { expect, test } from "@playwright/test";
import { hashOf, open } from "./helpers.ts";

test("Escape with a panel open closes it and focuses the map", async ({ page }) => {
  await open(page, "/A000045");
  await expect(page.locator("#panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#panel")).toBeHidden();
  await expect(page.locator("#map")).toBeFocused();
  await expect(page).toHaveURL(/\/#/);
});

test("arrow keys pan the focused map and plus and minus zoom it", async ({ page }) => {
  await open(page, "/");
  const start = hashOf(page.url());
  await page.locator("#map").focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => hashOf(page.url()).x).toBeCloseTo(start.x + 0.1, 3);
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => hashOf(page.url()).y).toBeCloseTo(start.y - 0.1, 3);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => hashOf(page.url())).toEqual(start);
  await page.keyboard.press("+");
  await expect.poll(() => hashOf(page.url()).z).toBeCloseTo(start.z * 1.5, 2);
  await page.keyboard.press("-");
  await expect.poll(() => hashOf(page.url()).z).toBeCloseTo(start.z, 2);
});
