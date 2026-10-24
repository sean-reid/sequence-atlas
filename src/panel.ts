import { formatANumber } from "../shared/anumber.ts";
import { NOISE } from "../shared/format.ts";
import type { Family } from "../shared/url.ts";
import { DEFAULT_LABELS } from "./color.ts";
import type { BaseEntry, DataSource, FamilyData, Features, NeighborRow } from "./data.ts";

const FAMILY_NAMES: Record<Family, string> = {
  all: "combined",
  growth: "growth",
  arith: "arithmetic",
  recur: "recurrence",
  graph: "references",
};

const NO_FEATURES: Features = { columns: {}, labels: DEFAULT_LABELS, format: null };

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

    this.root.scrollTop = 0;
    let failed = false;
    // The base entry and the neighbour rows key on the same number, so they load together.
    const neighbours = this.deps.data.getNeighbors(number, family).catch(() => [] as NeighborRow[]);
    const [base, features]: [BaseEntry | null, Features] = await Promise.all([
      this.deps.data.getBase(number).catch((error: unknown) => {
        console.warn(error);
        failed = true;
        return null;
      }),
      this.deps.data.getFeatures().catch(() => NO_FEATURES),
    ]);
    if (token !== this.token) return;
    const clusterId = familyData.clusters[index];
    const cluster =
      clusterId === undefined || clusterId === NOISE ? null : familyData.byId.get(clusterId);
    if (!base) {
      el("p-name").textContent = failed
        ? "The details for this sequence did not load."
        : "This snapshot has no details for this sequence.";
      el("p-summary").textContent = cluster ? `Island: ${cluster.label}.` : "";
      near.replaceChildren();
      return;
    }
    el("p-name").textContent = base.name;
    el("p-terms").textContent = base.terms.split(",").join(", ") + ", …";
    el("p-keywords").textContent = base.keywords.join(" ");
    const [growth, order] = base.color;
    const bits = [`${features.labels.growth[growth] ?? "irregular"} growth`];
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

    const phrases = (features.columns[family] ?? []).map((c) => c.phrase);
    const rows = await neighbours;
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
  li.setAttribute("role", "status");
  li.textContent = "Loading neighbors";
  return li;
}
