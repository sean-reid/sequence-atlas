import { describe, expect, it } from "vitest";
import {
  HEADER_BYTES,
  MAGIC,
  NOISE,
  QUANT_MAX,
  SHARD_SIZE,
  shardName,
} from "../../shared/format.ts";
import { parseLayout } from "../../shared/layout.ts";

describe("format constants", () => {
  it("match the python writer's values", () => {
    expect(NOISE).toBe(65535);
    expect(SHARD_SIZE).toBe(100);
    expect(QUANT_MAX).toBe(65535);
    expect(HEADER_BYTES).toBe(24);
    expect(new TextDecoder().decode(new Uint32Array([MAGIC]).buffer)).toBe("ATL1");
  });

  it("names the shard a number lives in", () => {
    expect(shardName(1)).toBe("00000");
    expect(shardName(99)).toBe("00000");
    expect(shardName(100)).toBe("00001");
    expect(shardName(376817)).toBe("03768");
  });

  it("is what parseLayout checks", () => {
    const buffer = new ArrayBuffer(HEADER_BYTES);
    new DataView(buffer).setUint32(0, MAGIC, true);
    expect(parseLayout(buffer).count).toBe(0);
  });
});
