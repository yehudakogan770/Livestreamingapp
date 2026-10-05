// The GPU programs that draw the picture. Colors are kept "premultiplied"
// (color already multiplied by how see-through it is), so layers stack cleanly.

export const FULL_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const LAYER_VS = `#version 300 es
in vec2 aPos;
in vec2 aUv;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uSize;
vec3 unpre(vec4 c) { return c.a > 0.0001 ? c.rgb / c.a : vec3(0.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

export const LAYER_FS = `${HEAD}
uniform vec4 uCrop; // left, top, right, bottom (0–1 of the picture kept)
void main() {
  if (vUv.x < uCrop.x || vUv.y < uCrop.y || vUv.x > uCrop.z || vUv.y > uCrop.w) discard;
  outColor = texture(uTex, vUv);
}`;

export const COPY_FS = `${HEAD}
uniform float uOpacity;
void main() { outColor = texture(uTex, vUv) * uOpacity; }`;

/** Over a flat color (the sequence background), flipped for reading back. */
export const FINAL_FS = `${HEAD}
uniform vec3 uBack;
uniform float uFlip;
void main() {
  vec2 uv = uFlip > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
  vec4 c = texture(uTex, uv);
  outColor = vec4(c.rgb + uBack * (1.0 - c.a), 1.0);
}`;

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'add', 'darken', 'lighten', 'difference', 'softlight'];

export const COMPOSITE_FS = `${HEAD}
uniform sampler2D uBase;
uniform float uOpacity;
uniform int uMode;
vec3 blendOne(vec3 b, vec3 s) {
  if (uMode == 1) return b * s;
  if (uMode == 2) return b + s - b * s;
  if (uMode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (uMode == 4) return min(vec3(1.0), b + s);
  if (uMode == 5) return min(b, s);
  if (uMode == 6) return max(b, s);
  if (uMode == 7) return abs(b - s);
  if (uMode == 8) {
    vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
    return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
  }
  return s;
}
void main() {
  vec4 B = texture(uBase, vUv);
  vec4 T = texture(uTex, vUv) * uOpacity;
  if (uMode == 0) { outColor = T + B * (1.0 - T.a); return; }
  vec3 cb = unpre(B);
  vec3 cs = unpre(T);
  vec3 f = blendOne(cb, cs);
  outColor = vec4((1.0 - B.a) * T.rgb + (1.0 - T.a) * B.rgb + T.a * B.a * f, T.a + B.a * (1.0 - T.a));
}`;

export const TRANSITION_TYPES = [
  'dissolve',
  'dipblack',
  'dipwhite',
  'filmdissolve',
  'wipeleft',
  'wiperight',
  'wipeup',
  'wipedown',
  'slideleft',
  'slideright',
  'pushleft',
  'pushright',
  'iris',
  'zoom',
  'blurdissolve',
];

export const TRANSITION_FS = `${HEAD}
uniform sampler2D uB;
uniform float uP;
uniform int uType;
uniform float uOpA;
uniform float uOpB;
vec4 A(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(uTex, uv) * uOpA; }
vec4 Bt(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(uB, uv) * uOpB; }
vec4 soft(vec4 a, vec4 b, float e) { return mix(a, b, smoothstep(-0.004, 0.004, e)); }
vec4 blurred(vec2 uv, float r, bool useB) {
  vec4 s = vec4(0.0);
  vec2 px = r / uSize;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
    vec2 o = vec2(float(i), float(j)) * px;
    s += useB ? Bt(uv + o) : A(uv + o);
  }
  return s / 25.0;
}
void main() {
  float p = clamp(uP, 0.0, 1.0);
  vec2 uv = vUv;
  vec4 black = vec4(0.0, 0.0, 0.0, 1.0);
  vec4 white = vec4(1.0);
  if (uType == 0) outColor = mix(A(uv), Bt(uv), p);
  else if (uType == 1) outColor = p < 0.5 ? mix(A(uv), black, p * 2.0) : mix(black, Bt(uv), p * 2.0 - 1.0);
  else if (uType == 2) outColor = p < 0.5 ? mix(A(uv), white, p * 2.0) : mix(white, Bt(uv), p * 2.0 - 1.0);
  else if (uType == 3) {
    vec4 a = A(uv); vec4 b = Bt(uv);
    vec3 c = pow(mix(pow(a.rgb, vec3(2.2)), pow(b.rgb, vec3(2.2)), p), vec3(1.0 / 2.2));
    outColor = vec4(c, mix(a.a, b.a, p));
  }
  else if (uType == 4) outColor = soft(A(uv), Bt(uv), uv.x - (1.0 - p));
  else if (uType == 5) outColor = soft(A(uv), Bt(uv), p - uv.x);
  else if (uType == 6) outColor = soft(A(uv), Bt(uv), p - uv.y);
  else if (uType == 7) outColor = soft(A(uv), Bt(uv), uv.y - (1.0 - p));
  else if (uType == 8) { vec4 b = Bt(uv - vec2(1.0 - p, 0.0)); outColor = b + A(uv) * (1.0 - b.a); }
  else if (uType == 9) { vec4 b = Bt(uv + vec2(1.0 - p, 0.0)); outColor = b + A(uv) * (1.0 - b.a); }
  else if (uType == 10) { vec4 b = Bt(uv - vec2(1.0 - p, 0.0)); vec4 a = A(uv + vec2(p, 0.0)); outColor = b + a * (1.0 - b.a); }
  else if (uType == 11) { vec4 b = Bt(uv + vec2(1.0 - p, 0.0)); vec4 a = A(uv - vec2(p, 0.0)); outColor = b + a * (1.0 - b.a); }
  else if (uType == 12) {
    vec2 d = (uv - 0.5) * vec2(uSize.x / uSize.y, 1.0);
    float r = p * length(vec2(uSize.x / uSize.y, 1.0)) * 0.5;
    outColor = soft(A(uv), Bt(uv), r - length(d));
  }
  else if (uType == 13) {
    vec4 a = A(0.5 + (uv - 0.5) / (1.0 + p * 1.5));
    vec4 b = Bt(0.5 + (uv - 0.5) * (1.0 + (1.0 - p) * 0.5));
    outColor = mix(a, b, smoothstep(0.2, 0.8, p));
  }
  else {
    float r = sin(p * 3.14159) * 6.0 + 0.001;
    outColor = mix(blurred(uv, r, false), blurred(uv, r, true), p);
  }
}`;

/** One program for each effect; each reads the layer and writes it changed. */
export const EFFECT_FS: Record<string, string> = {
  basic: `${HEAD}
uniform float uExposure, uContrast, uHighlights, uShadows, uWhites, uBlacks, uTemp, uTint, uSat, uVib;
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = unpre(src);
  c *= pow(2.0, uExposure);
  c = c * vec3(1.0 + uTemp * 0.25 + uTint * 0.1, 1.0 - uTint * 0.2, 1.0 - uTemp * 0.25 + uTint * 0.1);
  float l = luma(c);
  float hw = smoothstep(0.35, 1.0, l);
  float sw = 1.0 - smoothstep(0.0, 0.65, l);
  c += c * uHighlights * 0.6 * hw;
  c += uShadows * 0.35 * sw * (1.0 - c);
  // Whites and blacks move the ends of the range.
  float lo = -uBlacks * 0.15;
  float hi = 1.0 - uWhites * 0.2;
  c = (c - lo) / max(0.05, hi - lo);
  c = (c - 0.5) * (1.0 + uContrast) + 0.5;
  l = luma(c);
  float s = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  float vib = 1.0 + uVib * (1.0 - s);
  c = mix(vec3(l), c, uSat * vib);
  c = max(c, vec3(0.0));
  outColor = vec4(c * src.a, src.a);
}`,
  wheels: `${HEAD}
uniform vec3 uLift, uGamma, uGain;
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = unpre(src);
  c = c * uGain + uLift * (1.0 - c);
  c = pow(max(c, vec3(0.0)), 1.0 / max(uGamma, vec3(0.05)));
  outColor = vec4(c * src.a, src.a);
}`,
  curves: `${HEAD}
uniform sampler2D uCurve;
uniform float uMix;
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = clamp(unpre(src), 0.0, 1.0);
  vec3 o = vec3(texture(uCurve, vec2(c.r * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).r,
                texture(uCurve, vec2(c.g * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).g,
                texture(uCurve, vec2(c.b * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).b);
  outColor = vec4(mix(c, o, uMix) * src.a, src.a);
}`,
  lut: `${HEAD}
uniform highp sampler3D uLut;
uniform float uMix, uLutSize;
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = clamp(unpre(src), 0.0, 1.0);
  vec3 o = texture(uLut, c * (uLutSize - 1.0) / uLutSize + 0.5 / uLutSize).rgb;
  outColor = vec4(mix(c, o, uMix) * src.a, src.a);
}`,
  hsl: `${HEAD}
uniform float uHue, uRange, uShift, uSatS, uLight;
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = unpre(src);
  vec3 h = rgb2hsv(c);
  float d = abs(fract(h.x - uHue + 0.5) - 0.5);
  float w = (1.0 - smoothstep(uRange * 0.5, uRange, d)) * smoothstep(0.05, 0.2, h.y);
  h.x = fract(h.x + uShift * w);
  h.y = clamp(h.y * (1.0 + uSatS * w), 0.0, 1.0);
  h.z = clamp(h.z * (1.0 + uLight * w), 0.0, 4.0);
  outColor = vec4(hsv2rgb(h) * src.a, src.a);
}`,
  vignette: `${HEAD}
uniform float uAmount, uVSize, uFeather;
void main() {
  vec4 src = texture(uTex, vUv);
  vec2 d = (vUv - 0.5) * vec2(uSize.x / uSize.y, 1.0) * 1.2;
  float r = length(d);
  float v = smoothstep(uVSize, uVSize + max(0.01, uFeather), r);
  vec3 c = unpre(src);
  c = uAmount < 0.0 ? c * (1.0 + uAmount * v) : mix(c, vec3(1.0), uAmount * v);
  outColor = vec4(c * src.a, src.a);
}`,
  bw: `${HEAD}
uniform float uMix;
void main() { vec4 s = texture(uTex, vUv); vec3 c = unpre(s); outColor = vec4(mix(c, vec3(luma(c)), uMix) * s.a, s.a); }`,
  invert: `${HEAD}
uniform float uMix;
void main() { vec4 s = texture(uTex, vUv); vec3 c = unpre(s); outColor = vec4(mix(c, 1.0 - c, uMix) * s.a, s.a); }`,
  blur: `${HEAD}
uniform vec2 uDir;
uniform float uSigma;
void main() {
  if (uSigma < 0.3) { outColor = texture(uTex, vUv); return; }
  float stepPx = max(1.0, ceil(uSigma * 3.0 / 24.0));
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -24; i <= 24; i++) {
    float x = float(i) * stepPx;
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    sum += texture(uTex, vUv + uDir * x / uSize) * w;
    wsum += w;
  }
  outColor = sum / wsum;
}`,
  sharpen: `${HEAD}
uniform float uAmount;
void main() {
  vec2 px = 1.0 / uSize;
  vec4 c = texture(uTex, vUv);
  vec4 b = (texture(uTex, vUv + vec2(px.x, 0.0)) + texture(uTex, vUv - vec2(px.x, 0.0)) + texture(uTex, vUv + vec2(0.0, px.y)) + texture(uTex, vUv - vec2(0.0, px.y))) * 0.25;
  vec3 o = c.rgb + (c.rgb - b.rgb) * uAmount;
  outColor = vec4(clamp(o, vec3(0.0), vec3(c.a)), c.a);
}`,
  chromakey: `${HEAD}
uniform vec3 uKey;
uniform float uTol, uSoft, uSpill;
vec2 cbcr(vec3 c) { return vec2(-0.1146 * c.r - 0.3854 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4542 * c.g - 0.0458 * c.b); }
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = unpre(src);
  vec2 k = cbcr(uKey);
  float d = distance(cbcr(c), k);
  float a = smoothstep(uTol * 0.35, uTol * 0.35 + uSoft * 0.3 + 0.001, d);
  // Take the key color's tint off what is left (green edges on hair).
  vec2 dir = normalize(k + 1e-5);
  float spill = max(0.0, dot(cbcr(c), dir)) * uSpill;
  float l = luma(c);
  c = mix(c, vec3(l), clamp(spill * 3.0, 0.0, 1.0));
  float alpha = src.a * a;
  outColor = vec4(c * alpha, alpha);
}`,
  lumakey: `${HEAD}
uniform float uThreshold, uSoftness, uInvert;
void main() {
  vec4 src = texture(uTex, vUv);
  float l = luma(unpre(src));
  float a = smoothstep(uThreshold, uThreshold + uSoftness + 0.001, l);
  if (uInvert > 0.5) a = 1.0 - smoothstep(1.0 - uThreshold - uSoftness - 0.001, 1.0 - uThreshold, l);
  outColor = src * a;
}`,
  mask: `${HEAD}
uniform float uShape, uCx, uCy, uW, uH, uFeather, uInvert;
void main() {
  vec4 src = texture(uTex, vUv);
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) - vec2(0.5 + uCx * 0.5, 0.5 + uCy * 0.5);
  vec2 half_ = max(vec2(0.001), vec2(uW, uH) * 0.5);
  float d;
  if (uShape < 0.5) d = length(p / half_) - 1.0;
  else { vec2 q = abs(p) / half_ - 1.0; d = max(q.x, q.y); }
  float a = 1.0 - smoothstep(-uFeather, 0.0001, d);
  if (uInvert > 0.5) a = 1.0 - a;
  outColor = src * a;
}`,
  mosaic: `${HEAD}
uniform float uBlock;
void main() {
  vec2 b = vec2(max(1.0, uBlock)) / uSize;
  outColor = texture(uTex, (floor(vUv / b) + 0.5) * b);
}`,
  grain: `${HEAD}
uniform float uAmount, uGrain, uSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
void main() {
  vec4 src = texture(uTex, vUv);
  vec2 cell = floor(vUv * uSize / max(1.0, uGrain));
  float n = hash(cell) - 0.5;
  vec3 c = unpre(src) + n * uAmount * 0.35;
  outColor = vec4(clamp(c, 0.0, 1.0) * src.a, src.a);
}`,
  bright: `${HEAD}
uniform float uThreshold;
void main() {
  vec4 src = texture(uTex, vUv);
  vec3 c = unpre(src);
  float l = luma(c);
  outColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.1, l) * src.a, src.a * smoothstep(uThreshold, uThreshold + 0.1, l));
}`,
  add: `${HEAD}
uniform sampler2D uOther;
uniform float uAmount;
void main() {
  vec4 a = texture(uTex, vUv);
  vec4 g = texture(uOther, vUv) * uAmount;
  outColor = vec4(min(a.rgb + g.rgb, vec3(1.0)), max(a.a, min(1.0, g.a)));
}`,
  flip: `${HEAD}
uniform float uH, uV;
void main() { outColor = texture(uTex, vec2(uH > 0.5 ? 1.0 - vUv.x : vUv.x, uV > 0.5 ? 1.0 - vUv.y : vUv.y)); }`,
  shadowmake: `${HEAD}
uniform vec2 uOffset;
uniform float uOpacity;
void main() { float a = texture(uTex, vUv - uOffset / uSize).a * uOpacity; outColor = vec4(0.0, 0.0, 0.0, a); }`,
  over: `${HEAD}
uniform sampler2D uOther;
void main() { vec4 top = texture(uOther, vUv); outColor = top + texture(uTex, vUv) * (1.0 - top.a); }`,
};
