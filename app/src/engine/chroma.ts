// The picture processor: green screen, light and color, crop and position,
// and effects for cameras, videos and pictures, in one pass on the graphics
// card (WebGL), so full-HD cameras run in real time. The same processor
// serves the screens and the recorder.

import type { ChromaKey } from './types/ChromaKey';
import type { Adjust } from './types/Adjust';

/** Green screen off, with the usual settings ready (mirrors ChromaKey::default). */
export function defaultKey(): ChromaKey {
  return { enabled: false, color: '#00b140', similarity: 0.4, smoothness: 0.08, spill: 0.3 };
}

/** No change at all (mirrors Adjust::default). */
export function defaultAdjust(): Adjust {
  return {
    exposure: 0,
    brightness: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    gamma: 1,
    temperature: 5600,
    tint: 0,
    saturation: 0,
    sharpness: 0,
    cropLeft: 0,
    cropRight: 0,
    cropTop: 0,
    cropBottom: 0,
    zoom: 100,
    panX: 0,
    panY: 0,
    rotate: 0,
    flipH: false,
    flipV: false,
    blur: { on: false, amount: 30 },
    vignette: { on: false, amount: 30 },
    blackWhite: { on: false, amount: 100 },
    grain: { on: false, amount: 30 },
  };
}

const PLAIN = JSON.stringify(defaultAdjust());
/** Anything changed from the plain picture? (Effects count only when on.) */
export function isAdjusted(a: Adjust | undefined): boolean {
  if (!a) return false;
  const off = { ...a, blur: { ...a.blur }, vignette: { ...a.vignette }, blackWhite: { ...a.blackWhite }, grain: { ...a.grain } };
  const d = defaultAdjust();
  for (const k of ['blur', 'vignette', 'blackWhite', 'grain'] as const) if (!off[k].on) off[k] = d[k];
  return JSON.stringify(off) !== PLAIN;
}

/** Needs the processor at all (otherwise the plain picture is shown). */
export const needsProcessing = (key: ChromaKey, adjust: Adjust | undefined) => key.enabled || isAdjusted(adjust);

/** The share of the picture kept by the crop: [width, height] fractions. */
export function cropped(a: Adjust | undefined): [number, number] {
  if (!a) return [1, 1];
  return [Math.max(0.1, 1 - (a.cropLeft + a.cropRight) / 100), Math.max(0.1, 1 - (a.cropTop + a.cropBottom) / 100)];
}

const VERTEX = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D tex;
uniform vec2 texel;
// geometry
uniform vec4 crop;      // left, right, top, bottom (0 – 1)
uniform float zoom;     // 1 – 4
uniform vec2 pan;       // -1 – 1
uniform float rot;      // radians
uniform vec2 flip;      // 1 or -1
uniform float aspect;   // output width / height
// green screen
uniform float keyOn;
uniform vec3 keyColor;
uniform float similarity;
uniform float smoothness;
uniform float spill;
// light and color
uniform float exposure;
uniform float brightness;
uniform float contrast;
uniform float highlights;
uniform float shadows;
uniform float gamma;
uniform vec3 balance;   // white balance gains
uniform float saturation;
uniform float sharpness;
// effects (0 = off)
uniform float blur;
uniform float vignette;
uniform float bw;
uniform float grain;
uniform float time;

vec2 chroma(vec3 c) {
  return vec2(-0.169 * c.r - 0.331 * c.g + 0.5 * c.b, 0.5 * c.r - 0.419 * c.g - 0.081 * c.b);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  // Where in the source picture this output pixel comes from.
  vec2 q = uv - 0.5;
  q.x *= aspect;
  float cs = cos(rot), sn = sin(rot);
  q = mat2(cs, -sn, sn, cs) * q;
  q.x /= aspect;
  q /= zoom;
  q += pan * (0.5 - 0.5 / zoom);
  q *= flip;
  vec2 t = q + 0.5;
  if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  vec2 s = vec2(crop.x + t.x * (1.0 - crop.x - crop.y), crop.z + t.y * (1.0 - crop.z - crop.w));

  vec4 c = texture2D(tex, s);
  vec3 rgb = c.rgb;
  if (blur > 0.0) {
    vec3 acc = rgb;
    float r = blur * 10.0;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5236;
      vec2 o = vec2(cos(a), sin(a)) * texel * r;
      acc += texture2D(tex, s + o).rgb + texture2D(tex, s + o * 0.5).rgb;
    }
    rgb = acc / 25.0;
  } else if (sharpness > 0.0) {
    vec3 around = (texture2D(tex, s + vec2(texel.x, 0.0)).rgb + texture2D(tex, s - vec2(texel.x, 0.0)).rgb
      + texture2D(tex, s + vec2(0.0, texel.y)).rgb + texture2D(tex, s - vec2(0.0, texel.y)).rgb) * 0.25;
    rgb = rgb + (rgb - around) * sharpness * 2.0;
  }

  // Green screen, on the colors as the camera saw them.
  float alpha = c.a;
  if (keyOn > 0.5) {
    float d = distance(chroma(c.rgb), chroma(keyColor));
    alpha *= smoothstep(similarity * 0.25, similarity * 0.25 + smoothness * 0.25 + 0.0001, d);
    float sp = pow(clamp(d / (similarity * 0.25 + 0.0001), 0.0, 1.0), 1.5);
    rgb = mix(rgb, vec3(luma(rgb)), (1.0 - sp) * spill);
  }

  // Light and color.
  rgb *= balance;
  rgb *= exp2(exposure);
  rgb += brightness * 0.25;
  float l = luma(rgb);
  rgb += shadows * 0.25 * (1.0 - smoothstep(0.0, 0.5, l));
  rgb += highlights * 0.25 * smoothstep(0.5, 1.0, l);
  rgb = (rgb - 0.5) * (1.0 + contrast) + 0.5;
  rgb = pow(max(rgb, 0.0), vec3(1.0 / gamma));
  l = luma(rgb);
  rgb = mix(vec3(l), rgb, 1.0 + saturation);
  rgb = mix(rgb, vec3(luma(rgb)), bw);

  // Effects on the finished picture.
  if (vignette > 0.0) {
    vec2 v = uv - 0.5;
    v.x *= aspect;
    rgb *= 1.0 - vignette * smoothstep(0.35, 0.95, length(v) * 1.25);
  }
  if (grain > 0.0) {
    float n = fract(sin(dot(uv * 1000.0 + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    rgb += n * grain * 0.2;
  }
  rgb = clamp(rgb, 0.0, 1.0);
  gl_FragColor = vec4(rgb * alpha, alpha);
}`;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** White balance gains for a temperature (K) and tint (-100 – 100). */
export function balanceGains(temperature: number, tint: number): [number, number, number] {
  const k = Math.max(-1, Math.min(1, (temperature - 5600) / 3400));
  return [1 + 0.2 * k, 1 - (0.15 * tint) / 100, 1 - 0.2 * k];
}

/**
 * Auto white balance: the temperature and tint that make the average of
 * the picture grey. `rgb` is its average color (0 – 1).
 */
export function autoBalance([r, g, b]: [number, number, number]): { temperature: number; tint: number } {
  if (r + b <= 0 || g <= 0) return { temperature: 5600, tint: 0 };
  const k = Math.max(-1, Math.min(1, (b - r) / (0.2 * (r + b))));
  const r2 = r * (1 + 0.2 * k);
  const b2 = b * (1 - 0.2 * k);
  const tint = Math.max(-100, Math.min(100, ((1 - (r2 + b2) / 2 / g) / 0.15) * 100));
  return { temperature: Math.round(5600 + k * 3400), tint: Math.round(tint) };
}

const UNIFORMS = [
  'crop',
  'zoom',
  'pan',
  'rot',
  'flip',
  'aspect',
  'texel',
  'keyOn',
  'keyColor',
  'similarity',
  'smoothness',
  'spill',
  'exposure',
  'brightness',
  'contrast',
  'highlights',
  'shadows',
  'gamma',
  'balance',
  'saturation',
  'sharpness',
  'blur',
  'vignette',
  'bw',
  'grain',
  'time',
] as const;

/** One processor: draws a processed copy of a picture onto its own canvas. */
export class ChromaKeyer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext | null;
  private readonly loc: Partial<Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>> = {};

  constructor(canvas: HTMLCanvasElement = document.createElement('canvas')) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
    this.gl = gl;
    if (!gl) return;
    const shader = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const p = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(p);
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    for (const name of UNIFORMS) this.loc[name] = gl.getUniformLocation(prog, name);
  }

  /** This computer can process pictures (it has WebGL). */
  get works(): boolean {
    return this.gl !== null;
  }

  /**
   * Process one frame of `src` (sized w × h). The canvas takes the cropped
   * size (at most `maxW` wide). Returns false if it could not.
   */
  draw(src: TexImageSource, w: number, h: number, key: ChromaKey, adjust?: Adjust, maxW = 1920): boolean {
    const gl = this.gl;
    if (!gl || !w || !h) return false;
    const a = adjust ?? defaultAdjust();
    const [fw, fh] = cropped(a);
    let cw = Math.max(2, Math.round(w * fw));
    let ch = Math.max(2, Math.round(h * fh));
    if (cw > maxW) {
      ch = Math.round((ch * maxW) / cw);
      cw = maxW;
    }
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    gl.viewport(0, 0, cw, ch);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch {
      return false;
    }
    const L = this.loc;
    gl.uniform4f(L.crop!, a.cropLeft / 100, a.cropRight / 100, a.cropTop / 100, a.cropBottom / 100);
    gl.uniform1f(L.zoom!, a.zoom / 100);
    gl.uniform2f(L.pan!, a.panX / 100, -a.panY / 100);
    gl.uniform1f(L.rot!, (a.rotate * Math.PI) / 180);
    gl.uniform2f(L.flip!, a.flipH ? -1 : 1, a.flipV ? -1 : 1);
    gl.uniform1f(L.aspect!, cw / ch);
    gl.uniform2f(L.texel!, 1 / w, 1 / h);
    gl.uniform1f(L.keyOn!, key.enabled ? 1 : 0);
    gl.uniform3fv(L.keyColor!, hexToRgb(key.color));
    gl.uniform1f(L.similarity!, key.similarity);
    gl.uniform1f(L.smoothness!, key.smoothness);
    gl.uniform1f(L.spill!, key.spill);
    gl.uniform1f(L.exposure!, a.exposure);
    gl.uniform1f(L.brightness!, a.brightness / 100);
    gl.uniform1f(L.contrast!, a.contrast / 100);
    gl.uniform1f(L.highlights!, a.highlights / 100);
    gl.uniform1f(L.shadows!, a.shadows / 100);
    gl.uniform1f(L.gamma!, a.gamma);
    gl.uniform3fv(L.balance!, balanceGains(a.temperature, a.tint));
    gl.uniform1f(L.saturation!, a.saturation / 100);
    gl.uniform1f(L.sharpness!, a.sharpness / 100);
    gl.uniform1f(L.blur!, a.blur.on ? a.blur.amount / 100 : 0);
    gl.uniform1f(L.vignette!, a.vignette.on ? a.vignette.amount / 100 : 0);
    gl.uniform1f(L.bw!, a.blackWhite.on ? a.blackWhite.amount / 100 : 0);
    gl.uniform1f(L.grain!, a.grain.on ? a.grain.amount / 100 : 0);
    gl.uniform1f(L.time!, (performance.now() / 1000) % 100);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}
