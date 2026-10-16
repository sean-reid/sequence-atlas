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

// Shards of one kind live in a single pack object; the index maps a shard name
// to its byte range, so a shard request is one small range read.
const indexes = new Map<string, Promise<Record<string, [number, number]> | null>>();

async function readKey(
  request: Request,
  env: Env,
  key: string,
  range?: { offset: number; length: number },
): Promise<Response | null> {
  const object = await env.DATA.get(key, range ? { range } : undefined);
  if (object) return new Response(object.body, { status: 200 });
  const url = new URL(request.url);
  url.pathname = `/data/${key}`;
  url.search = "";
  const headers = new Headers();
  if (range) headers.set("range", `bytes=${range.offset}-${range.offset + range.length - 1}`);
  const asset = await env.ASSETS.fetch(new Request(url, { headers }));
  const type = asset.headers.get("content-type") ?? "";
  if (!asset.ok || type.startsWith("text/html")) return null;
  if (range && asset.status !== 206) {
    const whole = new Uint8Array(await asset.arrayBuffer());
    return new Response(whole.slice(range.offset, range.offset + range.length));
  }
  return asset;
}

async function shardIndex(request: Request, env: Env, key: string) {
  let pending = indexes.get(key);
  if (!pending) {
    pending = readKey(request, env, key).then((r) =>
      r ? (r.json() as Promise<Record<string, [number, number]>>) : null,
    );
    indexes.set(key, pending);
    pending.then(
      (v) => v ?? indexes.delete(key),
      () => indexes.delete(key),
    );
  }
  return pending;
}

async function serveShard(
  request: Request,
  env: Env,
  prefix: string,
  kind: string,
  name: string,
): Promise<Response> {
  const index = await shardIndex(request, env, `${prefix}/shards/${kind}.index.json`);
  const range = index?.[name];
  if (!range) return error(404, "not found");
  const body = await readKey(request, env, `${prefix}/shards/${kind}.pack`, {
    offset: range[0],
    length: range[1],
  });
  if (!body) return error(404, "not found");
  // The pack member is already gzip; without manual encoding the runtime
  // would compress it a second time.
  return new Response(body.body, {
    encodeBody: "manual",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-encoding": "gzip",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
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
      const shard = /^(v\/[^/]+)\/shards\/([a-z]+)\/(\d{5})\.json$/.exec(key);
      if (shard) return serveShard(request, env, shard[1]!, shard[2]!, shard[3]!);
      return serveData(request, env, key);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
