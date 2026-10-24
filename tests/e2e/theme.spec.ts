import { expect, test } from "@playwright/test";
import { open } from "./helpers.ts";

test.use({ colorScheme: "light" });

test("a light scheme offers Dark, and the choice sets the theme and survives a reload", async ({
  page,
}) => {
  await open(page, "/");
  const button = page.locator("#theme");
  await expect(button).toHaveText("Dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await button.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(button).toHaveText("Light");
  await page.reload();
  await expect(page.locator("body[data-ready]")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(button).toHaveText("Light");
});

test("a scheme change mid-session flips the label when nothing is stored", async ({ page }) => {
  await open(page, "/");
  await expect(page.locator("#theme")).toHaveText("Dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("#theme")).toHaveText("Light");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("#theme")).toHaveText("Dark");
});
