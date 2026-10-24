import { expect, test } from "@playwright/test";
import { open } from "./helpers.ts";

test.skip(({ isMobile }) => !isMobile, "the sheet layout belongs to the phone project");

test("the close button is on screen and tall enough to tap", async ({ page }) => {
  await open(page, "/A000045");
  const { width, height } = page.viewportSize()!;
  const box = (await page.locator("#p-close").boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.y + box.height).toBeLessThanOrEqual(height);
});

test("search results stay in front of the open sheet", async ({ page }) => {
  await open(page, "/A000045");
  await page.fill("#q", "sequence");
  const hits = page.locator("#results .hit");
  await expect(hits).toHaveCount(20);
  await expect(page.locator("#panel")).toBeVisible();
  const results = (await page.locator("#results").boundingBox())!;
  const center = [results.x + results.width / 2, results.y + results.height / 2];
  const under = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest("#results, #panel")?.id,
    center,
  );
  expect(under).toBe("results");
  await hits.nth(1).click();
  await expect(page.locator("#p-number")).toHaveText("A000004");
});

test("the label budget on a phone is eight", async ({ page }) => {
  await open(page, "/");
  await expect(page.locator("#labels span").first()).toBeVisible();
  expect(await page.locator("#labels span").count()).toBeLessThanOrEqual(8);
});

test("the Color button opens the sheet and a choice closes it", async ({ page }) => {
  await open(page, "/");
  const toggle = page.locator("#color-toggle");
  const sheet = page.locator("#colors");
  await expect(sheet).toBeHidden();
  await toggle.click();
  await expect(sheet).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await sheet.locator("button", { hasText: "Growth" }).click();
  await expect(sheet).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/c=growth/);
});
