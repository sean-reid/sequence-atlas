import { formatANumber, parseANumber } from "./anumber.ts";

export const FAMILIES = ["all", "growth", "arith", "recur", "graph"] as const;
export type Family = (typeof FAMILIES)[number];
export const COLORS = ["cluster", "growth", "order", "keyword"] as const;
export type Color = (typeof COLORS)[number];

export interface Route {
  number: number | null;
  family: Family;
}

export interface ViewState {
  x: number;
  y: number;
  scale: number;
  color: Color;
}

export function isFamily(text: string | null | undefined): text is Family {
  return (FAMILIES as readonly string[]).includes(text ?? "");
}

export function parsePath(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  const number = parts[0] ? parseANumber(parts[0]) : null;
  const family = isFamily(parts[1]) ? parts[1] : "all";
  if (parts[0] && number === null)
    return { number: null, family: isFamily(parts[0]) ? parts[0] : "all" };
  return { number, family };
}

export function formatPath(route: Route): string {
  if (route.number === null) return route.family === "all" ? "/" : `/${route.family}`;
  return route.family === "all"
    ? `/${formatANumber(route.number)}`
    : `/${formatANumber(route.number)}/${route.family}`;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export const MIN_SCALE = 0.6;
export const MAX_SCALE = 60;

export function parseHash(hash: string): Partial<ViewState> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const out: Partial<ViewState> = {};
  const num = (k: string) => {
    const v = Number(params.get(k));
    return params.has(k) && Number.isFinite(v) ? v : undefined;
  };
  const x = num("x");
  const y = num("y");
  const z = num("z");
  const scale = z === undefined ? 1 : Math.min(MAX_SCALE, Math.max(MIN_SCALE, z));
  const limit = scale + 1;
  if (x !== undefined) out.x = Math.min(limit, Math.max(-limit, x));
  if (y !== undefined) out.y = Math.min(limit, Math.max(-limit, y));
  if (z !== undefined) out.scale = scale;
  const c = params.get("c");
  if (c && (COLORS as readonly string[]).includes(c)) out.color = c as Color;
  return out;
}

export function formatHash(state: ViewState): string {
  const params = new URLSearchParams();
  if (state.x !== 0 || state.y !== 0 || state.scale !== 1) {
    params.set("x", String(round(state.x)));
    params.set("y", String(round(state.y)));
    params.set("z", String(round(state.scale)));
  }
  if (state.color !== "cluster") params.set("c", state.color);
  const text = params.toString();
  return text ? `#${text}` : "";
}
