import { formatANumber } from "../shared/anumber.ts";
import {
  MAX_SCALE,
  MIN_SCALE,
  formatHash,
  formatPath,
  parseHash,
  parsePath,
  type Color,
  type Family,
  type Route,
} from "../shared/url.ts";
import { scheme } from "./color.ts";
import { DataSource, type FamilyData } from "./data.ts";
import { MapRenderer } from "./map.ts";
import { Panel } from "./panel.ts";
import { PointIndex } from "./pick.ts";
import { Search } from "./search.ts";

const canvas = document.getElementById("map") as HTMLCanvasElement;
const labelsBox = document.getElementById("labels") as HTMLDivElement;
const hoverBox = document.getElementById("hover") as HTMLDivElement;
const themeButton = document.getElementById("theme") as HTMLButtonElement;
const colorButtons = [...document.querySelectorAll<HTMLButtonElement>(".colors button")];
const colorToggle = document.getElementById("color-toggle") as HTMLButtonElement;
const legendBox = document.getElementById("legend") as HTMLUListElement;
const metricButtons = [...document.querySelectorAll<HTMLButtonElement>(".metrics button")];

const data = new DataSource();
const status = document.getElementById("status") as HTMLParagraphElement;
const renderer = new MapRenderer(canvas);
const indexes = new Map<Family, PointIndex>();
let numbers: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
let route: Route = parsePath(location.pathname);
let color: Color = "cluster";
let selectedIndex = -1;
renderer.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const panel = new Panel({ data, onPick: (n) => void select(n, true) });
new Search({
  form: document.querySelector(".search") as HTMLFormElement,
  input: document.getElementById("q") as HTMLInputElement,
  list: document.getElementById("results") as HTMLOListElement,
  onPick: (n) => void select(n, true, true),
});
panel.onClose = () => {
  void select(null, true);
  canvas.focus();
};

function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

let codes: Uint8Array | null = null;

function applyPalette(): void {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  renderer.dark = isDark();
  const current = scheme(color, read);
  renderer.rememberPalette(current.palette[0]!, current.palette.slice(1), read("--ink"));
  legendBox.replaceChildren(
    ...current.legend.map((item) => {
      const li = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = item.swatch;
      li.append(swatch, item.label);
      return li;
    }),
  );
  legendBox.hidden = current.legend.length === 0;
  for (const b of colorButtons) {
    const on = b.dataset.color === color;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
  themeButton.textContent = renderer.dark ? "Light" : "Dark";
  themeButton.setAttribute("aria-label", renderer.dark ? "Switch to light" : "Switch to dark");
}

let frame = 0;
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame((now) => {
    frame = 0;
    renderer.draw(now);
    placeLabels();
    if (renderer.animating) schedule();
  });
}

function chromeRects(): [number, number, number, number][] {
  return [
    ...document.querySelectorAll<HTMLElement>(".top, .tools, .panel, .foot, .legend, .colors"),
  ]
    .filter((e) => e.checkVisibility())
    .map((e) => {
      const r = e.getBoundingClientRect();
      return [r.left - 8, r.top - 8, r.right + 8, r.bottom + 8];
    });
}

function placeLabels(): void {
  const current = renderer.family;
  if (!current || renderer.animating || pinch) {
    labelsBox.replaceChildren();
    return;
  }
  // While a drag is in progress the labels ride along as one layer; they are
  // placed again from scratch when the pointer lifts.
  if (drag?.moved) {
    const dx = ((renderer.view.x - drag.vx) / 2) * renderer.width;
    const dy = (-(renderer.view.y - drag.vy) / 2) * renderer.height;
    labelsBox.style.transform = `translate(${dx}px, ${dy}px)`;
    return;
  }
  labelsBox.style.transform = "";
  const w = renderer.width;
  const h = renderer.height;
  const placed = chromeRects();
  const fragment = document.createDocumentFragment();
  const budget = (w < 600 ? 8 : w < 1024 ? 20 : 48) + placed.length;
  const seen = new Set<string>();
  for (const c of current.info) {
    if (placed.length >= budget) break;
    if (seen.has(c.label)) continue;
    const [x, y] = renderer.toScreen(c.cx, c.cy);
    const bw = c.label.length * 6.6 + 8;
    const box: [number, number, number, number] = [x - bw / 2, y - 10, x + bw / 2, y + 10];
    if (box[0] < 0 || box[1] < 0 || box[2] > w || box[3] > h) continue;
    if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) {
      continue;
    }
    placed.push(box);
    seen.add(c.label);
    const span = document.createElement("span");
    span.style.left = `${x}px`;
    span.style.top = `${y}px`;
    span.textContent = c.label;
    fragment.append(span);
  }
  labelsBox.replaceChildren(fragment);
}

// On a phone the panel is a sheet over the lower half, so a centred point
// moves up into the band between the top bar and the sheet.
function liftAboveSheet(): void {
  if (window.innerWidth > 768) return;
  const top = document.querySelector(".top")?.getBoundingClientRect().bottom ?? 0;
  const sheetTop = renderer.height - renderer.height * 0.5 - 60;
  const bandCenter = (top + sheetTop) / 2;
  renderer.view.y += ((renderer.height / 2 - bandCenter) * 2) / renderer.height;
}

function indexOfNumber(n: number): number {
  let lo = 0;
  let hi = numbers.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = numbers[mid]!;
    if (v === n) return mid;
    if (v < n) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

let hashTimer = 0;
function writeUrl(replace = false): void {
  const path = formatPath(route);
  const hash = formatHash({ ...renderer.view, color });
  const url = path + hash;
  if (url === location.pathname + location.hash) return;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
}

function scheduleHash(): void {
  clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => writeUrl(true), 250);
}

async function showFamily(family: Family, push: boolean): Promise<FamilyData> {
  route = { ...route, family };
  const familyData = await data.getFamily(family);
  if (route.family !== family) return familyData;
  renderer.show(familyData);
  if (!indexes.has(family)) indexes.set(family, new PointIndex(familyData.layout));
  for (const b of metricButtons) {
    const on = b.dataset.family === family;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
  if (selectedIndex >= 0)
    void panel.show(numbers[selectedIndex]!, family, familyData, selectedIndex);
  if (push) writeUrl();
  schedule();
  return familyData;
}

async function select(number: number | null, push: boolean, center = false): Promise<void> {
  const familyData = renderer.family ?? (await data.getFamily(route.family));
  route = { ...route, number };
  selectedIndex = number === null ? -1 : indexOfNumber(number);
  renderer.selected = selectedIndex;
  if (selectedIndex < 0 || number === null) {
    panel.hide();
  } else {
    if (center) {
      renderer.centerOn(selectedIndex, Math.max(renderer.view.scale, 14));
      liftAboveSheet();
    }
    void panel.show(number, route.family, familyData, selectedIndex);
  }
  if (push) writeUrl();
  schedule();
}

function hover(e: PointerEvent): void {
  const current = renderer.family;
  const index = indexes.get(route.family);
  if (!current || !index) return;
  const [qx, qy] = renderer.screenToQuantized(e.clientX, e.clientY);
  const hit = index.nearest(qx, qy, renderer.unitsPerPixel() * 12);
  if (hit < 0) {
    hoverBox.hidden = true;
    canvas.style.cursor = "crosshair";
    return;
  }
  canvas.style.cursor = "pointer";
  hoverBox.hidden = false;
  hoverBox.style.left = `${e.clientX}px`;
  hoverBox.style.top = `${e.clientY}px`;
  const c = current.clusters[hit] ?? 65535;
  const label = c === 65535 ? "" : (current.byId.get(c)?.label ?? "");
  if (hoverBox.dataset.index === String(hit)) return;
  hoverBox.replaceChildren();
  const id = document.createElement("span");
  id.className = "id";
  id.textContent = formatANumber(numbers[hit]!);
  const name = document.createElement("span");
  name.textContent = label;
  hoverBox.append(id, name);
  hoverBox.dataset.index = String(hit);
  const number = numbers[hit]!;
  clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    void data.getBase(number).then((base) => {
      if (base && hoverBox.dataset.index === String(hit)) name.textContent = base.name;
    });
  }, 120);
}

let hoverTimer = 0;

for (const b of metricButtons) {
  b.addEventListener("click", () => void showFamily(b.dataset.family as Family, true));
}

async function applyColor(): Promise<void> {
  if (color !== "cluster") {
    try {
      codes ??= await data.getColors();
    } catch {
      color = "cluster";
    }
  }
  applyPalette();
  if (color === "cluster" || !codes) {
    renderer.colorByCodes(null);
  } else {
    const style = getComputedStyle(document.documentElement);
    const current = scheme(color, (n) => style.getPropertyValue(n).trim());
    const slots = new Uint8Array(numbers.length);
    for (let i = 0; i < slots.length; i++) {
      slots[i] = current.slot(codes[i * 3] ?? 0, codes[i * 3 + 1] ?? 0, codes[i * 3 + 2] ?? 0);
    }
    renderer.colorByCodes(slots);
  }
  schedule();
  scheduleHash();
}

function setColorsOpen(open: boolean): void {
  document.body.classList.toggle("colors-open", open);
  colorToggle.setAttribute("aria-expanded", String(open));
}

colorToggle.addEventListener("click", () => {
  setColorsOpen(!document.body.classList.contains("colors-open"));
});

for (const b of colorButtons) {
  b.addEventListener("click", () => {
    color = b.dataset.color as Color;
    void applyColor();
    setColorsOpen(false);
  });
}

themeButton.addEventListener("click", () => {
  const next = renderer.dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("sequence-atlas:theme", next);
  } catch {
    // Private mode; the choice lasts for this page only.
  }
  applyPalette();
  schedule();
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022));
  },
  { passive: false },
);

function zoomAt(px: number, py: number, factor: number): void {
  const mx = (px / canvas.clientWidth) * 2 - 1;
  const my = 1 - (py / canvas.clientHeight) * 2;
  const v = renderer.view;
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
  const f = next / v.scale;
  v.x = mx - (mx - v.x) * f;
  v.y = my - (my - v.y) * f;
  v.scale = next;
  schedule();
  scheduleHash();
}

const pointers = new Map<number, { x: number; y: number }>();
let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
let pinch: { dist: number; scale: number } | null = null;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    drag = { x: e.clientX, y: e.clientY, vx: renderer.view.x, vy: renderer.view.y, moved: false };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: renderer.view.scale };
    drag = null;
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (pinch.scale * dist) / pinch.dist));
    zoomAt((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, target / renderer.view.scale);
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    renderer.view.x = drag.vx + (dx / canvas.clientWidth) * 2;
    renderer.view.y = drag.vy - (dy / canvas.clientHeight) * 2;
    schedule();
    scheduleHash();
    return;
  }
  if (e.pointerType === "mouse") hover(e);
});

function endPointer(e: PointerEvent): void {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && !drag.moved) {
    const index = indexes.get(route.family);
    if (index) {
      const [qx, qy] = renderer.screenToQuantized(e.clientX, e.clientY);
      const radius = renderer.unitsPerPixel() * (e.pointerType === "touch" ? 22 : 12);
      const hit = index.nearest(qx, qy, radius);
      void select(hit >= 0 ? numbers[hit]! : null, true);
    }
  }
  if (pointers.size === 0) drag = null;
  schedule();
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", (e) => {
  pointers.delete(e.pointerId);
  drag = null;
  pinch = null;
  schedule();
});
canvas.addEventListener("pointerleave", () => (hoverBox.hidden = true));

addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    selectedIndex >= 0 &&
    document.activeElement?.closest(".search") === null
  ) {
    void select(null, true);
    canvas.focus();
  }
});

canvas.addEventListener("keydown", (e) => {
  const step = 0.1;
  const v = renderer.view;
  if (e.key === "ArrowLeft") v.x += step;
  else if (e.key === "ArrowRight") v.x -= step;
  else if (e.key === "ArrowUp") v.y -= step;
  else if (e.key === "ArrowDown") v.y += step;
  else if (e.key === "+" || e.key === "=") zoomAt(renderer.width / 2, renderer.height / 2, 1.5);
  else if (e.key === "-") zoomAt(renderer.width / 2, renderer.height / 2, 1 / 1.5);
  else return;
  e.preventDefault();
  schedule();
  scheduleHash();
});

addEventListener("resize", () => {
  renderer.resize();
  schedule();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  applyPalette();
  schedule();
});
addEventListener("popstate", () => {
  route = parsePath(location.pathname);
  const { color: next, ...view } = parseHash(location.hash);
  Object.assign(renderer.view, view);
  if (next && next !== color) {
    color = next;
    void applyColor();
  }
  void showFamily(route.family, false).then(() => select(route.number, false));
});

// A module script can run before the stylesheet has arrived on a cold cache,
// which would leave the palette empty and the canvas at its default size.
async function stylesheetReady(): Promise<void> {
  while (!getComputedStyle(document.documentElement).getPropertyValue("--c1").trim()) {
    await new Promise((r) => requestAnimationFrame(r));
  }
}

async function start(): Promise<void> {
  await stylesheetReady();
  renderer.resize();
  // A portrait screen is scaled by width, so the whole map fits on a phone.
  const aspect = canvas.clientWidth / canvas.clientHeight;
  if (aspect < 1) renderer.view.scale = Math.max(MIN_SCALE, renderer.view.scale * aspect);
  applyPalette();
  const view = parseHash(location.hash);
  if (view.color) color = view.color;
  const [manifest, loadedNumbers] = await Promise.all([
    data.getManifest(),
    data.getNumbers(),
    showFamily(route.family, false),
  ]);
  const snapshot = document.getElementById("snapshot");
  if (snapshot) snapshot.textContent = `, snapshot ${manifest.snapshot}`;
  numbers = loadedNumbers;
  void data.getFeatureNames().catch(() => undefined);
  status.hidden = true;
  if (color !== "cluster") await applyColor();
  if (view.x !== undefined) Object.assign(renderer.view, view);
  if (route.number !== null) await select(route.number, false, view.x === undefined);
  writeUrl(true);
  document.body.dataset.ready = "1";
}

start().catch((error: unknown) => {
  console.error(error);
  const lede = document.querySelector(".lede");
  if (lede)
    lede.textContent = "The map could not load. Reload the page, or try a browser with WebGL2.";
});
