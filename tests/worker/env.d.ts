import type { D1Migration } from "cloudflare:test";
import type { Env as WorkerEnv } from "../../worker/index.ts";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
      PACK: ArrayBuffer;
      PACK_INDEX: string;
    }
  }
}
