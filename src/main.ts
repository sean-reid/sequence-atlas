import { App } from "./app.ts";
import { DataSource } from "./data.ts";
import { HoverCard } from "./hover.ts";
import { Interaction } from "./interaction.ts";
import { LabelLayer } from "./labels.ts";
import { MapRenderer } from "./map.ts";
import { Panel } from "./panel.ts";
import { Search } from "./search.ts";
import { Theme } from "./theme.ts";

const canvas = document.getElementById("map") as HTMLCanvasElement;
const data = new DataSource();
const renderer = new MapRenderer(canvas);
renderer.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const theme: Theme = new Theme({
  renderer,
  data,
  color: () => app.color,
  onColor: (color) => app.setColor(color),
  onChange: () => app.schedule(),
});
const interaction = new Interaction(canvas, renderer.projection, {
  onTap: (x, y, radius) => app.tap(x, y, radius),
  onHover: (e, radius) => app.hover(e, radius),
  onHoverEnd: () => hover.hide(),
  onViewChange: () => app.viewChanged(),
  onRedraw: () => app.schedule(),
});
const hover = new HoverCard(document.getElementById("hover") as HTMLDivElement, canvas, data);
const labels = new LabelLayer(
  document.getElementById("labels") as HTMLDivElement,
  renderer,
  interaction,
);
const panel = new Panel({ data, onPick: (n) => void app.select(n, true) });
panel.onClose = () => {
  void app.select(null, true);
  canvas.focus();
};
new Search({
  form: document.querySelector(".search") as HTMLFormElement,
  input: document.getElementById("q") as HTMLInputElement,
  list: document.getElementById("results") as HTMLOListElement,
  onPick: (n) => void app.select(n, true, true),
});

const app: App = new App({
  data,
  renderer,
  canvas,
  panel,
  theme,
  labels,
  hover,
  status: document.getElementById("status") as HTMLParagraphElement,
});

app.start().catch((error: unknown) => {
  console.error(error);
  const lede = document.querySelector(".lede");
  if (lede)
    lede.textContent = "The map could not load. Reload the page, or try a browser with WebGL2.";
});
