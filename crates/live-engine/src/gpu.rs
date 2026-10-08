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
const YUV_SHADER: &str = include_str!("yuv.wgsl");
/// One draw's uniforms: eighteen vec4s.
const DRAW_FLOATS: usize = 72;
const DRAW_BYTES: u64 = (DRAW_FLOATS * 4) as u64;

struct Tex {
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
}

struct SourceTex {
    tex: Tex,
    format: PixelFormat,
    seq: u64,
    /// NV12 sources: their Y and UV planes as they arrive (made into `tex` on the GPU).
    planes: Option<(wgpu::Texture, wgpu::Texture, wgpu::BindGroup)>,
}

/// A graphics plane from the web overlay renderer: the slot (screen) it
/// belongs to, its name (`g:<input>`, `top`, `panic`: see [`crate::overlay`]) and size.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub struct PlaneId {
    pub slot: usize,
    pub name: String,
    pub w: u32,
    pub h: u32,
}

/// An input's person mask and the pictures behind and in front of its
/// people, from the vision worker ([`crate::vision`]), bound with its picture.
struct VisionTex {
    mask: Option<(wgpu::Texture, wgpu::TextureView)>,
    /// The picture behind the people, and its shape (width / height).
    back: Option<(wgpu::Texture, wgpu::TextureView, f32)>,
    /// A virtual set's desk in front of them.
    front: Option<(wgpu::Texture, wgpu::TextureView)>,
    bind: wgpu::BindGroup,
}

/// What a draw samples.
#[derive(Clone, PartialEq, Eq, Hash, Debug)]
enum TexKey {
    White,
    Source(SourceId),
    Target(usize),
    Plane(PlaneId),
}

/// What a pass paints.
pub enum Paint<'a> {
    /// A scene, and the slot whose graphics planes (from the web overlay
    /// renderer) it shows: graphics inputs in their places, the `top` plane
    /// over everything but blank and PANIC, the PANIC logo.
    Scene {
        scene: &'a ScreenScene,
        planes: Option<usize>,
    },
    /// Another target, stretched over the viewport (a preview of a screen).
    Target(usize),
    /// The 9:16 version of target `src` (the recorder's `VerticalFrame`):
    /// the whole picture across the middle, over a soft, darkened copy of
    /// it filling the frame (stretched up from the tiny target `small`).
    Vertical { src: usize, small: usize },
    /// A flat color (premultiplied) over the viewport.
    Solid([f32; 4]),
    /// A graphics plane of `slot` over the viewport, at whatever size it is held (the multiview's words).
    Plane { slot: usize, name: &'static str },
    /// Target `src` as NV12 (into an NV12 target, see [`Compositor::ensure_nv12_target`]).
    Nv12(usize),
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
    bpp: u32,
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

    /// Configure it again on the next present (a new graphics device).
    pub fn reset(&mut self) {
        self.config = None;
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
    /// NV12 to RGBA (`yuv.wgsl`): its layout and its pipelines (BT.709, BT.601).
    yuv_layout: wgpu::BindGroupLayout,
    yuv_pipes: [wgpu::RenderPipeline; 2],
    /// Person masks and the pictures behind people (group 2 of `compose.wgsl`).
    vision_layout: wgpu::BindGroupLayout,
    /// No mask (a person everywhere), nothing behind or in front.
    vision_none: wgpu::BindGroup,
    vision: HashMap<SourceId, VisionTex>,
    /// See-through, 1 × 1.
    clear: Tex,
    sampler: wgpu::Sampler,
    pipelines: HashMap<wgpu::TextureFormat, wgpu::RenderPipeline>,
    uniforms: wgpu::Buffer,
    uniform_cap: u64,
    draw_bind: wgpu::BindGroup,
    align: u64,
    white: Tex,
    sources: HashMap<SourceId, SourceTex>,
    targets: Vec<Option<Tex>>,
    planes: HashMap<PlaneId, Tex>,
    atlas: Option<Tex>,
    reads: HashMap<(u32, u32), wgpu::Buffer>,
    rings: HashMap<Dest, Ring>,
    /// Bytes uploaded to the GPU since the last [`Compositor::take_upload_bytes`].
    uploaded: u64,
    /// Seconds (0 – 100) for the grain effect.
    time: f32,
    /// The graphics device was lost (a driver reset, the card removed): the engine makes a new one.
    lost: Arc<std::sync::atomic::AtomicBool>,
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
        format,
    }
}

fn vision_bind(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    views: [&wgpu::TextureView; 3],
) -> wgpu::BindGroup {
    let entries: Vec<wgpu::BindGroupEntry<'_>> = views
        .iter()
        .enumerate()
        .map(|(i, v)| wgpu::BindGroupEntry {
            binding: i as u32,
            resource: wgpu::BindingResource::TextureView(v),
        })
        .collect();
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("vision"),
        layout,
        entries: &entries,
    })
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

/// Layers drawn whole into a scratch target first (see [`needs_group`]):
/// (an overlay channel, its index) → the scratch target.
type Groups = HashMap<(bool, usize), usize>;

/// Scratch targets (layers composited as a group) are numbered from here; they start see-through.
const SCRATCH: usize = 64;

/// A layer of several pictures (a split screen, a picture with its bars)
/// that fades, wipes or blurs is drawn whole first and then faded as one, as
/// the web fades a box with its contents: faded picture by picture, its
/// background would show through its boxes mid-fade.
pub fn needs_group(l: &Layer) -> bool {
    let pictures = l
        .pictures
        .iter()
        .filter(|p| !matches!(p.content, Content::Bars(_)))
        .count();
    pictures > 1
        && l.opacity > 0.0
        && (l.opacity < 1.0 || l.blur > 0.0 || l.shape != Shape::Whole || l.luma.is_some())
}

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
/// Green screen and light and color: six vec4s from here (see [`crate::look::Look::uniforms`]).
const LOOK: usize = 10;
/// The background behind people (mode, blur, edge, a mask came) and the
/// picture behind them (its shape, a desk in front).
const BG: usize = 16;
const BG2: usize = 17;

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
        // A lost device (a driver reset — Windows' TDR —, the card removed) is noticed and replaced.
        let lost = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let l = Arc::clone(&lost);
        device.set_device_lost_callback(move |reason, why| {
            eprintln!("live engine GPU lost ({reason:?}): {why}");
            l.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        let align = DRAW_BYTES.next_multiple_of(u64::from(
            device.limits().min_uniform_buffer_offset_alignment,
        ));
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
        let picture = |binding: u32| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let vision_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("vision"),
            entries: &[picture(0), picture(1), picture(2)],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("compose"),
            bind_group_layouts: &[Some(&draw_layout), Some(&tex_layout), Some(&vision_layout)],
            immediate_size: 0,
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("compose"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let plane = |binding: u32| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let yuv_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("nv12"),
            entries: &[
                plane(0),
                plane(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let yuv_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("nv12"),
            source: wgpu::ShaderSource::Wgsl(YUV_SHADER.into()),
        });
        let yuv_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("nv12"),
            bind_group_layouts: &[Some(&yuv_layout)],
            immediate_size: 0,
        });
        let yuv_pipe = |entry: &str| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("nv12"),
                layout: Some(&yuv_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &yuv_module,
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
                    module: &yuv_module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let yuv_pipes = [yuv_pipe("fs_709"), yuv_pipe("fs_601")];
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
        let clear = make_tex(
            &device,
            &tex_layout,
            &sampler,
            1,
            1,
            wgpu::TextureFormat::Rgba8Unorm,
            false,
            "clear",
        );
        write_tex(&queue, &clear, &[0; 4]);
        let vision_none = vision_bind(
            &device,
            &vision_layout,
            [&white.view, &clear.view, &clear.view],
        );
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
            yuv_layout,
            yuv_pipes,
            vision_layout,
            vision_none,
            vision: HashMap::new(),
            clear,
            sampler,
            pipelines: HashMap::new(),
            uniforms,
            uniform_cap,
            draw_bind,
            align,
            white,
            sources: HashMap::new(),
            targets: Vec::new(),
            planes: HashMap::new(),
            atlas: None,
            reads: HashMap::new(),
            rings: HashMap::new(),
            uploaded: 0,
            time: 0.0,
            lost,
        };
        c.pipeline(TARGET_FORMAT);
        Ok(c)
    }

    /// The device was lost: nothing drawn with it shows any more.
    pub fn is_lost(&self) -> bool {
        self.lost.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// A new device on the best card (after a loss), from the same instance
    /// (windows' surfaces stay valid; they are configured again).
    ///
    /// # Errors
    /// No usable graphics card (yet: the driver may still be resetting).
    pub fn renew(&self) -> Result<Self, String> {
        Self::new(self.instance.clone(), None)
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
                    // NV12 targets get the NV12 conversion (and no blending).
                    entry_point: Some(if format == NV12_FORMAT {
                        "fs_nv12"
                    } else {
                        "fs"
                    }),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: (format != NV12_FORMAT)
                            .then_some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
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

    /// Make sure target `i` exists as an NV12 target for a `w` × `h` picture
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

    /// Target `i`'s size, when it exists.
    pub fn target_size(&self, i: usize) -> Option<(u32, u32)> {
        self.dest_size(Dest::Target(i))
    }

    /// Let target `i` go (a feed ended).
    pub fn drop_target(&mut self, i: usize) {
        if let Some(t) = self.targets.get_mut(i) {
            *t = None;
        }
        self.rings.remove(&Dest::Target(i));
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
        if f.format == PixelFormat::Nv12 {
            self.upload_nv12(id, f);
            return;
        }
        let format = match f.format {
            PixelFormat::Rgba8 | PixelFormat::Nv12 => wgpu::TextureFormat::Rgba8Unorm,
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
                    planes: None,
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

    /// An NV12 frame: its two planes to the GPU (12 bits a pixel), made into
    /// the source's RGBA picture there.
    fn upload_nv12(&mut self, id: &SourceId, f: &VideoFrame) {
        let (w, h) = (f.width & !1, f.height & !1);
        if w == 0
            || h == 0
            || f.data.as_slice().len() < PixelFormat::Nv12.frame_len(f.width, f.height)
        {
            return;
        }
        let fresh = match self.sources.get(id) {
            Some(s) if s.tex.w == w && s.tex.h == h && s.format == PixelFormat::Nv12 => {
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
                w,
                h,
                wgpu::TextureFormat::Rgba8Unorm,
                true,
                "camera",
            );
            let plane = |pw: u32, ph: u32, format: wgpu::TextureFormat| {
                self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("camera-plane"),
                    size: wgpu::Extent3d {
                        width: pw,
                        height: ph,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                })
            };
            let y = plane(w, h, wgpu::TextureFormat::R8Unorm);
            let uv = plane(w / 2, h / 2, wgpu::TextureFormat::Rg8Unorm);
            let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("camera-planes"),
                layout: &self.yuv_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(
                            &y.create_view(&wgpu::TextureViewDescriptor::default()),
                        ),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(
                            &uv.create_view(&wgpu::TextureViewDescriptor::default()),
                        ),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                ],
            });
            self.sources.insert(
                id.clone(),
                SourceTex {
                    tex,
                    format: PixelFormat::Nv12,
                    seq: u64::MAX,
                    planes: Some((y, uv, bind)),
                },
            );
        }
        let Some(s) = self.sources.get_mut(id) else {
            return;
        };
        let Some((y, uv, bind)) = &s.planes else {
            return;
        };
        let data = f.data.as_slice();
        let stride = f.width as usize;
        let ylen = stride * f.height as usize;
        let write = |t: &wgpu::Texture, bytes: &[u8], row: u32, tw: u32, th: u32| {
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: t,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: Some(th),
                },
                wgpu::Extent3d {
                    width: tw,
                    height: th,
                    depth_or_array_layers: 1,
                },
            );
        };
        write(y, &data[..ylen], f.width, w, h);
        write(uv, &data[ylen..], f.width, w / 2, h / 2);
        self.uploaded += PixelFormat::Nv12.frame_len(w, h) as u64;
        // HD cameras speak BT.709; smaller ones BT.601.
        let pipe = &self.yuv_pipes[usize::from(h < 720)];
        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("nv12"),
            });
        {
            let mut rp = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("nv12"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &s.tex.view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            rp.set_pipeline(pipe);
            rp.set_bind_group(0, bind, &[]);
            rp.draw(0..4, 0..1);
        }
        self.queue.submit([enc.finish()]);
        s.seq = f.seq;
    }

    /// The show clock (ms), for effects that move (grain).
    pub fn set_time(&mut self, now_ms: u64) {
        self.time = (now_ms % 100_000) as f32 / 1000.0;
    }

    /// Bytes sent to the GPU since last asked.
    pub fn take_upload_bytes(&mut self) -> u64 {
        std::mem::take(&mut self.uploaded)
    }

    /// Forget sources no longer in the show.
    pub fn keep_sources(&mut self, keep: &dyn Fn(&SourceId) -> bool) {
        self.sources.retain(|id, _| keep(id));
        self.vision.retain(|id, _| keep(id));
    }

    /// A small texture of `format` holding `px` (`bpp` bytes a texel).
    fn small_texture(
        &mut self,
        w: u32,
        h: u32,
        format: wgpu::TextureFormat,
        bpp: u32,
        px: &[u8],
    ) -> Option<(wgpu::Texture, wgpu::TextureView)> {
        if w == 0 || h == 0 || px.len() < (w * h * bpp) as usize {
            return None;
        }
        let t = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vision"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        self.write_small(&t, w, h, bpp, px);
        let v = t.create_view(&wgpu::TextureViewDescriptor::default());
        Some((t, v))
    }

    fn write_small(&mut self, t: &wgpu::Texture, w: u32, h: u32, bpp: u32, px: &[u8]) {
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: t,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &px[..(w * h * bpp) as usize],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(w * bpp),
                rows_per_image: Some(h),
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        self.uploaded += u64::from(w * h * bpp);
    }

    /// An input's person mask from the vision worker (`w` × `h`, a byte a
    /// spot; None: no mask now, so its background shows as it is).
    pub fn set_vision_mask(&mut self, id: &SourceId, mask: Option<(u32, u32, &[u8])>) {
        if let Some((w, h, px)) = mask {
            // The same size: the new bytes go into the mask it has.
            let same = self
                .vision
                .get(id)
                .and_then(|v| v.mask.as_ref())
                .filter(|(t, _)| t.width() == w && t.height() == h)
                .map(|(t, _)| t.clone());
            if let Some(t) = same {
                if px.len() >= (w * h) as usize {
                    self.write_small(&t, w, h, 1, px);
                }
                return;
            }
        }
        let made = mask
            .and_then(|(w, h, px)| self.small_texture(w, h, wgpu::TextureFormat::R8Unorm, 1, px));
        if made.is_none() && self.vision.get(id).is_none_or(|v| v.mask.is_none()) {
            return;
        }
        self.update_vision(id, |v| v.mask = made);
    }

    /// The picture behind an input's people (`front`: a virtual set's desk in
    /// front of them): straight-alpha RGBA; None takes it away.
    pub fn set_vision_picture(
        &mut self,
        id: &SourceId,
        front: bool,
        pic: Option<(u32, u32, &[u8])>,
    ) {
        let made = pic.and_then(|(w, h, px)| {
            self.small_texture(w, h, wgpu::TextureFormat::Rgba8Unorm, 4, px)
                .map(|(t, v)| (t, v, w as f32 / h.max(1) as f32))
        });
        self.update_vision(id, |v| {
            if front {
                v.front = made.map(|(t, v, _)| (t, v));
            } else {
                v.back = made;
            }
        });
    }

    /// Everything the vision worker sent for an input goes (it no longer uses the models).
    pub fn forget_vision(&mut self, id: &SourceId) {
        self.vision.remove(id);
    }

    /// What the vision worker has sent for an input: a mask, the picture
    /// behind's shape (width / height), a desk in front.
    pub fn vision_of(&self, id: &SourceId) -> (bool, Option<f32>, bool) {
        self.vision.get(id).map_or((false, None, false), |v| {
            (
                v.mask.is_some(),
                v.back.as_ref().map(|b| b.2),
                v.front.is_some(),
            )
        })
    }

    fn update_vision(&mut self, id: &SourceId, change: impl FnOnce(&mut VisionTex)) {
        let mut v = self.vision.remove(id).unwrap_or_else(|| VisionTex {
            mask: None,
            back: None,
            front: None,
            bind: self.vision_none.clone(),
        });
        change(&mut v);
        v.bind = vision_bind(
            &self.device,
            &self.vision_layout,
            [
                v.mask.as_ref().map_or(&self.white.view, |m| &m.1),
                v.back.as_ref().map_or(&self.clear.view, |b| &b.1),
                v.front.as_ref().map_or(&self.clear.view, |f| &f.1),
            ],
        );
        if v.mask.is_some() || v.back.is_some() || v.front.is_some() {
            self.vision.insert(id.clone(), v);
        }
    }

    /// Size of a source's newest frame on the GPU.
    pub fn source_size(&self, id: &SourceId) -> Option<(u32, u32)> {
        self.sources.get(id).map(|s| (s.tex.w, s.tex.h))
    }

    /// Set (or clear) slot `slot`'s whole-screen `top` plane: straight-alpha
    /// RGBA, top row first (the benchmark and tests; the overlay renderer
    /// sends dirty rectangles through [`Compositor::patch_plane`]).
    pub fn set_overlay(&mut self, slot: usize, frame: Option<(u32, u32, &[u8])>) {
        let Some((w, h, px)) = frame else {
            self.planes
                .retain(|k, _| !(k.slot == slot && k.name == crate::overlay::TOP));
            return;
        };
        if px.len() >= (w * h * 4) as usize {
            self.planes.retain(|k, _| {
                !(k.slot == slot && k.name == crate::overlay::TOP && (k.w, k.h) != (w, h))
            });
            self.patch_plane(slot, crate::overlay::TOP, w, h, &[([0, 0, w, h], px)]);
        }
    }

    /// New pixels for some rectangles of a plane (made, transparent, when new).
    /// Rectangles that don't fit are left out.
    pub fn patch_plane(
        &mut self,
        slot: usize,
        name: &str,
        w: u32,
        h: u32,
        rects: &[([u32; 4], &[u8])],
    ) {
        let id = PlaneId {
            slot,
            name: name.to_owned(),
            w,
            h,
        };
        if !self.planes.contains_key(&id) {
            // New textures start out transparent (wgpu zeroes them).
            let t = make_tex(
                &self.device,
                &self.tex_layout,
                &self.sampler,
                w,
                h,
                wgpu::TextureFormat::Rgba8Unorm,
                false,
                "graphics",
            );
            self.planes.insert(id.clone(), t);
        }
        let Some(t) = self.planes.get(&id) else {
            return;
        };
        for &([x, y, rw, rh], px) in rects {
            let fits = rw > 0
                && rh > 0
                && x.checked_add(rw).is_some_and(|e| e <= t.w)
                && y.checked_add(rh).is_some_and(|e| e <= t.h)
                && px.len() >= (rw as usize) * (rh as usize) * 4;
            if !fits {
                continue;
            }
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &t.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x, y, z: 0 },
                    aspect: wgpu::TextureAspect::All,
                },
                px,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(rw * 4),
                    rows_per_image: Some(rh),
                },
                wgpu::Extent3d {
                    width: rw,
                    height: rh,
                    depth_or_array_layers: 1,
                },
            );
            self.uploaded += u64::from(rw) * u64::from(rh) * 4;
        }
    }

    /// A plane is no longer shown.
    pub fn clear_plane(&mut self, slot: usize, name: &str, w: u32, h: u32) {
        self.planes.remove(&PlaneId {
            slot,
            name: name.to_owned(),
            w,
            h,
        });
    }

    /// Every plane of a slot goes (its renderer started again).
    pub fn reset_planes(&mut self, slot: usize) {
        self.planes.retain(|k, _| k.slot != slot);
    }

    /// Whether slot `slot` has a plane `name` (at any size).
    pub fn has_plane(&self, slot: usize, name: &str) -> bool {
        self.planes.keys().any(|k| k.slot == slot && k.name == name)
    }

    /// Planes held now.
    pub fn plane_count(&self) -> usize {
        self.planes.len()
    }

    /// The plane `name` of `slot` closest in size to `want` pixels.
    fn plane(&self, slot: usize, name: &str, want: (u32, u32)) -> Option<PlaneId> {
        let (w, h) = crate::overlay::closest(
            self.planes
                .keys()
                .filter(|k| k.slot == slot && k.name == name)
                .map(|k| (k.w, k.h)),
            want,
        )?;
        Some(PlaneId {
            slot,
            name: name.to_owned(),
            w,
            h,
        })
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

    /// The draws that paint `scene` on an output of `out_w` × `out_h`, with
    /// the graphics planes of slot `planes` (back to front: the pictures,
    /// dip, flash, the overlay channels, the `top` plane, blank, PANIC and its logo).
    #[allow(clippy::too_many_arguments)]
    fn scene_draws(
        &self,
        scene: &ScreenScene,
        planes: Option<usize>,
        out_w: u32,
        out_h: u32,
        groups: &Groups,
        draws: &mut Vec<(DrawU, TexKey)>,
    ) {
        let out_aspect = out_w as f32 / out_h.max(1) as f32;
        for (i, layer) in scene.layers.iter().enumerate() {
            match groups.get(&(false, i)) {
                Some(t) => self.group_draw(layer, *t, out_w, out_h, draws),
                None => self.layer_draws(layer, planes, scene.plane_prefix, out_w, out_h, draws),
            }
        }
        let solid = |c: [f32; 4], a: f32, draws: &mut Vec<(DrawU, TexKey)>| {
            if a > 0.0 {
                let mut d = DrawU::new();
                d.set(COLOR, c).set(FX, [a, 0.0, 0.0, 0.0]);
                d.0[MISC * 4 + 3] = 1.0;
                draws.push((d, TexKey::White));
            }
        };
        let whole = |slot: usize, name: &str, a: f32, draws: &mut Vec<(DrawU, TexKey)>| {
            if a <= 0.0 {
                return;
            }
            if let Some(id) = self.plane(slot, name, (out_w, out_h)) {
                let mut d = DrawU::new();
                d.set(LUMA, [0.0, 0.0, out_aspect, out_aspect])
                    .set(FX, [a, 0.0, 0.0, 0.0]);
                draws.push((d, TexKey::Plane(id)));
            }
        };
        solid([0.0, 0.0, 0.0, 1.0], scene.black, draws);
        solid([1.0, 1.0, 1.0, 1.0], scene.white, draws);
        for (i, layer) in scene.overlays.iter().enumerate() {
            match groups.get(&(true, i)) {
                Some(t) => self.group_draw(layer, *t, out_w, out_h, draws),
                None => self.layer_draws(layer, planes, scene.plane_prefix, out_w, out_h, draws),
            }
        }
        if let Some(slot) = planes {
            whole(slot, crate::overlay::TOP, 1.0, draws);
        }
        solid([0.0, 0.0, 0.0, 1.0], scene.blank, draws);
        // PANIC: the safe screen — black at once (here, whatever the web
        // renderer is doing), then the event's logo from it.
        solid([0.0, 0.0, 0.0, 1.0], scene.panic, draws);
        if let Some(slot) = planes {
            whole(slot, crate::overlay::PANIC, scene.panic, draws);
        }
    }

    /// A layer drawn whole into scratch target `t` (unmoved, opaque), put on
    /// as one picture with the layer's move, fade, shape, luma wipe and blur.
    fn group_draw(
        &self,
        layer: &Layer,
        t: usize,
        out_w: u32,
        out_h: u32,
        draws: &mut Vec<(DrawU, TexKey)>,
    ) {
        let out_aspect = out_w as f32 / out_h.max(1) as f32;
        let lb = layer_box(layer);
        let lw = (lb[2] - lb[0]) * out_w as f32;
        let lh = (lb[3] - lb[1]) * out_h as f32;
        let mut d = DrawU::new();
        d.set(LAYER, lb).set(DST, lb);
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
        d.set(MISC, [1.0, 1.0, layer_aspect, 2.0]);
        draws.push((d, TexKey::Target(t)));
    }

    /// The draws of one layer (an input with its transition, or an overlay channel).
    fn layer_draws(
        &self,
        layer: &Layer,
        planes: Option<usize>,
        prefix: &str,
        out_w: u32,
        out_h: u32,
        draws: &mut Vec<(DrawU, TexKey)>,
    ) {
        if layer.opacity <= 0.0 {
            return;
        }
        let out_aspect = out_w as f32 / out_h.max(1) as f32;
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
                    if let Some(look) = &pl.look {
                        for (k, v) in look.uniforms(self.time).into_iter().enumerate() {
                            d.set(LOOK + k, v);
                        }
                    }
                    if let Some(b) = &pl.backdrop {
                        // As the processor: on once a mask came (a picture
                        // behind also with a green screen's edge alone), and a
                        // picture behind only once it is there.
                        let (mask, back, front) = self.vision_of(id);
                        let keyed = pl.look.is_some_and(|l| l.key.is_some());
                        let on = if b.mode > 2.5 {
                            back.is_some() && (mask || keyed)
                        } else {
                            mask
                        };
                        if on {
                            d.set(BG, [b.mode, b.blur, b.edge, f32::from(u8::from(mask))]);
                            d.set(
                                BG2,
                                [
                                    back.unwrap_or(16.0 / 9.0),
                                    f32::from(u8::from(front)),
                                    0.0,
                                    0.0,
                                ],
                            );
                        }
                    }
                    draws.push((d, TexKey::Source(id.clone())));
                }
                Content::Graphic(id) => {
                    // Drawn by the web renderer at the size it is shown (the
                    // layer's own box, before a slide or zoom moved it).
                    let Some(slot) = planes else { continue };
                    let f = pic.placement.frame;
                    let want = (
                        ((f[2] - f[0]) * out_w as f32).round().max(1.0) as u32,
                        ((f[3] - f[1]) * out_h as f32).round().max(1.0) as u32,
                    );
                    let Some(plane) = self.plane(
                        slot,
                        &format!("{prefix}{}", crate::overlay::graphic_plane(id.as_str())),
                        want,
                    ) else {
                        continue;
                    };
                    let (qw, qh) = (
                        (frame[2] - frame[0]) * out_w as f32,
                        (frame[3] - frame[1]) * out_h as f32,
                    );
                    d.set(DST, frame);
                    d.set(MISC, [1.0, 1.0, if qh > 0.0 { qw / qh } else { 1.0 }, 0.0]);
                    draws.push((d, TexKey::Plane(plane)));
                }
            }
        }
    }

    fn dest_bpp(&self, dest: Dest) -> u32 {
        match dest {
            Dest::Target(i) => self
                .targets
                .get(i)
                .and_then(Option::as_ref)
                .map_or(4, |t| bytes_per_texel(t.format)),
            Dest::Atlas => 4,
        }
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
        let mut scratch = SCRATCH;
        for p in passes {
            let Some((tw, th)) = self.dest_size(p.dest) else {
                continue;
            };
            let (w, h) = p.viewport.map_or((tw, th), |v| (v[2], v[3]));
            let mut draws = Vec::new();
            match &p.paint {
                Paint::Scene { scene, planes } => {
                    // Layers faded as a whole: drawn into scratch targets first.
                    let mut groups = Groups::new();
                    for (overlay, list) in [(false, &scene.layers), (true, &scene.overlays)] {
                        for (i, l) in list.iter().enumerate().filter(|(_, l)| needs_group(l)) {
                            let t = scratch;
                            scratch += 1;
                            self.ensure_target(t, w, h);
                            let whole = Layer {
                                opacity: 1.0,
                                blur: 0.0,
                                shape: Shape::Whole,
                                luma: None,
                                shift: [0.0, 0.0],
                                scale: 1.0,
                                ..l.clone()
                            };
                            let mut d = Vec::new();
                            self.layer_draws(&whole, *planes, scene.plane_prefix, w, h, &mut d);
                            plan.push((Dest::Target(t), None, d));
                            groups.insert((overlay, i), t);
                        }
                    }
                    self.scene_draws(scene, *planes, w, h, &groups, &mut draws)
                }
                Paint::Target(i) => {
                    let mut d = DrawU::new();
                    d.0[MISC * 4 + 3] = 2.0;
                    draws.push((d, TexKey::Target(*i)));
                }
                Paint::Solid(c) => {
                    let mut d = DrawU::new();
                    d.set(COLOR, *c);
                    d.0[MISC * 4 + 3] = 1.0;
                    draws.push((d, TexKey::White));
                }
                Paint::Nv12(src) => {
                    draws.push((DrawU::new(), TexKey::Target(*src)));
                }
                Paint::Plane { slot, name } => {
                    if let Some(id) = self.plane(*slot, name, (w, h)) {
                        draws.push((DrawU::new(), TexKey::Plane(id)));
                    }
                }
                Paint::Vertical { src, small } => {
                    let (sw, sh) = self.dest_size(Dest::Target(*src)).unwrap_or((16, 9));
                    let (ow, oh) = (w as f32, h as f32);
                    // Behind: the tiny copy, stretched to the frame's height (a cheap, smooth blur).
                    let cw = oh * sw as f32 / sh as f32 / ow;
                    let mut d = DrawU::new();
                    d.set(DST, [0.5 - cw / 2.0, 0.0, 0.5 + cw / 2.0, 1.0]);
                    d.0[MISC * 4 + 3] = 2.0;
                    draws.push((d, TexKey::Target(*small)));
                    let mut dark = DrawU::new();
                    dark.set(COLOR, [0.0, 0.0, 0.0, 1.0])
                        .set(FX, [0.45, 0.0, 0.0, 0.0]);
                    dark.0[MISC * 4 + 3] = 1.0;
                    draws.push((dark, TexKey::White));
                    // In front: the whole picture, nothing cut off.
                    let k = (ow / sw as f32).min(oh / sh as f32);
                    let (fw, fh) = (sw as f32 * k / ow, sh as f32 * k / oh);
                    let mut d = DrawU::new();
                    d.set(
                        DST,
                        [
                            (1.0 - fw) / 2.0,
                            (1.0 - fh) / 2.0,
                            (1.0 + fw) / 2.0,
                            (1.0 + fh) / 2.0,
                        ],
                    );
                    d.0[MISC * 4 + 3] = 2.0;
                    draws.push((d, TexKey::Target(*src)));
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
        let nv12_pipe = plan
            .iter()
            .any(|(d, _, _)| self.dest_bpp(*d) == 1)
            .then(|| self.pipeline(NV12_FORMAT));
        let surface_pipe = surface.map(|(_, f)| self.pipeline(f));
        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("frame"),
            });
        let mut n = 0u64;
        for (dest, viewport, draws) in &plan {
            let (view, size, nv12) = match (dest, surface) {
                (Dest::Target(usize::MAX), Some((v, _))) => (v, None, false),
                (Dest::Target(i), _) => match self.targets.get(*i).and_then(Option::as_ref) {
                    Some(t) => (&t.view, Some((t.w, t.h)), t.format == NV12_FORMAT),
                    None => continue,
                },
                (Dest::Atlas, _) => match &self.atlas {
                    Some(t) => (&t.view, Some((t.w, t.h)), false),
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
                            wgpu::LoadOp::Clear(
                                if matches!(dest, Dest::Target(i) if *i >= SCRATCH) {
                                    wgpu::Color::TRANSPARENT
                                } else {
                                    wgpu::Color::BLACK
                                },
                            )
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
            } else if nv12 {
                nv12_pipe.as_ref().unwrap_or(&target_pipe)
            } else {
                &target_pipe
            };
            rp.set_pipeline(pipe);
            rp.set_bind_group(2, &self.vision_none, &[]);
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
                    TexKey::Plane(id) => self.planes.get(id).map(|t| &t.bind),
                };
                let offset = (n * self.align) as u32;
                n += 1;
                let Some(bind) = bind else { continue };
                rp.set_bind_group(0, &self.draw_bind, &[offset]);
                rp.set_bind_group(1, bind, &[]);
                if let TexKey::Source(id) = key {
                    let v = self.vision.get(id).map_or(&self.vision_none, |v| &v.bind);
                    rp.set_bind_group(2, v, &[]);
                } else {
                    rp.set_bind_group(2, &self.vision_none, &[]);
                }
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
    fn read_buffer(&self, w: u32, h: u32, bpp: u32) -> wgpu::Buffer {
        let row = (w * bpp).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
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
        let bpp = bytes_per_texel(t.format);
        if buffer.size()
            < u64::from((w * bpp).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT))
                * u64::from(h)
        {
            return Err("The read-back buffer is too small.".into());
        }
        let row = (w * bpp).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
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
            bpp,
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
        let (w, h, bpp) = (p.w, p.h, p.bpp as usize);
        let row = (w as usize * bpp).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize);
        let mut px = Vec::with_capacity(w as usize * h as usize * bpp);
        {
            let slice = p.buffer.slice(..);
            let mapped = slice.get_mapped_range().map_err(|e| e.to_string())?;
            for y in 0..h as usize {
                let start = y * row;
                px.extend_from_slice(&mapped[start..start + w as usize * bpp]);
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
        let bpp = self.dest_bpp(dest);
        let buffer = match self.reads.get(&(w * bpp, h)) {
            Some(b) => b.clone(),
            None => {
                let b = self.read_buffer(w, h, bpp);
                self.reads.insert((w * bpp, h), b.clone());
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
        let bpp = self.dest_bpp(dest);
        if self.rings.get(&dest).is_none_or(|r| r.size != size) {
            let buffers = vec![
                self.read_buffer(size.0, size.1, bpp),
                self.read_buffer(size.0, size.1, bpp),
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

    /// Copy target `i` into `dest` (same size and format: a zero-copy
    /// encoder's ring, [`crate::zerocopy`]) and submit it. False when the
    /// target doesn't exist or the sizes differ.
    pub fn copy_target_to(&mut self, i: usize, dest: &wgpu::Texture) -> bool {
        let Some(t) = self.targets.get(i).and_then(Option::as_ref) else {
            return false;
        };
        if (t.w, t.h) != (dest.width(), dest.height()) || t.format != dest.format() {
            return false;
        }
        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("zero-copy"),
            });
        enc.copy_texture_to_texture(
            t.texture.as_image_copy(),
            dest.as_image_copy(),
            wgpu::Extent3d {
                width: t.w,
                height: t.h,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([enc.finish()]);
        true
    }

    /// Read any RGBA texture of `size` back (the zero-copy stand-in). Waits for the GPU.
    ///
    /// # Errors
    /// The GPU failed.
    pub fn read_texture(&mut self, tex: &wgpu::Texture, size: (u32, u32)) -> Result<Vec<u8>, String> {
        let buffer = match self.reads.get(&(size.0 * 4, size.1)) {
            Some(b) => b.clone(),
            None => {
                let b = self.read_buffer(size.0, size.1, 4);
                self.reads.insert((size.0 * 4, size.1), b.clone());
                b
            }
        };
        let row = (size.0 * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("read"),
            });
        enc.copy_texture_to_buffer(
            tex.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: Some(size.1),
                },
            },
            wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([enc.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        self.finish_read(Pending {
            buffer,
            rx,
            w: size.0,
            h: size.1,
            bpp: 4,
        })
        .map(|(_, _, px)| px)
    }

    /// Wait until the GPU has finished everything submitted (benchmarks).
    pub fn finish(&self) {
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
    }
}
