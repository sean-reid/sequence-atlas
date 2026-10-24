import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS, SLOTS, scheme } from "../../src/color.ts";

const css = (name: string) => `<${name.slice(2)}>`;

describe("slot tables", () => {
  it("map growth codes 0 to 6 onto the ramp and 7 onto noise", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 200].map((g) => SLOTS.growth(g, 0, 0))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 0, 0,
    ]);
  });

  it("bucket recurrence orders, with 0 and anything past 12 handled", () => {
    const orders = Array.from({ length: 15 }, (_, o) => SLOTS.order(0, o, 0));
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 5, 6, 6, 6, 7, 7, 7, 7, 7]);
  });

  it("use the keyword group as the slot and send 0 and 9 to noise", () => {
    expect([0, 1, 4, 8, 9].map((k) => SLOTS.keyword(0, 0, k))).toEqual([0, 1, 4, 8, 0]);
    expect(SLOTS.cluster(5, 5, 5)).toBe(0);
  });
});

describe("scheme", () => {
  it("builds the legend from the label tables in slot order", () => {
    const labels = {
      growth: ["g0", "g1", "g2", "g3", "g4", "g5", "g6", "g7"],
      order: ["o1", "o2", "o3", "o4", "o5", "o6", "o7", "none"],
      keyword: ["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8"],
    };
    const growth = scheme("growth", css, labels);
    expect(growth.legend.map((l) => l.label)).toEqual(labels.growth);
    expect(growth.legend[0]?.swatch).toBe("<s1>");
    expect(growth.legend[7]?.swatch).toBe("<noise>");
    expect(growth.palette).toHaveLength(9);
    const order = scheme("order", css, labels);
    expect(order.legend.map((l) => l.label)).toEqual(labels.order);
    const keyword = scheme("keyword", css, labels);
    expect(keyword.legend.map((l) => l.label)).toEqual([
      "k1",
      "k2",
      "k3",
      "k4",
      "k5",
      "k6",
      "k7",
      "k8",
      "k0",
    ]);
    expect(keyword.legend[0]?.swatch).toBe("<c1>");
    expect(keyword.legend[8]?.swatch).toBe("<noise>");
    expect(scheme("cluster", css, labels).legend).toEqual([]);
  });

  it("falls back to the built in tables", () => {
    expect(scheme("growth", css).legend.map((l) => l.label)).toEqual(DEFAULT_LABELS.growth);
    expect(DEFAULT_LABELS.keyword[0]).toBe("none of these");
  });
});
