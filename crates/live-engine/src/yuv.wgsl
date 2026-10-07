// A camera's NV12 frame (Y plane, then the U and V of each 2 × 2 block) made
// into the RGBA picture the compositor draws from — once per new frame, on
// the GPU: the camera's frames cross to the graphics card at 12 bits a pixel
// instead of 32. Limited range; BT.709 for HD, BT.601 below (`fs_601`).

@group(0) @binding(0) var y_tex: texture_2d<f32>;
@group(0) @binding(1) var uv_tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct V {
  @builtin(position) pos: vec4<f32>,
  @location(0) t: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> V {
  let t = vec2<f32>(f32(i & 1u), f32((i >> 1u) & 1u));
  var v: V;
  v.pos = vec4<f32>(t.x * 2.0 - 1.0, 1.0 - t.y * 2.0, 0.0, 1.0);
  v.t = t;
  return v;
}

fn yuv(t: vec2<f32>) -> vec3<f32> {
  let y = (textureSampleLevel(y_tex, samp, t, 0.0).r - 16.0 / 255.0) * (255.0 / 219.0);
  let c = (textureSampleLevel(uv_tex, samp, t, 0.0).rg - 128.0 / 255.0) * (255.0 / 224.0);
  return vec3<f32>(y, c.x, c.y);
}

@fragment
fn fs_709(v: V) -> @location(0) vec4<f32> {
  let p = yuv(v.t);
  let rgb = vec3<f32>(p.x + 1.5748 * p.z, p.x - 0.1873 * p.y - 0.4681 * p.z, p.x + 1.8556 * p.y);
  return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}

@fragment
fn fs_601(v: V) -> @location(0) vec4<f32> {
  let p = yuv(v.t);
  let rgb = vec3<f32>(p.x + 1.402 * p.z, p.x - 0.344136 * p.y - 0.714136 * p.z, p.x + 1.772 * p.y);
  return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
