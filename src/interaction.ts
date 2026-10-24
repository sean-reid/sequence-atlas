import { MAX_SCALE, MIN_SCALE } from "../shared/url.ts";
import type { Projection } from "./projection.ts";

/** Zoom factor per wheel pixel, as exp(-deltaY * WHEEL_FACTOR). */
export const WHEEL_FACTOR = 0.0022;
/** A pointer that travels less than this before lifting is a tap. */
export const DRAG_SLOP_PX = 3;
/** How far from a point a tap or hover still hits it. */
export const HIT_RADIUS_PX = { mouse: 12, touch: 22 };
/** Arrow keys pan by this much of the clip range; plus and minus zoom by this factor. */
export const KEY_PAN_STEP = 0.1;
export const KEY_ZOOM_FACTOR = 1.5;

export interface InteractionDeps {
  onTap(x: number, y: number, radiusPx: number): void;
  onHover(e: PointerEvent, radiusPx: number): void;
  onHoverEnd(): void;
  /** The view moved: redraw and write the hash. */
  onViewChange(): void;
  /** Nothing moved, but the labels need placing again. */
  onRedraw(): void;
}

interface Drag {
  x: number;
  y: number;
  vx: number;
  vy: number;
  moved: boolean;
}

/** Wheel, pointer, drag, pinch, and keyboard control of the view. */
export class Interaction {
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: Drag | null = null;
  private pinch: { dist: number; scale: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private projection: Projection,
    private deps: InteractionDeps,
  ) {
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    canvas.addEventListener("pointercancel", (e) => this.onPointerCancel(e));
    canvas.addEventListener("pointerleave", () => deps.onHoverEnd());
    canvas.addEventListener("keydown", (e) => this.onKey(e));
  }

  /** Clip space offset of a drag in progress, or null when the view is settled. */
  dragDelta(): { x: number; y: number } | null {
    if (!this.drag?.moved) return null;
    const v = this.projection.view;
    return { x: v.x - this.drag.vx, y: v.y - this.drag.vy };
  }

  get pinching(): boolean {
    return this.pinch !== null;
  }

  zoomAt(px: number, py: number, factor: number): void {
    this.projection.zoomAt(px, py, factor, MIN_SCALE, MAX_SCALE);
    this.deps.onViewChange();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * WHEEL_FACTOR));
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = this.projection.view;
    if (this.pointers.size === 1) {
      this.drag = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: v.scale };
      this.drag = null;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const v = this.projection.view;
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const target = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, (this.pinch.scale * dist) / this.pinch.dist),
      );
      this.zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, target / v.scale);
      return;
    }
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > DRAG_SLOP_PX) this.drag.moved = true;
      v.x = this.drag.vx + (dx / this.canvas.clientWidth) * 2;
      v.y = this.drag.vy - (dy / this.canvas.clientHeight) * 2;
      this.deps.onViewChange();
      return;
    }
    if (e.pointerType === "mouse") this.deps.onHover(e, HIT_RADIUS_PX.mouse);
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.drag && !this.drag.moved) {
      const radius = e.pointerType === "touch" ? HIT_RADIUS_PX.touch : HIT_RADIUS_PX.mouse;
      this.deps.onTap(e.clientX, e.clientY, radius);
    }
    if (this.pointers.size === 0) this.drag = null;
    this.deps.onRedraw();
  }

  private onPointerCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.drag = null;
    this.pinch = null;
    this.deps.onRedraw();
  }

  private onKey(e: KeyboardEvent): void {
    const v = this.projection.view;
    const cx = this.projection.width / 2;
    const cy = this.projection.height / 2;
    if (e.key === "ArrowLeft") v.x += KEY_PAN_STEP;
    else if (e.key === "ArrowRight") v.x -= KEY_PAN_STEP;
    else if (e.key === "ArrowUp") v.y -= KEY_PAN_STEP;
    else if (e.key === "ArrowDown") v.y += KEY_PAN_STEP;
    else if (e.key === "+" || e.key === "=") this.zoomAt(cx, cy, KEY_ZOOM_FACTOR);
    else if (e.key === "-") this.zoomAt(cx, cy, 1 / KEY_ZOOM_FACTOR);
    else return;
    e.preventDefault();
    this.deps.onViewChange();
  }
}
