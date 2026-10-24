// The artifact formats the Python writer in tools/layout/layout.py produces
// and this client reads. Both sides name these values; features.json carries
// the writer's copy so a mismatch is caught at load time.

/** Cluster id for a point outside every island. */
export const NOISE = 65535;
/** Sequences per shard file, keyed by the five-digit floor of number / SHARD_SIZE. */
export const SHARD_SIZE = 100;
/** Layout coordinates are uint16 across the family's bounds. */
export const QUANT_MAX = 65535;
/** "ATL1" little endian: the layout file's first four bytes. */
export const MAGIC = 0x314c5441;
/** Magic, uint32 count, four float32 bounds. */
export const HEADER_BYTES = 24;

export function shardName(number: number): string {
  return String(Math.floor(number / SHARD_SIZE)).padStart(5, "0");
}
