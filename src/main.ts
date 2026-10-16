import { formatANumber } from "../shared/anumber.ts";
import {
  formatHash,
  formatPath,
  parseHash,
  parsePath,
  type Colour,
  type Family,
  type Route,
} from "../shared/url.ts";
import { scheme } from "./colour.ts";
import { DataSource, type FamilyData } from "./data.ts";
import { MapRenderer } from "./map.ts";
import { Panel } from "./panel.ts";
import { PointIndex } from "./pick.ts";
import { Search } from "./search.ts";

const canvas = document.getElementById("map") as HTMLCanvasElement;
const labelsBox = document.getElementById("labels") as HTMLDivElement;
const hoverBox = document.getElementById("hover") as HTMLDivElement;
const themeButton = document.getElementById("theme") as HTMLButtonElement;
const colourSelect = document.getElementById("colour") as HTMLSelectElement;
const legendBox = document.getElementById("legend") as HTMLUListElement;
const metricButtons = [...document.querySelectorAll<HTMLButtonElement>(".metrics button")];

const data = new DataSource();
const renderer = new MapRenderer(canvas);
const indexes = new Map<Family, PointIndex>();
let numbers: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
let route: Route = parsePath(location.pathname);
let colour: Colour = "cluster";
let selectedIndex = -1;
renderer.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const panel = new Panel({ data, onPick: (n) => void select(n, true) });
new Search({
  form: document.querySelector(".search") as HTMLFormElement,
  input: document.getElementById("q") as HTMLInputElement,
  list: document.getElementById("results") as HTMLOListElement,
  onPick: (n) => void select(n, true, true),
});
panel.onClose = () => void select(null, true);

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
  const current = scheme(colour, read);
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
  legendBox.classList.toggle("beside-panel", !document.getElementById("panel")!.hidden);
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
  return [...document.querySelectorAll<HTMLElement>(".top, .tools, .panel, .foot")]
    .filter((e) => e.checkVisibility())
    .map((e) => {
      const r = e.getBoundingClientRect();
      return [r.left - 8, r.top - 8, r.right + 8, r.bottom + 8];
    });
}

function placeLabels(): void {
  labelsBox.replaceChildren();
  const current = renderer.family;
  if (!current || renderer.animating) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const placed = chromeRects();
  const budget = (w < 768 ? 14 : 48) + placed.length;
  for (const c of current.info) {
    if (placed.length >= budget) break;
    const [x, y] = renderer.toScreen(c.cx, c.cy);
    if (x < 0 || y < 0 || x > w || y > h) continue;
    const bw = c.label.length * 6.6 + 8;
    const box: [number, number, number, number] = [x - bw / 2, y - 10, x + bw / 2, y + 10];
    if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) {
      continue;
    }
    placed.push(box);
    const span = document.createElement("span");
    span.style.left = `${x}px`;
    span.style.top = `${y}px`;
    span.textContent = c.label;
    labelsBox.append(span);
  }
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
  const hash = formatHash({ ...renderer.view, colour });
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
  const familyData = await data.getFamily(family);
  route = { ...route, family };
  renderer.show(familyData);
  if (!indexes.has(family)) indexes.set(family, new PointIndex(familyData.layout));
  for (const b of metricButtons) b.classList.toggle("on", b.dataset.family === family);
  if (selectedIndex >= 0)
    void panel.show(numbers[selectedIndex]!, family, familyData, selectedIndex);
  if (push) writeUrl();
  schedule();
  return familyData;
}

async function select(number: number | null, push: boolean, centre = false): Promise<void> {
  const familyData = renderer.family ?? (await data.getFamily(route.family));
  route = { ...route, number };
  selectedIndex = number === null ? -1 : indexOfNumber(number);
  renderer.selected = selectedIndex;
  if (selectedIndex < 0 || number === null) {
    panel.hide();
    legendBox.classList.remove("beside-panel");
  } else {
    legendBox.classList.add("beside-panel");
    if (centre) renderer.centreOn(selectedIndex, Math.max(renderer.view.scale, 14));
    void panel.show(number, route.family, familyData, selectedIndex);
  }
  if (push) writeUrl();
  schedule();
}

function hover(e: PointerEvent): void {
  const current = renderer.family;
  const index = indexes.get(route.family);
  if (!current || !index) return;
  const [qx, qy] = renderer.screenToQuantised(e.clientX, e.clientY);
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
  hoverBox.replaceChildren();
  const id = document.createElement("span");
  id.className = "id";
  id.textContent = formatANumber(numbers[hit]!);
  hoverBox.append(id, label);
  hoverBox.dataset.index = String(hit);
}

for (const b of metricButtons) {
  b.addEventListener("click", () => void showFamily(b.dataset.family as Family, true));
}

async function applyColour(): Promise<void> {
  applyPalette();
  if (colour === "cluster") {
    renderer.colourByCodes(null);
  } else {
    codes ??= await data.getColours();
    const style = getComputedStyle(document.documentElement);
    const current = scheme(colour, (n) => style.getPropertyValue(n).trim());
    const slots = new Uint8Array(numbers.length);
    for (let i = 0; i < slots.length; i++) {
      slots[i] = current.slot(codes[i * 3] ?? 0, codes[i * 3 + 1] ?? 0, codes[i * 3 + 2] ?? 0);
    }
    renderer.colourByCodes(slots);
  }
  schedule();
}

colourSelect.addEventListener("change", () => {
  colour = colourSelect.value as Colour;
  void applyColour();
  scheduleHash();
});

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
  const next = Math.min(400, Math.max(0.6, v.scale * factor));
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
    const target = Math.min(400, Math.max(0.6, (pinch.scale * dist) / pinch.dist));
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
      const [qx, qy] = renderer.screenToQuantised(e.clientX, e.clientY);
      const radius = renderer.unitsPerPixel() * (e.pointerType === "touch" ? 22 : 12);
      const hit = index.nearest(qx, qy, radius);
      void select(hit >= 0 ? numbers[hit]! : null, true);
    }
  }
  if (pointers.size === 0) drag = null;
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", (e) => {
  pointers.delete(e.pointerId);
  drag = null;
  pinch = null;
});
canvas.addEventListener("pointerleave", () => (hoverBox.hidden = true));

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
  const view = parseHash(location.hash);
  Object.assign(renderer.view, view);
  void showFamily(route.family, false).then(() => select(route.number, false));
});

async function start(): Promise<void> {
  applyPalette();
  const view = parseHash(location.hash);
  if (view.colour) {
    colour = view.colour;
    colourSelect.value = colour;
  }
  numbers = await data.getNumbers();
  await showFamily(route.family, false);
  if (colour !== "cluster") await applyColour();
  if (view.x !== undefined) Object.assign(renderer.view, view);
  if (route.number !== null) await select(route.number, false, view.x === undefined);
  writeUrl(true);
  document.body.dataset.ready = "1";
}

void start();
