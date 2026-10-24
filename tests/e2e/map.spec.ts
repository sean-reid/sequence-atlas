import { expect, test } from "@playwright/test";
import { hashOf, open } from "./helpers.ts";

test("a deep link opens the sequence with its neighbors", async ({ page }, info) => {
  await open(page, "/A000045/recur");
  const panel = page.locator("#panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("#p-number")).toHaveText("A000045");
  await expect(panel.locator("#p-name")).toContainText("Fibonacci");
  await expect(panel.locator("#p-near-head")).toHaveText("Nearest in the recurrence map");
  await expect(panel.locator("#p-near li")).toHaveCount(5);
  await expect(panel.locator("#p-near .why").first()).toHaveText("growth rate, parity balance");
  await expect(panel.locator("#p-oeis")).toHaveAttribute("href", "https://oeis.org/A000045");
  await expect(page.locator(".metrics button.on")).toHaveText("Recurrence");
  await page.screenshot({ path: info.outputPath("selected.png") });
});

test("switching the measure keeps the selection and rewrites the url", async ({ page }) => {
  await open(page, "/A000045");
  await page.locator(".metrics button", { hasText: "Growth" }).click();
  await expect(page).toHaveURL(/\/A000045\/growth/);
  await expect(page.locator("#p-near-head")).toHaveText("Nearest in the growth map");
  await page.goBack();
  await expect(page).toHaveURL(/\/A000045(#|$)/);
});

test("picking a neighbor moves the selection", async ({ page }) => {
  await open(page, "/A000045");
  await expect(page.locator("#p-near .pick").first()).toBeVisible();
  const first = await page.locator("#p-near .id").first().textContent();
  await page.locator("#p-near .pick").first().click();
  await expect(page.locator("#p-number")).toHaveText(first ?? "");
  await expect(page).toHaveURL(new RegExp(`/${first}`));
});

test("close returns to the bare map", async ({ page }) => {
  await open(page, "/A000045/arith#x=0.1&y=0.2&z=3");
  await expect(page.locator("#panel")).toBeVisible();
  await page.locator("#p-close").click();
  await expect(page.locator("#panel")).toBeHidden();
  await expect(page).toHaveURL(/\/arith#/);
});

test("the color variable recolors the map, shows a legend, and survives a reload", async ({
  page,
}, info) => {
  test.skip(
    info.project.name === "mobile",
    "phones get the sheet layout, covered by the tablet project",
  );
  // Under 768px the color buttons live in a sheet behind the Color button.
  const openSheet = async () => {
    const toggle = page.locator("#color-toggle");
    if (await toggle.isVisible()) await toggle.click();
  };
  await open(page, "/");
  await expect(page.locator("#legend")).toBeHidden();
  await openSheet();
  await page.locator(".colors button", { hasText: "Growth" }).click();
  await expect(page).toHaveURL(/c=growth/);
  await openSheet();
  await expect(page.locator("#legend li")).toHaveCount(8);
  await page.reload();
  await expect(page.locator("body[data-ready]")).toBeVisible();
  await openSheet();
  await expect(page.locator(".colors button.on")).toHaveText("Growth");
  await page.screenshot({ path: info.outputPath("growth-color.png") });
});

test("labels follow a drag, settle when it ends, and the view moves with it", async ({ page }) => {
  await open(page, "/");
  const { width, height } = page.viewportSize()!;
  const start = hashOf(page.url());
  const label = page.locator("#labels span").first();
  await expect(label).toBeVisible();
  const before = await label.boundingBox();
  await page.mouse.move(150, 320);
  await page.mouse.down();
  await page.mouse.move(210, 360, { steps: 5 });
  const during = await label.boundingBox();
  expect(Math.round(during!.x - before!.x)).toBe(60);
  expect(Math.round(during!.y - before!.y)).toBe(40);
  await page.mouse.up();
  // The spans are rebuilt on the frame after the pointer lifts, so a stale one has no box.
  await expect
    .poll(async () => ((await label.boundingBox())?.x ?? NaN) - before!.x, { timeout: 2000 })
    .toBeGreaterThan(50);
  await expect(page.locator("#labels")).toHaveAttribute("style", "");
  // A drag of 60 by 40 pixels moves the view by twice that fraction of the canvas.
  await expect.poll(() => hashOf(page.url()).x).toBeCloseTo(start.x + 120 / width, 2);
  expect(hashOf(page.url()).y).toBeCloseTo(start.y - 80 / height, 2);
  expect(hashOf(page.url()).z).toBe(start.z);
});
