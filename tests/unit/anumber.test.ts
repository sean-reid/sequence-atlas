import { describe, expect, it } from "vitest";
import { formatANumber, parseANumber } from "../../shared/anumber.ts";

describe("parseANumber", () => {
  it("accepts padded, unpadded, and lower case forms", () => {
    expect(parseANumber("A000045")).toBe(45);
    expect(parseANumber("a45")).toBe(45);
    expect(parseANumber(" 45 ")).toBe(45);
    expect(parseANumber("A1234567")).toBe(1234567);
  });

  it("rejects zero, words, and term lists", () => {
    expect(parseANumber("A000000")).toBeNull();
    expect(parseANumber("fibonacci")).toBeNull();
    expect(parseANumber("1,1,2,3")).toBeNull();
  });
});

describe("formatANumber", () => {
  it("pads to six digits and keeps longer numbers whole", () => {
    expect(formatANumber(45)).toBe("A000045");
    expect(formatANumber(1234567)).toBe("A1234567");
  });
});
