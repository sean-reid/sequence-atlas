import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB_A, env.TEST_MIGRATIONS);
  await applyD1Migrations(env.DB_B, env.TEST_MIGRATIONS);
});
