// More picture effects, each one GPU program used the same way by the viewer
// (WebGL), the native engine and exports: video noise reduction, skin
// smoothing, clarity, tint and duotone, cinematic bars, mirror, tilt-shift,
// lens distortion and camera shake. Their settings are listed here once, with
// how each setting becomes the program's numbers.
import type { EffectDef } from '../model/effects';

const P = (key: string, label: string, min: number, max: number, def: number, step = 1, unit?: string) => ({
  key,
  label,
  min,
  max,
  def,
  step,
  ...(unit ? { unit } : {}),
});

export const MORE_EFFECTS: EffectDef[] = [
  {
    type: 'vdenoise',
    name: 'Reduce video noise',
    kind: 'video',
    group: 'Blur & sharpen',
    params: [P('amount', 'Amount', 0, 100, 50), P('radius', 'Size', 1, 4, 1.5, 0.1)],
  },
  { type: 'skin', name: 'Skin smoothing', kind: 'video', group: 'Color', params: [P('amount', 'Amount', 0, 100, 45)] },
  {
    type: 'clarity',
    name: 'Clarity (local contrast)',
    kind: 'video',
    group: 'Color',
    params: [P('amount', 'Amount', -100, 100, 30), P('radius', 'Size', 2, 40, 12)],
  },
  { type: 'tint', name: 'Tint', kind: 'video', group: 'Color', params: [P('amount', 'Amount', 0, 100, 40)], data: { color: '#e0973f' } },
  {
    type: 'duotone',
    name: 'Duotone',
    kind: 'video',
    group: 'Stylize',
    params: [P('amount', 'Amount', 0, 100, 100)],
    data: { dark: '#1b2a4a', light: '#f2c48d' },
  },
  {
    type: 'letterbox',
    name: 'Cinematic bars',
    kind: 'video',
    group: 'Transform',
    params: [
      { ...P('ratio', 'Shape', 0, 4, 0), options: ['2.39 : 1 (scope)', '2 : 1', '1.85 : 1', '4 : 3', '1 : 1'], still: true },
      P('opacity', 'Opacity', 0, 100, 100),
    ],
  },
  {
    type: 'mirror',
    name: 'Mirror',
    kind: 'video',
    group: 'Stylize',
    params: [
      { ...P('mode', 'Mirror', 0, 4, 0), options: ['Left onto right', 'Right onto left', 'Top onto bottom', 'Bottom onto top', 'Four ways'], still: true },
    ],
  },
  {
    type: 'tiltshift',
    name: 'Tilt-shift (miniature)',
    kind: 'video',
    group: 'Blur & sharpen',
    params: [P('blur', 'Blur', 0, 40, 12), P('center', 'Sharp band', 0, 100, 55, 1, '%'), P('width', 'Band width', 2, 60, 18, 1, '%')],
  },
  {
    type: 'lens',
    name: 'Lens distortion',
    kind: 'video',
    group: 'Transform',
    params: [P('amount', 'Bend', -100, 100, -20), P('zoom', 'Zoom', 50, 150, 100, 1, '%')],
  },
  { type: 'shake', name: 'Camera shake', kind: 'video', group: '3D & VFX', params: [P('amount', 'Amount', 0, 100, 25), P('speed', 'Speed', 1, 100, 30)] },
];

/** The programs (each starts with the shared header the caller passes). */
export function moreEffectSources(head: string): Record<string, string> {
  return {
    vdenoise: `${head}
uniform float uAmount, uRadius;
void main() {
  vec4 c0 = texture(uTex, vUv);
  vec3 a = unpre(c0);
  float rs = 0.03 + 0.15 * uAmount;
  vec3 sum = vec3(0.0);
  float w = 0.0;
  for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
    vec4 s = texture(uTex, vUv + vec2(float(i), float(j)) * uRadius / uSize);
    vec3 b = unpre(s);
    vec3 d = b - a;
    float g = exp(-dot(d, d) / (2.0 * rs * rs)) * exp(-float(i * i + j * j) / 8.0);
    sum += b * g;
    w += g;
  }
  outColor = vec4(mix(a, sum / max(w, 1e-5), uAmount) * c0.a, c0.a);
}`,
    skin: `${head}
uniform float uAmount;
void main() {
  vec4 c0 = texture(uTex, vUv);
  vec3 a = unpre(c0);
  vec3 hsv = rgb2hsv(a);
  // Skin tones: warm hues, some color, not too dark.
  float hd = hsv.x < 0.5 ? hsv.x : 1.0 - hsv.x;
  float skin = (1.0 - smoothstep(0.08, 0.14, hd)) * smoothstep(0.08, 0.2, hsv.y) * (1.0 - smoothstep(0.7, 0.85, hsv.y)) * smoothstep(0.15, 0.3, hsv.z);
  vec3 sum = vec3(0.0);
  float w = 0.0;
  for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++) {
    vec3 b = unpre(texture(uTex, vUv + vec2(float(i), float(j)) * 2.0 / uSize * (uSize.y / 1080.0)));
    vec3 d = b - a;
    float g = exp(-dot(d, d) / 0.006) * exp(-float(i * i + j * j) / 10.0);
    sum += b * g;
    w += g;
  }
  outColor = vec4(mix(a, sum / max(w, 1e-5), uAmount * skin) * c0.a, c0.a);
}`,
    clarity: `${head}
uniform float uAmount, uRadius;
void main() {
  vec4 c0 = texture(uTex, vUv);
  vec3 a = unpre(c0);
  vec3 blur = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float t = float(i) * 0.5236;
    vec2 o = vec2(cos(t), sin(t)) * uRadius / uSize;
    blur += unpre(texture(uTex, vUv + o)) + unpre(texture(uTex, vUv + o * 0.5));
  }
  blur /= 24.0;
  float l = luma(a);
  // Mostly in the midtones, so highlights and shadows don't clip.
  float mid = 1.0 - pow(abs(l * 2.0 - 1.0), 2.0);
  outColor = vec4(clamp(a + (a - blur) * uAmount * 1.5 * mid, 0.0, 1.0) * c0.a, c0.a);
}`,
    tint: `${head}
uniform float uAmount;
uniform vec3 uColor;
void main() {
  vec4 c0 = texture(uTex, vUv);
  vec3 a = unpre(c0);
  vec3 t = clamp(luma(a) * uColor / max(luma(uColor), 0.05), 0.0, 1.0);
  outColor = vec4(mix(a, t, uAmount) * c0.a, c0.a);
}`,
    duotone: `${head}
uniform float uAmount;
uniform vec3 uDark, uLight;
void main() {
  vec4 c0 = texture(uTex, vUv);
  vec3 a = unpre(c0);
  vec3 d = mix(uDark, uLight, smoothstep(0.0, 1.0, luma(a)));
  outColor = vec4(mix(a, d, uAmount) * c0.a, c0.a);
}`,
    letterbox: `${head}
uniform float uRatio, uOpacity;
void main() {
  vec4 c0 = texture(uTex, vUv);
  float aspect = uSize.x / uSize.y;
  // Bars top and bottom for a wider shape, at the sides for a narrower one.
  float bar = uRatio > aspect ? step(0.5 * aspect / uRatio, abs(vUv.y - 0.5)) : step(0.5 * uRatio / aspect, abs(vUv.x - 0.5));
  outColor = mix(c0, vec4(0.0, 0.0, 0.0, 1.0), bar * uOpacity);
}`,
    mirror: `${head}
uniform float uMode;
void main() {
  vec2 uv = vUv;
  int m = int(uMode + 0.5);
  if (m == 0) uv.x = uv.x > 0.5 ? 1.0 - uv.x : uv.x;
  else if (m == 1) uv.x = uv.x < 0.5 ? 1.0 - uv.x : uv.x;
  else if (m == 2) uv.y = uv.y < 0.5 ? 1.0 - uv.y : uv.y;
  else if (m == 3) uv.y = uv.y > 0.5 ? 1.0 - uv.y : uv.y;
  else uv = 0.5 - abs(uv - 0.5);
  outColor = texture(uTex, uv);
}`,
    tiltshift: `${head}
uniform float uBlur, uCenter, uWidth;
void main() {
  float d = abs(vUv.y - uCenter);
  float r = uBlur * smoothstep(uWidth * 0.5, uWidth * 0.5 + 0.2, d);
  if (r < 0.3) { outColor = texture(uTex, vUv); return; }
  vec4 s = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    float t = float(i) * 2.39996;
    float k = sqrt((float(i) + 0.5) / 16.0);
    s += texture(uTex, vUv + vec2(cos(t), sin(t)) * k * r / uSize);
  }
  outColor = s / 16.0;
}`,
    lens: `${head}
uniform float uAmount, uZoom;
void main() {
  vec2 asp = vec2(uSize.x / uSize.y, 1.0);
  vec2 p = (vUv - 0.5) * asp;
  float r2 = dot(p, p);
  vec2 q = p * (1.0 + uAmount * r2) / uZoom;
  vec2 uv = q / asp + 0.5;
  outColor = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(uTex, uv);
}`,
    shake: `${head}
uniform float uAmount, uTime;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float wobble(float t) {
  float i = floor(t);
  float f = fract(t);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), f) - 0.5;
}
void main() {
  vec2 off = vec2(wobble(uTime) + 0.5 * wobble(uTime * 2.3 + 11.0), wobble(uTime + 37.0) + 0.5 * wobble(uTime * 2.1 + 5.0)) * uAmount / uSize;
  float turn = (wobble(uTime * 0.8 + 71.0)) * uAmount * 0.0008;
  // Zoomed in just enough that no edge shows.
  float zoom = 1.0 + 2.5 * uAmount / uSize.y;
  vec2 asp = vec2(uSize.x / uSize.y, 1.0);
  vec2 p = (vUv - 0.5) * asp / zoom;
  p = vec2(cos(turn) * p.x - sin(turn) * p.y, sin(turn) * p.x + cos(turn) * p.y);
  outColor = texture(uTex, p / asp + 0.5 + off);
}`,
  };
}

const RATIOS = [2.39, 2, 1.85, 4 / 3, 1];

const rgb = (hex: unknown, fallback: string): number[] => {
  const h = typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};

/** Where an effect is drawn: frame pixels per sequence pixel, seconds into the clip, and its non-number settings. */
export interface FxEnv {
  k: number;
  time: number;
  d: Record<string, unknown>;
}

/** An effect's numbers for its program, or null when it isn't one of these (or does nothing as set). */
export function moreEffectUniforms(type: string, n: (key: string, def?: number) => number, env: FxEnv): Record<string, number | number[]> | null | 'skip' {
  switch (type) {
    case 'vdenoise':
      return n('amount', 50) <= 0 ? 'skip' : { uAmount: n('amount', 50) / 100, uRadius: n('radius', 1.5) * env.k };
    case 'skin':
      return n('amount', 45) <= 0 ? 'skip' : { uAmount: n('amount', 45) / 100 };
    case 'clarity':
      return n('amount', 30) === 0 ? 'skip' : { uAmount: n('amount', 30) / 100, uRadius: n('radius', 12) * env.k };
    case 'tint':
      return { uAmount: n('amount', 40) / 100, uColor: rgb(env.d.color, '#e0973f') };
    case 'duotone':
      return { uAmount: n('amount', 100) / 100, uDark: rgb(env.d.dark, '#1b2a4a'), uLight: rgb(env.d.light, '#f2c48d') };
    case 'letterbox':
      return { uRatio: RATIOS[Math.max(0, Math.min(RATIOS.length - 1, Math.round(n('ratio', 0))))] as number, uOpacity: n('opacity', 100) / 100 };
    case 'mirror':
      return { uMode: Math.round(n('mode', 0)) };
    case 'tiltshift':
      return n('blur', 12) <= 0 ? 'skip' : { uBlur: n('blur', 12) * env.k, uCenter: 1 - n('center', 55) / 100, uWidth: n('width', 18) / 100 };
    case 'lens':
      return { uAmount: n('amount', -20) / 100, uZoom: Math.max(0.2, n('zoom', 100) / 100) };
    case 'shake':
      return n('amount', 25) <= 0 ? 'skip' : { uAmount: n('amount', 25) * env.k, uTime: env.time * (n('speed', 30) / 10) };
    default:
      return null;
  }
}
