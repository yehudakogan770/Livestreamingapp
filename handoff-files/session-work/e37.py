W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/gpu.rs', [
("""impl SurfaceOut {
    pub fn new(surface: wgpu::Surface<'static>) -> Self {
        SurfaceOut {
            surface,
            config: None,
        }
    }
}""","""impl SurfaceOut {
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
}"""),
("""    /// Seconds (0 – 100) for the grain effect.
    time: f32,
}""","""    /// Seconds (0 – 100) for the grain effect.
    time: f32,
    /// The graphics device was lost (a driver reset, the card removed): the engine makes a new one.
    lost: Arc<std::sync::atomic::AtomicBool>,
}"""),
("""        // A mistake on the GPU is reported, never a crash in the middle of a show.
        device.on_uncaptured_error(Arc::new(|e| eprintln!("live engine GPU: {e}")));""","""        // A mistake on the GPU is reported, never a crash in the middle of a show.
        device.on_uncaptured_error(Arc::new(|e| eprintln!("live engine GPU: {e}")));
        // A lost device (a driver reset — Windows' TDR —, the card removed) is noticed and replaced.
        let lost = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let l = Arc::clone(&lost);
        device.set_device_lost_callback(move |reason, why| {
            eprintln!("live engine GPU lost ({reason:?}): {why}");
            l.store(true, std::sync::atomic::Ordering::SeqCst);
        });"""),
("""            uploaded: 0,
            time: 0.0,
        };""","""            uploaded: 0,
            time: 0.0,
            lost,
        };"""),
("""    /// Start without any window (tests, the benchmark).""","""    /// The device was lost: nothing drawn with it shows any more.
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

    /// Start without any window (tests, the benchmark)."""),
])
edit('crates/live-engine/src/feeds.rs', [
("""    /// Drawn at its own size (and the vertical's small copy).
    target: Option<usize>,
    small: Option<usize>,""","""    /// Drawn at its own size (and the vertical's small copy).
    target: Option<usize>,
    small: Option<usize>,
    /// The target's size.
    size: (u32, u32),"""),
("""            target: None,
            small: None,
            error: None,
        };""","""            target: None,
            small: None,
            size: (spec.width.max(2), spec.height.max(2)),
            error: None,
        };"""),
("""    /// Feed `id`'s encoder has started.""","""    /// A new graphics device: the feeds' targets are made again on it.
    pub fn renew(&mut self, gpu: &mut Compositor) {
        for f in self.feeds.values() {
            if let Some(t) = f.target {
                gpu.ensure_target(t, f.size.0, f.size.1);
            }
            if let Some(t) = f.small {
                gpu.ensure_target(t, SMALL.0, SMALL.1);
            }
        }
    }

    /// Feed `id`'s encoder has started."""),
])
edit('crates/live-engine/src/engine.rs', [
("""    /// Draw and send out one frame at show time `now`.
    pub fn frame(&mut self, now: u64) {""","""    /// The graphics device was lost (a driver reset, the card removed): make
    /// a new one and carry on. Pictures, windows and encoders continue; the
    /// graphics planes are asked for again (`graphics_lost`). Returns whether
    /// the engine can draw now.
    pub fn recover(&mut self) -> bool {
        if !self.gpu.is_lost() {
            return true;
        }
        let gpu = match self.gpu.renew() {
            Ok(g) => g,
            Err(e) => {
                self.stats.error = Some(format!("The graphics card stopped; trying again: {e}"));
                return false;
            }
        };
        self.gpu = gpu;
        for (_, i) in PROGRAM {
            self.gpu.ensure_target(i, self.config.width, self.config.height);
        }
        for (_, i) in NEXT {
            self.gpu
                .ensure_target(i, self.config.width / 2, self.config.height / 2);
        }
        for o in self.outputs.values_mut() {
            o.out.reset();
        }
        if let Some(o) = self.multiview.as_mut() {
            o.out.reset();
        }
        self.feeds.renew(&mut self.gpu);
        self.stats.recoveries += 1;
        self.stats.adapter = Some(self.gpu.describe());
        self.stats.error = Some("The graphics card was reset; the engine started again on it.".into());
        self.graphics_lost = true;
        true
    }

    /// Draw and send out one frame at show time `now`.
    pub fn frame(&mut self, now: u64) {
        if !self.recover() {
            self.frame_no += 1;
            return;
        }"""),
("""    /// Cameras held back (their picture's delay).""","""    /// The graphics planes went with a lost device: the renderers send everything again.
    pub graphics_lost: bool,
    /// Cameras held back (their picture's delay)."""),
("""            delays: HashMap::new(),
""","""            delays: HashMap::new(),
            graphics_lost: false,
"""),
("""    pub feeds: Vec<FeedInfo>,""","""    pub feeds: Vec<FeedInfo>,
    /// Times the graphics device was lost and made again.
    pub recoveries: u64,"""),
# Runner: graphics returns resync error when lost
("""    pub previews: Mutex<HashMap<String, Preview>>,
    pub health: Mutex<Vec<(SourceId, SourceHealth)>>,
}""","""    pub previews: Mutex<HashMap<String, Preview>>,
    pub health: Mutex<Vec<(SourceId, SourceHealth)>>,
    /// The graphics planes were lost (a new graphics device): the next
    /// graphics frame is refused so the renderers send everything again.
    pub graphics_lost: std::sync::atomic::AtomicBool,
}"""),
("""    pub fn graphics(&self, bytes: Vec<u8>) -> Result<(), String> {
        let m = overlay::parse(bytes)?;""","""    pub fn graphics(&self, bytes: Vec<u8>) -> Result<(), String> {
        if self
            .shared
            .graphics_lost
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err("The engine started again on a new graphics device: send everything.".into());
        }
        let m = overlay::parse(bytes)?;"""),
("""        let caught =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| engine.frame(now_ms())));""","""        let caught =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| engine.frame(now_ms())));
        if std::mem::take(&mut engine.graphics_lost) {
            shared
                .graphics_lost
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }"""),
])
