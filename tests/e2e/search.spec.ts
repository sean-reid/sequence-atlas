import { expect, test } from "@playwright/test";
import { open } from "./helpers.ts";

test("search finds the real Fibonacci entry and Enter opens it", async ({ page }) => {
  await open(page, "/");
  await page.fill("#q", "fibon");
  const hits = page.locator("#results .hit");
  await expect(hits).toHaveCount(1);
  await expect(hits.first().locator(".id")).toHaveText("A000045");
  await expect(hits.first().locator(".nm")).toContainText("Fibonacci numbers");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/A000045/);
  await expect(page.locator("#p-number")).toHaveText("A000045");
  await expect(page.locator("#p-name")).toContainText("Fibonacci");
  await page.fill("#q", "zzzz");
  await expect(page.locator("#results .note")).toHaveText("Nothing matches.");
});

test("a rate limited search shows the unavailable note", async ({ page }) => {
  await page.route(/\/api\/search\?/, (route) =>
    route.fulfill({ status: 429, json: { error: "slow down" } }),
  );
  await open(page, "/");
  await page.fill("#q", "fibon");
  await expect(page.locator("#results .note")).toHaveText("Search is unavailable right now.");
  await expect(page.locator("#results .hit")).toHaveCount(0);
});

test.describe("keyboard in the search box", () => {
  test("ArrowDown twice then Enter picks the third hit", async ({ page }) => {
    await open(page, "/");
    await page.fill("#q", "sequence");
    const hits = page.locator("#results .hit");
    await expect(hits).toHaveCount(20);
    const third = await hits.nth(2).locator(".id").textContent();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(hits.nth(2)).toHaveClass(/active/);
    await expect(page.locator("#q")).toHaveAttribute("aria-activedescendant", "hit-2");
    await page.keyboard.press("Enter");
    await expect(page.locator("#p-number")).toHaveText(third ?? "");
    await expect(page).toHaveURL(new RegExp(`/${third}`));
    await expect(page.locator("#q")).toHaveValue(third ?? "");
  });

  test("ArrowUp from the first hit wraps to the last", async ({ page }) => {
    await open(page, "/");
    await page.fill("#q", "sequence");
    const hits = page.locator("#results .hit");
    await expect(hits).toHaveCount(20);
    await expect(hits.first()).toHaveClass(/active/);
    await page.keyboard.press("ArrowUp");
    await expect(hits.last()).toHaveClass(/active/);
    await expect(hits.first()).not.toHaveClass(/active/);
    await expect(page.locator("#q")).toHaveAttribute("aria-activedescendant", "hit-19");
  });

  test("Escape hides the results and keeps the typed text", async ({ page }) => {
    await open(page, "/");
    await page.fill("#q", "sequence");
    await expect(page.locator("#results .hit")).toHaveCount(20);
    await page.keyboard.press("Escape");
    await expect(page.locator("#results")).toBeHidden();
    await expect(page.locator("#q")).toHaveValue("sequence");
    await expect(page.locator("#q")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#panel")).toBeHidden();
  });
});
