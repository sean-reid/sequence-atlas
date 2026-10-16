import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseLayout, pointAt } from "../../shared/layout.ts";

// Written by write_layout in tools/layout/layout.py from these five points.
const written = [
  [-3.5, 2.0],
  [0.0, 0.0],
  [10.25, -7.75],
  [1.0, 1.0],
  [-3.5, -7.75],
];

const fixture = () => {
  const bytes = readFileSync(new URL("../fixtures/layout-5.bin", import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe("parseLayout", () => {
  it("reads the python writer's output back within quantisation error", () => {
    const layout = parseLayout(fixture());
    expect(layout.count).toBe(5);
    expect(layout.bounds).toEqual([-3.5, -7.75, 10.25, 2.0]);
    const step = Math.max(10.25 + 3.5, 2.0 + 7.75) / 65535;
    written.forEach(([x, y], i) => {
      const [px, py] = pointAt(layout, i);
      expect(Math.abs(px - x!)).toBeLessThan(step);
      expect(Math.abs(py - y!)).toBeLessThan(step);
    });
  });

  it("rejects other files and truncated ones", () => {
    expect(() => parseLayout(new ArrayBuffer(8))).toThrow("not a layout file");
    expect(() => parseLayout(fixture().slice(0, 30))).toThrow("expected");
  });
});
