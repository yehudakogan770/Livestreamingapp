W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/feeds.rs', [
("""    /// Drawn at its own size (and the vertical's small copy).
    target: Option<usize>,
    small: Option<usize>,""","""    /// Drawn at its own size (and the vertical's small copy).
    target: Option<usize>,
    small: Option<usize>,
    /// Its NV12 copy, read back for the encoder (screens).
    nv12: Option<usize>,"""),
("""            target: None,
            small: None,
            size: (spec.width.max(2), spec.height.max(2)),""","""            target: None,
            small: None,
            nv12: None,
            size: (spec.width.max(2) & !1, spec.height.max(2) & !1),"""),
("""            FeedSource::Screen { vertical, .. } => {
                let (w, h) = (spec.width.max(2), spec.height.max(2));
                if *vertical || (w, h) != screen_size {
                    f.target = Some(self.target(gpu, w, h));
                }
                if *vertical {
                    f.small = Some(self.target(gpu, SMALL.0, SMALL.1));
                }
                let shape = FeedShape {
                    width: w,
                    height: h,
                    fps: spec.fps,
                    pix_fmt: "rgba",
                };""","""            FeedSource::Screen { vertical, .. } => {
                let (w, h) = f.size;
                if *vertical || (w, h) != screen_size {
                    f.target = Some(self.target(gpu, w, h));
                }
                if *vertical {
                    f.small = Some(self.target(gpu, SMALL.0, SMALL.1));
                }
                // Read back as NV12: a third of the bytes, what encoders take.
                let n = self.target(gpu, 2, 2);
                gpu.ensure_nv12_target(n, w, h);
                f.nv12 = Some(n);
                let shape = FeedShape {
                    width: w,
                    height: h,
                    fps: spec.fps,
                    pix_fmt: "nv12",
                };"""),
("""        for t in [f.target, f.small].into_iter().flatten() {
            gpu.drop_target(t);
            self.free.push(t);
        }""","""        for t in [f.target, f.small, f.nv12].into_iter().flatten() {
            gpu.drop_target(t);
            self.free.push(t);
        }"""),
("""            if let Some(t) = f.small {
                gpu.ensure_target(t, SMALL.0, SMALL.1);
            }""","""            if let Some(t) = f.small {
                gpu.ensure_target(t, SMALL.0, SMALL.1);
            }
            if let Some(t) = f.nv12 {
                gpu.ensure_nv12_target(t, f.size.0, f.size.1);
            }"""),
("""            let src = program(*screen);
            let dest = match (f.target, f.small) {
                (Some(t), Some(small)) => {
                    passes.push(Pass {
                        dest: Dest::Target(small),
                        viewport: None,
                        paint: Paint::Target(src),
                    });
                    passes.push(Pass {
                        dest: Dest::Target(t),
                        viewport: None,
                        paint: Paint::Vertical { src, small },
                    });
                    Dest::Target(t)
                }
                (Some(t), None) => {
                    passes.push(Pass {
                        dest: Dest::Target(t),
                        viewport: None,
                        paint: Paint::Target(src),
                    });
                    Dest::Target(t)
                }
                _ => Dest::Target(src),
            };
            due.push((*id, n, dest));""","""            let src = program(*screen);
            let picture = match (f.target, f.small) {
                (Some(t), Some(small)) => {
                    passes.push(Pass {
                        dest: Dest::Target(small),
                        viewport: None,
                        paint: Paint::Target(src),
                    });
                    passes.push(Pass {
                        dest: Dest::Target(t),
                        viewport: None,
                        paint: Paint::Vertical { src, small },
                    });
                    t
                }
                (Some(t), None) => {
                    passes.push(Pass {
                        dest: Dest::Target(t),
                        viewport: None,
                        paint: Paint::Target(src),
                    });
                    t
                }
                _ => src,
            };
            let Some(nv12) = f.nv12 else { continue };
            passes.push(Pass {
                dest: Dest::Target(nv12),
                viewport: None,
                paint: Paint::Nv12(picture),
            });
            due.push((*id, n, Dest::Target(nv12)));"""),
])
edit('crates/live-engine/src/encoder.rs', [
("""    a.push(f.pix_fmt.to_owned());
    a.push("-s".to_owned());""","""    a.push(f.pix_fmt.to_owned());
    if f.pix_fmt == "nv12" {
        // The engine's NV12 is BT.709, limited range: said so, so it is encoded and played so.
        a.extend(
            [
                "-color_range",
                "tv",
                "-colorspace",
                "bt709",
                "-color_primaries",
                "bt709",
                "-color_trc",
                "bt709",
            ]
            .map(str::to_owned),
        );
    }
    a.push("-s".to_owned());"""),
("""            frame_len: f.width as usize * f.height as usize * 4,""","""            frame_len: frame_len(f.pix_fmt, f.width, f.height),"""),
("""/// Called once when FFmpeg ends: whether it was asked to (the feed""","""/// Bytes of one frame of `w` × `h` in FFmpeg's pixel format `pix_fmt`.
pub fn frame_len(pix_fmt: &str, w: u32, h: u32) -> usize {
    let px = w as usize * h as usize;
    if pix_fmt == "nv12" {
        px * 3 / 2
    } else {
        px * 4
    }
}

/// Called once when FFmpeg ends: whether it was asked to (the feed"""),
])
