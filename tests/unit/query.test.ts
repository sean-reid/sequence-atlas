import { describe, expect, it } from "vitest";
import { classify, nameMatch, termsMatch } from "../../shared/query.ts";

describe("classify", () => {
  it("reads a-numbers in any case", () => {
    expect(classify("A000045")).toEqual({ kind: "anumber", number: 45 });
    expect(classify("a45")).toEqual({ kind: "anumber", number: 45 });
  });

  it("treats a bare short integer as an a-number and runs of terms as terms", () => {
    expect(classify("45")).toEqual({ kind: "anumber", number: 45 });
    expect(classify("1, 1, 2, 3, 5")).toEqual({ kind: "terms", terms: ["1", "1", "2", "3", "5"] });
    expect(classify("0 -1 02")).toEqual({ kind: "terms", terms: ["0", "1", "2"] });
  });

  it("turns everything else into lower case words", () => {
    expect(classify("  Fibonacci numbers: F(n) ")).toEqual({
      kind: "text",
      words: ["fibonacci", "numbers", "f", "n"],
    });
    expect(classify("   ")).toEqual({ kind: "empty" });
    expect(classify("!!!")).toEqual({ kind: "empty" });
  });
});

describe("match expressions", () => {
  it("quote words and phrases so punctuation cannot reach fts5", () => {
    expect(nameMatch(["prime", "num"])).toBe('"prime"* "num"*');
    expect(termsMatch(["1", "2", "3"])).toBe('"1 2 3"');
  });
});
