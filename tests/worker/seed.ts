import { env } from "cloudflare:test";

export const GENERATION = "test";
export const PREFIX = `v/${GENERATION}`;

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Bytes a response carried, expanded if the runtime handed them back still gzipped. */
export async function decoded(response: Response): Promise<Uint8Array> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzip(bytes) : bytes;
}

export const clusters = Uint8Array.from({ length: 4096 }, (_, i) => i % 7);

/** The bucket as r2-sync and r2-manifest leave it: a manifest, a gzipped
 *  cluster file, a raw layout, and the three-shard base pack with its index. */
export async function seedBucket(): Promise<void> {
  const manifest = { version: GENERATION, build: "abc", count: 289, families: ["all"] };
  await env.DATA.put("manifest.json", JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
  await env.DATA.put(`${PREFIX}/all.cluster.u16`, await gzip(clusters), {
    httpMetadata: { contentType: "application/octet-stream", contentEncoding: "gzip" },
  });
  await env.DATA.put(`${PREFIX}/all.layout.bin`, new Uint8Array([0x41, 0x54, 0x4c, 0x31]), {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  await env.DATA.put(`${PREFIX}/shards/base.pack`, env.PACK);
  await env.DATA.put(`${PREFIX}/shards/base.index.json`, env.PACK_INDEX);
}

export interface Row {
  number: number;
  name: string;
  terms: string;
  weight?: number;
}

export async function seedSearch(db: D1Database, rows: Row[]): Promise<void> {
  const insert = db.prepare(
    "INSERT INTO seq (number, name, terms, weight) VALUES (?1, ?2, ?3, ?4)",
  );
  const batch = rows.map((r) => insert.bind(r.number, r.name, r.terms, r.weight ?? 2));
  for (let i = 0; i < batch.length; i += 100) await db.batch(batch.slice(i, i + 100));
  await db.batch([
    db.prepare("INSERT INTO name_index(name_index) VALUES ('rebuild')"),
    db.prepare("INSERT INTO terms_index(terms_index) VALUES ('rebuild')"),
  ]);
}
