W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/frame.rs', [
("""    /// B, G, R and a byte to ignore (Windows `RGB32` from Media Foundation: opaque).
    Bgrx8,
}

impl PixelFormat {
    pub const fn bytes_per_pixel(self) -> usize {
        4
    }
}""","""    /// B, G, R and a byte to ignore (Windows `RGB32` from Media Foundation: opaque).
    Bgrx8,
    /// NV12 (cameras: Media Foundation's own format): the Y plane, then the U
    /// and V of each 2 × 2 block side by side. 12 bits a pixel; even sizes.
    Nv12,
}

impl PixelFormat {
    /// Bytes of a `w` × `h` frame.
    pub const fn frame_len(self, w: u32, h: u32) -> usize {
        let px = w as usize * h as usize;
        match self {
            PixelFormat::Nv12 => px * 3 / 2,
            _ => px * 4,
        }
    }
}"""),
("""        let mut buf = pool.take(width as usize * height as usize * format.bytes_per_pixel());""","""        let mut buf = pool.take(format.frame_len(width, height));"""),
])
edit('crates/live-engine/src/feeds.rs', [
("""        PixelFormat::Bgrx8 => "bgr0",""","""        PixelFormat::Bgrx8 => "bgr0",
        PixelFormat::Nv12 => "nv12","""),
])
edit('crates/live-engine/src/gpu.rs', [
("""const SHADER: &str = include_str!("compose.wgsl");""","""const SHADER: &str = include_str!("compose.wgsl");
const YUV_SHADER: &str = include_str!("yuv.wgsl");"""),
("""struct SourceTex {
    tex: Tex,
    format: PixelFormat,
    seq: u64,
}""","""struct SourceTex {
    tex: Tex,
    format: PixelFormat,
    seq: u64,
    /// NV12 sources: their Y and UV planes as they arrive (made into `tex` on the GPU).
    planes: Option<(wgpu::Texture, wgpu::Texture, wgpu::BindGroup)>,
}"""),
("""    pipeline_layout: wgpu::PipelineLayout,
    module: wgpu::ShaderModule,""","""    pipeline_layout: wgpu::PipelineLayout,
    module: wgpu::ShaderModule,
    /// NV12 to RGBA (`yuv.wgsl`): its layout and its pipelines (BT.709, BT.601).
    yuv_layout: wgpu::BindGroupLayout,
    yuv_pipes: [wgpu::RenderPipeline; 2],"""),
("""        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("compose"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });""","""        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
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
        let yuv_pipes = [yuv_pipe("fs_709"), yuv_pipe("fs_601")];"""),
("""            pipeline_layout,
            module,""","""            pipeline_layout,
            module,
            yuv_layout,
            yuv_pipes,"""),
("""    pub fn upload(&mut self, id: &SourceId, f: &VideoFrame) {
        let format = match f.format {
            PixelFormat::Rgba8 => wgpu::TextureFormat::Rgba8Unorm,
            PixelFormat::Bgra8 | PixelFormat::Bgrx8 => wgpu::TextureFormat::Bgra8Unorm,
        };""","""    pub fn upload(&mut self, id: &SourceId, f: &VideoFrame) {
        if f.format == PixelFormat::Nv12 {
            self.upload_nv12(id, f);
            return;
        }
        let format = match f.format {
            PixelFormat::Rgba8 | PixelFormat::Nv12 => wgpu::TextureFormat::Rgba8Unorm,
            PixelFormat::Bgra8 | PixelFormat::Bgrx8 => wgpu::TextureFormat::Bgra8Unorm,
        };"""),
("""                SourceTex {
                    tex,
                    format: f.format,
                    seq: u64::MAX,
                },
            );
        }
        if let Some(s) = self.sources.get_mut(id) {
            if f.data.as_slice().len() >= (f.width * f.height * 4) as usize {""","""                SourceTex {
                    tex,
                    format: f.format,
                    seq: u64::MAX,
                    planes: None,
                },
            );
        }
        if let Some(s) = self.sources.get_mut(id) {
            if f.data.as_slice().len() >= (f.width * f.height * 4) as usize {"""),
("""    /// The show clock (ms), for effects that move (grain).""","""    /// An NV12 frame: its two planes to the GPU (12 bits a pixel), made into
    /// the source's RGBA picture there.
    fn upload_nv12(&mut self, id: &SourceId, f: &VideoFrame) {
        let (w, h) = (f.width & !1, f.height & !1);
        if w == 0 || h == 0 || f.data.as_slice().len() < PixelFormat::Nv12.frame_len(f.width, f.height) {
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

    /// The show clock (ms), for effects that move (grain)."""),
])
