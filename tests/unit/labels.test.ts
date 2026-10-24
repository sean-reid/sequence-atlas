import { describe, expect, it } from "vitest";
import { LABEL_BUDGET, labelBudget, placeLabels, type Rect } from "../../src/labels.ts";

// Clusters already in screen space: the projection is the identity.
const identity = (cx: number, cy: number): [number, number] => [cx, cy];
const at = (label: string, cx: number, cy: number) => ({ label, cx, cy });

describe("labelBudget", () => {
  it("steps up at the phone and tablet breakpoints", () => {
    expect(labelBudget(375)).toBe(LABEL_BUDGET.phone);
    expect(labelBudget(768)).toBe(LABEL_BUDGET.tablet);
    expect(labelBudget(1280)).toBe(LABEL_BUDGET.desktop);
  });
});

describe("placeLabels", () => {
  it("keeps labels off the chrome, off each other, and on screen", () => {
    const chrome: Rect[] = [[0, 0, 400, 120]];
    const placed = placeLabels(
      [
        at("under the header", 200, 60),
        at("clear", 600, 400),
        at("too close", 610, 405),
        at("edge", 1270, 400),
        at("below", 600, 795),
        at("fine", 900, 400),
      ],
      identity,
      1280,
      800,
      chrome,
    );
    expect(placed.map((p) => p.label)).toEqual(["clear", "fine"]);
    expect(placed[0]).toEqual({ x: 600, y: 400, label: "clear" });
  });

  it("places each label text once and stops at the budget", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      at(`island ${i}`, 50 + (i % 15) * 80, 40 + Math.floor(i / 15) * 30),
    );
    const twice = [at("twin", 100, 100), at("twin", 500, 500), ...many];
    const placed = placeLabels(twice, identity, 1280, 800, []);
    expect(placed.filter((p) => p.label === "twin")).toHaveLength(1);
    expect(placed).toHaveLength(LABEL_BUDGET.desktop);
    const phone = placeLabels(twice, identity, 375, 740, []);
    expect(phone).toHaveLength(LABEL_BUDGET.phone);
  });

  it("uses the projection it is given", () => {
    const flip = (cx: number, cy: number): [number, number] => [1280 - cx, 800 - cy];
    expect(placeLabels([at("a", 280, 100)], flip, 1280, 800, [])).toEqual([
      { x: 1000, y: 700, label: "a" },
    ]);
  });
});
