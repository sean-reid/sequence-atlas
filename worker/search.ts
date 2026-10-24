import { classify, nameMatch, termsMatch } from "../shared/query.ts";

export interface SearchEnv {
  DB_A: D1Database;
  DB_B: D1Database;
  STATE: KVNamespace;
  SEARCH_RATE: RateLimit;
}

export interface SearchHit {
  number: number;
  name: string;
}

export interface SearchResponse {
  kind: string;
  results: SearchHit[];
}

const LIMIT = 20;
// ORDER BY weight, number sorts every FTS hit before the limit, so the hits
// that reach it are capped first; a one-letter prefix would match most rows.
const SCAN = 2_000;
const MIN_PREFIX = 2;
const POINTER_TTL_MS = 60_000;
let pointer: { value: "a" | "b"; at: number } | null = null;

// The weekly refresh loads the standby database and flips this key, so
// a query never hits a database mid import.
export async function liveDb(env: SearchEnv): Promise<D1Database> {
  const now = Date.now();
  if (!pointer || now - pointer.at > POINTER_TTL_MS) {
    const value = (await env.STATE.get("live-db")) === "b" ? "b" : "a";
    pointer = { value, at: now };
  }
  return pointer.value === "b" ? env.DB_B : env.DB_A;
}

export async function search(env: SearchEnv, raw: string): Promise<SearchResponse> {
  const query = classify(raw);
  const db = await liveDb(env);
  if (query.kind === "empty") return { kind: "empty", results: [] };
  if (query.kind === "anumber") {
    const row = await db
      .prepare("SELECT number, name FROM seq WHERE number = ?1")
      .bind(query.number)
      .first<SearchHit>();
    return { kind: "anumber", results: row ? [row] : [] };
  }
  if (query.kind === "terms") {
    const { results } = await db
      .prepare(matchSql("terms_index"))
      .bind(termsMatch(query.terms), SCAN, LIMIT)
      .all<SearchHit>();
    return { kind: "terms", results };
  }
  if (query.words.some((w) => w.length < MIN_PREFIX)) return { kind: "text", results: [] };
  const { results } = await db
    .prepare(matchSql("name_index"))
    .bind(nameMatch(query.words), SCAN, LIMIT)
    .all<SearchHit>();
  return { kind: "text", results };
}

const matchSql = (index: string): string =>
  `SELECT seq.number, seq.name FROM (SELECT rowid FROM ${index} WHERE ${index} MATCH ?1 LIMIT ?2) AS hit JOIN seq ON seq.number = hit.rowid ORDER BY seq.weight, seq.number LIMIT ?3`;
