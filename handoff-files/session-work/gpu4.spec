@@@
const YUV_SHADER: &str = include_str!("yuv.wgsl");
===
const YUV_SHADER: &str = include_str!("yuv.wgsl");
const HDR_SHADER: &str = include_str!("hdr.wgsl");
@@@
    yuv_layout: wgpu::BindGroupLayout,
    yuv_pipes: [wgpu::RenderPipeline; 2],
===
    yuv_layout: wgpu::BindGroupLayout,
    yuv_pipes: [wgpu::RenderPipeline; 2],
    /// HDR inputs to the SDR picture (`hdr.wgsl`): 10-bit RGB or P010, PQ or HLG.
    hdr_layout: wgpu::BindGroupLayout,
    hdr_pipes: [wgpu::RenderPipeline; 4],
    /// Stand-ins for the planes an HDR format doesn't have (float, then two uint).
    hdr_none: [wgpu::TextureView; 3],
@@@
        let yuv_pipes = [yuv_pipe("fs_709"), yuv_pipe("fs_601")];
===
        let yuv_pipes = [yuv_pipe("fs_709"), yuv_pipe("fs_601")];
        let hdr_entry = |binding: u32, sample_type: wgpu::TextureSampleType| {
            wgpu::BindGroupLayoutEntry {
                binding,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type,
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }
        };
        let hdr_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("hdr"),
            entries: &[
                hdr_entry(0, wgpu::TextureSampleType::Float { filterable: false }),
                hdr_entry(1, wgpu::TextureSampleType::Uint),
                hdr_entry(2, wgpu::TextureSampleType::Uint),
            ],
        });
        let hdr_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("hdr"),
            source: wgpu::ShaderSource::Wgsl(HDR_SHADER.into()),
        });
        let hdr_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("hdr"),
            bind_group_layouts: &[Some(&hdr_layout)],
            immediate_size: 0,
        });
        let hdr_pipe = |entry: &str| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("hdr"),
                layout: Some(&hdr_pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &hdr_module,
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
                    module: &hdr_module,
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
        let hdr_pipes = [
            hdr_pipe("fs_rgb10_pq"),
            hdr_pipe("fs_rgb10_hlg"),
            hdr_pipe("fs_p010_pq"),
            hdr_pipe("fs_p010_hlg"),
        ];
        let none = |format: wgpu::TextureFormat| {
            device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some("hdr-none"),
                    size: wgpu::Extent3d {
                        width: 1,
                        height: 1,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                })
                .create_view(&wgpu::TextureViewDescriptor::default())
        };
        let hdr_none = [
            none(wgpu::TextureFormat::Rgb10a2Unorm),
            none(wgpu::TextureFormat::R16Uint),
            none(wgpu::TextureFormat::Rg16Uint),
        ];
@@@
            yuv_layout,
            yuv_pipes,
===
            yuv_layout,
            yuv_pipes,
            hdr_layout,
            hdr_pipes,
            hdr_none,
@@@
    pub fn upload(&mut self, id: &SourceId, f: &VideoFrame) {
        if f.format == PixelFormat::Nv12 {
            self.upload_nv12(id, f);
            return;
        }
        let format = match f.format {
            PixelFormat::Rgba8 | PixelFormat::Nv12 => wgpu::TextureFormat::Rgba8Unorm,
            PixelFormat::Bgra8 | PixelFormat::Bgrx8 => wgpu::TextureFormat::Bgra8Unorm,
        };
===
    pub fn upload(&mut self, id: &SourceId, f: &VideoFrame) {
        if f.format == PixelFormat::Nv12 {
            self.upload_nv12(id, f);
            return;
        }
        if f.format.hdr().is_some() {
            self.upload_hdr(id, f);
            return;
        }
        let format = match f.format {
            PixelFormat::Bgra8 | PixelFormat::Bgrx8 => wgpu::TextureFormat::Bgra8Unorm,
            _ => wgpu::TextureFormat::Rgba8Unorm,
        };
@@@
    /// The show clock (ms), for effects that move (grain).
===
    /// An HDR frame (10-bit RGB from a file, P010 from a camera): to the GPU
    /// as it is, made into the source's SDR picture there (`hdr.wgsl`: the
    /// highlights rolled off into SDR white, BT.2020 into BT.709).
    fn upload_hdr(&mut self, id: &SourceId, f: &VideoFrame) {
        let Some(hdr) = f.format.hdr() else { return };
        let p010 = matches!(f.format, PixelFormat::P010(_));
        let (w, h) = if p010 {
            (f.width & !1, f.height & !1)
        } else {
            (f.width, f.height)
        };
        if w == 0 || h == 0 || f.data.as_slice().len() < f.format.frame_len(f.width, f.height) {
            return;
        }
        let fresh = match self.sources.get(id) {
            Some(s) if s.tex.w == w && s.tex.h == h && s.format == f.format => {
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
                "hdr input",
            );
            let plane = |pw: u32, ph: u32, format: wgpu::TextureFormat| {
                self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("hdr-plane"),
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
            let view = |t: &wgpu::Texture| t.create_view(&wgpu::TextureViewDescriptor::default());
            let (a, b, views) = if p010 {
                let y = plane(w, h, wgpu::TextureFormat::R16Uint);
                let uv = plane(w / 2, h / 2, wgpu::TextureFormat::Rg16Uint);
                let v = [self.hdr_none[0].clone(), view(&y), view(&uv)];
                (y, uv, v)
            } else {
                let rgb = plane(w, h, wgpu::TextureFormat::Rgb10a2Unorm);
                let v = [view(&rgb), self.hdr_none[1].clone(), self.hdr_none[2].clone()];
                (rgb.clone(), rgb, v)
            };
            let entries: Vec<wgpu::BindGroupEntry<'_>> = views
                .iter()
                .enumerate()
                .map(|(i, v)| wgpu::BindGroupEntry {
                    binding: i as u32,
                    resource: wgpu::BindingResource::TextureView(v),
                })
                .collect();
            let bind = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("hdr-planes"),
                layout: &self.hdr_layout,
                entries: &entries,
            });
            self.sources.insert(
                id.clone(),
                SourceTex {
                    tex,
                    format: f.format,
                    seq: u64::MAX,
                    planes: Some((a, b, bind)),
                },
            );
        }
        let Some(s) = self.sources.get_mut(id) else {
            return;
        };
        let Some((a, b, bind)) = &s.planes else {
            return;
        };
        let data = f.data.as_slice();
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
        if p010 {
            let ylen = f.width as usize * f.height as usize * 2;
            write(a, &data[..ylen], f.width * 2, w, h);
            write(b, &data[ylen..], f.width * 2, w / 2, h / 2);
        } else {
            write(a, data, f.width * 4, w, h);
        }
        self.uploaded += f.format.frame_len(w, h) as u64;
        let pipe = &self.hdr_pipes[usize::from(p010) * 2 + usize::from(hdr == crate::hdr::Hdr::Hlg)];
        let mut enc = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("hdr") });
        {
            let mut rp = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("hdr"),
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
