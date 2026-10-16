import { expect, test } from "@playwright/test";

test("a deep link opens the sequence with its neighbours", async ({ page }, info) => {
  await page.goto("/A000045/recur");
  await expect(page.locator("body[data-ready]")).toBeVisible();
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
  await page.goto("/A000045");
  await expect(page.locator("body[data-ready]")).toBeVisible();
  await page.locator(".metrics button", { hasText: "Growth" }).click();
  await expect(page).toHaveURL(/\/A000045\/growth/);
  await expect(page.locator("#p-near-head")).toHaveText("Nearest in the growth map");
  await page.goBack();
  await expect(page).toHaveURL(/\/A000045(#|$)/);
});

test("picking a neighbour moves the selection", async ({ page }) => {
  await page.goto("/A000045");
  await expect(page.locator("#p-near .pick").first()).toBeVisible();
  const first = await page.locator("#p-near .id").first().textContent();
  await page.locator("#p-near .pick").first().click();
  await expect(page.locator("#p-number")).toHaveText(first ?? "");
  await expect(page).toHaveURL(new RegExp(`/${first}`));
});

test("close returns to the bare map", async ({ page }) => {
  await page.goto("/A000045/arith#x=0.1&y=0.2&z=3");
  await expect(page.locator("#panel")).toBeVisible();
  await page.locator("#p-close").click();
  await expect(page.locator("#panel")).toBeHidden();
  await expect(page).toHaveURL(/\/arith#/);
});

test("the theme toggle persists", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body[data-ready]")).toBeVisible();
  const button = page.locator("#theme");
  const before = await button.textContent();
  await button.click();
  await expect(button).not.toHaveText(before ?? "");
  await page.reload();
  await expect(page.locator("body[data-ready]")).toBeVisible();
  await expect(button).not.toHaveText(before ?? "");
});
