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
      .prepare(
        "SELECT seq.number, seq.name FROM terms_index JOIN seq ON seq.number = terms_index.rowid WHERE terms_index MATCH ?1 ORDER BY seq.number LIMIT ?2",
      )
      .bind(termsMatch(query.terms), LIMIT)
      .all<SearchHit>();
    return { kind: "terms", results };
  }
  const { results } = await db
    .prepare(
      "SELECT seq.number, seq.name FROM name_index JOIN seq ON seq.number = name_index.rowid WHERE name_index MATCH ?1 ORDER BY rank, seq.number LIMIT ?2",
    )
    .bind(nameMatch(query.words), LIMIT)
    .all<SearchHit>();
  return { kind: "text", results };
}
