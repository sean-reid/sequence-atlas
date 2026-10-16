import { FAMILIES, MapRenderer, loadFamily, type Family, type FamilyData } from "./map.ts";

const canvas = document.getElementById("map") as HTMLCanvasElement;
const labelsBox = document.getElementById("labels") as HTMLDivElement;
const themeButton = document.getElementById("theme") as HTMLButtonElement;
const metricButtons = [...document.querySelectorAll<HTMLButtonElement>(".metrics button")];

const renderer = new MapRenderer(canvas);
const cache = new Map<Family, Promise<FamilyData>>();
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
renderer.reduceMotion = reduce.matches;

function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyPalette(): void {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  renderer.dark = isDark();
  renderer.setPalette(
    read("--noise"),
    ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7", "--c8"].map(read),
  );
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

function placeLabels(): void {
  labelsBox.replaceChildren();
  const data = renderer.family;
  if (!data || renderer.animating) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const placed: [number, number, number, number][] = [
    ...document.querySelectorAll(".top, .tools, .panel, .foot"),
  ]
    .filter((el) => el.checkVisibility())
    .map((el) => {
      const r = el.getBoundingClientRect();
      return [r.left - 8, r.top - 8, r.right + 8, r.bottom + 8];
    });
  const chrome = placed.length;
  const budget = (w < 768 ? 14 : 48) + chrome;
  for (const c of data.info) {
    if (placed.length >= budget) break;
    const [x, y] = renderer.toScreen(c.cx, c.cy);
    if (x < 0 || y < 0 || x > w || y > h) continue;
    const bw = c.label.length * 6.6 + 8;
    const box: [number, number, number, number] = [x - bw / 2, y - 10, x + bw / 2, y + 10];
    if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1]))
      continue;
    placed.push(box);
    const span = document.createElement("span");
    span.style.left = `${x}px`;
    span.style.top = `${y}px`;
    span.textContent = c.label;
    labelsBox.append(span);
  }
}

async function showFamily(family: Family): Promise<void> {
  let pending = cache.get(family);
  if (!pending) {
    pending = loadFamily(family);
    cache.set(family, pending);
  }
  const data = await pending;
  renderer.show(data);
  for (const b of metricButtons) b.classList.toggle("on", b.dataset.family === family);
  schedule();
}

for (const b of metricButtons) {
  b.addEventListener("click", () => void showFamily(b.dataset.family as Family));
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
    const factor = Math.exp(-e.deltaY * 0.0022);
    const mx = (e.clientX / canvas.clientWidth) * 2 - 1;
    const my = 1 - (e.clientY / canvas.clientHeight) * 2;
    const v = renderer.view;
    v.x = mx - (mx - v.x) * factor;
    v.y = my - (my - v.y) * factor;
    v.scale = Math.min(400, Math.max(0.6, v.scale * factor));
    schedule();
  },
  { passive: false },
);

let drag: { x: number; y: number; vx: number; vy: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, vx: renderer.view.x, vy: renderer.view.y };
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  renderer.view.x = drag.vx + ((e.clientX - drag.x) / canvas.clientWidth) * 2;
  renderer.view.y = drag.vy - ((e.clientY - drag.y) / canvas.clientHeight) * 2;
  schedule();
});
canvas.addEventListener("pointerup", () => (drag = null));
canvas.addEventListener("pointercancel", () => (drag = null));

addEventListener("resize", () => {
  renderer.resize();
  schedule();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  applyPalette();
  schedule();
});

const initial = (new URLSearchParams(location.search).get("f") as Family | null) ?? "all";
applyPalette();
void showFamily(FAMILIES.includes(initial) ? initial : "all").then(() => {
  document.body.dataset.ready = "1";
});
