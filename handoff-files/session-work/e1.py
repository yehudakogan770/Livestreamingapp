W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'crates/live-engine/src/engine.rs'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep("""                paint: Paint::Scene {
                    scene: sc,
                    overlay: self.overlays.get(s).copied().unwrap_or(false).then_some(*i),
                },""","""                paint: Paint::Scene {
                    scene: sc,
                    planes: (*s != ScreenId::Monitor).then_some(*i),
                },""")
s=s.replace("overlay: None,","planes: None,")

rep("""    overlays: HashMap<ScreenId, bool>,
""","""    graphics: GraphicsTally,
""")
rep("""            overlays: HashMap::new(),
""","""            graphics: GraphicsTally::default(),
""")
rep("""    /// A screen's graphics layer (straight-alpha RGBA at any size; None clears it).
    pub fn set_overlay(&mut self, screen: ScreenId, frame: Option<(u32, u32, &[u8])>) {
        self.overlays.insert(screen, frame.is_some());
        self.gpu.set_overlay(program_target(screen), frame);
    }""","""    /// A screen's whole-screen `top` graphics plane (straight-alpha RGBA at
    /// any size; None clears it). The benchmark and tests use it; the web
    /// renderer sends [`LiveEngine::apply_graphics`].
    pub fn set_overlay(&mut self, screen: ScreenId, frame: Option<(u32, u32, &[u8])>) {
        self.gpu.set_overlay(program_target(screen), frame);
    }

    /// Changed graphics from a screen's web overlay renderer (dirty
    /// rectangles of its planes; see [`crate::overlay`]).
    pub fn apply_graphics(&mut self, m: &overlay::Message) {
        let now = now_ms();
        for r in &m.records {
            let slot = program_target(r.screen);
            match r.op {
                overlay::Op::Patch => {
                    let rects: Vec<([u32; 4], &[u8])> = r
                        .rects
                        .iter()
                        .map(|x| ([x.x, x.y, x.w, x.h], m.pixels(x)))
                        .collect();
                    self.gpu.patch_plane(slot, &r.name, r.w, r.h, &rects);
                    self.graphics.latency_ms += now as f64 - r.at as f64;
                    self.graphics.records += 1;
                }
                overlay::Op::Clear => self.gpu.clear_plane(slot, &r.name, r.w, r.h),
                overlay::Op::Reset => self.gpu.reset_planes(slot),
            }
        }
        self.graphics.messages += 1;
        self.graphics.bytes += m.pixel_bytes();
    }

    /// A graphics frame that could not be read.
    pub fn refuse_graphics(&mut self) {
        self.stats.overlay.refused += 1;
    }""")
rep("""    pub feed: Option<FeedStats>,
    /// Things that""","""    pub feed: Option<FeedStats>,
    /// How the graphics from the web overlay renderers arrive.
    pub overlay: OverlayStats,
    /// Things that""")
rep("""use crate::gpu::{AdapterInfo, Compositor, Dest, Paint, Pass};""","""use crate::gpu::{AdapterInfo, Compositor, Dest, Paint, Pass};
use crate::overlay::{self, OverlayStats};""")
rep("""#[derive(Default)]
struct Timing {""","""/// Graphics frames since the statistics were last worked out.
#[derive(Default)]
struct GraphicsTally {
    messages: u32,
    records: u32,
    bytes: u64,
    latency_ms: f64,
}

#[derive(Default)]
struct Timing {""")
rep("""            self.stats.feed = self.feed.as_ref().map(|(_, f)| f.stats());""","""            self.stats.feed = self.feed.as_ref().map(|(_, f)| f.stats());
            let g = std::mem::take(&mut self.graphics);
            self.stats.overlay = OverlayStats {
                frames_per_s: (f64::from(g.messages) / span) as f32,
                mb_per_s: (g.bytes as f64 / span / 1e6) as f32,
                latency_ms: if g.records > 0 {
                    (g.latency_ms / f64::from(g.records)) as f32
                } else {
                    self.stats.overlay.latency_ms
                },
                planes: self.gpu.plane_count(),
                refused: self.stats.overlay.refused,
            };""")
a=s.index("        let graphics = show")
b=s.index("        if show.settings.stingers")
s=s[:a]+"""        let behind = show.sources.iter().any(|s| match &s.kind {
            SourceKind::Slideshow(k) => k
                .behind
                .as_ref()
                .and_then(|id| show.source(id))
                .is_some_and(|b| scene::is_video_kind(&b.kind)),
            _ => false,
        });
        if behind {
            notes.push(
                "A camera or video behind slides is not shown yet in the unified engine (the slides are)."
                    .into(),
            );
        }
"""+s[b:]
rep("""        if show.settings.stingers.iter().any(|s| !s.path.is_empty()) {
            notes.push(
                "Stinger videos are not drawn yet: the pictures cut at the stinger's cut point."
                    .into(),
            );
        }
""","")
rep("""    Overlay(ScreenId, Option<(u32, u32, Vec<u8>)>),""","""    Overlay(ScreenId, Option<(u32, u32, Vec<u8>)>),
    Graphics(Box<overlay::Message>),""")
rep("""                Ok(Command::Overlay(s, f)) => {
                    engine.set_overlay(s, f.as_ref().map(|(w, h, px)| (*w, *h, px.as_slice())));
                }""","""                Ok(Command::Overlay(s, f)) => {
                    engine.set_overlay(s, f.as_ref().map(|(w, h, px)| (*w, *h, px.as_slice())));
                }
                Ok(Command::Graphics(m)) => engine.apply_graphics(&m),""")
rep("""    pub fn set_overlay(&self, screen: ScreenId, frame: Option<(u32, u32, Vec<u8>)>) {
        let _ = self.tx.send(Command::Overlay(screen, frame));
    }""","""    pub fn set_overlay(&self, screen: ScreenId, frame: Option<(u32, u32, Vec<u8>)>) {
        let _ = self.tx.send(Command::Overlay(screen, frame));
    }

    /// A graphics frame from a web overlay renderer (checked here, applied
    /// on the engine's thread before its next frame).
    ///
    /// # Errors
    /// The frame is malformed (nothing of it is applied).
    pub fn graphics(&self, bytes: Vec<u8>) -> Result<(), String> {
        let m = overlay::parse(bytes)?;
        self.tx
            .send(Command::Graphics(Box::new(m)))
            .map_err(|_| "The unified engine has stopped.".to_owned())
    }""")
open(p,'w').write(s)
p=W+'crates/live-engine/src/lib.rs'
s=open(p).read()
s=s.replace("pub mod mix;\n","pub mod mix;\npub mod overlay;\n")
s=s.replace("""//! Graphics (titles, countdowns, scoreboards…) stay drawn by web code: each
//! screen has an overlay layer that takes transparent RGBA frames.""","""//! Graphics (titles, countdowns, scoreboards…) stay drawn by web code: a
//! hidden web overlay renderer per screen draws them into transparent planes
//! and sends what changed ([`overlay`]); the engine draws them in their place.""")
open(p,'w').write(s)
