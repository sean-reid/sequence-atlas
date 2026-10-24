import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { liveDb, type SearchResponse } from "../../worker/search.ts";
import { seedSearch } from "./seed.ts";

const search = async (q: string): Promise<{ status: number; body: SearchResponse }> => {
  const res = await SELF.fetch(`https://atlas.test/api/search?q=${encodeURIComponent(q)}`);
  return { status: res.status, body: (await res.json()) as SearchResponse };
};

const CAP = 2_000;

beforeAll(async () => {
  const rows = [
    {
      number: 45,
      name: "Fibonacci numbers: F(n) = F(n-1) + F(n-2).",
      terms: "0 1 1 2 3 5 8 13 21",
      weight: 0,
    },
    { number: 40, name: "The prime numbers.", terms: "2 3 5 7 11 13 17 19 23", weight: 0 },
    {
      number: 32,
      name: "Lucas numbers beginning at 2: L(n) = L(n-1) + L(n-2).",
      terms: "2 1 3 4 7 11 18 29",
      weight: 1,
    },
    { number: 1, name: "Number of groups of order n.", terms: "0 1 1 1 2 1 2 1 5 2 2", weight: 2 },
    {
      number: 7,
      name: "The characteristic function of {1}: a(n) = 0^n.",
      terms: "1 0 0 0 0 0 0 0",
      weight: 2,
    },
  ];
  // Rows past the scan cap, one of them weighted first, so the cap is observable.
  for (let i = 0; i < CAP + 100; i++) {
    rows.push({
      number: 1000 + i,
      name: `Zedbury sequence ${i}.`,
      terms: `${i} ${i + 1} ${i + 2}`,
      weight: i === CAP + 50 ? 0 : 2,
    });
  }
  await seedSearch(env.DB_A, rows);
  await seedSearch(env.DB_B, [
    { number: 2, name: "Standby copy: the prime numbers.", terms: "2 3 5 7 11 13", weight: 0 },
  ]);
});

describe("shapes", () => {
  it("resolves an a-number", async () => {
    const { status, body } = await search("A000045");
    expect(status).toBe(200);
    expect(body.kind).toBe("anumber");
    expect(body.results).toEqual([
      { number: 45, name: "Fibonacci numbers: F(n) = F(n-1) + F(n-2)." },
    ]);
    expect((await search("A999999")).body.results).toEqual([]);
  });

  it("matches every word as a prefix and orders by weight then number", async () => {
    const { body } = await search("fibon num");
    expect(body.kind).toBe("text");
    expect(body.results.map((r) => r.number)).toEqual([45]);
    const numbers = (await search("numbers")).body.results.map((r) => r.number);
    expect(numbers).toEqual([40, 45, 32]);
  });

  it("matches a phrase of consecutive terms", async () => {
    const { body } = await search("1, 2, 3, 5");
    expect(body.kind).toBe("terms");
    expect(body.results.map((r) => r.number)).toEqual([45]);
    expect((await search("3 5 8 13")).body.results.map((r) => r.number)).toEqual([45]);
    expect((await search("99 98 97")).body.results).toEqual([]);
  });

  it("refuses a one-letter prefix instead of scanning", async () => {
    for (const q of ["a", "n", "a b", "prime n"]) {
      const { status, body } = await search(q);
      expect(status).toBe(200);
      expect(body.kind, q).toBe("text");
      expect(body.results, q).toEqual([]);
    }
    expect((await search("pr")).body.results.map((r) => r.number)).toEqual([40]);
  });

  it("orders only the first 2,000 FTS hits", async () => {
    const { body } = await search("zedbury");
    expect(body.results.length).toBe(20);
    expect(body.results.map((r) => r.number)).not.toContain(1000 + CAP + 50);
    expect(body.results[0]?.number).toBe(1000);
  });

  it("answers an empty query without touching the database", async () => {
    expect((await search("")).body).toEqual({ kind: "empty", results: [] });
  });
});

describe("live database", () => {
  afterEach(() => vi.useRealTimers());

  it("follows the KV pointer and re-reads it after the TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 120_000);
    await env.STATE.put("live-db", "b");
    expect(await liveDb(env)).toBe(env.DB_B);
    await env.STATE.put("live-db", "a");
    expect(await liveDb(env)).toBe(env.DB_B);
    vi.setSystemTime(Date.now() + 61_000);
    expect(await liveDb(env)).toBe(env.DB_A);
    await env.STATE.delete("live-db");
    vi.setSystemTime(Date.now() + 61_000);
    expect(await liveDb(env)).toBe(env.DB_A);
  });
});
