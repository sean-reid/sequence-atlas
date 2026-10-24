import { expect, test } from "@playwright/test";
import { open } from "./helpers.ts";

test("going back restores the measure, the panel head, and the view", async ({ page }) => {
  await open(page, "/A000045#x=0.1&y=0.2&z=3");
  await page.locator(".metrics button", { hasText: "Growth" }).click();
  await expect(page).toHaveURL(/\/A000045\/growth#x=0.1&y=0.2&z=3$/);
  await page.locator("#map").focus();
  await page.keyboard.press("+");
  await expect(page).toHaveURL(/\/A000045\/growth#x=0.15&y=0.3&z=4.5$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/A000045#x=0.1&y=0.2&z=3$/);
  await expect(page.locator(".metrics button.on")).toHaveText("All");
  await expect(page.locator("#p-near-head")).toHaveText("Nearest in the combined map");
  await expect(page.locator("#p-number")).toHaveText("A000045");
});

test("going back from a selection to the bare map hides the panel", async ({ page }) => {
  await open(page, "/");
  await page.fill("#q", "A000045");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/A000045/);
  await expect(page.locator("#panel")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/#x=/);
  await expect(page.locator("#panel")).toBeHidden();
});
