import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

// The limiter counts per isolate, so this file holds the only searches that
// run in it and the whole budget is observable.
it("answers 429 once the budget for the address is spent", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 70; i++) {
    statuses.push((await SELF.fetch("https://atlas.test/api/search?q=zz")).status);
  }
  const allowed = statuses.filter((s) => s === 200).length;
  expect(allowed).toBe(60);
  expect(statuses.slice(0, allowed).every((s) => s === 200)).toBe(true);
  expect(statuses.slice(allowed).every((s) => s === 429)).toBe(true);
  const limited = await SELF.fetch("https://atlas.test/api/search?q=zz");
  expect(await limited.json()).toEqual({ error: "slow down" });
});
