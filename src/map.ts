import { parseLayout, type Layout } from "../shared/layout.ts";

export type Family = "all" | "growth" | "arith" | "recur" | "graph";
export const FAMILIES: Family[] = ["all", "growth", "arith", "recur", "graph"];

export interface ClusterInfo {
  id: number;
  label: string;
  size: number;
  cx: number;
  cy: number;
}

export interface FamilyData {
  layout: Layout;
  clusters: Uint16Array;
  info: ClusterInfo[];
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

const NOISE = 65535;

const VERTEX = `#version 300 es
in vec2 p0;
in vec2 p1;
in float colour;
uniform float t;
uniform vec2 scale;
uniform vec2 offset;
uniform float size;
uniform vec3 palette[9];
out vec3 vc;
void main() {
  vec2 p = mix(p0, p1, t) / 32767.5 - 1.0;
  gl_Position = vec4(p * scale + offset, 0.0, 1.0);
  gl_PointSize = size;
  vc = palette[int(colour)];
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 vc;
out vec4 o;
uniform float alpha;
uniform float additive;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  o = vec4(vc * alpha, alpha * (1.0 - additive) + additive * alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("no shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader failed");
  }
  return shader;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.trim().slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export async function loadFamily(family: Family): Promise<FamilyData> {
  const [layoutBuf, clusterBuf, info] = await Promise.all([
    fetch(`/data/${family}.layout.bin`).then((r) => r.arrayBuffer()),
    fetch(`/data/${family}.cluster.u16`).then((r) => r.arrayBuffer()),
    fetch(`/data/${family}.clusters.json`).then((r) => r.json() as Promise<ClusterInfo[]>),
  ]);
  return { layout: parseLayout(layoutBuf), clusters: new Uint16Array(clusterBuf), info };
}

export class MapRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffers: { p0: WebGLBuffer; p1: WebGLBuffer; colour: WebGLBuffer };
  private count = 0;
  private t = 1;
  private tStart = 0;
  private current: FamilyData | null = null;
  view: View = { scale: 1.7, x: 0, y: 0 };
  dark = true;
  reduceMotion = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    const program = gl.createProgram();
    if (!program) throw new Error("no program");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
    }
    gl.useProgram(program);
    this.program = program;
    const make = () => {
      const b = gl.createBuffer();
      if (!b) throw new Error("no buffer");
      return b;
    };
    this.buffers = { p0: make(), p1: make(), colour: make() };
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private setAttribute(
    name: string,
    buffer: WebGLBuffer,
    data: ArrayBufferView,
    size: number,
    type: number,
  ): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, false, 0, 0);
  }

  private colourIndices(data: FamilyData): Float32Array {
    // Slot 0 is the noise colour; clusters take the eight palette slots in turn.
    const out = new Float32Array(data.layout.count);
    for (let i = 0; i < out.length; i++) {
      const c = data.clusters[i] ?? NOISE;
      out[i] = c === NOISE ? 0 : 1 + (c % 8);
    }
    return out;
  }

  show(data: FamilyData): void {
    const from = this.current ?? data;
    this.current = data;
    this.count = data.layout.count;
    this.setAttribute("p0", this.buffers.p0, from.layout.points, 2, this.gl.UNSIGNED_SHORT);
    this.setAttribute("p1", this.buffers.p1, data.layout.points, 2, this.gl.UNSIGNED_SHORT);
    this.setAttribute("colour", this.buffers.colour, this.colourIndices(data), 1, this.gl.FLOAT);
    this.t = from === data || this.reduceMotion ? 1 : 0;
    this.tStart = performance.now();
  }

  setPalette(noise: string, hexes: string[]): void {
    const flat = [noise, ...hexes].flatMap(hexToRgb);
    this.gl.uniform3fv(this.gl.getUniformLocation(this.program, "palette"), new Float32Array(flat));
  }

  get animating(): boolean {
    return this.t < 1;
  }

  draw(now: number): void {
    const gl = this.gl;
    if (this.t < 1) {
      const raw = Math.min(1, (now - this.tStart) / 900);
      this.t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    if (this.dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const aspect = this.canvas.width / this.canvas.height;
    const u = (n: string) => gl.getUniformLocation(this.program, n);
    gl.uniform1f(u("t"), this.t);
    gl.uniform2f(u("scale"), this.view.scale / aspect, this.view.scale);
    gl.uniform2f(u("offset"), this.view.x, this.view.y);
    const dpr = Math.min(devicePixelRatio, 2);
    gl.uniform1f(u("size"), Math.max(1.4, Math.min(9, this.view.scale * 1.15)) * dpr);
    gl.uniform1f(u("alpha"), Math.min(0.85, 0.13 + this.view.scale * 0.06));
    gl.uniform1f(u("additive"), this.dark ? 1 : 0);
    gl.drawArrays(gl.POINTS, 0, this.count);
  }

  /** Screen position in CSS pixels of a point in embedding units, for the current family. */
  toScreen(ex: number, ey: number): [number, number] {
    const data = this.current;
    if (!data) return [0, 0];
    const [x0, y0, x1, y1] = data.layout.bounds;
    const nx = ((ex - x0) / (x1 - x0)) * 2 - 1;
    const ny = ((ey - y0) / (y1 - y0)) * 2 - 1;
    const aspect = this.canvas.width / this.canvas.height;
    const sx = ((nx * this.view.scale) / aspect + this.view.x + 1) / 2;
    const sy = (1 - (ny * this.view.scale + this.view.y)) / 2;
    return [sx * this.canvas.clientWidth, sy * this.canvas.clientHeight];
  }

  get family(): FamilyData | null {
    return this.current;
  }
}
