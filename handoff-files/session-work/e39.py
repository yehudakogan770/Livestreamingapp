W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/compose.wgsl', [
("""@fragment
fn fs(v: V) -> @location(0) vec4<f32> {""","""// A drawn screen (`tex`, opaque RGBA) as NV12 for the encoders, in one R8
// target of W × 1.5 H: the Y plane (W × H), then the U and V samples of each
// 2 × 2 block side by side (W × H / 2). BT.709, limited range, as the
// recordings are tagged. A third of the bytes of RGBA to read back, and what
// the hardware encoders take as they are.
@fragment
fn fs_nv12(v: V) -> @location(0) vec4<f32> {
  let size = vec2<i32>(textureDimensions(tex));
  let p = vec2<i32>(floor(v.pos.xy));
  if (p.y < size.y) {
    let c = textureLoad(tex, min(p, size - 1), 0).rgb;
    let y = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
    return vec4<f32>((16.0 + 219.0 * y) / 255.0, 0.0, 0.0, 1.0);
  }
  let pair = p.x / 2;
  let s = vec2<i32>(pair * 2, (p.y - size.y) * 2);
  let m = size - 1;
  let c = (textureLoad(tex, min(s, m), 0).rgb + textureLoad(tex, min(s + vec2<i32>(1, 0), m), 0).rgb
    + textureLoad(tex, min(s + vec2<i32>(0, 1), m), 0).rgb + textureLoad(tex, min(s + vec2<i32>(1, 1), m), 0).rgb) * 0.25;
  var k: f32;
  if (p.x - pair * 2 == 0) {
    k = -0.1146 * c.r - 0.3854 * c.g + 0.5 * c.b;
  } else {
    k = 0.5 * c.r - 0.4542 * c.g - 0.0458 * c.b;
  }
  return vec4<f32>((128.0 + 224.0 * k) / 255.0, 0.0, 0.0, 1.0);
}

@fragment
fn fs(v: V) -> @location(0) vec4<f32> {"""),
])
edit('crates/live-engine/src/gpu.rs', [
("""struct Tex {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    bind: wgpu::BindGroup,
    w: u32,
    h: u32,
}""","""struct Tex {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    bind: wgpu::BindGroup,
    w: u32,
    h: u32,
    format: wgpu::TextureFormat,
}

/// The NV12 targets' format (one byte a texel: see `fs_nv12`).
pub const NV12_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::R8Unorm;

/// Bytes a texel of a target.
fn bytes_per_texel(f: wgpu::TextureFormat) -> u32 {
    if f == NV12_FORMAT {
        1
    } else {
        4
    }
}"""),
("""    Tex {
        texture,
        view,
        bind,
        w: w.max(1),
        h: h.max(1),
    }
}""","""    Tex {
        texture,
        view,
        bind,
        w: w.max(1),
        h: h.max(1),
        format,
    }
}"""),
("""    /// A graphics plane of `slot` over the viewport, at whatever size it is held (the multiview's words).
    Plane { slot: usize, name: &'static str },
}""","""    /// A graphics plane of `slot` over the viewport, at whatever size it is held (the multiview's words).
    Plane { slot: usize, name: &'static str },
    /// Target `src` as NV12 (into an NV12 target, see [`Compositor::ensure_nv12_target`]).
    Nv12(usize),
}"""),
("""/// A read-back on its way: the buffer, the "mapped" signal, the picture's size.
struct Pending {
    buffer: wgpu::Buffer,
    rx: std::sync::mpsc::Receiver<Result<(), wgpu::BufferAsyncError>>,
    w: u32,
    h: u32,
}""","""/// A read-back on its way: the buffer, the "mapped" signal, the picture's size.
struct Pending {
    buffer: wgpu::Buffer,
    rx: std::sync::mpsc::Receiver<Result<(), wgpu::BufferAsyncError>>,
    w: u32,
    h: u32,
    bpp: u32,
}"""),
("""    /// Let target `i` go (a feed ended).""","""    /// Make sure target `i` exists as an NV12 target for a `w` × `h` picture
    /// (one byte a texel, `w` × 1.5 `h`; `w` and `h` even).
    pub fn ensure_nv12_target(&mut self, i: usize, w: u32, h: u32) {
        if self.targets.len() <= i {
            self.targets.resize_with(i + 1, || None);
        }
        let (tw, th) = (w, h * 3 / 2);
        let ok = self.targets[i]
            .as_ref()
            .is_some_and(|t| t.w == tw && t.h == th && t.format == NV12_FORMAT);
        if !ok {
            self.targets[i] = Some(make_tex(
                &self.device,
                &self.tex_layout,
                &self.sampler,
                tw,
                th,
                NV12_FORMAT,
                true,
                "nv12",
            ));
        }
    }

    /// Let target `i` go (a feed ended)."""),
("""                Paint::Plane { slot, name } => {""","""                Paint::Nv12(src) => {
                    draws.push((DrawU::new(), TexKey::Target(*src)));
                }
                Paint::Plane { slot, name } => {"""),
("""    fn read_buffer(&self, w: u32, h: u32) -> wgpu::Buffer {
        let row = (w * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);""","""    fn read_buffer(&self, w: u32, h: u32, bpp: u32) -> wgpu::Buffer {
        let row = (w * bpp).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);"""),
("""        .ok_or("Nothing to read.")?;
        let (w, h) = (t.w, t.h);
        let row = (w * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);""","""        .ok_or("Nothing to read.")?;
        let (w, h) = (t.w, t.h);
        let bpp = bytes_per_texel(t.format);
        if buffer.size() < u64::from((w * bpp).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)) * u64::from(h) {
            return Err("The read-back buffer is too small.".into());
        }
        let row = (w * bpp).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);"""),
("""        Ok(Pending {
            buffer: buffer.clone(),
            rx,
            w,
            h,
        })""","""        Ok(Pending {
            buffer: buffer.clone(),
            rx,
            w,
            h,
            bpp,
        })"""),
("""        let (w, h) = (p.w, p.h);
        let row = (w * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) as usize;
        let mut px = Vec::with_capacity((w * h * 4) as usize);
        {
            let slice = p.buffer.slice(..);
            let mapped = slice.get_mapped_range().map_err(|e| e.to_string())?;
            for y in 0..h as usize {
                let start = y * row;
                px.extend_from_slice(&mapped[start..start + w as usize * 4]);
            }
        }""","""        let (w, h, bpp) = (p.w, p.h, p.bpp as usize);
        let row = (w as usize * bpp).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize);
        let mut px = Vec::with_capacity(w as usize * h as usize * bpp);
        {
            let slice = p.buffer.slice(..);
            let mapped = slice.get_mapped_range().map_err(|e| e.to_string())?;
            for y in 0..h as usize {
                let start = y * row;
                px.extend_from_slice(&mapped[start..start + w as usize * bpp]);
            }
        }"""),
("""        let (w, h) = self.dest_size(dest).ok_or("Nothing to read.")?;
        let buffer = match self.reads.get(&(w, h)) {
            Some(b) => b.clone(),
            None => {
                let b = self.read_buffer(w, h);
                self.reads.insert((w, h), b.clone());
                b
            }
        };""","""        let (w, h) = self.dest_size(dest).ok_or("Nothing to read.")?;
        let bpp = self.dest_bpp(dest);
        let buffer = match self.reads.get(&(w * bpp, h)) {
            Some(b) => b.clone(),
            None => {
                let b = self.read_buffer(w, h, bpp);
                self.reads.insert((w * bpp, h), b.clone());
                b
            }
        };"""),
("""        let size = self.dest_size(dest)?;
        if self.rings.get(&dest).is_none_or(|r| r.size != size) {
            let buffers = vec![
                self.read_buffer(size.0, size.1),
                self.read_buffer(size.0, size.1),
            ];""","""        let size = self.dest_size(dest)?;
        let bpp = self.dest_bpp(dest);
        if self.rings.get(&dest).is_none_or(|r| r.size != size) {
            let buffers = vec![
                self.read_buffer(size.0, size.1, bpp),
                self.read_buffer(size.0, size.1, bpp),
            ];"""),
("""    fn dest_size(&self, dest: Dest) -> Option<(u32, u32)> {""","""    fn dest_bpp(&self, dest: Dest) -> u32 {
        match dest {
            Dest::Target(i) => self
                .targets
                .get(i)
                .and_then(Option::as_ref)
                .map_or(4, |t| bytes_per_texel(t.format)),
            Dest::Atlas => 4,
        }
    }

    fn dest_size(&self, dest: Dest) -> Option<(u32, u32)> {"""),
])
