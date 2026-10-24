import { formatANumber } from "../shared/anumber.ts";
import { NOISE, QUANT_MAX, SHARD_SIZE, shardName } from "../shared/format.ts";
import { parseLayout, type Layout } from "../shared/layout.ts";
import { FAMILIES, type Family } from "../shared/url.ts";
import { DEFAULT_LABELS, type LabelTables } from "./color.ts";

export interface Manifest {
  version: string;
  build: string;
  count: number;
  families: Family[];
  snapshot: string;
}

export interface ClusterInfo {
  id: number;
  label: string;
  size: number;
  cx: number;
  cy: number;
}

export interface FamilyData {
  family: Family;
  layout: Layout;
  clusters: Uint16Array;
  info: ClusterInfo[];
  byId: Map<number, ClusterInfo>;
}

export interface BaseEntry {
  name: string;
  terms: string;
  offset: number;
  keywords: string[];
  cluster: Partial<Record<Family, number | null>>;
  color: [number, number, number];
}

export type NeighborRow = [number, number, number];

export interface FeatureColumn {
  name: string;
  phrase: string;
}

/** The writer's copy of shared/format.ts, checked on load. */
export interface FormatBlock {
  noise: number;
  shardSize: number;
  quantMax: number;
  neighbors: number;
}

export interface Features {
  columns: Partial<Record<Family, FeatureColumn[]>>;
  labels: LabelTables;
  format: FormatBlock | null;
}

const LABEL_LENGTHS: Record<keyof LabelTables, number> = { growth: 8, order: 8, keyword: 9 };

function labelTables(raw: unknown): LabelTables {
  if (!raw || typeof raw !== "object") return DEFAULT_LABELS;
  const tables = raw as Record<string, unknown>;
  const out = { ...DEFAULT_LABELS };
  for (const key of Object.keys(LABEL_LENGTHS) as (keyof LabelTables)[]) {
    const list = tables[key];
    if (
      Array.isArray(list) &&
      list.length === LABEL_LENGTHS[key] &&
      list.every((s) => typeof s === "string")
    ) {
      out[key] = list as string[];
    }
  }
  return out;
}

/**
 * Reads features.json: a column list per family, plus the label tables and
 * the format block newer snapshots carry. A format block that disagrees with
 * this client's constants throws, since every byte would then be misread.
 */
export function parseFeatures(raw: unknown): Features {
  if (!raw || typeof raw !== "object") throw new Error("features.json is not an object");
  const doc = raw as Record<string, unknown>;
  const columns: Features["columns"] = {};
  for (const family of FAMILIES) {
    const list = doc[family];
    if (Array.isArray(list)) columns[family] = list as FeatureColumn[];
  }
  const format = (doc.format as FormatBlock | undefined) ?? null;
  if (format) {
    const expected = { noise: NOISE, shardSize: SHARD_SIZE, quantMax: QUANT_MAX };
    for (const [key, value] of Object.entries(expected)) {
      const got = format[key as keyof typeof expected];
      if (got !== value)
        throw new Error(`features.json ${key} is ${got}, this client reads ${value}`);
    }
  }
  return { columns, labels: labelTables(doc.labels), format };
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

export class DataSource {
  private manifest: Promise<Manifest> | null = null;
  private families = new Map<Family, Promise<FamilyData>>();
  private numbers: Promise<Uint32Array> | null = null;
  private features: Promise<Features> | null = null;
  private shards = new Map<string, Promise<Record<string, unknown>>>();
  private colors: Promise<Uint8Array> | null = null;

  async getManifest(): Promise<Manifest> {
    this.manifest ??= fetchOk("/data/manifest.json").then((r) => r.json() as Promise<Manifest>);
    return this.manifest;
  }

  // The build id digests every artifact, so a republished file changes its URL
  // and immutable caches never serve it alongside a newer manifest.
  private async url(path: string): Promise<string> {
    const { version, build } = await this.getManifest();
    return `/data/v/${version}/${path}?b=${build}`;
  }

  async getNumbers(): Promise<Uint32Array> {
    this.numbers ??= this.url("numbers.u32")
      .then(fetchOk)
      .then((r) => r.arrayBuffer())
      .then((b) => new Uint32Array(b));
    return this.numbers;
  }

  /** Position of a sequence in numbers.u32, or -1 when it is not on the map. */
  async indexOfNumber(number: number): Promise<number> {
    const numbers = await this.getNumbers();
    let lo = 0;
    let hi = numbers.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = numbers[mid]!;
      if (v === number) return mid;
      if (v < number) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  /** Three bytes per sequence: growth class, recurrence order, keyword group. */
  async getColors(): Promise<Uint8Array> {
    this.colors ??= this.url("color.u8")
      .then(fetchOk)
      .then((r) => r.arrayBuffer())
      .then((b) => new Uint8Array(b));
    this.colors.catch(() => (this.colors = null));
    return this.colors;
  }

  getFamily(family: Family): Promise<FamilyData> {
    let pending = this.families.get(family);
    if (!pending) {
      pending = (async () => {
        const [layoutBuf, clusterBuf, info] = await Promise.all([
          this.url(`${family}.layout.bin`)
            .then(fetchOk)
            .then((r) => r.arrayBuffer()),
          this.url(`${family}.cluster.u16`)
            .then(fetchOk)
            .then((r) => r.arrayBuffer()),
          this.url(`${family}.clusters.json`)
            .then(fetchOk)
            .then((r) => r.json() as Promise<ClusterInfo[]>),
        ]);
        const byId = new Map(info.map((c) => [c.id, c]));
        return {
          family,
          layout: parseLayout(layoutBuf),
          clusters: new Uint16Array(clusterBuf),
          info,
          byId,
        };
      })();
      this.families.set(family, pending);
      pending.catch(() => this.families.delete(family));
    }
    return pending;
  }

  async getFeatures(): Promise<Features> {
    this.features ??= this.url("features.json")
      .then(fetchOk)
      .then((r) => r.json())
      .then(parseFeatures);
    return this.features;
  }

  private shard(kind: string, number: number): Promise<Record<string, unknown>> {
    const key = `${kind}/${shardName(number)}.json`;
    let pending = this.shards.get(key);
    if (!pending) {
      pending = this.url(`shards/${key}`)
        .then(fetchOk)
        .then((r) => r.json() as Promise<Record<string, unknown>>);
      this.shards.set(key, pending);
      pending.catch(() => this.shards.delete(key));
    }
    return pending;
  }

  async getBase(number: number): Promise<BaseEntry | null> {
    const shard = await this.shard("base", number);
    return (shard[formatANumber(number)] as BaseEntry | undefined) ?? null;
  }

  async getNeighbors(number: number, family: Family): Promise<NeighborRow[]> {
    const shard = await this.shard(family, number);
    return (shard[formatANumber(number)] as NeighborRow[] | undefined) ?? [];
  }
}
