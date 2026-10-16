import { search, type SearchEnv } from "./search.ts";

export interface Env extends SearchEnv {
  ASSETS: Fetcher;
  DATA: R2Bucket;
}

const json = (body: unknown, status = 200, cache = "no-store"): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });

const error = (status: number, message: string): Response => json({ error: message }, status);

const TYPES: Record<string, string> = {
  json: "application/json; charset=utf-8",
  bin: "application/octet-stream",
  u16: "application/octet-stream",
  u32: "application/octet-stream",
  u8: "application/octet-stream",
};

// Versioned objects never change, so they cache for a year; the manifest
// names the current version and is rechecked every five minutes.
async function serveData(request: Request, env: Env, key: string): Promise<Response> {
  const object = await env.DATA.get(key);
  if (!object) {
    // Local development serves the data directory from the asset store;
    // the SPA fallback page is not data.
    const asset = await env.ASSETS.fetch(request);
    const type = asset.headers.get("content-type") ?? "";
    const found = asset.status === 304 || (asset.ok && !type.startsWith("text/html"));
    return found ? asset : error(404, "not found");
  }
  const ext = key.split(".").pop() ?? "";
  const headers = new Headers({
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "cache-control": key.startsWith("v/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300",
    etag: object.httpEtag,
  });
  return new Response(object.body, { headers });
}

async function handleSearch(request: Request, url: URL, env: Env): Promise<Response> {
  const key = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.SEARCH_RATE.limit({ key });
  if (!success) return error(429, "slow down");
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  const body = await search(env, q);
  return json(body, 200, "public, max-age=3600");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/api/health") return json({ ok: true });
    if (pathname === "/api/search" && request.method === "GET") {
      return handleSearch(request, url, env);
    }
    if (pathname.startsWith("/api/")) return error(404, "not found");
    if (pathname.startsWith("/data/") && request.method === "GET") {
      const key = decodeURIComponent(pathname.slice("/data/".length));
      if (!key) return error(404, "not found");
      return serveData(request, env, key);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
