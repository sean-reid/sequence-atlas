import { describe, expect, it } from "vitest";
import { QUANT_MAX } from "../../shared/format.ts";
import { Projection } from "../../src/projection.ts";

const make = () => {
  const p = new Projection();
  p.resize(1280, 800);
  return p;
};

describe("Projection", () => {
  it("round trips screen pixels through quantized units at any view", () => {
    const p = make();
    for (const view of [
      { scale: 1.7, x: 0, y: 0 },
      { scale: 14, x: -3.2, y: 2.1 },
      { scale: 0.6, x: 0.4, y: -0.4 },
    ]) {
      p.view = view;
      for (const [sx, sy] of [
        [0, 0],
        [640, 400],
        [1279, 799],
        [17.5, 603.25],
      ] as const) {
        const [qx, qy] = p.screenToQuantized(sx, sy);
        const [bx, by] = p.quantizedToScreen(qx, qy);
        expect(bx).toBeCloseTo(sx, 6);
        expect(by).toBeCloseTo(sy, 6);
      }
    }
  });

  it("puts the quantized middle at the screen middle in the default view", () => {
    const p = make();
    const [x, y] = p.quantizedToScreen(QUANT_MAX / 2, QUANT_MAX / 2);
    expect(x).toBeCloseTo(640);
    expect(y).toBeCloseTo(400);
    const [qx, qy] = p.toScreen([-12, -12, 12, 12], 0, 0);
    expect(qx).toBeCloseTo(640, 0);
    expect(qy).toBeCloseTo(400, 0);
  });

  it("centers a point and keeps it still through a zoom about the middle", () => {
    const p = make();
    p.centerOn(1000, 60000, 14);
    expect(p.quantizedToScreen(1000, 60000)).toEqual([640, 400]);
    expect(p.view.scale).toBe(14);
    p.zoomAt(640, 400, 1.5, 0.6, 60);
    const [x, y] = p.quantizedToScreen(1000, 60000);
    expect(x).toBeCloseTo(640);
    expect(y).toBeCloseTo(400);
    expect(p.view.scale).toBe(21);
  });

  it("keeps the point under the cursor fixed while zooming and clamps the scale", () => {
    const p = make();
    const [qx, qy] = p.screenToQuantized(200, 700);
    p.zoomAt(200, 700, 3, 0.6, 60);
    const [x, y] = p.quantizedToScreen(qx, qy);
    expect(x).toBeCloseTo(200);
    expect(y).toBeCloseTo(700);
    p.zoomAt(200, 700, 1000, 0.6, 60);
    expect(p.view.scale).toBe(60);
    p.zoomAt(200, 700, 1e-6, 0.6, 60);
    expect(p.view.scale).toBe(0.6);
  });

  it("scales units per pixel with the zoom", () => {
    const p = make();
    p.view.scale = 2;
    expect(p.unitsPerPixel()).toBeCloseTo((QUANT_MAX + 1) / 1600);
  });
});
