import { expect, type APIRequestContext, type Page } from "@playwright/test";

export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("body[data-ready]")).toBeVisible();
}

export interface Hash {
  x: number;
  y: number;
  z: number;
}

export function hashOf(url: string): Hash {
  const params = new URLSearchParams(new URL(url).hash.replace(/^#/, ""));
  return { x: Number(params.get("x")), y: Number(params.get("y")), z: Number(params.get("z")) };
}

/** numbers.u32 in the fixture holds 1 to 600 in order, so a point's index is its number minus one. */
export const FIBONACCI = 45;
export const FIBONACCI_INDEX = 44;

const HEADER_BYTES = 24;

/** Quantized position of one point, read from the layout file the page itself loads. */
export async function layoutPoint(
  request: APIRequestContext,
  family: string,
  index: number,
): Promise<[number, number]> {
  const { version } = (await (await request.get("/data/manifest.json")).json()) as {
    version: string;
  };
  const body = await (await request.get(`/data/v/${version}/${family}.layout.bin`)).body();
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const at = HEADER_BYTES + index * 4;
  return [view.getUint16(at, true), view.getUint16(at + 2, true)];
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export interface Placement {
  /** Hash fragment that puts the point at the requested screen position. */
  hash: string;
  /** Where the point lands once the hash is rounded to three decimals. */
  sx: number;
  sy: number;
}

/** The view that puts a quantized point at screen (tx, ty) for a canvas of width by height at zoom z. */
export function placeAt(
  [qx, qy]: [number, number],
  width: number,
  height: number,
  tx: number,
  ty: number,
  z: number,
): Placement {
  const aspect = width / height;
  const nx = qx / 32767.5 - 1;
  const ny = qy / 32767.5 - 1;
  const x = round((tx / width) * 2 - 1 - (nx * z) / aspect);
  const y = round(1 - (ty / height) * 2 - ny * z);
  const sx = (((nx * z) / aspect + x + 1) / 2) * width;
  const sy = ((1 - (ny * z + y)) / 2) * height;
  return { hash: `#x=${x}&y=${y}&z=${z}`, sx, sy };
}

/** A view with the Fibonacci point in the clear band below the top bar and above any sheet. */
export async function fibonacciOnScreen(page: Page, family = "all"): Promise<Placement> {
  const { width, height } = page.viewportSize()!;
  const point = await layoutPoint(page.request, family, FIBONACCI_INDEX);
  return placeAt(point, width, height, width / 2, height * 0.3, 20);
}
