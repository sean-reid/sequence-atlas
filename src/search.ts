import { formatANumber } from "../shared/anumber.ts";

interface Hit {
  number: number;
  name: string;
}

interface Response {
  kind: string;
  results: Hit[];
}

export interface SearchDeps {
  form: HTMLFormElement;
  input: HTMLInputElement;
  list: HTMLOListElement;
  onPick: (number: number) => void;
}

/** The search box: debounced lookups, a results list, keyboard and pointer picking. */
export class Search {
  private timer = 0;
  private token = 0;
  private hits: Hit[] = [];
  private active = -1;

  constructor(private deps: SearchDeps) {
    const { form, input, list } = deps;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (this.hits.length) this.pick(this.hits[Math.max(0, this.active)]!.number);
      else void this.lookup(input.value, true);
    });
    input.addEventListener("input", () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.lookup(input.value, false), 180);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        this.active = (this.active + step + this.hits.length) % Math.max(1, this.hits.length);
        this.render();
      } else if (e.key === "Escape") {
        this.clear();
      }
    });
    input.addEventListener("blur", () => window.setTimeout(() => this.clear(false), 150));
    input.addEventListener("focus", () => {
      if (this.hits.length) list.hidden = false;
    });
  }

  private async lookup(text: string, submit: boolean): Promise<void> {
    const token = ++this.token;
    const q = text.trim();
    if (!q) {
      this.clear();
      return;
    }
    let body: Response;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(String(res.status));
      body = (await res.json()) as Response;
    } catch {
      body = { kind: "error", results: [] };
    }
    if (token !== this.token) return;
    this.hits = body.results;
    this.active = this.hits.length ? 0 : -1;
    if (submit && body.kind === "anumber" && this.hits[0]) {
      this.pick(this.hits[0].number);
      return;
    }
    this.render(body.kind === "error" ? "Search is unavailable right now." : undefined);
  }

  private render(note?: string): void {
    const { list } = this.deps;
    list.replaceChildren();
    if (note || !this.hits.length) {
      const li = document.createElement("li");
      li.className = "note";
      li.textContent = note ?? "Nothing matches.";
      list.append(li);
      list.hidden = false;
      return;
    }
    this.hits.forEach((hit, i) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = i === this.active ? "hit active" : "hit";
      button.setAttribute("aria-selected", String(i === this.active));
      const id = document.createElement("span");
      id.className = "id";
      id.textContent = formatANumber(hit.number);
      const name = document.createElement("span");
      name.className = "nm";
      name.textContent = hit.name;
      button.append(id, name);
      button.addEventListener("pointerdown", (e) => e.preventDefault());
      button.addEventListener("click", () => this.pick(hit.number));
      li.append(button);
      list.append(li);
    });
    list.hidden = false;
  }

  private pick(number: number): void {
    this.deps.input.value = formatANumber(number);
    this.clear(false);
    this.deps.onPick(number);
    this.deps.input.blur();
  }

  clear(reset = true): void {
    this.deps.list.hidden = true;
    this.deps.list.replaceChildren();
    if (reset) {
      this.hits = [];
      this.active = -1;
    }
  }
}
