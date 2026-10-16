import { formatANumber } from "../shared/anumber.ts";
import type { Family } from "../shared/url.ts";
import type { BaseEntry, DataSource, FamilyData, NeighbourRow } from "./data.ts";

const FAMILY_NAMES: Record<Family, string> = {
  all: "combined",
  growth: "growth",
  arith: "arithmetic",
  recur: "recurrence",
  graph: "references",
};

const GROWTH = [
  "constant or periodic",
  "linear growth",
  "quadratic growth",
  "cubic or quartic growth",
  "polynomial growth",
  "exponential growth",
  "factorial growth or faster",
  "irregular growth",
];

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface PanelDeps {
  data: DataSource;
  onPick: (number: number) => void;
}

export class Panel {
  private root = el<HTMLElement>("panel");
  private token = 0;

  constructor(private deps: PanelDeps) {
    el("p-close").addEventListener("click", () => this.onClose?.());
  }

  onClose: (() => void) | null = null;

  hide(): void {
    this.root.hidden = true;
  }

  async show(number: number, family: Family, familyData: FamilyData, index: number): Promise<void> {
    const token = ++this.token;
    const id = formatANumber(number);
    this.root.hidden = false;
    el("p-number").textContent = id;
    el("p-name").textContent = "";
    el("p-terms").textContent = "";
    el("p-keywords").textContent = "";
    el("p-summary").textContent = "";
    el("p-near-head").textContent = `Nearest in the ${FAMILY_NAMES[family]} map`;
    el<HTMLAnchorElement>("p-oeis").href = `https://oeis.org/${id}`;
    el("p-oeis").textContent = `${id} at oeis.org`;
    const near = el<HTMLOListElement>("p-near");
    near.replaceChildren(loading());

    const base: BaseEntry | null = await this.deps.data.getBase(number).catch(() => null);
    if (token !== this.token) return;
    const clusterId = familyData.clusters[index];
    const cluster =
      clusterId === undefined || clusterId === 65535 ? null : familyData.byId.get(clusterId);
    if (!base) {
      el("p-name").textContent = "This snapshot has no details for this sequence.";
      el("p-summary").textContent = cluster ? `Island: ${cluster.label}.` : "";
      near.replaceChildren();
      return;
    }
    el("p-name").textContent = base.name;
    el("p-terms").textContent = base.terms.split(",").join(", ") + ", …";
    el("p-keywords").textContent = base.keywords.join(" ");
    const [growth, order] = base.colour;
    const bits = [GROWTH[growth] ?? ""];
    if (order > 0) bits.push(`linear recurrence of order ${order}`);
    const summary = document.createElement("span");
    summary.append(bits.filter(Boolean).join(", ") + ". ");
    if (cluster) {
      summary.append(`In the ${FAMILY_NAMES[family]} map it sits in the island `);
      const strong = document.createElement("span");
      strong.className = "cluster";
      strong.textContent = cluster.label;
      summary.append(strong, ".");
    }
    el("p-summary").replaceChildren(summary);

    const [rows, phrases]: [NeighbourRow[], string[]] = await Promise.all([
      this.deps.data.getNeighbours(number, family).catch(() => []),
      this.deps.data
        .getFeatureNames()
        .then((f) => (f[family] ?? []).map((c) => c.phrase))
        .catch(() => []),
    ]);
    if (token !== this.token) return;
    near.replaceChildren();
    const names = await Promise.all(
      rows.map((r) => this.deps.data.getBase(r[0]).catch(() => null)),
    );
    if (token !== this.token) return;
    rows.forEach((row, i) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pick";
      button.addEventListener("click", () => this.deps.onPick(row[0]));
      const idSpan = document.createElement("span");
      idSpan.className = "id";
      idSpan.textContent = formatANumber(row[0]);
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = names[i]?.name ?? "";
      const why = document.createElement("span");
      why.className = "why";
      why.textContent = [...new Set([phrases[row[1]], phrases[row[2]]].filter(Boolean))].join(", ");
      button.append(idSpan, nm, why);
      li.append(button);
      near.append(li);
    });
  }
}

function loading(): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "loading";
  li.textContent = "Loading neighbours";
  return li;
}
