import type { Color } from "../shared/url.ts";
import { DEFAULT_LABELS, scheme, type LabelTables } from "./color.ts";
import type { DataSource } from "./data.ts";
import type { MapRenderer } from "./map.ts";

export const THEME_KEY = "sequence-atlas:theme";

export interface ThemeDeps {
  renderer: MapRenderer;
  data: DataSource;
  /** The color variable in force, owned by the app. */
  color: () => Color;
  onColor: (color: Color) => void;
  /** The palette changed: redraw. */
  onChange: () => void;
}

export function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Light and dark, the color variable buttons, the legend, and the palette. */
export class Theme {
  private legendBox = document.getElementById("legend") as HTMLUListElement;
  private themeButton = document.getElementById("theme") as HTMLButtonElement;
  private colorToggle = document.getElementById("color-toggle") as HTMLButtonElement;
  private colorButtons = [...document.querySelectorAll<HTMLButtonElement>(".colors button")];
  private codes: Uint8Array | null = null;
  private labels: LabelTables = DEFAULT_LABELS;

  constructor(private deps: ThemeDeps) {
    this.themeButton.addEventListener("click", () => this.toggleDark());
    this.colorToggle.addEventListener("click", () => {
      this.setColorsOpen(!document.body.classList.contains("colors-open"));
    });
    for (const b of this.colorButtons) {
      b.addEventListener("click", () => {
        deps.onColor(b.dataset.color as Color);
        this.setColorsOpen(false);
      });
    }
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      this.applyPalette(deps.color());
      deps.onChange();
    });
  }

  private toggleDark(): void {
    const next = this.deps.renderer.dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode; the choice lasts for this page only.
    }
    this.applyPalette(this.deps.color());
    this.deps.onChange();
  }

  private setColorsOpen(open: boolean): void {
    document.body.classList.toggle("colors-open", open);
    this.colorToggle.setAttribute("aria-expanded", String(open));
  }

  private css(): (name: string) => string {
    const style = getComputedStyle(document.documentElement);
    return (name) => style.getPropertyValue(name).trim();
  }

  /** Sends the palette for the theme and color variable to the renderer and the legend. */
  applyPalette(color: Color): void {
    const read = this.css();
    const renderer = this.deps.renderer;
    renderer.dark = isDark();
    const current = scheme(color, read, this.labels);
    renderer.rememberPalette(current.palette[0]!, current.palette.slice(1), read("--ink"));
    this.legendBox.replaceChildren(
      ...current.legend.map((item) => {
        const li = document.createElement("li");
        const swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = item.swatch;
        li.append(swatch, item.label);
        return li;
      }),
    );
    this.legendBox.hidden = current.legend.length === 0;
    for (const b of this.colorButtons) {
      const on = b.dataset.color === color;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    this.themeButton.textContent = renderer.dark ? "Light" : "Dark";
    this.themeButton.setAttribute(
      "aria-label",
      renderer.dark ? "Switch to light" : "Switch to dark",
    );
  }

  /**
   * Colors the points by a variable, loading the color codes and label
   * tables on first use. Resolves to the color in force, which is cluster
   * when the codes could not load.
   */
  async applyColor(color: Color): Promise<Color> {
    if (color !== "cluster") {
      const [codes, features] = await Promise.all([
        this.deps.data.getColors().catch(() => null),
        this.deps.data.getFeatures().catch(() => null),
      ]);
      this.codes = codes;
      if (features) this.labels = features.labels;
      if (!codes) color = "cluster";
    }
    this.applyPalette(color);
    const codes = this.codes;
    if (color === "cluster" || !codes) {
      this.deps.renderer.colorByCodes(null);
    } else {
      const slot = scheme(color, this.css(), this.labels).slot;
      const slots = new Uint8Array(codes.length / 3);
      for (let i = 0; i < slots.length; i++) {
        slots[i] = slot(codes[i * 3] ?? 0, codes[i * 3 + 1] ?? 0, codes[i * 3 + 2] ?? 0);
      }
      this.deps.renderer.colorByCodes(slots);
    }
    return color;
  }
}
