import type { ClusterInfo } from "./data.ts";
import type { Interaction } from "./interaction.ts";
import type { MapRenderer } from "./map.ts";

/** Labels on screen at once, by viewport width. */
export const LABEL_BUDGET = { phone: 8, tablet: 20, desktop: 48 };
export const LABEL_BREAKPOINTS = { phone: 600, tablet: 1024 };
/** Margin kept clear around the page chrome. */
export const CHROME_PAD_PX = 8;
/** Label box estimate: width per character plus padding, and half the height. */
export const LABEL_CHAR_PX = 6.6;
export const LABEL_PAD_PX = 8;
export const LABEL_HALF_HEIGHT_PX = 10;

/** Left, top, right, bottom in CSS pixels. */
export type Rect = [number, number, number, number];

export interface PlacedLabel {
  x: number;
  y: number;
  label: string;
}

export function labelBudget(width: number): number {
  if (width < LABEL_BREAKPOINTS.phone) return LABEL_BUDGET.phone;
  if (width < LABEL_BREAKPOINTS.tablet) return LABEL_BUDGET.tablet;
  return LABEL_BUDGET.desktop;
}

/** Rectangles of the visible page chrome, padded, that labels keep out of. */
export function chromeRects(): Rect[] {
  return [
    ...document.querySelectorAll<HTMLElement>(".top, .tools, .panel, .foot, .legend, .colors"),
  ]
    .filter((e) => e.checkVisibility())
    .map((e) => {
      const r = e.getBoundingClientRect();
      return [
        r.left - CHROME_PAD_PX,
        r.top - CHROME_PAD_PX,
        r.right + CHROME_PAD_PX,
        r.bottom + CHROME_PAD_PX,
      ];
    });
}

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * Picks which cluster labels fit: in cluster order, skipping repeats, boxes
 * off screen, and boxes over chrome or an earlier label, up to the budget.
 */
export function placeLabels(
  clusters: readonly Pick<ClusterInfo, "label" | "cx" | "cy">[],
  toScreen: (cx: number, cy: number) => [number, number],
  width: number,
  height: number,
  chrome: readonly Rect[],
): PlacedLabel[] {
  const placed: Rect[] = [...chrome];
  const budget = labelBudget(width) + chrome.length;
  const seen = new Set<string>();
  const out: PlacedLabel[] = [];
  for (const c of clusters) {
    if (placed.length >= budget) break;
    if (seen.has(c.label)) continue;
    const [x, y] = toScreen(c.cx, c.cy);
    const half = (c.label.length * LABEL_CHAR_PX + LABEL_PAD_PX) / 2;
    const box: Rect = [x - half, y - LABEL_HALF_HEIGHT_PX, x + half, y + LABEL_HALF_HEIGHT_PX];
    if (box[0] < 0 || box[1] < 0 || box[2] > width || box[3] > height) continue;
    if (placed.some((p) => overlaps(box, p))) continue;
    placed.push(box);
    seen.add(c.label);
    out.push({ x, y, label: c.label });
  }
  return out;
}

/** The island names over the map, placed after each settled draw. */
export class LabelLayer {
  constructor(
    private box: HTMLDivElement,
    private renderer: MapRenderer,
    private interaction: Interaction,
  ) {}

  place(): void {
    const current = this.renderer.family;
    if (!current || this.renderer.animating || this.interaction.pinching) {
      this.box.replaceChildren();
      return;
    }
    // During a drag the labels ride along as one layer and are placed again
    // from scratch when the pointer lifts.
    const delta = this.interaction.dragDelta();
    if (delta) {
      const dx = (delta.x / 2) * this.renderer.width;
      const dy = (-delta.y / 2) * this.renderer.height;
      this.box.style.transform = `translate(${dx}px, ${dy}px)`;
      return;
    }
    this.box.style.transform = "";
    const labels = placeLabels(
      current.info,
      (cx, cy) => this.renderer.toScreen(cx, cy),
      this.renderer.width,
      this.renderer.height,
      chromeRects(),
    );
    const fragment = document.createDocumentFragment();
    for (const { x, y, label } of labels) {
      const span = document.createElement("span");
      span.style.left = `${x}px`;
      span.style.top = `${y}px`;
      span.textContent = label;
      fragment.append(span);
    }
    this.box.replaceChildren(fragment);
  }
}
