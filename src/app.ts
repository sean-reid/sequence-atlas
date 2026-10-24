import { NOISE } from "../shared/format.ts";
import {
  MIN_SCALE,
  formatHash,
  formatPath,
  parseHash,
  parsePath,
  type Color,
  type Family,
  type Route,
} from "../shared/url.ts";
import type { DataSource, FamilyData } from "./data.ts";
import type { HoverCard } from "./hover.ts";
import type { LabelLayer } from "./labels.ts";
import type { MapRenderer } from "./map.ts";
import type { Panel } from "./panel.ts";
import { PointIndex } from "./pick.ts";
import type { Theme } from "./theme.ts";

/** The view hash is written this long after the last change. */
export const HASH_DEBOUNCE_MS = 250;
/** Zoom when a search or neighbor pick centers a point. */
export const CENTER_ZOOM = 14;
/** On a phone the panel is a sheet over the lower half of the screen. */
export const PHONE_MAX_WIDTH = 768;
const SHEET_FRACTION = 0.5;
const SHEET_GAP_PX = 60;

export interface AppParts {
  data: DataSource;
  renderer: MapRenderer;
  canvas: HTMLCanvasElement;
  panel: Panel;
  theme: Theme;
  labels: LabelLayer;
  hover: HoverCard;
  status: HTMLParagraphElement;
}

/** Route, color, selection, and the loaded numbers, with the moves between them. */
export class App {
  route: Route = parsePath(location.pathname);
  color: Color = "cluster";
  selectedIndex = -1;
  numbers: Uint32Array | null = null;
  private indexes = new Map<Family, PointIndex>();
  private metricButtons = [...document.querySelectorAll<HTMLButtonElement>(".metrics button")];
  private frame = 0;
  private hashTimer = 0;
  private selectToken = 0;

  constructor(private parts: AppParts) {
    for (const b of this.metricButtons) {
      b.addEventListener("click", () => void this.showFamily(b.dataset.family as Family, true));
    }
    addEventListener("keydown", (e) => {
      if (
        e.key === "Escape" &&
        this.selectedIndex >= 0 &&
        document.activeElement?.closest(".search") === null
      ) {
        void this.select(null, true);
        parts.canvas.focus();
      }
    });
    addEventListener("resize", () => {
      parts.renderer.resize();
      this.schedule();
    });
    addEventListener("popstate", () => this.onPopState());
  }

  schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      this.parts.renderer.draw(now);
      this.parts.labels.place();
      if (this.parts.renderer.animating) this.schedule();
    });
  }

  scheduleHash(): void {
    clearTimeout(this.hashTimer);
    this.hashTimer = window.setTimeout(() => this.writeUrl(true), HASH_DEBOUNCE_MS);
  }

  /** Redraw and write the hash, for every move of the view. */
  viewChanged(): void {
    this.schedule();
    this.scheduleHash();
  }

  writeUrl(replace = false): void {
    const path = formatPath(this.route);
    const hash = formatHash({ ...this.parts.renderer.view, color: this.color });
    const url = path + hash;
    if (url === location.pathname + location.hash) return;
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
  }

  async showFamily(family: Family, push: boolean): Promise<FamilyData> {
    const { data, renderer, panel } = this.parts;
    this.route = { ...this.route, family };
    const familyData = await data.getFamily(family);
    if (this.route.family !== family) return familyData;
    renderer.show(familyData);
    if (!this.indexes.has(family)) this.indexes.set(family, new PointIndex(familyData.layout));
    for (const b of this.metricButtons) {
      const on = b.dataset.family === family;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    if (this.selectedIndex >= 0 && this.numbers) {
      void panel.show(this.numbers[this.selectedIndex]!, family, familyData, this.selectedIndex);
    }
    if (push) this.writeUrl();
    this.schedule();
    return familyData;
  }

  async select(number: number | null, push: boolean, center = false): Promise<void> {
    const { data, renderer, panel } = this.parts;
    const token = ++this.selectToken;
    const familyData = renderer.family ?? (await data.getFamily(this.route.family));
    this.route = { ...this.route, number };
    const index = number === null ? -1 : await data.indexOfNumber(number);
    if (token !== this.selectToken) return;
    this.selectedIndex = index;
    renderer.selected = index;
    if (index < 0 || number === null) {
      panel.hide();
    } else {
      if (center) {
        renderer.centerOn(index, Math.max(renderer.view.scale, CENTER_ZOOM));
        this.liftAboveSheet();
      }
      void panel.show(number, this.route.family, familyData, index);
    }
    if (push) this.writeUrl();
    this.schedule();
  }

  // A centered point moves up into the band between the top bar and the sheet.
  private liftAboveSheet(): void {
    if (window.innerWidth > PHONE_MAX_WIDTH) return;
    const { renderer } = this.parts;
    const top = document.querySelector(".top")?.getBoundingClientRect().bottom ?? 0;
    const sheetTop = renderer.height - renderer.height * SHEET_FRACTION - SHEET_GAP_PX;
    const bandCenter = (top + sheetTop) / 2;
    renderer.view.y += ((renderer.height / 2 - bandCenter) * 2) / renderer.height;
  }

  /** Point index under a screen position within a radius in pixels, or -1. */
  private hitAt(x: number, y: number, radiusPx: number): number {
    const index = this.indexes.get(this.route.family);
    if (!index || !this.numbers) return -1;
    const { projection } = this.parts.renderer;
    const [qx, qy] = projection.screenToQuantized(x, y);
    return index.nearest(qx, qy, projection.unitsPerPixel() * radiusPx);
  }

  tap(x: number, y: number, radiusPx: number): void {
    if (!this.indexes.has(this.route.family) || !this.numbers) return;
    const hit = this.hitAt(x, y, radiusPx);
    void this.select(hit >= 0 ? this.numbers[hit]! : null, true);
  }

  hover(e: PointerEvent, radiusPx: number): void {
    const current = this.parts.renderer.family;
    if (!current || !this.numbers) return;
    const hit = this.hitAt(e.clientX, e.clientY, radiusPx);
    if (hit < 0) {
      this.parts.hover.hide();
      return;
    }
    const c = current.clusters[hit] ?? NOISE;
    const label = c === NOISE ? "" : (current.byId.get(c)?.label ?? "");
    this.parts.hover.show(e, hit, this.numbers[hit]!, label);
  }

  setColor(color: Color): void {
    this.color = color;
    void this.applyColor();
  }

  private async applyColor(): Promise<void> {
    this.color = await this.parts.theme.applyColor(this.color);
    this.viewChanged();
  }

  private onPopState(): void {
    this.route = parsePath(location.pathname);
    const { color: next, ...view } = parseHash(location.hash);
    Object.assign(this.parts.renderer.view, view);
    if (next && next !== this.color) {
      this.color = next;
      void this.applyColor();
    }
    void this.showFamily(this.route.family, false).then(() =>
      this.select(this.route.number, false),
    );
  }

  async start(): Promise<void> {
    const { data, renderer, canvas, theme, status } = this.parts;
    await stylesheetReady();
    renderer.resize();
    // A portrait screen is scaled by width, so the whole map fits on a phone.
    const aspect = canvas.clientWidth / canvas.clientHeight;
    if (aspect < 1) renderer.view.scale = Math.max(MIN_SCALE, renderer.view.scale * aspect);
    theme.applyPalette(this.color);
    const view = parseHash(location.hash);
    if (view.color) this.color = view.color;
    if (view.x !== undefined) Object.assign(renderer.view, view);
    // The first family draws as soon as it lands; the numbers, which only
    // picking and selection need, keep loading behind it.
    let count = 0;
    const numbers = data.getNumbers((received, total) => {
      if (!count) return;
      const loaded = Math.round((received / total) * count);
      status.textContent = `Loading ${thousands(loaded)} of ${thousands(count)} sequences`;
    });
    const family = this.showFamily(this.route.family, false);
    const manifest = await data.getManifest();
    count = manifest.count;
    status.textContent = `Loading ${thousands(count)} sequences`;
    const snapshot = document.getElementById("snapshot");
    if (snapshot) snapshot.textContent = `, snapshot ${manifest.snapshot}`;
    await family;
    void data.getFeatures().catch(() => undefined);
    if (this.color !== "cluster") await this.applyColor();
    this.numbers = await numbers;
    status.hidden = true;
    if (this.route.number !== null) {
      await this.select(this.route.number, false, view.x === undefined);
    }
    this.writeUrl(true);
    document.body.dataset.ready = "1";
  }
}

const thousands = (n: number) => n.toLocaleString("en-US");

// A module script can run before the stylesheet has arrived on a cold cache,
// which would leave the palette empty and the canvas at its default size.
async function stylesheetReady(): Promise<void> {
  while (!getComputedStyle(document.documentElement).getPropertyValue("--c1").trim()) {
    await new Promise((r) => requestAnimationFrame(r));
  }
}
