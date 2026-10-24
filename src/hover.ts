import { formatANumber } from "../shared/anumber.ts";
import type { DataSource } from "./data.ts";

/** The card waits this long on one point before fetching its name. */
export const HOVER_NAME_DELAY_MS = 120;

/** The small card beside the cursor naming the point under it. */
export class HoverCard {
  private timer = 0;

  constructor(
    private box: HTMLDivElement,
    private canvas: HTMLCanvasElement,
    private data: DataSource,
  ) {}

  hide(): void {
    this.box.hidden = true;
    this.canvas.style.cursor = "crosshair";
  }

  show(e: PointerEvent, index: number, number: number, label: string): void {
    this.canvas.style.cursor = "pointer";
    this.box.hidden = false;
    this.box.style.left = `${e.clientX}px`;
    this.box.style.top = `${e.clientY}px`;
    if (this.box.dataset.index === String(index)) return;
    this.box.replaceChildren();
    const id = document.createElement("span");
    id.className = "id";
    id.textContent = formatANumber(number);
    const name = document.createElement("span");
    name.textContent = label;
    this.box.append(id, name);
    this.box.dataset.index = String(index);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      void this.data.getBase(number).then((base) => {
        if (base && this.box.dataset.index === String(index)) name.textContent = base.name;
      });
    }, HOVER_NAME_DELAY_MS);
  }
}
