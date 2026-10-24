import { QUANT_MAX } from "../shared/format.ts";

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const DEFAULT_VIEW: View = { scale: 1.7, x: 0, y: 0 };

/** The shader divides by this so 0..QUANT_MAX lands exactly on -1..1. */
export const HALF_QUANT = QUANT_MAX / 2;

/**
 * Maps between quantized layout units, clip space, and CSS pixels for one
 * view. The renderer and the pointer code share one instance.
 */
export class Projection {
  /** CSS pixel size, cached so drawing and label placement never read layout. */
  width = 1;
  height = 1;
  /** Device pixel aspect ratio of the canvas, as the shader sees it. */
  aspect = 1;
  view: View = { ...DEFAULT_VIEW };

  resize(width: number, height: number, aspect = width / height): void {
    this.width = width;
    this.height = height;
    this.aspect = aspect;
  }

  /** Screen position in CSS pixels of a point given in embedding units. */
  toScreen(bounds: readonly number[], ex: number, ey: number): [number, number] {
    const [x0 = 0, y0 = 0, x1 = 1, y1 = 1] = bounds;
    const qx = ((ex - x0) / (x1 - x0)) * QUANT_MAX;
    const qy = ((ey - y0) / (y1 - y0)) * QUANT_MAX;
    return this.quantizedToScreen(qx, qy);
  }

  quantizedToScreen(qx: number, qy: number): [number, number] {
    const nx = qx / HALF_QUANT - 1;
    const ny = qy / HALF_QUANT - 1;
    const sx = ((nx * this.view.scale) / this.aspect + this.view.x + 1) / 2;
    const sy = (1 - (ny * this.view.scale + this.view.y)) / 2;
    return [sx * this.width, sy * this.height];
  }

  screenToQuantized(sx: number, sy: number): [number, number] {
    const cx = (sx / this.width) * 2 - 1;
    const cy = 1 - (sy / this.height) * 2;
    const nx = ((cx - this.view.x) * this.aspect) / this.view.scale;
    const ny = (cy - this.view.y) / this.view.scale;
    return [(nx + 1) * HALF_QUANT, (ny + 1) * HALF_QUANT];
  }

  /** Quantized units per CSS pixel at the current zoom, along y. */
  unitsPerPixel(): number {
    return (QUANT_MAX + 1) / (this.height * this.view.scale);
  }

  /** Center the view on a quantized point at a given zoom. */
  centerOn(qx: number, qy: number, scale: number): void {
    this.view.scale = scale;
    this.view.x = -((qx / HALF_QUANT - 1) * scale) / this.aspect;
    this.view.y = -(qy / HALF_QUANT - 1) * scale;
  }

  /** Zoom by a factor about a screen point, which stays put. */
  zoomAt(px: number, py: number, factor: number, min: number, max: number): void {
    const mx = (px / this.width) * 2 - 1;
    const my = 1 - (py / this.height) * 2;
    const v = this.view;
    const next = Math.min(max, Math.max(min, v.scale * factor));
    const f = next / v.scale;
    v.x = mx - (mx - v.x) * f;
    v.y = my - (my - v.y) * f;
    v.scale = next;
  }
}
