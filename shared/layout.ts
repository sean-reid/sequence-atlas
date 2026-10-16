// Layout file written by tools/layout: "ATL1", uint32 count, float32 bounds
// (min x, min y, max x, max y), then count pairs of uint16 x, y quantized
// across those bounds. All little endian.

const MAGIC = 0x314c5441;
const HEADER_BYTES = 24;

export interface Layout {
  count: number;
  bounds: [number, number, number, number];
  /** Interleaved x, y per point in the file's quantized units, 0 to 65535. */
  points: Uint16Array;
}

export function parseLayout(buffer: ArrayBuffer): Layout {
  const view = new DataView(buffer);
  if (buffer.byteLength < HEADER_BYTES || view.getUint32(0, true) !== MAGIC) {
    throw new Error("not a layout file");
  }
  const count = view.getUint32(4, true);
  if (buffer.byteLength !== HEADER_BYTES + count * 4) {
    throw new Error(
      `layout holds ${buffer.byteLength} bytes, expected ${HEADER_BYTES + count * 4}`,
    );
  }
  const bounds: [number, number, number, number] = [
    view.getFloat32(8, true),
    view.getFloat32(12, true),
    view.getFloat32(16, true),
    view.getFloat32(20, true),
  ];
  const points = new Uint16Array(buffer.slice(HEADER_BYTES));
  return { count, bounds, points };
}

/** Coordinates of one point in the embedding's own units. */
export function pointAt(layout: Layout, index: number): [number, number] {
  const [x0, y0, x1, y1] = layout.bounds;
  const qx = layout.points[index * 2] ?? 0;
  const qy = layout.points[index * 2 + 1] ?? 0;
  return [x0 + (qx / 65535) * (x1 - x0), y0 + (qy / 65535) * (y1 - y0)];
}
