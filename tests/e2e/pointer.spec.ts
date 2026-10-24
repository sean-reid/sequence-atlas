import { expect, test } from "@playwright/test";
import { fibonacciOnScreen, hashOf, open } from "./helpers.ts";

test("clicking a point selects it", async ({ page }) => {
  const at = await fibonacciOnScreen(page);
  await open(page, `/A000001${at.hash}`);
  await expect(page.locator("#p-number")).toHaveText("A000001");
  await page.mouse.click(at.sx, at.sy);
  await expect(page.locator("#p-number")).toHaveText("A000045");
  await expect(page.locator("#p-name")).toContainText("Fibonacci");
  await expect(page).toHaveURL(new RegExp(`/A000045${at.hash.replace(/[.?]/g, "\\$&")}$`));
});

test("clicking empty map closes the panel", async ({ page }) => {
  await open(page, "/A000045#x=0&y=0&z=60");
  await expect(page.locator("#panel")).toBeVisible();
  const { width, height } = page.viewportSize()!;
  await page.mouse.click(width / 2, height * 0.3);
  await expect(page.locator("#panel")).toBeHidden();
  await expect(page).toHaveURL(/\/#x=0&y=0&z=60$/);
});

test("the wheel zooms within half a second and stops at 60", async ({ page }) => {
  await open(page, "/");
  const { width, height } = page.viewportSize()!;
  const start = hashOf(page.url());
  await page.mouse.move(width / 2, height / 2);
  const settled = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        const before = location.hash;
        const tick = () => {
          if (location.hash !== before) resolve(performance.now() - t0);
          else if (performance.now() - t0 > 3000) resolve(Infinity);
          else setTimeout(tick, 5);
        };
        tick();
      }),
  );
  await page.mouse.wheel(0, -100);
  const ms = await settled;
  test.info().annotations.push({ type: "hash-settle-ms", description: ms.toFixed(0) });
  // The hash waits 250 ms after the last input; the rest is scheduler lag under load.
  expect(ms).toBeLessThan(500);
  // A notch of 100 scales by exp(0.22).
  expect(hashOf(page.url()).z).toBeCloseTo(start.z * Math.exp(0.22), 2);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -1000);
  await expect.poll(() => hashOf(page.url()).z).toBe(60);
  await page.mouse.wheel(0, -1000);
  await page.waitForTimeout(400);
  expect(hashOf(page.url()).z).toBe(60);
});

test("a pinch zooms in", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "two touch points need the phone project");
  await open(page, "/");
  const start = hashOf(page.url());
  const cdp = await page.context().newCDPSession(page);
  const points = (gap: number) => [
    { x: 187 - gap, y: 350 },
    { x: 187 + gap, y: 350 },
  ];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(40) });
  for (let gap = 50; gap <= 150; gap += 20) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(gap) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => hashOf(page.url()).z).toBeGreaterThan(start.z * 2);
  await expect(page.locator("#panel")).toBeHidden();
});

test("hovering a point names it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "hover needs a mouse");
  const at = await fibonacciOnScreen(page);
  await open(page, `/${at.hash}`);
  await expect(page.locator("#hover")).toBeHidden();
  await page.mouse.move(at.sx + 40, at.sy + 40);
  await page.mouse.move(at.sx, at.sy, { steps: 4 });
  await expect(page.locator("#hover")).toBeVisible();
  await expect(page.locator("#hover .id")).toHaveText("A000045");
  await expect(page.locator("#hover")).toContainText("Fibonacci numbers");
  await expect(page.locator("#panel")).toBeHidden();
  await page.mouse.move(at.sx + 200, at.sy + 200, { steps: 4 });
  await expect(page.locator("#hover")).toBeHidden();
});
