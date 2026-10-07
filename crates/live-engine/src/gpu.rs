//! The GPU compositor: every screen drawn once a frame with wgpu (Direct3D 12
//! on Windows), from source frames uploaded once each however many screens
//! show them. Screens are drawn into textures; outputs (windows, the
//! encoder, the previews) take them from there.

use std::collections::HashMap;
use std::sync::Arc;

use lumora_engine::SourceId;

use crate::frame::{PixelFormat, VideoFrame};
use crate::mix::Shape;
use crate::scene::{fit_rect, Content, Layer, Placement, Rect, ScreenScene, FULL};

/// Every screen is drawn in plain 8-bit RGBA (as the web canvases are: blending happens on the stored values).
pub const TARGET_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

const SHADER: &str = include_str!("compose.wgsl");
/// One draw's uniforms: ten vec4s.
const DRAW_FLOATS: usize = 40;
const DRAW_BYTES: u64 = (DRAW_FLOATS * 4) as u64;

struct Tex {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    bind: wgpu::BindGroup,
    w: u32,
    h: u32,
}

struct SourceTex {
    tex: Tex,
    format: PixelFormat,
    seq: u64,
}

/// What a draw samples.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
enum TexKey {
    White,
    Source(SourceId),
    Target(usize),
    Overlay(usize),
}

/// What a pass paints.
pub enum Paint<'a> {
    /// A scene, and the overlay layer (the screen's graphics) to put over its inputs.
    Scene {
        scene: &'a ScreenScene,
        overlay: Option<usize>,
    },
    /// Another target, stretched over the viewport (a preview of a screen).
    Target(usize),
}

/// Where a pass paints.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Dest {
    Target(usize),
    Atlas,
}

/// One pass: paint into a target (all of it, or a viewport in pixels).
pub struct Pass<'a> {
    pub dest: Dest,
    pub viewport: Option<[u32; 4]>,
    pub paint: Paint<'a>,
}

/// A read-back on its way: the buffer, the "mapped" signal, the picture's size.
struct Pending {
    buffer: wgpu::Buffer,
    rx: std::sync::mpsc::Receiver<Result<(), wgpu::BufferAsyncError>>,
    w: u32,
    h: u32,
}

/// Two read-back buffers taking turns (see [`Compositor::read_pipelined`]).
struct Ring {
    size: (u32, u32),
    buffers: Vec<wgpu::Buffer>,
    next: usize,
    pending: Option<Pending>,
}

/// A window (or anything with a wgpu surface) being drawn into.
pub struct SurfaceOut {
    pub surface: wgpu::Surface<'static>,
    config: Option<wgpu::SurfaceConfiguration>,
}

impl SurfaceOut {
    pub fn new(surface: wgpu::Surface<'static>) -> Self {
        SurfaceOut {
            surface,
            config: None,
        }
    }
}

/// A graphics card the engine could use.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AdapterInfo {
    pub name: String,
    pub backend: String,
    /// "discrete", "integrated", "software", "virtual" or "other".
    pub kind: &'static str,
}

pub struct Compositor {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    tex_layout: wgpu::BindGroupLayout,
    draw_layout: wgpu::BindGroupLayout,
    pipeline_layout: wgpu::PipelineLayout,
    module: wgpu::ShaderModule,
    sampler: wgpu::Sampler,
    pipelines: HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>,
    uniforms: wgpu::Buffer,
    uniform_cap: u64,
    draw_bind: wgpu::BindGroup,
    align: u64,
    white: Tex,
    sources: HashMap<SourceId, SourceTex>,
    targets: Vec<Option<Tex>>,
    overlays: HashMap<usize, Tex>,
    atlas: Option<Tex>,
    reads: HashMap<(u32, u32), wgpu::Buffer>,
    rings: HashMap<Dest, Ring>,
    /// Bytes uploaded to the GPU since the last [`Compositor::take_upload_bytes`].
    uploaded: u64,
}

#[allow(clippy::too_many_arguments)]
fn make_tex(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    w: u32,
    h: u32,
    format: wgpu::TextureFormat,
    target: bool,
    label: &str,
) -> Tex {
    let usage = wgpu::TextureUsages::TEXTURE_BINDING
        | wgpu::TextureUsages::COPY_DST
        | if target {
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC
        } else {
            wgpu::TextureUsages::empty()
        };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: w.max(1),
            height: h.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(label),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    });
    Tex {
        texture,
        view,
        bind,
        w: w.max(1),
        h: h.max(1),
    }
}

fn write_tex(queue: &wgpu::Queue, t: &Tex, data: &[u8]) {
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &t.texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        data,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(t.w * 4),
            rows_per_image: Some(t.h),
        },
        wgpu::Extent3d {
            width: t.w,
            height: t.h,
            depth_or_array_layers: 1,
        },
    );
}

/// Every graphics card wgpu offers here (Direct3D 12 on Windows). Nothing is started.
pub fn adapters() -> Vec<AdapterInfo> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()))
        .iter()
        .map(|a| {
            let i = a.get_info();
            AdapterInfo {
                kind: kind_of(i.device_type),
                backend: format!("{:?}", i.backend),
                name: i.name,
            }
        })
        .collect()
}

fn kind_of(t: wgpu::DeviceType) -> &'static str {
    match t {
        wgpu::DeviceType::DiscreteGpu => "discrete",
        wgpu::DeviceType::IntegratedGpu => "integrated",
        wgpu::DeviceType::Cpu => "software",
        wgpu::DeviceType::VirtualGpu => "virtual",
        wgpu::DeviceType::Other => "other",
    }
}

/// A pass ready to encode: where, which part, and its draws.
type Planned = (Dest, Option<[u32; 4]>, Vec<(DrawU, TexKey)>);

/// One draw's uniforms.
#[derive(Clone, Copy)]
struct DrawU([f32; DRAW_FLOATS]);

impl DrawU {
    fn new() -> Self {
        let mut f = [0.0; DRAW_FLOATS];
        // dst, layer, uv: the whole thing.
        for base in [0, 4, 8] {
            f[base..base + 4].copy_from_slice(&FULL);
        }
        // view: zoom 1.
        f[12] = 1.0;
        // misc: no flip, square, picture.
        f[16..20].copy_from_slice(&[1.0, 1.0, 1.0, 0.0]);
        // fx: opaque.
        f[24] = 1.0;
        // luma: aspects.
        f[34] = 16.0 / 9.0;
        f[35] = 16.0 / 9.0;
        // clip: everything.
        f[36..40].copy_from_slice(&[-1e6, -1e6, 1e6, 1e6]);
        DrawU(f)
    }
    fn set(&mut self, at: usize, v: [f32; 4]) -> &mut Self {
        self.0[at * 4..at * 4 + 4].copy_from_slice(&v);
        self
    }
    fn bytes(&self) -> impl Iterator<Item = u8> + '_ {
        self.0.iter().flat_map(|f| f.to_le_bytes())
    }
}

const DST: usize = 0;
const LAYER: usize = 1;
const UV: usize = 2;
const VIEW: usize = 3;
const MISC: usize = 4;
const COLOR: usize = 5;
const FX: usize = 6;
const CUT: usize = 7;
const LUMA: usize = 8;
const CLIP: usize = 9;

/// Map a rect given in a box's own fractions into output fractions.
fn within(outer: Rect, inner: Rect) -> Rect {
    let (w, h) = (outer[2] - outer[0], outer[3] - outer[1]);
    [
        outer[0] + inner[0] * w,
        outer[1] + inner[1] * h,
        outer[0] + inner[2] * w,
        outer[1] + inner[3] * h,
    ]
}

/// The layer's box once a slide or zoom moved it (CSS `translate(x%, y%) scale(s)`, centered).
pub fn layer_box(l: &Layer) -> Rect {
    let s = if l.scale.is_finite() { l.scale } else { 1.0 };
    let (sx, sy) = (l.shift[0] / 100.0, l.shift[1] / 100.0);
    [
        0.5 + sx - 0.5 * s,
        0.5 + sy - 0.5 * s,
        0.5 + sx + 0.5 * s,
        0.5 + sy + 0.5 * s,
    ]
}

impl Compositor {
    /// Start on the best graphics card (one that can show in `surface`, when given).
    ///
    /// # Errors
    /// No usable graphics card.
    pub fn new(
        instance: wgpu::Instance,
        surface: Option<&wgpu::Surface<'_>>,
    ) -> Result<Self, String> {
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: surface,
            apply_limit_buckets: false,
        }))
        .map_err(|e| format!("No graphics card for the unified engine: {e}"))?;
        let limits = wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits());
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("lumora-live-engine"),
            required_features: wgpu::Features::empty(),
            required_limits: limits,
            ..Default::default()
        }))
        .map_err(|e| format!("The graphics card could not start: {e}"))?;
        // A mistake on the GPU is reported, never a crash in the middle of a show.
        device.on_uncaptured_error(Arc::new(|e| eprintln!("live engine GPU: {e}")));
        let align = u64::from(device.limits().min_uniform_buffer_offset_alignment).max(DRAW_BYTES);
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("linear-clamp"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let tex_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("picture"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let draw_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("draw"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: true,
                    min_binding_size: wgpu::BufferSize::new(DRAW_BYTES),
                },
                count: None,
            }],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("compose"),
            bind_group_layouts: &[Some(&draw_layout), Some(&tex_layout)],
            immediate_size: 0,
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("compose"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let white = make_tex(
            &device,
            &tex_layout,
            &sampler,
            1,
            1,
            wgpu::TextureFormat::Rgba8Unorm,
            false,
            "white",
        );
        write_tex(&queue, &white, &[255; 4]);
        let uniform_cap = align * 64;
        let (uniforms, draw_bind) = Self::uniform_buffer(&device, &draw_layout, uniform_cap);
        let mut c = Compositor {
            instance,
            adapter,
            device,
            queue,
            tex_layout,
            draw_layout,
            pipeline_layout,
            module,
            sampler,
            pipelines: HashMap::new(),
            uniforms,
            uniform_cap,
            draw_bind,
            align,
            white,
            sources: HashMap::new(),
            targets: Vec::new(),
            overlays: HashMap::new(),
            atlas: None,
            reads: HashMap::new(),
            rings: HashMap::new(),
            uploaded: 0,
        };
        c.pipeline(TARGET_FORMAT);
        Ok(c)
    }

    /// Start without any window (tests, the benchmark).
    ///
    /// # Errors
    /// No usable graphics card.
    pub fn headless() -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        Self::new(instance, None)
    }

    fn uniform_buffer(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        size: u64,
    ) -> (wgpu::Buffer, wgpu::BindGroup) {
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("draws"),
            size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("draws"),
            layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &buffer,
                    offset: 0,
                    size: wgpu::BufferSize::new(DRAW_BYTES),
                }),
            }],
        });
        (buffer, bind)
    }

    /// Which graphics card and API.
    pub fn describe(&self) -> AdapterInfo {
        let i = self.adapter.get_info();
        AdapterInfo {
            kind: kind_of(i.device_type),
            backend: format!("{:?}", i.backend),
            name: i.name,
        }
    }

    fn pipeline(&mut self, format: wgpu::TextureFormat) -> wgpu::RenderPipeline {
        if let Some(p) = self.pipelines.get(&format) {
            return p.clone();
        }
        let p = self
            .device
            .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("compose"),
                layout: Some(&self.pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &self.module,
                    entry_point: Some("vs"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::TriangleStrip,
                    ..Default::default()
                },
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &self.module,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
        self.pipelines.insert(format, p.clone());
        p
    }

    /// Make sure target `i` exists at `w` × `h` (screens, previews).
    pub fn ensure_target(&mut self, i: usize, w: u32, h: u32) {
        if self.targets.len() <= i {
            self.targets.resize_with(i + 1, || None);
        }
        let ok = self.targets[i]
            .as_ref()
            .is_some_and(|t| t.w == w && t.h == h);
        if !ok {
            self.targets[i] = Some(make_tex(
                &self.device,
                &self.tex_layout,
                &self.sampler,
                w,
                h,
                TARGET_FORMAT,
                true,
                "screen",
            ));
        }
    }

    /// Make sure the preview atlas exists at `w` × `h`.
    pub fn ensure_atlas(&mut self, w: u32, h: u32) {
        let ok = self.atlas.as_ref().is_some_and(|t| t.w == w && t.h == h);
        if !ok {
            self.atlas = Some(make_tex(
                &self.device,
                &self.tex_layout,
                &self.sampler,
                w,
                h,
                TARGET_FORMAT,
                true,
                "previews",
            ));
        }
    }

    /// The newest frame of a source to the GPU (nothing happens when it was already sent).
    pub fn upload(&mut self, id: &SourceId, f: &VideoFrame) {
        let format = match f.format {
            PixelFormat::Rgba8 => wgpu::TextureFormat::Rgba8Unorm,
            PixelFormat::Bgra8 | PixelFormat::Bgrx8 => wgpu::TextureFormat::Bgra8Unorm,
        };
        let fresh = match self.sources.get(id) {
            Some(s) if s.tex.w == f.width && s.tex.h == f.height && s.format == f.format => {
                if s.seq == f.seq {
                    return;
                }
                false
            }
            _ => true,
        };
        if fresh {
            let tex = make_tex(
                &self.device,
                &self.tex_layout,
                &self.sampler,
                f.width,
                f.height,
                format,
                false,
                "source",
            );
            self.sources.insert(
                id.clone(),
                SourceTex {
                    tex,
                    format: f.format,
                    seq: u64::MAX,
                },
            );
        }
        if let Some(s) = self.sources.get_mut(id) {
            if f.data.as_slice().len() >= (f.width * f.height * 4) as usize {
                write_tex(&self.queue, &s.tex, f.data.as_slice());
                self.uploaded += u64::from(f.width) * u64::from(f.height) * 4;
            }
            s.seq = f.seq;
        }
    }

    /// Bytes sent to the GPU since last asked.
    pub fn take_upload_bytes(&mut self) -> u64 {
        std::mem::take(&mut self.uploaded)
    }

    /// Forget sources no longer in the show.
    pub fn keep_sources(&mut self, keep: &dyn Fn(&SourceId) -> bool) {
        self.sources.retain(|id, _| keep(id));
    }

    /// Size of a source's newest frame on the GPU.
    pub fn source_size(&self, id: &SourceId) -> Option<(u32, u32)> {
        self.sources.get(id).map(|s| (s.tex.w, s.tex.h))
    }

    /// Set (or clear) overlay layer `slot`: straight-alpha RGBA, top row first.
    pub fn set_overlay(&mut self, slot: usize, frame: Option<(u32, u32, &[u8])>) {
        let Some((w, h, px)) = frame else {
            self.overlays.remove(&slot);
            return;
        };
        let ok = self
            .overlays
            .get(&slot)
            .is_some_and(|t| t.w == w && t.h == h);
        if !ok {
            let t = make_tex(
                &self.device,
                &self.tex_layout,
                &self.sampler,
                w,
                h,
                wgpu::TextureFormat::Rgba8Unorm,
                false,
                "overlay",
            );
            self.overlays.insert(slot, t);
        }
        if let Some(t) = self.overlays.get(&slot) {
            if px.len() >= (w * h * 4) as usize {
                write_tex(&self.queue, t, px);
                self.uploaded += u64::from(w) * u64::from(h) * 4;
            }
        }
    }

    /// Where a source's picture lands (output fractions), which part of it
    /// shows, and how its alpha is read; None when the source has no frame yet.
    fn video_dst(
        &self,
        pic: &crate::scene::Picture,
        lb: Rect,
        lw: f32,
        lh: f32,
    ) -> Option<(Rect, Rect, f32)> {
        let Content::Video(id) = &pic.content else {
            return None;
        };
        let st = self.sources.get(id)?;
        let mode = if st.format == PixelFormat::Bgrx8 {
            3.0
        } else {
            0.0
        };
        let f = pic.placement.frame;
        let (dst_in, uv) = fit_rect(
            &Placement {
                frame: FULL,
                ..pic.placement.clone()
            },
            st.tex.w,
            st.tex.h,
            (lw * (f[2] - f[0])).max(1.0) as u32,
            (lh * (f[3] - f[1])).max(1.0) as u32,
        );
        Some((within(within(lb, f), dst_in), uv, mode))
    }

    /// The draws that paint `scene` on an output of `out_w` × `out_h`.
    fn scene_draws(
        &self,
        scene: &ScreenScene,
        overlay: Option<usize>,
        out_w: u32,
        out_h: u32,
        draws: &mut Vec<(DrawU, TexKey)>,
    ) {
        let out_aspect = out_w as f32 / out_h.max(1) as f32;
        for layer in &scene.layers {
            if layer.opacity <= 0.0 {
                continue;
            }
            let lb = layer_box(layer);
            let lw = (lb[2] - lb[0]) * out_w as f32;
            let lh = (lb[3] - lb[1]) * out_h as f32;
            for (n, pic) in layer.pictures.iter().enumerate() {
                let frame = within(lb, pic.placement.frame);
                let mut d = DrawU::new();
                d.set(LAYER, lb).set(CLIP, frame);
                let (shape_kind, size) = match layer.shape {
                    Shape::Whole => (0.0, 0.0),
                    Shape::Rect { t, r, b, l } => {
                        d.set(CUT, [t, r, b, l]);
                        (1.0, 0.0)
                    }
                    Shape::Circle { r } => (2.0, r),
                    Shape::Diamond { r } => (3.0, r),
                };
                d.set(FX, [layer.opacity, layer.blur, shape_kind, size]);
                let (pattern, p) = layer
                    .luma
                    .map_or((0.0, 0.0), |(pat, p)| (pat.code() as f32, p));
                let layer_aspect = if lh > 0.0 { lw / lh } else { out_aspect };
                d.set(LUMA, [pattern, p, layer_aspect, out_aspect]);
                let color_rect = |r: Rect, c: [f32; 4], draws: &mut Vec<(DrawU, TexKey)>| {
                    if r[2] - r[0] > 1e-5 && r[3] - r[1] > 1e-5 {
                        let mut d = d;
                        d.set(DST, r).set(COLOR, c);
                        d.0[MISC * 4 + 3] = 1.0;
                        draws.push((d, TexKey::White));
                    }
                };
                match &pic.content {
                    Content::Color(c) => color_rect(frame, *c, draws),
                    Content::Bars(c) => {
                        // Only around the picture that follows: under it, its own
                        // opacity would let the bars show through mid-fade.
                        let covered = layer
                            .pictures
                            .get(n + 1)
                            .and_then(|next| self.video_dst(next, lb, lw, lh));
                        match covered {
                            Some((v, _, _)) => {
                                let [f0, f1, f2, f3] = frame;
                                let [v0, v1, v2, v3] = v;
                                for r in [
                                    [f0, f1, v0, f3],
                                    [v2, f1, f2, f3],
                                    [v0, f1, v2, v1],
                                    [v0, v3, v2, f3],
                                ] {
                                    color_rect(r, *c, draws);
                                }
                            }
                            None => color_rect(frame, *c, draws),
                        }
                    }
                    Content::Video(id) => {
                        let Some((dst, uv, mode)) = self.video_dst(pic, lb, lw, lh) else {
                            continue;
                        };
                        let pl = &pic.placement;
                        let qw = (dst[2] - dst[0]) * out_w as f32;
                        let qh = (dst[3] - dst[1]) * out_h as f32;
                        d.set(DST, dst).set(UV, uv).set(
                            VIEW,
                            [pl.zoom, pl.pan[0], pl.pan[1], pl.rotate.to_radians()],
                        );
                        d.set(
                            MISC,
                            [
                                if pl.flip[0] { -1.0 } else { 1.0 },
                                if pl.flip[1] { -1.0 } else { 1.0 },
                                if qh > 0.0 { qw / qh } else { 1.0 },
                                mode,
                            ],
                        );
                        draws.push((d, TexKey::Source(id.clone())));
                    }
                    Content::Graphic(_) => {}
                }
            }
        }
        if let Some(slot) = overlay.filter(|s| self.overlays.contains_key(s)) {
            let mut d = DrawU::new();
            d.set(LUMA, [0.0, 0.0, out_aspect, out_aspect]);
            draws.push((d, TexKey::Overlay(slot)));
        }
        let mut solid = |c: [f32; 4], a: f32| {
            if a > 0.0 {
                let mut d = DrawU::new();
                d.set(COLOR, c).set(FX, [a, 0.0, 0.0, 0.0]);
                d.0[MISC * 4 + 3] = 1.0;
                draws.push((d, TexKey::White));
            }
        };
        solid([0.0, 0.0, 0.0, 1.0], scene.black);
        solid([1.0, 1.0, 1.0, 1.0], scene.white);
        solid([0.0, 0.0, 0.0, 1.0], scene.blank);
        // PANIC: the safe screen (black; the event logo arrives with the overlay renderer).
        solid([0.0, 0.0, 0.0, 1.0], scene.panic);
    }

    fn dest_size(&self, dest: Dest) -> Option<(u32, u32)> {
        match dest {
            Dest::Target(i) => self.targets.get(i)?.as_ref().map(|t| (t.w, t.h)),
            Dest::Atlas => self.atlas.as_ref().map(|t| (t.w, t.h)),
        }
    }

    /// Paint every pass in one submission. Targets painted whole are cleared to black first.
    pub fn render(&mut self, passes: &[Pass<'_>]) {
        let mut plan: Vec<Planned> = Vec::new();
        for p in passes {
            let Some((tw, th)) = self.dest_size(p.dest) else {
                continue;
            };
            let (w, h) = p.viewport.map_or((tw, th), |v| (v[2], v[3]));
            let mut draws = Vec::new();
            match &p.paint {
                Paint::Scene { scene, overlay } => {
                    self.scene_draws(scene, *overlay, w, h, &mut draws)
                }
                Paint::Target(i) => {
                    let mut d = DrawU::new();
                    d.0[MISC * 4 + 3] = 2.0;
                    draws.push((d, TexKey::Target(*i)));
                }
            }
            plan.push((p.dest, p.viewport, draws));
        }
        self.submit(plan, None);
    }

    /// Upload every draw's uniforms, then encode and submit the passes (and a present, when given).
    fn submit(
        &mut self,
        plan: Vec<Planned>,
        surface: Option<(&wgpu::TextureView, wgpu::TextureFormat)>,
    ) {
        let total: usize = plan.iter().map(|p| p.2.len()).sum();
        let need = self.align * total.max(1) as u64;
        if need > self.uniform_cap {
            let cap = need.next_power_of_two();
            let (b, g) = Self::uniform_buffer(&self.device, &self.draw_layout, cap);
            self.uniforms = b;
            self.draw_bind = g;
            self.uniform_cap = cap;
        }
        let mut bytes = Vec::with_capacity(need as usize);
        for (_, _, draws) in &plan {
            for (d, _) in draws {
                bytes.extend(d.bytes());
                bytes.resize(bytes.len().next_multiple_of(self.align as usize), 0);
            }
        }
        if !bytes.is_empty() {
            self.queue.write_buffer(&self.uniforms, 0, &bytes);
        }
        let target_pipe = self.pipeline(TARGET_FORMAT);
        let surface_pipe = surface.map(|(_, f)| self.pipeline(f));
        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("frame"),
            });
        let mut n = 0u64;
        for (dest, viewport, draws) in &plan {
            let (view, size) = match (dest, surface) {
                (Dest::Target(usize::MAX), Some((v, _))) => (v, None),
                (Dest::Target(i), _) => match self.targets.get(*i).and_then(Option::as_ref) {
                    Some(t) => (&t.view, Some((t.w, t.h))),
                    None => continue,
                },
                (Dest::Atlas, _) => match &self.atlas {
                    Some(t) => (&t.view, Some((t.w, t.h))),
                    None => continue,
                },
            };
            let whole = viewport.is_none();
            let mut rp = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("compose"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if whole {
                            wgpu::LoadOp::Clear(wgpu::Color::BLACK)
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            let pipe = if size.is_none() {
                surface_pipe.as_ref().unwrap_or(&target_pipe)
            } else {
                &target_pipe
            };
            rp.set_pipeline(pipe);
            if let Some([x, y, w, h]) = viewport {
                if let Some((tw, th)) = size {
                    if x + w > tw || y + h > th || *w == 0 || *h == 0 {
                        n += draws.len() as u64;
                        continue;
                    }
                }
                rp.set_viewport(*x as f32, *y as f32, *w as f32, *h as f32, 0.0, 1.0);
            }
            for (_, key) in draws {
                let bind = match key {
                    TexKey::White => Some(&self.white.bind),
                    TexKey::Source(id) => self.sources.get(id).map(|s| &s.tex.bind),
                    TexKey::Target(i) => self
                        .targets
                        .get(*i)
                        .and_then(Option::as_ref)
                        .map(|t| &t.bind),
                    TexKey::Overlay(i) => self.overlays.get(i).map(|t| &t.bind),
                };
                let offset = (n * self.align) as u32;
                n += 1;
                let Some(bind) = bind else { continue };
                rp.set_bind_group(0, &self.draw_bind, &[offset]);
                rp.set_bind_group(1, bind, &[]);
                rp.draw(0..4, 0..1);
            }
        }
        self.queue.submit([enc.finish()]);
    }

    /// Show target `i` in a window, letterboxed to the window's shape. Returns
    /// false when the window couldn't take a frame (minimized, being resized).
    pub fn present(&mut self, out: &mut SurfaceOut, i: usize, w: u32, h: u32) -> bool {
        if w == 0 || h == 0 {
            return false;
        }
        let stale = out
            .config
            .as_ref()
            .is_none_or(|c| c.width != w || c.height != h);
        if stale {
            let caps = out.surface.get_capabilities(&self.adapter);
            let Some(format) = caps
                .formats
                .iter()
                .copied()
                .find(|f| {
                    matches!(
                        f,
                        wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm
                    )
                })
                .or_else(|| caps.formats.first().copied())
            else {
                return false;
            };
            // Never wait for the display: three windows on three displays
            // would each hold the engine for a refresh.
            let mode = [wgpu::PresentMode::Mailbox, wgpu::PresentMode::Immediate]
                .into_iter()
                .find(|m| caps.present_modes.contains(m))
                .unwrap_or(wgpu::PresentMode::Fifo);
            let c = wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                width: w,
                height: h,
                present_mode: mode,
                desired_maximum_frame_latency: 1,
                alpha_mode: caps
                    .alpha_modes
                    .first()
                    .copied()
                    .unwrap_or(wgpu::CompositeAlphaMode::Auto),
                view_formats: vec![],
                color_space: Default::default(),
            };
            out.surface.configure(&self.device, &c);
            out.config = Some(c);
        }
        let format = out
            .config
            .as_ref()
            .map_or(wgpu::TextureFormat::Bgra8Unorm, |c| c.format);
        let tex = match out.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return false
            }
            _ => {
                out.config = None;
                return false;
            }
        };
        let view = tex
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let Some(src) = self.targets.get(i).and_then(Option::as_ref) else {
            return false;
        };
        // Letterbox the screen into the window.
        let (sa, wa) = (src.w as f32 / src.h as f32, w as f32 / h as f32);
        let dst = if sa > wa {
            let k = wa / sa;
            [0.0, (1.0 - k) / 2.0, 1.0, (1.0 + k) / 2.0]
        } else {
            let k = sa / wa;
            [(1.0 - k) / 2.0, 0.0, (1.0 + k) / 2.0, 1.0]
        };
        let mut d = DrawU::new();
        d.set(DST, dst);
        d.0[MISC * 4 + 3] = 2.0;
        self.submit(
            vec![(Dest::Target(usize::MAX), None, vec![(d, TexKey::Target(i))])],
            Some((&view, format)),
        );
        self.queue.present(tex);
        true
    }

    /// A read-back buffer for `w` × `h` (bytes per row padded as the GPU wants).
    fn read_buffer(&self, w: u32, h: u32) -> wgpu::Buffer {
        let row = (w * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("read"),
            size: u64::from(row) * u64::from(h),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        })
    }

    /// Copy a target into `buffer` and ask for it to be mapped.
    fn start_read(&self, dest: Dest, buffer: &wgpu::Buffer) -> Result<Pending, String> {
        let t = match dest {
            Dest::Target(i) => self.targets.get(i).and_then(Option::as_ref),
            Dest::Atlas => self.atlas.as_ref(),
        }
        .ok_or("Nothing to read.")?;
        let (w, h) = (t.w, t.h);
        let row = (w * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("read"),
            });
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &t.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: Some(h),
                },
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([enc.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        Ok(Pending {
            buffer: buffer.clone(),
            rx,
            w,
            h,
        })
    }

    /// Wait for a read to be mapped and take its pixels out (unpadded).
    fn finish_read(&self, p: Pending) -> Result<(u32, u32, Vec<u8>), String> {
        let _ = self.device.poll(wgpu::PollType::Poll);
        let ready = match p.rx.try_recv() {
            Ok(r) => Some(r),
            Err(_) => {
                let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
                p.rx.recv().ok()
            }
        };
        ready
            .ok_or("The read-back was lost.")?
            .map_err(|e| e.to_string())?;
        let (w, h) = (p.w, p.h);
        let row = (w * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) as usize;
        let mut px = Vec::with_capacity((w * h * 4) as usize);
        {
            let slice = p.buffer.slice(..);
            let mapped = slice.get_mapped_range().map_err(|e| e.to_string())?;
            for y in 0..h as usize {
                let start = y * row;
                px.extend_from_slice(&mapped[start..start + w as usize * 4]);
            }
        }
        p.buffer.unmap();
        Ok((w, h, px))
    }

    /// Read target `i` (or the atlas) back: RGBA, top row first. Waits for the GPU.
    ///
    /// # Errors
    /// The target doesn't exist or the GPU failed.
    pub fn read(&mut self, dest: Dest) -> Result<(u32, u32, Vec<u8>), String> {
        let (w, h) = self.dest_size(dest).ok_or("Nothing to read.")?;
        let buffer = match self.reads.get(&(w, h)) {
            Some(b) => b.clone(),
            None => {
                let b = self.read_buffer(w, h);
                self.reads.insert((w, h), b.clone());
                b
            }
        };
        let p = self.start_read(dest, &buffer)?;
        self.finish_read(p)
    }

    /// Read a target back without stalling: starts this frame's copy and
    /// returns the **previous** call's pixels (one frame late), which the GPU
    /// has normally long finished. Two buffers take turns. None on the first call.
    pub fn read_pipelined(&mut self, dest: Dest) -> Option<(u32, u32, Vec<u8>)> {
        let size = self.dest_size(dest)?;
        if self.rings.get(&dest).is_none_or(|r| r.size != size) {
            let buffers = vec![
                self.read_buffer(size.0, size.1),
                self.read_buffer(size.0, size.1),
            ];
            self.rings.insert(
                dest,
                Ring {
                    size,
                    buffers,
                    next: 0,
                    pending: None,
                },
            );
        }
        let ring = self.rings.get_mut(&dest)?;
        let buffer = ring.buffers[ring.next].clone();
        ring.next = 1 - ring.next;
        let previous = ring.pending.take();
        let started = self.start_read(dest, &buffer).ok();
        let out = previous.and_then(|p| self.finish_read(p).ok());
        if let Some(ring) = self.rings.get_mut(&dest) {
            ring.pending = started;
        }
        out
    }

    /// Wait until the GPU has finished everything submitted (benchmarks).
    pub fn finish(&self) {
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
    }
}
