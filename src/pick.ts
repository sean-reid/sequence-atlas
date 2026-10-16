import type { Layout } from "../shared/layout.ts";

// Points bucketed on a fixed grid in quantised layout units so a hover
// only visits the cells under the cursor.
const CELLS = 256;
const CELL = 65536 / CELLS;

export class PointIndex {
  private starts: Uint32Array;
  private items: Uint32Array;

  constructor(private layout: Layout) {
    const n = layout.count;
    const counts = new Uint32Array(CELLS * CELLS + 1);
    const cellOf = (i: number) => {
      const x = layout.points[i * 2] ?? 0;
      const y = layout.points[i * 2 + 1] ?? 0;
      return Math.floor(y / CELL) * CELLS + Math.floor(x / CELL);
    };
    for (let i = 0; i < n; i++) counts[cellOf(i) + 1]!++;
    for (let c = 0; c < CELLS * CELLS; c++) counts[c + 1]! += counts[c]!;
    this.starts = counts;
    this.items = new Uint32Array(n);
    const fill = counts.slice();
    for (let i = 0; i < n; i++) this.items[fill[cellOf(i)]!++] = i;
  }

  /** Nearest point to (qx, qy) in quantised units within radius r, or -1. */
  nearest(qx: number, qy: number, r: number): number {
    const c0 = Math.max(0, Math.floor((qx - r) / CELL));
    const c1 = Math.min(CELLS - 1, Math.floor((qx + r) / CELL));
    const r0 = Math.max(0, Math.floor((qy - r) / CELL));
    const r1 = Math.min(CELLS - 1, Math.floor((qy + r) / CELL));
    let best = -1;
    let bestD = r * r;
    const pts = this.layout.points;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = row * CELLS + col;
        const end = this.starts[cell + 1]!;
        for (let k = this.starts[cell]!; k < end; k++) {
          const i = this.items[k]!;
          const dx = pts[i * 2]! - qx;
          const dy = pts[i * 2 + 1]! - qy;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    return best;
  }
}
