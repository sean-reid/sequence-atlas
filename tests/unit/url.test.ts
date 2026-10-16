import { describe, expect, it } from "vitest";
import { formatHash, formatPath, parseHash, parsePath } from "../../shared/url.ts";

describe("paths", () => {
  it("round trips a sequence and family", () => {
    expect(parsePath("/A000045/recur")).toEqual({ number: 45, family: "recur" });
    expect(formatPath({ number: 45, family: "recur" })).toBe("/A000045/recur");
    expect(formatPath({ number: 45, family: "all" })).toBe("/A000045");
    expect(formatPath({ number: null, family: "all" })).toBe("/");
    expect(formatPath({ number: null, family: "graph" })).toBe("/graph");
  });

  it("falls back for unknown families and junk", () => {
    expect(parsePath("/A000045/nope")).toEqual({ number: 45, family: "all" });
    expect(parsePath("/growth")).toEqual({ number: null, family: "growth" });
    expect(parsePath("/nothing/here")).toEqual({ number: null, family: "all" });
    expect(parsePath("/")).toEqual({ number: null, family: "all" });
  });
});

describe("hash", () => {
  it("keeps the view and color and drops defaults", () => {
    const state = { x: 0.25, y: -0.5, scale: 12, color: "order" as const };
    expect(parseHash(formatHash(state))).toEqual(state);
    expect(formatHash({ x: 0, y: 0, scale: 1, color: "cluster" })).toBe("");
    expect(parseHash("#z=-3&c=bogus")).toEqual({});
  });
});
