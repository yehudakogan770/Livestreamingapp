// GPU programs for motion and timing: frame blending and optical-flow
// interpolation (time remapping), and adding up the looks of motion blur.

const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uSize;
`;

/** Two frames mixed (frame blending). */
export const FRAME_MIX_FS = `${HEAD}
uniform sampler2D uB;
uniform float uMix;
void main() { outColor = mix(texture(uTex, vUv), texture(uB, vUv), uMix); }`;

/**
 * The moment between two frames, warped along the optical flow (pixels of a small copy, A to B): A is looked up
 * where each point came from and B where it is going, then mixed by how near each frame is. Where the two
 * disagree a lot (things appearing or hidden), the nearer frame wins.
 */
export const FLOW_WARP_FS = `${HEAD}
uniform sampler2D uB;
uniform sampler2D uFlow;
uniform vec2 uFlowSize;
uniform float uMix;
void main() {
  vec2 f = texture(uFlow, vUv).rg / uFlowSize;
  vec4 a = texture(uTex, clamp(vUv - uMix * f, 0.0, 1.0));
  vec4 b = texture(uB, clamp(vUv + (1.0 - uMix) * f, 0.0, 1.0));
  float differ = length(a.rgb - b.rgb);
  float w = mix(uMix, step(0.5, uMix), smoothstep(0.25, 0.6, differ));
  outColor = mix(a, b, w);
}`;

/** One look of motion blur added in: base + this × weight. */
export const ACCUM_FS = `${HEAD}
uniform sampler2D uBase;
uniform float uW;
void main() { outColor = texture(uBase, vUv) + texture(uTex, vUv) * uW; }`;
