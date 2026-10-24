import { expect, test } from "@playwright/test";
import { open } from "./helpers.ts";

test("a base shard that fails to load says so", async ({ page }) => {
  await page.route(/\/shards\/base\//, (route) =>
    route.fulfill({ status: 404, json: { error: "not found" } }),
  );
  await open(page, "/A000045");
  await expect(page.locator("#p-number")).toHaveText("A000045");
  await expect(page.locator("#p-name")).toHaveText("The details for this sequence did not load.");
  await expect(page.locator("#p-summary")).toContainText("Island: decimal expansion.");
  await expect(page.locator("#p-near li")).toHaveCount(0);
});

test("a point outside every island gets no island sentence", async ({ page }) => {
  await open(page, "/A000045");
  await expect(page.locator("#p-summary")).toContainText("sits in the island");
  await expect(page.locator("#p-summary .cluster")).toHaveText("decimal expansion");
  await open(page, "/A000050");
  await expect(page.locator("#p-name")).toHaveText("Fixture sequence 50 of primes congruent.");
  await expect(page.locator("#p-summary")).toHaveText("quadratic growth.");
  await expect(page.locator("#p-summary .cluster")).toHaveCount(0);
});

test("two selections in one tick leave the panel on the last one", async ({ page }) => {
  await open(page, "/A000045");
  await expect(page.locator("#p-near .pick")).toHaveCount(5);
  const last = await page.evaluate(() => {
    const picks = document.querySelectorAll<HTMLButtonElement>("#p-near .pick");
    const id = picks[1]!.querySelector(".id")!.textContent;
    picks[0]!.click();
    picks[1]!.click();
    return id;
  });
  await expect(page).toHaveURL(new RegExp(`/${last}`));
  await expect(page.locator("#p-number")).toHaveText(last ?? "");
  await expect(page.locator("#p-name")).toHaveText(
    new RegExp(`^Fixture sequence ${Number(last!.slice(1))} `),
  );
  await expect(page.locator("#p-near .pick")).toHaveCount(5);
});
