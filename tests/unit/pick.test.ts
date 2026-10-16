import { describe, expect, it } from "vitest";
import { PointIndex } from "../../src/pick.ts";

const layout = (pts: number[]) => ({
  count: pts.length / 2,
  bounds: [0, 0, 1, 1] as [number, number, number, number],
  points: new Uint16Array(pts),
});

describe("PointIndex", () => {
  it("finds the nearest point across cell borders and respects the radius", () => {
    const index = new PointIndex(layout([100, 100, 255, 300, 257, 300, 60000, 60000]));
    expect(index.nearest(256, 300, 10)).toBe(1);
    expect(index.nearest(258, 300, 10)).toBe(2);
    expect(index.nearest(30000, 30000, 100)).toBe(-1);
    expect(index.nearest(65535, 65535, 20000)).toBe(3);
  });

  it("agrees with brute force on random points", () => {
    const n = 5000;
    const pts: number[] = [];
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) % 65536;
    for (let i = 0; i < n * 2; i++) pts.push(rand());
    const index = new PointIndex(layout(pts));
    for (let t = 0; t < 50; t++) {
      const qx = rand();
      const qy = rand();
      let best = -1;
      let bestD = 3000 * 3000;
      for (let i = 0; i < n; i++) {
        const d = (pts[i * 2]! - qx) ** 2 + (pts[i * 2 + 1]! - qy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      expect(index.nearest(qx, qy, 3000)).toBe(best);
    }
  });
});
