import { formatANumber } from "../shared/anumber.ts";
import { parseLayout, type Layout } from "../shared/layout.ts";
import type { Family } from "../shared/url.ts";

export interface Manifest {
  version: string;
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

export interface FeatureNames {
  [family: string]: { name: string; phrase: string }[];
}

const SHARD = 100;

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
}

export class DataSource {
  private manifest: Promise<Manifest> | null = null;
  private families = new Map<Family, Promise<FamilyData>>();
  private numbers: Promise<Uint32Array> | null = null;
  private features: Promise<FeatureNames> | null = null;
  private shards = new Map<string, Promise<Record<string, unknown>>>();
  private colors: Promise<Uint8Array> | null = null;

  async getManifest(): Promise<Manifest> {
    this.manifest ??= fetchOk("/data/manifest.json").then((r) => r.json() as Promise<Manifest>);
    return this.manifest;
  }

  // The count changes with every refresh, so stale caches of files that grew
  // cannot be mixed with the new manifest.
  private async url(path: string): Promise<string> {
    const { version, count } = await this.getManifest();
    return `/data/v/${version}/${path}?n=${count}`;
  }

  async getNumbers(): Promise<Uint32Array> {
    this.numbers ??= this.url("numbers.u32")
      .then(fetchOk)
      .then((r) => r.arrayBuffer())
      .then((b) => new Uint32Array(b));
    return this.numbers;
  }

  /** Three bytes per sequence: growth class, recurrence order, keyword group. */
  async getColors(): Promise<Uint8Array> {
    this.colors ??= this.url("color.u8")
      .then(fetchOk)
      .then((r) => r.arrayBuffer())
      .then((b) => new Uint8Array(b));
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
    }
    return pending;
  }

  async getFeatureNames(): Promise<FeatureNames> {
    this.features ??= this.url("features.json")
      .then(fetchOk)
      .then((r) => r.json() as Promise<FeatureNames>);
    return this.features;
  }

  private shard(kind: string, number: number): Promise<Record<string, unknown>> {
    const key = `${kind}/${String(Math.floor(number / SHARD)).padStart(5, "0")}.json`;
    let pending = this.shards.get(key);
    if (!pending) {
      pending = this.url(`shards/${key}`)
        .then(fetchOk)
        .then((r) => r.json() as Promise<Record<string, unknown>>);
      this.shards.set(key, pending);
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
