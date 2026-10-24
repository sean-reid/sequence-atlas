// One Cloudflare client for the refresh scripts: credentials from the
// environment, ids from wrangler.jsonc, and R2 reads and writes that back off
// on 429.
import { readFileSync } from "node:fs";

export interface Credentials {
  token: string;
  account: string;
}

export interface Config {
  bucket: string;
  kvStateId: string;
  databases: { a: string; b: string };
}

const USAGE_ENV = "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required";
const MAX_ATTEMPTS = 12;
let credentials: Credentials | null = null;

export function env(usage?: string): Credentials {
  if (credentials) return credentials;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    if (usage) console.error(usage);
    console.error(USAGE_ENV);
    process.exit(2);
  }
  credentials = { token, account };
  return credentials;
}

// Drops // and /* */ comments outside strings and the comma before a closing
// bracket, which is all wrangler.jsonc uses beyond JSON.
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      if (i < 0) i = text.length;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[\]}])/g, "$1"));
}

interface WranglerConfig {
  r2_buckets?: { binding: string; bucket_name: string }[];
  kv_namespaces?: { binding: string; id: string }[];
  d1_databases?: { binding: string; database_name: string }[];
}

export function config(path = new URL("../wrangler.jsonc", import.meta.url)): Config {
  const parsed = parseJsonc(readFileSync(path, "utf8")) as WranglerConfig;
  const bucket = parsed.r2_buckets?.find((b) => b.binding === "DATA")?.bucket_name;
  const kv = parsed.kv_namespaces?.find((k) => k.binding === "STATE")?.id;
  const a = parsed.d1_databases?.find((d) => d.binding === "DB_A")?.database_name;
  const b = parsed.d1_databases?.find((d) => d.binding === "DB_B")?.database_name;
  if (!bucket || !kv || !a || !b) {
    throw new Error("wrangler.jsonc needs the DATA bucket, STATE namespace, and DB_A and DB_B");
  }
  return { bucket, kvStateId: kv, databases: { a, b } };
}

function objectUrl(key: string): string {
  const { account } = env();
  const { bucket } = config();
  return `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`;
}

// The API allows about 1,200 requests per five minutes; a 429 waits a fixed
// fifteen seconds and anything else transient waits a growing second.
async function request(key: string, init: RequestInit): Promise<Response> {
  const { token } = env();
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(objectUrl(key), {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
    });
    if (res.ok || res.status === 404) return res;
    if (attempt >= MAX_ATTEMPTS || (res.status < 500 && res.status !== 429)) {
      throw new Error(`${key}: ${res.status} ${await res.text()}`);
    }
    const wait = res.status === 429 ? 15_000 : 1000 * attempt;
    await new Promise((r) => setTimeout(r, wait));
  }
}

/** The object's response, or null when the key does not exist. */
export async function r2Get(key: string): Promise<Response | null> {
  const res = await request(key, { method: "GET" });
  return res.status === 404 ? null : res;
}

export async function r2Put(
  key: string,
  body: Uint8Array | string,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const res = await request(key, {
    method: "PUT",
    headers: { "content-type": contentType, ...extraHeaders },
    body: new Blob([Uint8Array.from(bytes)]),
  });
  if (!res.ok) throw new Error(`${key}: ${res.status} ${await res.text()}`);
}
