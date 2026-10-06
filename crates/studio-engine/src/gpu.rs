//! Runs a frame's passes on the GPU with wgpu (Direct3D 12 on Windows).
//!
//! Textures are laid out as WebGL lays them out (the translated vertex stage
//! turns Y over), targets are half-float like the WebGL compositor's, and
//! blending is off: every pass writes its result, as there.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Arc;

use crate::glsl::{self, Layout, TexDim};
use crate::plan::{Frame, Message, TexRef, UploadKind};
use crate::yuv;

/// The format of the frames being built (as WebGL's RGBA16F targets).
pub const TARGET_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const PICTURE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// How a program's vertices come.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VertexKind {
    /// A quad over the whole target (aPos: vec2).
    Full,
    /// The placed picture's corners (aPos: vec4, aUv: vec2).
    Layer,
}

/// One of the editor's programs (as it sent it).
#[derive(Debug, Clone)]
pub struct ProgramSource {
    pub name: String,
    pub vertex: VertexKind,
    pub vs: String,
    pub fs: String,
}

struct Pipe {
    pipeline: wgpu::RenderPipeline,
    bgl: wgpu::BindGroupLayout,
    layout: Layout,
}

struct Tex {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    w: u32,
    h: u32,
}

struct VideoTex {
    y: Tex,
    uv: Tex,
    rgba: Tex,
    conv: wgpu::Buffer,
    bind: wgpu::BindGroup,
    id: (u64, u64),
}

/// Where a frame goes.
pub enum Output<'a> {
    /// Shown: drawn over the background into a window's picture, stretched to fit it.
    View(&'a wgpu::TextureView, wgpu::TextureFormat),
    /// Read back as RGBA bytes (top row first), as the WebGL compositor's `readFrame`.
    Read,
}

pub struct Gpu {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    sampler: wgpu::Sampler,
    sources: HashMap<String, ProgramSource>,
    pipes: HashMap<(String, wgpu::TextureFormat), Arc<Pipe>>,
    /// Programs that didn't translate (frames using them are drawn by the editor).
    pub broken: HashMap<String, String>,
    size: (u32, u32),
    targets: Vec<Option<Tex>>,
    uploads: HashMap<String, Tex>,
    videos: HashMap<String, VideoTex>,
    empty2d: Tex,
    empty3d: Tex,
    full: wgpu::Buffer,
    uniforms: Option<wgpu::Buffer>,
    vertices: Option<wgpu::Buffer>,
    nv12: (wgpu::RenderPipeline, wgpu::BindGroupLayout),
    read: Option<(Tex, wgpu::Buffer)>,
    align: usize,
}

fn make_tex(
    device: &wgpu::Device,
    w: u32,
    h: u32,
    d: u32,
    format: wgpu::TextureFormat,
    render: bool,
    label: &str,
) -> Tex {
    let usage = wgpu::TextureUsages::TEXTURE_BINDING
        | wgpu::TextureUsages::COPY_DST
        | if render {
            wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC
        } else {
            wgpu::TextureUsages::empty()
        };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: d.max(1),
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: if d > 0 {
            wgpu::TextureDimension::D3
        } else {
            wgpu::TextureDimension::D2
        },
        format,
        usage,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    Tex {
        texture,
        view,
        w,
        h,
    }
}

fn write(queue: &wgpu::Queue, t: &Tex, data: &[u8], bytes_per_px: u32, depth: u32) {
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
            bytes_per_row: Some(t.w * bytes_per_px),
            rows_per_image: Some(t.h),
        },
        wgpu::Extent3d {
            width: t.w,
            height: t.h,
            depth_or_array_layers: depth.max(1),
        },
    );
}

/// Premultiply straight RGBA, as WebGL does with `UNPACK_PREMULTIPLY_ALPHA_WEBGL`.
pub fn premultiply(px: &mut [u8]) {
    for p in px.as_chunks_mut::<4>().0 {
        let a = u16::from(p[3]);
        if a < 255 {
            for c in &mut p[..3] {
                *c = ((u16::from(*c) * a + 127) / 255) as u8;
            }
        }
    }
}

/// A graphics card the engine could use, for the system check.
#[derive(Debug, Clone)]
pub struct AdapterSummary {
    pub name: String,
    /// "discrete", "integrated", "software", "virtual" or "other".
    pub kind: &'static str,
    pub backend: String,
}

/// Every graphics card the engine's graphics APIs offer (Direct3D 12 on Windows). Nothing is started.
pub fn adapters() -> Vec<AdapterSummary> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all()))
        .iter()
        .map(|a| {
            let i = a.get_info();
            AdapterSummary {
                kind: match i.device_type {
                    wgpu::DeviceType::DiscreteGpu => "discrete",
                    wgpu::DeviceType::IntegratedGpu => "integrated",
                    wgpu::DeviceType::Cpu => "software",
                    wgpu::DeviceType::VirtualGpu => "virtual",
                    wgpu::DeviceType::Other => "other",
                },
                backend: format!("{:?}", i.backend),
                name: i.name,
            }
        })
        .collect()
}

impl Gpu {
    /// Find a graphics card (one that can show in `surface`, when given) and start it.
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
        .map_err(|e| format!("No graphics card for native playback: {e}"))?;
        let limits = wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits());
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("lumora-native-view"),
            required_features: wgpu::Features::empty(),
            required_limits: limits,
            ..Default::default()
        }))
        .map_err(|e| format!("The graphics card could not start: {e}"))?;
        // A mistake on the GPU is reported, never a crash.
        device.on_uncaptured_error(Arc::new(|e| eprintln!("native view: {e}")));
        let align = device.limits().min_uniform_buffer_offset_alignment as usize;
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("linear-clamp"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let empty2d = make_tex(&device, 1, 1, 0, PICTURE_FORMAT, false, "empty");
        write(&queue, &empty2d, &[0, 0, 0, 0], 4, 1);
        let empty3d = make_tex(&device, 1, 1, 1, PICTURE_FORMAT, false, "empty-3d");
        write(&queue, &empty3d, &[0, 0, 0, 0], 4, 1);
        let full = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("full-quad"),
            size: 32,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let quad: [f32; 8] = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];
        queue.write_buffer(&full, 0, &f32_bytes(&quad));
        let nv12 = nv12_pipeline(&device);
        Ok(Self {
            instance,
            adapter,
            device,
            queue,
            sampler,
            sources: HashMap::new(),
            pipes: HashMap::new(),
            broken: HashMap::new(),
            size: (0, 0),
            targets: Vec::new(),
            uploads: HashMap::new(),
            videos: HashMap::new(),
            empty2d,
            empty3d,
            full,
            uniforms: None,
            vertices: None,
            nv12,
            read: None,
            align: align.max(16),
        })
    }

    /// Which graphics card and API.
    pub fn describe(&self) -> String {
        let i = self.adapter.get_info();
        format!("{} ({:?})", i.name, i.backend)
    }

    /// Learn the editor's programs (translated when first used).
    pub fn set_programs(&mut self, programs: Vec<ProgramSource>) {
        self.pipes.clear();
        self.broken.clear();
        self.sources = programs.into_iter().map(|p| (p.name.clone(), p)).collect();
    }

    pub fn has_program(&self, name: &str) -> bool {
        self.sources.contains_key(name)
    }

    /// Translate and build a program now (so a frame never waits for it; and to find ones that fail).
    ///
    /// # Errors
    /// The program doesn't translate.
    pub fn prepare(&mut self, name: &str, format: wgpu::TextureFormat) -> Result<(), String> {
        self.pipe(name, format).map(|_| ())
    }

    fn pipe(&mut self, name: &str, format: wgpu::TextureFormat) -> Result<Arc<Pipe>, String> {
        if let Some(p) = self.pipes.get(&(name.to_owned(), format)) {
            return Ok(p.clone());
        }
        if let Some(e) = self.broken.get(name) {
            return Err(e.clone());
        }
        let src = self
            .sources
            .get(name)
            .ok_or_else(|| format!("The program {name} is not known."))?
            .clone();
        let built = build_pipe(&self.device, &src, format);
        match built {
            Ok(p) => {
                let p = Arc::new(p);
                self.pipes.insert((name.to_owned(), format), p.clone());
                Ok(p)
            }
            Err(e) => {
                let e = format!("{name}: {e}");
                self.broken.insert(name.to_owned(), e.clone());
                Err(e)
            }
        }
    }

    /// New pictures in, old ones out.
    pub fn apply_uploads(&mut self, m: &Message) {
        for id in &m.frame.free {
            self.uploads.remove(id);
        }
        for u in &m.frame.uploads {
            let data = m.data(u);
            let tex = make_tex(
                &self.device,
                u.w,
                u.h,
                u.d,
                PICTURE_FORMAT,
                false,
                "picture",
            );
            match u.kind {
                UploadKind::Raw => write(&self.queue, &tex, data, 4, u.d),
                UploadKind::Straight => {
                    let mut px = data.to_vec();
                    premultiply(&mut px);
                    write(&self.queue, &tex, &px, 4, u.d);
                }
                UploadKind::Alpha => {
                    let px: Vec<u8> = data.iter().flat_map(|&a| [a, a, a, a]).collect();
                    write(&self.queue, &tex, &px, 4, u.d);
                }
            }
            self.uploads.insert(u.id.clone(), tex);
        }
    }

    pub fn has_upload(&self, id: &str) -> bool {
        self.uploads.contains_key(id)
    }

    pub fn upload_count(&self) -> usize {
        self.uploads.len()
    }

    /// Forget every picture and video frame (the editor sends them again).
    pub fn forget(&mut self) {
        self.uploads.clear();
        self.videos.clear();
    }

    /// A decoded frame (NV12) made into the clip's RGBA picture, unless it is already there.
    pub fn video(
        &mut self,
        key: &str,
        id: (u64, u64),
        w: u32,
        h: u32,
        nv12: &[u8],
        matrix: yuv::Matrix,
    ) {
        if nv12.len() < yuv::nv12_len(w, h) {
            return;
        }
        let fresh = self
            .videos
            .get(key)
            .is_none_or(|v| v.rgba.w != w || v.rgba.h != h);
        if fresh {
            let y = make_tex(
                &self.device,
                w,
                h,
                0,
                wgpu::TextureFormat::R8Unorm,
                false,
                "luma",
            );
            let uv = make_tex(
                &self.device,
                w.div_ceil(2),
                h.div_ceil(2),
                0,
                wgpu::TextureFormat::Rg8Unorm,
                false,
                "chroma",
            );
            let rgba = make_tex(&self.device, w, h, 0, PICTURE_FORMAT, true, "video");
            let conv = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("yuv"),
                size: 64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("yuv"),
                layout: &self.nv12.1,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: conv.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::TextureView(&y.view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: wgpu::BindingResource::TextureView(&uv.view),
                    },
                ],
            });
            self.videos.insert(
                key.to_owned(),
                VideoTex {
                    y,
                    uv,
                    rgba,
                    conv,
                    bind,
                    id: (u64::MAX, u64::MAX),
                },
            );
        }
        let Some(v) = self.videos.get_mut(key) else {
            return;
        };
        if v.id == id {
            return;
        }
        v.id = id;
        let (wy, hy) = (w as usize, h as usize);
        write(&self.queue, &v.y, &nv12[..wy * hy], 1, 1);
        let uv_len = v.uv.w as usize * v.uv.h as usize * 2;
        write(&self.queue, &v.uv, &nv12[wy * hy..wy * hy + uv_len], 2, 1);
        let m = yuv::yuv_to_rgb(matrix, false);
        let mut c = Vec::with_capacity(16);
        for row in m {
            c.extend_from_slice(&row);
        }
        c.extend_from_slice(&[w as f32, h as f32, 0.0, 0.0]);
        self.queue.write_buffer(&v.conv, 0, &f32_bytes(&c));
        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("yuv") });
        {
            let mut rp = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("yuv"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &v.rgba.view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            rp.set_pipeline(&self.nv12.0);
            rp.set_bind_group(0, &v.bind, &[]);
            rp.draw(0..3, 0..1);
        }
        self.queue.submit([enc.finish()]);
    }

    /// Forget clips' pictures that aren't in use.
    pub fn keep_videos(&mut self, keys: &[&str]) {
        self.videos.retain(|k, _| keys.contains(&k.as_str()));
    }

    fn ensure_targets(&mut self, w: u32, h: u32, count: usize) {
        if self.size != (w, h) {
            self.targets.clear();
            self.size = (w, h);
        }
        if self.targets.len() < count {
            self.targets.resize_with(count, || None);
        }
        for t in self.targets.iter_mut().take(count) {
            if t.is_none() {
                *t = Some(make_tex(
                    &self.device,
                    w,
                    h,
                    0,
                    TARGET_FORMAT,
                    true,
                    "target",
                ));
            }
        }
    }

    /// The programs a frame uses that can't run here (empty: it can be drawn).
    pub fn check(&mut self, frame: &Frame) -> Vec<String> {
        let mut bad = Vec::new();
        for p in &frame.passes {
            if p.k != 1 {
                continue;
            }
            let name = p.p.as_deref().unwrap_or("");
            if let Err(e) = self.pipe(name, TARGET_FORMAT) {
                if !bad.contains(&e) {
                    bad.push(e);
                }
            }
        }
        bad
    }

    /// Draw a frame (its uploads already applied, its videos already in).
    ///
    /// # Errors
    /// A program that doesn't run, or a picture that isn't here.
    pub fn render(&mut self, frame: &Frame, out: Output<'_>) -> Result<Option<Vec<u8>>, String> {
        let (w, h) = (frame.w, frame.h);
        let count = frame
            .passes
            .iter()
            .map(|p| p.t as usize + 1)
            .chain(frame.out.map(|t| t as usize + 1))
            .max()
            .unwrap_or(0);
        let reads = frame
            .passes
            .iter()
            .flat_map(|p| p.x.values())
            .filter_map(|x| match TexRef::parse(x) {
                Ok(TexRef::Target(t)) => Some(t as usize + 1),
                _ => None,
            })
            .max()
            .unwrap_or(0);
        self.ensure_targets(w, h, count.max(reads).max(1));

        // Every pass's uniforms in one buffer (each at an aligned offset), and the placed corners in another.
        struct Step {
            pipe: Option<Arc<Pipe>>,
            offset: u32,
            vertex: Option<u64>,
        }
        let mut block = Vec::<u8>::new();
        let mut verts = Vec::<f32>::new();
        let mut steps = Vec::with_capacity(frame.passes.len() + 1);
        for p in &frame.passes {
            if p.k == 0 {
                steps.push(Step {
                    pipe: None,
                    offset: 0,
                    vertex: None,
                });
                continue;
            }
            let pipe = self.pipe(p.p.as_deref().unwrap_or(""), TARGET_FORMAT)?;
            let offset = push_block(&mut block, &pipe.layout, &p.u, self.align);
            let vertex = p.q.as_ref().map(|q| {
                let at = (verts.len() * 4) as u64;
                verts.extend_from_slice(q);
                at
            });
            steps.push(Step {
                pipe: Some(pipe),
                offset,
                vertex,
            });
        }
        // The last step: the frame over the background, into the window or a picture to read.
        let (final_name, final_format, uniforms) = match &out {
            Output::View(_, f) => (
                "final",
                *f,
                HashMap::from([
                    ("uBack".to_owned(), frame.background.to_vec()),
                    ("uFlip".to_owned(), vec![1.0]),
                    ("uSize".to_owned(), vec![w as f32, h as f32]),
                ]),
            ),
            Output::Read => (
                "out",
                PICTURE_FORMAT,
                HashMap::from([
                    ("uBack".to_owned(), frame.background.to_vec()),
                    ("uAlpha".to_owned(), vec![0.0]),
                    ("uSize".to_owned(), vec![w as f32, h as f32]),
                ]),
            ),
        };
        let last = self.pipe(final_name, final_format)?;
        let last_offset = push_block(&mut block, &last.layout, &uniforms, self.align);

        let ubuf = grow(
            &self.device,
            &mut self.uniforms,
            block.len().max(256) as u64,
            wgpu::BufferUsages::UNIFORM,
            "uniforms",
        );
        self.queue.write_buffer(&ubuf, 0, &block);
        let vbuf = grow(
            &self.device,
            &mut self.vertices,
            (verts.len() * 4).max(96) as u64,
            wgpu::BufferUsages::VERTEX,
            "corners",
        );
        if !verts.is_empty() {
            self.queue.write_buffer(&vbuf, 0, &f32_bytes(&verts));
        }

        if let Output::Read = out {
            let fresh = self.read.as_ref().is_none_or(|(t, _)| t.w != w || t.h != h);
            if fresh {
                let t = make_tex(&self.device, w, h, 0, PICTURE_FORMAT, true, "read");
                let row = (w * 4).div_ceil(256) * 256;
                let b = self.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("read"),
                    size: u64::from(row) * u64::from(h),
                    usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    mapped_at_creation: false,
                });
                self.read = Some((t, b));
            }
        }

        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("frame"),
            });
        for (p, s) in frame.passes.iter().zip(&steps) {
            let target = &self.targets[p.t as usize]
                .as_ref()
                .ok_or("A target is missing.")?
                .view;
            match &s.pipe {
                None => {
                    let c = p.c.unwrap_or([0.0; 4]);
                    let _ = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("clear"),
                        color_attachments: &[Some(attachment(
                            target,
                            wgpu::LoadOp::Clear(wgpu::Color {
                                r: f64::from(c[0]),
                                g: f64::from(c[1]),
                                b: f64::from(c[2]),
                                a: f64::from(c[3]),
                            }),
                        ))],
                        ..Default::default()
                    });
                }
                Some(pipe) => {
                    let views = self.bind_views(pipe, &p.x, frame)?;
                    let bind = self.bind_group(pipe, &ubuf, &views);
                    let mut rp = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: p.p.as_deref(),
                        color_attachments: &[Some(attachment(target, wgpu::LoadOp::Load))],
                        ..Default::default()
                    });
                    rp.set_pipeline(&pipe.pipeline);
                    let dynamic: Vec<u32> = if pipe.layout.block_size > 0 {
                        vec![s.offset]
                    } else {
                        vec![]
                    };
                    rp.set_bind_group(0, &bind, &dynamic);
                    match s.vertex {
                        Some(at) => rp.set_vertex_buffer(0, vbuf.slice(at..at + 96)),
                        None => rp.set_vertex_buffer(0, self.full.slice(..)),
                    }
                    rp.draw(0..4, 0..1);
                }
            }
        }
        // The finished frame.
        let input: HashMap<String, String> = HashMap::from([(
            "uTex".to_owned(),
            frame
                .out
                .map_or_else(|| "e".to_owned(), |t| format!("t{t}")),
        )]);
        let views = self.bind_views(&last, &input, frame)?;
        let bind = self.bind_group(&last, &ubuf, &views);
        let read_view = self.read.as_ref().map(|(t, _)| t.view.clone());
        let dest = match &out {
            Output::View(v, _) => (*v).clone(),
            Output::Read => read_view.ok_or("Nothing to read into.")?,
        };
        {
            let mut rp = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(final_name),
                color_attachments: &[Some(attachment(
                    &dest,
                    wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                ))],
                ..Default::default()
            });
            rp.set_pipeline(&last.pipeline);
            let dynamic: Vec<u32> = if last.layout.block_size > 0 {
                vec![last_offset]
            } else {
                vec![]
            };
            rp.set_bind_group(0, &bind, &dynamic);
            rp.set_vertex_buffer(0, self.full.slice(..));
            rp.draw(0..4, 0..1);
        }
        let row = (w * 4).div_ceil(256) * 256;
        if let (Output::Read, Some((t, b))) = (&out, &self.read) {
            enc.copy_texture_to_buffer(
                wgpu::TexelCopyTextureInfo {
                    texture: &t.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyBufferInfo {
                    buffer: b,
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
        }
        self.queue.submit([enc.finish()]);
        if let (Output::Read, Some((_, b))) = (&out, &self.read) {
            let slice = b.slice(..);
            let (tx, rx) = std::sync::mpsc::channel();
            slice.map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx.send(r);
            });
            let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
            rx.recv()
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            let mapped = slice.get_mapped_range().map_err(|e| e.to_string())?;
            let mut px = Vec::with_capacity((w * h * 4) as usize);
            for y in 0..h as usize {
                let start = y * row as usize;
                px.extend_from_slice(&mapped[start..start + (w * 4) as usize]);
            }
            drop(mapped);
            b.unmap();
            return Ok(Some(px));
        }
        Ok(None)
    }

    fn bind_views(
        &self,
        pipe: &Pipe,
        x: &HashMap<String, String>,
        frame: &Frame,
    ) -> Result<Vec<wgpu::TextureView>, String> {
        let mut views = Vec::with_capacity(pipe.layout.textures.len());
        for slot in &pipe.layout.textures {
            let empty = if slot.dim == TexDim::D3 {
                &self.empty3d
            } else {
                &self.empty2d
            };
            let r = x
                .get(&slot.name)
                .map(|s| TexRef::parse(s))
                .transpose()?
                .unwrap_or(TexRef::Empty);
            let view = match r {
                TexRef::Empty => &empty.view,
                TexRef::Target(t) => {
                    &self
                        .targets
                        .get(t as usize)
                        .and_then(Option::as_ref)
                        .ok_or("A target is missing.")?
                        .view
                }
                TexRef::Video(i) => {
                    let key = &frame.videos.get(i).ok_or("A video is missing.")?.key;
                    self.videos.get(key).map_or(&empty.view, |v| &v.rgba.view)
                }
                TexRef::Upload(id) => {
                    &self
                        .uploads
                        .get(&id)
                        .ok_or_else(|| format!("missing picture {id}"))?
                        .view
                }
            };
            views.push(view.clone());
        }
        Ok(views)
    }

    fn bind_group(
        &self,
        pipe: &Pipe,
        ubuf: &wgpu::Buffer,
        views: &[wgpu::TextureView],
    ) -> wgpu::BindGroup {
        let mut entries = Vec::with_capacity(views.len() + 2);
        if pipe.layout.block_size > 0 {
            entries.push(wgpu::BindGroupEntry {
                binding: glsl::UNIFORM_BINDING,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: ubuf,
                    offset: 0,
                    size: wgpu::BufferSize::new(pipe.layout.block_size as u64),
                }),
            });
        }
        if !views.is_empty() {
            entries.push(wgpu::BindGroupEntry {
                binding: glsl::SAMPLER_BINDING,
                resource: wgpu::BindingResource::Sampler(&self.sampler),
            });
        }
        for (slot, view) in pipe.layout.textures.iter().zip(views) {
            entries.push(wgpu::BindGroupEntry {
                binding: slot.binding,
                resource: wgpu::BindingResource::TextureView(view),
            });
        }
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &pipe.bgl,
            entries: &entries,
        })
    }
}

fn attachment(
    view: &wgpu::TextureView,
    load: wgpu::LoadOp<wgpu::Color>,
) -> wgpu::RenderPassColorAttachment<'_> {
    wgpu::RenderPassColorAttachment {
        view,
        depth_slice: None,
        resolve_target: None,
        ops: wgpu::Operations {
            load,
            store: wgpu::StoreOp::Store,
        },
    }
}

fn grow(
    device: &wgpu::Device,
    slot: &mut Option<wgpu::Buffer>,
    size: u64,
    usage: wgpu::BufferUsages,
    label: &str,
) -> wgpu::Buffer {
    if let Some(b) = slot {
        if b.size() >= size {
            return b.clone();
        }
    }
    let b = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: size.next_power_of_two(),
        usage: usage | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    *slot = Some(b.clone());
    b
}

/// Add one pass's uniform block at the next aligned offset.
fn push_block(
    block: &mut Vec<u8>,
    layout: &Layout,
    values: &HashMap<String, Vec<f32>>,
    align: usize,
) -> u32 {
    if layout.block_size == 0 {
        return 0;
    }
    let at = block.len().div_ceil(align) * align;
    block.resize(at + layout.block_size, 0);
    for (name, v) in values {
        layout.put(&mut block[at..at + layout.block_size], name, v);
    }
    at as u32
}

fn f32_bytes(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn build_pipe(
    device: &wgpu::Device,
    src: &ProgramSource,
    format: wgpu::TextureFormat,
) -> Result<Pipe, String> {
    let c = glsl::convert(&src.vs, &src.fs)?;
    let vm = glsl::module(&c.vertex, glsl::Stage::Vertex)?;
    let fm = glsl::module(&c.fragment, glsl::Stage::Fragment)?;
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let vs = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(&src.name),
        source: wgpu::ShaderSource::Naga(Cow::Owned(vm)),
    });
    let fs = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(&src.name),
        source: wgpu::ShaderSource::Naga(Cow::Owned(fm)),
    });
    let vis = wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT;
    let mut entries = Vec::new();
    if c.layout.block_size > 0 {
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: glsl::UNIFORM_BINDING,
            visibility: vis,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: true,
                min_binding_size: wgpu::BufferSize::new(c.layout.block_size as u64),
            },
            count: None,
        });
    }
    if !c.layout.textures.is_empty() {
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: glsl::SAMPLER_BINDING,
            visibility: vis,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            count: None,
        });
    }
    for t in &c.layout.textures {
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: t.binding,
            visibility: vis,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: if t.dim == TexDim::D3 {
                    wgpu::TextureViewDimension::D3
                } else {
                    wgpu::TextureViewDimension::D2
                },
                multisampled: false,
            },
            count: None,
        });
    }
    let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some(&src.name),
        entries: &entries,
    });
    let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(&src.name),
        bind_group_layouts: &[Some(&bgl)],
        immediate_size: 0,
    });
    let full_attrs = [wgpu::VertexAttribute {
        format: wgpu::VertexFormat::Float32x2,
        offset: 0,
        shader_location: 0,
    }];
    let layer_attrs = [
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x4,
            offset: 0,
            shader_location: 0,
        },
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x2,
            offset: 16,
            shader_location: 1,
        },
    ];
    let buffers = [Some(match src.vertex {
        VertexKind::Full => wgpu::VertexBufferLayout {
            array_stride: 8,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &full_attrs,
        },
        VertexKind::Layer => wgpu::VertexBufferLayout {
            array_stride: 24,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &layer_attrs,
        },
    })];
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(&src.name),
        layout: Some(&pl),
        vertex: wgpu::VertexState {
            module: &vs,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            buffers: &buffers,
        },
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleStrip,
            ..Default::default()
        },
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: &fs,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    });
    if let Some(e) = pollster::block_on(scope.pop()) {
        return Err(e.to_string());
    }
    Ok(Pipe {
        pipeline,
        bgl,
        layout: c.layout,
    })
}

fn nv12_pipeline(device: &wgpu::Device) -> (wgpu::RenderPipeline, wgpu::BindGroupLayout) {
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("nv12"),
        source: wgpu::ShaderSource::Wgsl(yuv::NV12_WGSL.into()),
    });
    let vis = wgpu::ShaderStages::FRAGMENT;
    let tex = |binding| wgpu::BindGroupLayoutEntry {
        binding,
        visibility: vis,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    };
    let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("nv12"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: vis,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: vis,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
            tex(2),
            tex(3),
        ],
    });
    let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("nv12"),
        bind_group_layouts: &[Some(&bgl)],
        immediate_size: 0,
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("nv12"),
        layout: Some(&pl),
        vertex: wgpu::VertexState {
            module: &module,
            entry_point: Some("vs"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some("fs"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: PICTURE_FORMAT,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    });
    (pipeline, bgl)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn premultiplies_like_webgl() {
        let mut px = [200, 100, 50, 128, 10, 20, 30, 255, 99, 99, 99, 0];
        premultiply(&mut px);
        assert_eq!(px, [100, 50, 25, 128, 10, 20, 30, 255, 0, 0, 0, 0]);
    }

    #[test]
    fn packs_each_pass_at_an_aligned_offset() {
        let (uniforms, block_size) =
            glsl::std140(&[("uOpacity".to_owned(), glsl::UniformType::Float)]);
        let l = Layout {
            uniforms,
            block_size,
            textures: vec![],
        };
        let mut b = Vec::new();
        let a = push_block(
            &mut b,
            &l,
            &HashMap::from([("uOpacity".to_owned(), vec![0.5])]),
            256,
        );
        let c = push_block(
            &mut b,
            &l,
            &HashMap::from([("uOpacity".to_owned(), vec![0.25])]),
            256,
        );
        assert_eq!((a, c), (0, 256));
        assert_eq!(f32::from_le_bytes(b[256..260].try_into().unwrap()), 0.25);
    }
}
