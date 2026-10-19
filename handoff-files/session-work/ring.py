import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aa366926aba0928a0')
p='crates/live-engine/src/gpu.rs'
s=open(p).read()
start=s.index("    /// Read target `i` (or the atlas) back: RGBA, top row first. Waits for the GPU.")
end=s.index("    /// Wait until the GPU has finished everything submitted (benchmarks).")
new='''    /// A read-back buffer for `w` × `h` (bytes per row padded as the GPU wants).
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

'''
s=s[:start]+new+s[end:]
s=s.replace("""    reads: HashMap<(u32, u32), wgpu::Buffer>,""","""    reads: HashMap<(u32, u32), wgpu::Buffer>,
    rings: HashMap<Dest, Ring>,""")
s=s.replace("""            reads: HashMap::new(),""","""            reads: HashMap::new(),
            rings: HashMap::new(),""")
s=s.replace("""/// Where a pass paints.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dest {""","""/// Where a pass paints.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Dest {""")
s=s.replace("""/// A window (or anything with a wgpu surface) being drawn into.""","""/// A read-back on its way: the buffer, the "mapped" signal, the picture's size.
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

/// A window (or anything with a wgpu surface) being drawn into.""")
open(p,'w').write(s)

p='crates/live-engine/src/engine.rs'
s=open(p).read()
old="""        if let Some((s, feed)) = &self.feed {
            if let Ok((_, _, px)) = self.gpu.read(Dest::Target(program_target(*s))) {
                feed.push(px);
            }
        }"""
assert old in s
s=s.replace(old,"""        // One frame late, so the engine never waits for the GPU to finish the copy.
        if let Some((s, feed)) = &self.feed {
            if let Some((_, _, px)) = self.gpu.read_pipelined(Dest::Target(program_target(*s))) {
                feed.push(px);
            }
        }""")
open(p,'w').write(s)

p='crates/live-engine/tests/gpu.rs'
s=open(p).read()
s=s.replace("""#[test]
fn blank_and_panic_cover_everything() {""","""#[test]
fn pipelined_read_back_is_one_frame_late() {
    let Some(mut g) = gpu() else { return };
    setup(&mut g);
    let red = ScreenScene {
        layers: vec![layer("red", 1.0)],
        ..ScreenScene::default()
    };
    let blue = ScreenScene {
        layers: vec![layer("blue", 1.0)],
        ..ScreenScene::default()
    };
    g.ensure_target(0, W, H);
    let paint = |g: &mut Compositor, sc: &ScreenScene| {
        g.render(&[Pass {
            dest: Dest::Target(0),
            viewport: None,
            paint: Paint::Scene {
                scene: sc,
                overlay: None,
            },
        }]);
    };
    paint(&mut g, &red);
    assert!(g.read_pipelined(Dest::Target(0)).is_none(), "nothing yet on the first call");
    paint(&mut g, &blue);
    let (_, _, img) = g.read_pipelined(Dest::Target(0)).expect("the red frame");
    assert!(near(px(&img, 5, 5), [255, 0, 0, 255]));
    paint(&mut g, &red);
    let (_, _, img) = g.read_pipelined(Dest::Target(0)).expect("the blue frame");
    assert!(near(px(&img, 5, 5), [0, 0, 255, 255]));
}

#[test]
fn blank_and_panic_cover_everything() {""")
open(p,'w').write(s)
