// The GPU programs for masks: cutting a clip out with a mask, and keeping an
// effect inside (or outside) one. A mask here is a frame-sized picture whose
// alpha says how much of each spot is in.

const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uSize;
`;

/** The layer, kept only where the mask is. */
export const CUTOUT_FS = `${HEAD}
uniform sampler2D uMask;
void main() { outColor = texture(uTex, vUv) * texture(uMask, vUv).a; }`;

/** The effect's result inside the mask (or outside it), the layer as it was elsewhere. */
export const LIMIT_FS = `${HEAD}
uniform sampler2D uOrig;
uniform sampler2D uMask;
uniform float uOutside;
void main() {
  float m = texture(uMask, vUv).a;
  if (uOutside > 0.5) m = 1.0 - m;
  outColor = mix(texture(uOrig, vUv), texture(uTex, vUv), m);
}`;
