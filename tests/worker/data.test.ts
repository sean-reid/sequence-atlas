import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { clusters, decoded, PREFIX, seedBucket } from "./seed.ts";

const get = (path: string, init?: RequestInit) => SELF.fetch(`https://atlas.test${path}`, init);

beforeAll(seedBucket);

describe("shards", () => {
  it("serves one member by range as gzip JSON", async () => {
    const res = await get(`/data/${PREFIX}/shards/base/00001.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const doc = JSON.parse(new TextDecoder().decode(await decoded(res))) as Record<
      string,
      { name: string }
    >;
    const keys = Object.keys(doc);
    expect(keys.length).toBe(96);
    expect(keys[0]).toBe("A000100");
    expect(keys.at(-1)).toBe("A000199");
    expect(doc.A000100?.name).toBe(
      "a(n) is the number of compositions of n in which the maximal part is 3.",
    );
  });

  it("answers 404 JSON for a shard the index does not name", async () => {
    const res = await get(`/data/${PREFIX}/shards/base/00009.json`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ error: "not found" });
    expect((await get(`/data/${PREFIX}/shards/nope/00001.json`)).status).toBe(404);
  });
});

describe("objects", () => {
  it("serves the manifest with a short cache life", async () => {
    const res = await get("/data/manifest.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(((await res.json()) as { version: string }).version).toBe("test");
  });

  it("passes a gzipped .u16 through with its encoding and an immutable cache life", async () => {
    const res = await get(`/data/${PREFIX}/all.cluster.u16`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(await decoded(res)).toEqual(clusters);
  });

  it("still decodes a gzipped .u16 on the second request", async () => {
    await get(`/data/${PREFIX}/all.cluster.u16`);
    const again = await get(`/data/${PREFIX}/all.cluster.u16`);
    expect(again.headers.get("content-encoding")).toBe("gzip");
    expect(await decoded(again)).toEqual(clusters);
  });

  it("serves a raw layout without an encoding", async () => {
    const res = await get(`/data/${PREFIX}/all.layout.bin`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([0x41, 0x54, 0x4c, 0x31]),
    );
  });
});

describe("key allowlist", () => {
  it("refuses keys outside manifest.json and v/<generation>/<path>", async () => {
    await env.DATA.put("hashes.json", "{}");
    await env.DATA.put("secret.txt", "no");
    for (const key of [
      "",
      "hashes.json",
      "secret.txt",
      "manifest.json/",
      "V/test/all.layout.bin",
      "v/test/",
      "v/TEST/all.layout.bin",
      "v/test/%2E%2E/manifest.json",
      "v/test/shards/%2E%2E/base.pack",
      "v/test/all%20layout.bin",
      "v/test/all.layout.bin%00",
      "v/te%2Fst/all.layout.bin",
      "%ZZ",
    ]) {
      const res = await get(`/data/${key}`);
      expect(res.status, key).toBe(404);
      expect(await res.json(), key).toEqual({ error: "not found" });
    }
  });

  it("allows a nested path under a generation", async () => {
    await env.DATA.put("v/gen-2/sub/dir/file_1.bin", new Uint8Array([7]));
    expect((await get("/data/v/gen-2/sub/dir/file_1.bin")).status).toBe(200);
  });
});

describe("methods", () => {
  it("answers HEAD with headers only", async () => {
    const res = await get("/data/manifest.json", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.text()).toBe("");
  });

  it("answers 405 to POST", async () => {
    const data = await get("/data/manifest.json", { method: "POST" });
    expect(data.status).toBe(405);
    const search = await get("/api/search?q=prime", { method: "POST" });
    expect(search.status).toBe(405);
    expect((await get("/api/nope")).status).toBe(404);
  });
});
