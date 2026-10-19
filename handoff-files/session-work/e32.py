W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/compose.wgsl', [
("""  // Nothing outside this rect is drawn (a split screen's box): x0, y0, x1, y1.
  clip: vec4<f32>,
};""","""  // Nothing outside this rect is drawn (a split screen's box): x0, y0, x1, y1.
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
};"""),
("""@fragment
fn fs(v: V) -> @location(0) vec4<f32> {""","""fn chroma_of(c: vec3<f32>) -> vec2<f32> {
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
fn fs(v: V) -> @location(0) vec4<f32> {"""),
("""    let px = sample_at(s, blur);
    if (d.misc.w > 2.5) {
      c = vec4<f32>(px.rgb, 1.0);
    } else if (d.misc.w > 1.5) {
      c = px;
    } else {
      c = vec4<f32>(px.rgb * px.a, px.a);
    }""","""    let px = sample_at(s, blur);
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
    }"""),
])
edit('crates/live-engine/src/gpu.rs', [
("""/// One draw's uniforms: ten vec4s.
const DRAW_FLOATS: usize = 40;""","""/// One draw's uniforms: sixteen vec4s.
const DRAW_FLOATS: usize = 64;"""),
("""const CLIP: usize = 9;""","""const CLIP: usize = 9;
/// Green screen and light and color: six vec4s from here (see [`crate::look::Look::uniforms`]).
const LOOK: usize = 10;"""),
("""    /// Bytes uploaded to the GPU since the last [`Compositor::take_upload_bytes`].
    uploaded: u64,
}""","""    /// Bytes uploaded to the GPU since the last [`Compositor::take_upload_bytes`].
    uploaded: u64,
    /// Seconds (0 – 100) for the grain effect.
    time: f32,
}"""),
("""            rings: HashMap::new(),
            uploaded: 0,
        };""","""            rings: HashMap::new(),
            uploaded: 0,
            time: 0.0,
        };"""),
("""    /// Bytes sent to the GPU since last asked.""","""    /// The show clock (ms), for effects that move (grain).
    pub fn set_time(&mut self, now_ms: u64) {
        self.time = (now_ms % 100_000) as f32 / 1000.0;
    }

    /// Bytes sent to the GPU since last asked."""),
("""                    draws.push((d, TexKey::Source(id.clone())));""","""                    if let Some(look) = &pl.look {
                        for (k, v) in look.uniforms(self.time).into_iter().enumerate() {
                            d.set(LOOK + k, v);
                        }
                    }
                    draws.push((d, TexKey::Source(id.clone())));"""),
])
edit('crates/live-engine/src/scene.rs', [
("""    pub flip: [bool; 2],
    /// Degrees.
    pub rotate: f32,
}""","""    pub flip: [bool; 2],
    /// Degrees.
    pub rotate: f32,
    /// Green screen and light and color (None: the picture as it is).
    pub look: Option<crate::look::Look>,
}"""),
("""            flip: [false; 2],
            rotate: 0.0,
        }
    }
}""","""            flip: [false; 2],
            rotate: 0.0,
            look: None,
        }
    }
}"""),
("""        flip: [a.flip_h, a.flip_v],
        rotate: if a.rotate.is_finite() { a.rotate } else { 0.0 },
    }""","""        flip: [a.flip_h, a.flip_v],
        rotate: if a.rotate.is_finite() { a.rotate } else { 0.0 },
        look: crate::look::Look::of(&src.key, a),
    }"""),
])
edit('crates/live-engine/src/lib.rs', [
("""pub mod frame;\n""","""pub mod frame;\npub mod look;\n"""),
])
edit('crates/live-engine/src/engine.rs', [
("""    pub fn frame(&mut self, now: u64) {
        let t0 = Instant::now();""","""    pub fn frame(&mut self, now: u64) {
        let t0 = Instant::now();
        self.gpu.set_time(now);"""),
])
