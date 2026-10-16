import { expect, test } from "@playwright/test";

interface Hit {
  number: number;
  name: string;
}
interface Body {
  kind: string;
  results: Hit[];
}

const get = async (request: Parameters<Parameters<typeof test>[2]>[0]["request"], q: string) => {
  const res = await request.get(`/api/search?q=${encodeURIComponent(q)}`);
  return { status: res.status(), body: (await res.json()) as Body };
};

test.describe.configure({ mode: "serial" });

test("resolves an a-number, a name prefix, and a run of terms", async ({ request }) => {
  const byNumber = await get(request, "A000045");
  expect(byNumber.status).toBe(200);
  expect(byNumber.body.kind).toBe("anumber");
  expect(byNumber.body.results[0]?.name).toContain("Fibonacci");

  const byName = await get(request, "fibon num");
  expect(byName.body.kind).toBe("text");
  expect(byName.body.results.map((r) => r.number)).toEqual([45]);

  const weighted = await get(request, "sequence");
  expect(weighted.body.results[0]?.number).toBe(1);
  expect(weighted.body.results.length).toBe(20);

  const byTerms = await get(request, "4, 6, 8");
  expect(byTerms.body.kind).toBe("terms");
  expect(byTerms.body.results[0]?.number).toBe(2);
  expect(byTerms.body.results.length).toBeLessThanOrEqual(20);

  const nothing = await get(request, "zzzz");
  expect(nothing.body.results).toEqual([]);
  expect((await get(request, "")).body.kind).toBe("empty");
});

test("odd input never reaches fts5 unquoted", async ({ request }) => {
  for (const q of ['"', "AND OR NOT", "a(n) = n*(n+1)/2", "--", "1,,2"]) {
    const { status } = await get(request, q);
    expect(status).toBe(200);
  }
});

test("answers 429 once the per-minute budget is spent", async ({ request }) => {
  let limited = false;
  for (let i = 0; i < 70 && !limited; i++) {
    const res = await request.get(`/api/search?q=n${i}`);
    limited = res.status() === 429;
  }
  expect(limited).toBe(true);
});
