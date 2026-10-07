// The unified engine's one drawing program. Every picture on every screen is
// one quad: a source frame (placed, cropped, zoomed, panned, flipped,
// rotated), or a flat color. Transitions show through the quad's shape (wipes,
// iris, diamond), its luma-wipe pattern, its opacity and its blur. Output is
// premultiplied alpha, blended "over" what is already there.
//
// Coordinates: (0,0) is the output's top-left corner, (1,1) its bottom-right.

struct Draw {
  // Where the quad goes: x0, y0, x1, y1.
  dst: vec4<f32>,
  // The layer's box (after a slide or zoom moved it), for wipes and luma.
  layer: vec4<f32>,
  // Which part of the source shows: u0, v0, u1, v1.
  uv: vec4<f32>,
  // zoom (1 – 4), pan x, pan y (-1 – 1), rotation (radians).
  view: vec4<f32>,
  // flip x (±1), flip y (±1), the quad's aspect (w / h in pixels),
  // mode (0 picture with straight alpha, 1 color, 2 picture already premultiplied,
  // 3 opaque picture whose fourth byte means nothing: Windows RGB32).
  misc: vec4<f32>,
  // A flat color (premultiplied).
  color: vec4<f32>,
  // opacity, blur (fraction of the output's height), shape (0 whole, 1 rect, 2 circle, 3 diamond), shape size.
  fx: vec4<f32>,
  // rect shape: cut off top, right, bottom, left.
  cut: vec4<f32>,
  // luma pattern (0 none, 1 – 6), progress, the layer's aspect, the output's aspect.
  luma: vec4<f32>,
  // Nothing outside this rect is drawn (a split screen's box): x0, y0, x1, y1.
  clip: vec4<f32>,
  // Green screen and light and color (look.rs; chroma.ts's processor):
  // on, key on, blur, sharpness
  look0: vec4<f32>,
  // key color, similarity
  look1: vec4<f32>,
  // smoothness, spill, exposure, brightness
  look2: vec4<f32>,
  // contrast, highlights, shadows, gamma
  look3: vec4<f32>,
  // white balance gains, saturation
  look4: vec4<f32>,
  // vignette, black and white, grain, time
  look5: vec4<f32>,
};

@group(0) @binding(0) var<uniform> d: Draw;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

struct V {
  @builtin(position) pos: vec4<f32>,
  // Output coordinates.
  @location(0) o: vec2<f32>,
  // 0 – 1 across the quad.
  @location(1) t: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> V {
  let t = vec2<f32>(f32(i & 1u), f32((i >> 1u) & 1u));
  let o = mix(d.dst.xy, d.dst.zw, t);
  var v: V;
  v.pos = vec4<f32>(o.x * 2.0 - 1.0, 1.0 - o.y * 2.0, 0.0, 1.0);
  v.o = o;
  v.t = t;
  return v;
}

const PI: f32 = 3.14159265;

fn luma_value(p: f32, u: f32, v: f32, aspect: f32) -> f32 {
  let x = (u - 0.5) * aspect;
  let y = v - 0.5;
  if (p < 1.5) {
    return fract(atan2(x, -y) / (2.0 * PI) + 1.0);
  }
  if (p < 2.5) {
    return min(1.0, length(vec2<f32>(x, y)) / 1.02);
  }
  if (p < 3.5) {
    return fract(u * 8.0);
  }
  if (p < 4.5) {
    return (u + v) / 2.0;
  }
  if (p < 5.5) {
    let cx = floor(u * 64.0);
    let cy = floor(v * 36.0);
    let a = sin(cx * 12.9898 + cy * 78.233) * 43758.5453;
    return a - floor(a);
  }
  // Heart: the size of the heart shape that just reaches this point.
  let hx = x * 2.2;
  let hy = -y * 2.2 + 0.15;
  var lo = 0.001;
  var hi = 4.0;
  for (var n = 0; n < 24; n++) {
    let mid = (lo + hi) / 2.0;
    let X = hx / mid;
    let Y = hy / mid;
    let a = X * X + Y * Y - 1.0;
    if (a * a * a - X * X * Y * Y * Y <= 0.0) { hi = mid; } else { lo = mid; }
  }
  return min(1.0, hi / 2.9);
}

const SOFT: f32 = 0.08;

fn sample_at(s: vec2<f32>, blur: vec2<f32>) -> vec4<f32> {
  if (blur.x <= 0.0 && blur.y <= 0.0) {
    return textureSampleLevel(tex, samp, s, 0.0);
  }
  // A soft blur: the middle and two rings of eight.
  var acc = textureSampleLevel(tex, samp, s, 0.0);
  var n = 1.0;
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * PI / 4.0;
    let dir = vec2<f32>(cos(a), sin(a));
    acc += textureSampleLevel(tex, samp, s + dir * blur * 0.5, 0.0);
    acc += textureSampleLevel(tex, samp, s + dir * blur, 0.0);
    n += 2.0;
  }
  return acc / n;
}

fn chroma_of(c: vec3<f32>) -> vec2<f32> {
  return vec2<f32>(-0.169 * c.r - 0.331 * c.g + 0.5 * c.b, 0.5 * c.r - 0.419 * c.g - 0.081 * c.b);
}

fn luma3(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// The picture processor (app/src/engine/chroma.ts) on one pixel: `rgb` and
// `alpha` straight, `s` where in the source, `t` where in the picture (0 – 1).
fn look(rgb_in: vec3<f32>, alpha_in: f32, s: vec2<f32>, t: vec2<f32>) -> vec4<f32> {
  var rgb = rgb_in;
  var alpha = alpha_in;
  let texel = 1.0 / vec2<f32>(textureDimensions(tex));
  if (d.look0.z > 0.0) {
    var acc = rgb;
    let r = d.look0.z * 10.0;
    for (var i = 0; i < 12; i++) {
      let a = f32(i) * 0.5236;
      let o = vec2<f32>(cos(a), sin(a)) * texel * r;
      acc += textureSampleLevel(tex, samp, s + o, 0.0).rgb + textureSampleLevel(tex, samp, s + o * 0.5, 0.0).rgb;
    }
    rgb = acc / 25.0;
  } else if (d.look0.w > 0.0) {
    let around = (textureSampleLevel(tex, samp, s + vec2<f32>(texel.x, 0.0), 0.0).rgb
      + textureSampleLevel(tex, samp, s - vec2<f32>(texel.x, 0.0), 0.0).rgb
      + textureSampleLevel(tex, samp, s + vec2<f32>(0.0, texel.y), 0.0).rgb
      + textureSampleLevel(tex, samp, s - vec2<f32>(0.0, texel.y), 0.0).rgb) * 0.25;
    rgb = rgb + (rgb - around) * d.look0.w * 2.0;
  }
  // Green screen, on the colors as the camera saw them.
  if (d.look0.y > 0.5) {
    let sim = d.look1.w * 0.25;
    let dist = distance(chroma_of(rgb_in), chroma_of(d.look1.rgb));
    alpha *= smoothstep(sim, sim + d.look2.x * 0.25 + 0.0001, dist);
    let sp = pow(clamp(dist / (sim + 0.0001), 0.0, 1.0), 1.5);
    rgb = mix(rgb, vec3<f32>(luma3(rgb)), (1.0 - sp) * d.look2.y);
  }
  // Light and color.
  rgb *= d.look4.rgb;
  rgb *= exp2(d.look2.z);
  rgb += d.look2.w * 0.25;
  var l = luma3(rgb);
  rgb += d.look3.z * 0.25 * (1.0 - smoothstep(0.0, 0.5, l));
  rgb += d.look3.y * 0.25 * smoothstep(0.5, 1.0, l);
  rgb = (rgb - 0.5) * (1.0 + d.look3.x) + 0.5;
  rgb = pow(max(rgb, vec3<f32>(0.0)), vec3<f32>(1.0 / max(d.look3.w, 0.01)));
  l = luma3(rgb);
  rgb = mix(vec3<f32>(l), rgb, 1.0 + d.look4.w);
  rgb = mix(rgb, vec3<f32>(luma3(rgb)), d.look5.y);
  // Effects on the finished picture.
  if (d.look5.x > 0.0) {
    var w = t - 0.5;
    w.x *= d.misc.z;
    rgb *= 1.0 - d.look5.x * smoothstep(0.35, 0.95, length(w) * 1.25);
  }
  if (d.look5.z > 0.0) {
    let n = fract(sin(dot(t * 1000.0 + d.look5.w, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5;
    rgb += n * d.look5.z * 0.2;
  }
  return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), alpha);
}

@fragment
fn fs(v: V) -> @location(0) vec4<f32> {
  let o = v.o;
  if (o.x < d.clip.x || o.y < d.clip.y || o.x > d.clip.z || o.y > d.clip.w) {
    discard;
  }
  // Where in the layer's own box this pixel is.
  let lsize = max(d.layer.zw - d.layer.xy, vec2<f32>(1e-6));
  let l = (o - d.layer.xy) / lsize;
  var a = 1.0;
  let shape = d.fx.z;
  if (shape > 0.5 && shape < 1.5) {
    if (l.x < d.cut.w || l.x > 1.0 - d.cut.y || l.y < d.cut.x || l.y > 1.0 - d.cut.z) { a = 0.0; }
  } else if (shape > 1.5 && shape < 2.5) {
    let asp = d.luma.z;
    let dist = length(vec2<f32>((l.x - 0.5) * asp, l.y - 0.5));
    let half_diag = sqrt(asp * asp + 1.0) / 2.0;
    if (dist > d.fx.w * half_diag) { a = 0.0; }
  } else if (shape > 2.5) {
    if (abs(l.x - 0.5) + abs(l.y - 0.5) > d.fx.w) { a = 0.0; }
  }
  if (d.luma.x > 0.5) {
    let lv = luma_value(d.luma.x, l.x, l.y, d.luma.z);
    a *= clamp((d.luma.y * (1.0 + SOFT) - lv) / SOFT, 0.0, 1.0);
  }
  if (a <= 0.0) {
    discard;
  }
  var c: vec4<f32>;
  if (d.misc.w > 0.5 && d.misc.w < 1.5) {
    c = d.color;
  } else {
    // The picture processor's placement (app/src/engine/chroma.ts).
    var q = v.t - 0.5;
    let asp = d.misc.z;
    q.x *= asp;
    let cs = cos(d.view.w);
    let sn = sin(d.view.w);
    q = vec2<f32>(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
    q.x /= asp;
    let zoom = max(d.view.x, 1.0);
    q /= zoom;
    q += d.view.yz * (0.5 - 0.5 / zoom);
    q *= d.misc.xy;
    let t = q + 0.5;
    if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) {
      discard;
    }
    let span = d.uv.zw - d.uv.xy;
    let s = d.uv.xy + t * span;
    // Blur radius: a fraction of the output's height, in source coordinates.
    let qh = max(d.dst.w - d.dst.y, 1e-6);
    let qw = max(d.dst.z - d.dst.x, 1e-6);
    let blur = vec2<f32>(d.fx.y / d.luma.w / qw, d.fx.y / qh) * span / zoom;
    let px = sample_at(s, blur);
    if (d.look0.x > 0.5) {
      // Straight colors for the processor, premultiplied after it.
      var a0 = px.a;
      var rgb0 = px.rgb;
      if (d.misc.w > 2.5) {
        a0 = 1.0;
      } else if (d.misc.w > 1.5) {
        rgb0 = px.rgb / max(px.a, 1e-5);
      }
      let o = look(rgb0, a0, s, t);
      c = vec4<f32>(o.rgb * o.a, o.a);
    } else if (d.misc.w > 2.5) {
      c = vec4<f32>(px.rgb, 1.0);
    } else if (d.misc.w > 1.5) {
      c = px;
    } else {
      c = vec4<f32>(px.rgb * px.a, px.a);
    }
  }
  return c * (d.fx.x * a);
}
