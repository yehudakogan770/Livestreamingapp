// Green screen: taking a colour out of a picture so what is behind shows
// through. Done on the graphics card (WebGL), so full-HD cameras key in real
// time; the same keyer serves the screens and the recorder.

import type { ChromaKey } from './types/ChromaKey';

/** Green screen off, with the usual settings ready (mirrors ChromaKey::default). */
export function defaultKey(): ChromaKey {
  return { enabled: false, color: '#00b140', similarity: 0.4, smoothness: 0.08, spill: 0.3 };
}

const VERTEX = `
attribute vec2 p;
varying vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Distance from the key colour in the colour (Cb/Cr) plane, so shadows and
// light on the screen still key; then the key colour's spill on people is
// pulled back towards grey.
const FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D tex;
uniform vec3 keyColor;
uniform float similarity;
uniform float smoothness;
uniform float spill;
vec2 chroma(vec3 c) {
  return vec2(-0.169 * c.r - 0.331 * c.g + 0.5 * c.b, 0.5 * c.r - 0.419 * c.g - 0.081 * c.b);
}
void main() {
  vec4 c = texture2D(tex, uv);
  float d = distance(chroma(c.rgb), chroma(keyColor));
  float a = smoothstep(similarity * 0.25, similarity * 0.25 + smoothness * 0.25 + 0.0001, d);
  vec3 rgb = c.rgb;
  float s = pow(clamp(d / (similarity * 0.25 + 0.0001), 0.0, 1.0), 1.5);
  float grey = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(rgb, vec3(grey), (1.0 - s) * spill);
  gl_FragColor = vec4(rgb * a, a);
}`;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** One keyer: draws a keyed copy of a picture onto its own canvas. */
export class ChromaKeyer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext | null;
  private readonly loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement = document.createElement('canvas')) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
    this.gl = gl;
    if (!gl) return;
    const shader = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
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
    for (const name of ['keyColor', 'similarity', 'smoothness', 'spill']) this.loc[name] = gl.getUniformLocation(prog, name);
  }

  /** This computer can key (it has WebGL). */
  get works(): boolean {
    return this.gl !== null;
  }

  /** Key one frame of `src` (sized w × h). Returns false if it could not. */
  draw(src: TexImageSource, w: number, h: number, key: ChromaKey): boolean {
    const gl = this.gl;
    if (!gl || !w || !h) return false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch {
      return false;
    }
    gl.uniform3fv(this.loc.keyColor!, hexToRgb(key.color));
    gl.uniform1f(this.loc.similarity!, key.similarity);
    gl.uniform1f(this.loc.smoothness!, key.smoothness);
    gl.uniform1f(this.loc.spill!, key.spill);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}
