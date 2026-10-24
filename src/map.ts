import { NOISE, QUANT_MAX } from "../shared/format.ts";
import type { FamilyData } from "./data.ts";

export interface View {
  scale: number;
  x: number;
  y: number;
}

const VERTEX = `#version 300 es
in vec2 p0;
in vec2 p1;
in float color;
uniform float t;
uniform vec2 scale;
uniform vec2 offset;
uniform float size;
uniform vec3 palette[9];
uniform float highlight;
out vec3 vc;
void main() {
  vec2 p = mix(p0, p1, t) / 32767.5 - 1.0;
  gl_Position = vec4(p * scale + offset, 0.0, 1.0);
  gl_PointSize = size;
  vc = highlight > 0.5 ? palette[0] : palette[int(color)];
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 vc;
out vec4 o;
uniform float alpha;
uniform float ring;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  if (ring > 0.5 && r2 < 0.12) discard;
  o = vec4(vc * alpha, alpha);
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

export class MapRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffers: { p0: WebGLBuffer; p1: WebGLBuffer; color: WebGLBuffer };
  private count = 0;
  private t = 1;
  private tStart = 0;
  private current: FamilyData | null = null;
  private colorSource: ((data: FamilyData) => Float32Array | Uint8Array) | null = null;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private highlightRgb = new Float32Array(27);
  /** CSS pixel size, cached so drawing and label placement never read layout. */
  width = 1;
  height = 1;
  view: View = { scale: 1.7, x: 0, y: 0 };
  dark = true;
  reduceMotion = false;
  selected = -1;
  highlightColor = "#ffffff";

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
    this.buffers = { p0: make(), p1: make(), color: make() };
    this.resize();
  }

  get dpr(): number {
    return Math.min(devicePixelRatio, 2);
  }

  resize(): void {
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private uniform(name: string): WebGLUniformLocation | null {
    let loc = this.uniforms.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(this.program, name);
      this.uniforms.set(name, loc);
    }
    return loc;
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

  /** Default coloring: slot 0 for noise, the eight palette slots by cluster id. */
  static clusterColors(data: FamilyData): Uint8Array {
    const out = new Uint8Array(data.layout.count);
    for (let i = 0; i < out.length; i++) {
      const c = data.clusters[i] ?? NOISE;
      out[i] = c === NOISE ? 0 : 1 + (c % 8);
    }
    return out;
  }

  setColorSource(source: (data: FamilyData) => Float32Array | Uint8Array): void {
    this.colorSource = source;
    if (this.current) this.recolor();
  }

  recolor(): void {
    if (!this.current) return;
    const source = this.colorSource ?? MapRenderer.clusterColors;
    const slots = source(this.current);
    const type = slots instanceof Uint8Array ? this.gl.UNSIGNED_BYTE : this.gl.FLOAT;
    this.setAttribute("color", this.buffers.color, slots, 1, type);
  }

  show(data: FamilyData): void {
    const from = this.current ?? data;
    this.current = data;
    this.count = data.layout.count;
    this.setAttribute("p0", this.buffers.p0, from.layout.points, 2, this.gl.UNSIGNED_SHORT);
    this.setAttribute("p1", this.buffers.p1, data.layout.points, 2, this.gl.UNSIGNED_SHORT);
    this.recolor();
    this.t = from === data || this.reduceMotion ? 1 : 0;
    this.tStart = performance.now();
  }

  setPalette(noise: string, hexes: string[], highlight: string): void {
    const flat = [noise, ...hexes].flatMap(hexToRgb);
    this.gl.uniform3fv(this.uniform("palette"), new Float32Array(flat));
    this.highlightColor = highlight;
    this.highlightRgb.fill(0);
    this.highlightRgb.set(hexToRgb(highlight));
  }

  get animating(): boolean {
    return this.t < 1;
  }

  get family(): FamilyData | null {
    return this.current;
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
    // Additive blending shows density when the whole map is on screen; once
    // zoomed in the points are separate and additive only bleaches them.
    const additive = this.dark && this.view.scale < 4;
    if (additive) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const aspect = this.canvas.width / this.canvas.height;
    const u = (n: string) => this.uniform(n);
    gl.uniform1f(u("t"), this.t);
    gl.uniform2f(u("scale"), this.view.scale / aspect, this.view.scale);
    gl.uniform2f(u("offset"), this.view.x, this.view.y);
    const size = Math.max(1.4, Math.min(14, this.view.scale * 1.15)) * this.dpr;
    gl.uniform1f(u("size"), size);
    gl.uniform1f(
      u("alpha"),
      additive ? 0.13 + this.view.scale * 0.06 : Math.min(0.92, 0.5 + this.view.scale * 0.03),
    );
    gl.uniform1f(u("highlight"), 0);
    gl.uniform1f(u("ring"), 0);
    gl.drawArrays(gl.POINTS, 0, this.count);
    if (this.selected >= 0 && this.selected < this.count) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform3fv(u("palette"), this.highlightRgb);
      gl.uniform1f(u("highlight"), 1);
      gl.uniform1f(u("alpha"), 1);
      gl.uniform1f(u("size"), Math.max(size * 3, 16 * this.dpr));
      gl.uniform1f(u("ring"), 1);
      gl.drawArrays(gl.POINTS, this.selected, 1);
      this.restorePalette();
    }
  }

  private paletteCache: Float32Array | null = null;
  private restorePalette(): void {
    if (this.paletteCache) this.gl.uniform3fv(this.uniform("palette"), this.paletteCache);
  }

  rememberPalette(noise: string, hexes: string[], highlight: string): void {
    this.paletteCache = new Float32Array([noise, ...hexes].flatMap(hexToRgb));
    this.setPalette(noise, hexes, highlight);
  }

  /** Color every point by a code of its own rather than its cluster. */
  colorByCodes(slots: Uint8Array | null): void {
    this.setColorSource(slots ? () => slots : MapRenderer.clusterColors);
  }

  /** Screen position in CSS pixels of a point given in embedding units. */
  toScreen(ex: number, ey: number): [number, number] {
    const data = this.current;
    if (!data) return [0, 0];
    const [x0, y0, x1, y1] = data.layout.bounds;
    const qx = ((ex - x0) / (x1 - x0)) * QUANT_MAX;
    const qy = ((ey - y0) / (y1 - y0)) * QUANT_MAX;
    return this.quantizedToScreen(qx, qy);
  }

  quantizedToScreen(qx: number, qy: number): [number, number] {
    const aspect = this.canvas.width / this.canvas.height;
    const nx = qx / 32767.5 - 1;
    const ny = qy / 32767.5 - 1;
    const sx = ((nx * this.view.scale) / aspect + this.view.x + 1) / 2;
    const sy = (1 - (ny * this.view.scale + this.view.y)) / 2;
    return [sx * this.width, sy * this.height];
  }

  screenToQuantized(sx: number, sy: number): [number, number] {
    const aspect = this.canvas.width / this.canvas.height;
    const cx = (sx / this.width) * 2 - 1;
    const cy = 1 - (sy / this.height) * 2;
    const nx = ((cx - this.view.x) * aspect) / this.view.scale;
    const ny = (cy - this.view.y) / this.view.scale;
    return [(nx + 1) * 32767.5, (ny + 1) * 32767.5];
  }

  /** Quantized units per CSS pixel at the current zoom, along y. */
  unitsPerPixel(): number {
    return 65536 / (this.height * this.view.scale);
  }

  /** Center the view on a point index at a given zoom. */
  centerOn(index: number, scale: number): void {
    const data = this.current;
    if (!data) return;
    const qx = data.layout.points[index * 2] ?? 0;
    const qy = data.layout.points[index * 2 + 1] ?? 0;
    const aspect = this.canvas.width / this.canvas.height;
    this.view.scale = scale;
    this.view.x = -((qx / 32767.5 - 1) * scale) / aspect;
    this.view.y = -(qy / 32767.5 - 1) * scale;
  }
}
