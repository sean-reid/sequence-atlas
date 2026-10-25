import { search, type SearchEnv } from "./search.ts";

export interface Env extends SearchEnv {
  ASSETS: Fetcher;
  DATA: R2Bucket;
}

// Every response the Worker builds carries these; the asset store's _headers
// covers only files it serves itself.
const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

const json = (body: unknown, status = 200, cache = "no-store"): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...SECURITY,
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
    },
  });

const error = (status: number, message: string): Response => json({ error: message }, status);

const TYPES: Record<string, string> = {
  json: "application/json; charset=utf-8",
  bin: "application/octet-stream",
  u16: "application/octet-stream",
  u32: "application/octet-stream",
  u8: "application/octet-stream",
};

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
    ...SECURITY,
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "cache-control": key.startsWith("v/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300",
    etag: object.httpEtag,
  });
  // Cluster, color, and number files are stored gzipped; the runtime must not
  // compress them a second time.
  if (object.httpMetadata?.contentEncoding !== "gzip")
    return new Response(object.body, { headers });
  headers.set("content-encoding", "gzip");
  return new Response(object.body, { headers, encodeBody: "manual" });
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
      ...SECURITY,
      "content-type": "application/json; charset=utf-8",
      "content-encoding": "gzip",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

// The bucket serves two shapes of key and nothing else: the manifest, and a
// path under a generation. Anything else is a 404 before storage is asked.
const KEY = /^(manifest\.json|v\/[0-9a-z-]+\/[A-Za-z0-9._/-]+)$/;
const allowedKey = (key: string): boolean => KEY.test(key) && !key.split("/").includes("..");

// One host owns a whole IPv6 /64, so the budget is per /64 there and per address on IPv4.
function rateKey(request: Request): string {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (!ip.includes(":")) return ip;
  const [left = ""] = ip.split("::");
  return left.split(":").slice(0, 4).join(":") + "::/64";
}

async function handleSearch(request: Request, url: URL, env: Env): Promise<Response> {
  const { success } = await env.SEARCH_RATE.limit({ key: rateKey(request) });
  if (!success) return error(429, "slow down");
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  const body = await search(env, q);
  return json(body, 200, "public, max-age=3600");
}

// Objects under v/ are keyed by the manifest's build id, so the edge may keep
// them for a year; the manifest itself is rechecked every five minutes.
async function cached(
  request: Request,
  ctx: ExecutionContext,
  make: () => Promise<Response>,
): Promise<Response> {
  const cache = caches.default;
  const key = request.method === "GET" ? request : new Request(request.url);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = await make();
  if (response.ok) ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method === "HEAD" ? "GET" : request.method;
  if (pathname === "/api/health") return json({ ok: true });
  if (pathname === "/api/search" && method === "GET") return handleSearch(request, url, env);
  if (pathname.startsWith("/api/")) return error(method === "GET" ? 404 : 405, "not found");
  if (pathname.startsWith("/data/")) {
    if (method !== "GET") return error(405, "method not allowed");
    let key: string;
    try {
      key = decodeURIComponent(pathname.slice("/data/".length));
    } catch {
      return error(404, "not found");
    }
    if (!allowedKey(key)) return error(404, "not found");
    const shard = /^(v\/[^/]+)\/shards\/([a-z]+)\/(\d{5})\.json$/.exec(key);
    // Shard members are pre-compressed and the cache would hand them back
    // re-encoded, so only whole objects go through the edge cache.
    if (shard) return serveShard(request, env, shard[1]!, shard[2]!, shard[3]!);
    return cached(request, ctx, () => serveData(request, env, key));
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const response = await route(request, env, ctx);
      return request.method === "HEAD" ? new Response(null, response) : response;
    } catch (err) {
      console.error(err);
      return error(500, "internal error");
    }
  },
} satisfies ExportedHandler<Env>;
