import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS } from "../../src/color.ts";
import { parseFeatures } from "../../src/data.ts";

const columns = {
  all: [{ name: "g_log_last", phrase: "last term size" }],
  recur: [{ name: "r_order", phrase: "recurrence order" }],
};

const labels = {
  growth: ["periodic", "linear", "quadratic", "cubic", "poly", "exp", "fact", "other"],
  order: ["1", "2", "3", "4", "5-6", "7-9", "10-12", "none"],
  keyword: ["none of these", "core", "nice", "hard", "base", "mult", "tabl", "cons", "easy"],
};

describe("parseFeatures", () => {
  it("reads a snapshot without the label and format keys", () => {
    const features = parseFeatures(columns);
    expect(features.columns.all).toEqual(columns.all);
    expect(features.columns.growth).toBeUndefined();
    expect(features.labels).toBe(DEFAULT_LABELS);
    expect(features.format).toBeNull();
  });

  it("takes the writer's labels and format when present", () => {
    const format = { noise: 65535, shardSize: 100, quantMax: 65535, neighbors: 15 };
    const features = parseFeatures({ ...columns, labels, format });
    expect(features.labels).toEqual(labels);
    expect(features.format).toEqual(format);
    expect(features.columns.recur).toEqual(columns.recur);
  });

  it("keeps the built in table for a label list of the wrong length", () => {
    const features = parseFeatures({ ...columns, labels: { ...labels, order: ["1", "2"] } });
    expect(features.labels.growth).toEqual(labels.growth);
    expect(features.labels.order).toBe(DEFAULT_LABELS.order);
  });

  it("refuses a format block this client does not read", () => {
    const format = { noise: 65535, shardSize: 1000, quantMax: 65535, neighbors: 15 };
    expect(() => parseFeatures({ ...columns, format })).toThrow("shardSize is 1000");
    expect(() => parseFeatures(null)).toThrow("not an object");
  });
});
