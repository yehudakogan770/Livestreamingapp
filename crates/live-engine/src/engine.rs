//! The engine loop: once a frame, take each source's newest picture to the
//! GPU, draw every screen, show the screens in their windows, feed the
//! encoder, and (a few times a second) draw small previews for the control
//! window. [`Runner`] runs it on its own thread; [`LiveEngine`] is the loop
//! itself, also driven directly by the benchmark and the tests.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use lumora_engine::{ScreenId, Show, Source, SourceId, SourceKind};
use serde::Serialize;

use crate::encoder::{EncoderFeed, FeedStats};
use crate::feeds::{FeedInfo, FeedSpec, Feeds, MakeFeed};
use crate::gpu::{AdapterInfo, Compositor, Dest, Paint, Pass};
use crate::multiview::{self, Tally, TileContent};
use crate::overlay::{self, OverlayStats};
use crate::present::{NativeOutput, Placement};
use crate::scene::{self, ScreenScene};
use crate::source::{FfmpegFile, SourceHealth, TestPattern, Unavailable, VideoSource};

/// How the engine runs.
#[derive(Debug, Clone)]
pub struct Config {
    /// The size every screen is drawn at.
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// One preview tile (screens and inputs) for the control window.
    pub preview_w: u32,
    pub preview_h: u32,
    /// Previews are drawn every this many frames (60 fps / 6 = 10 previews a second).
    pub preview_every: u32,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            width: 1920,
            height: 1080,
            fps: 60,
            preview_w: 320,
            preview_h: 180,
            preview_every: 6,
        }
    }
}

/// Opens the sources the show's inputs need.
pub trait SourceFactory: Send {
    /// What identifies the source (the engine reopens it when this changes).
    fn key(&self, src: &Source) -> String;
    fn open(&mut self, src: &Source) -> Box<dyn VideoSource>;
}

/// Cameras through Media Foundation (Windows), files and pictures through
/// FFmpeg, the test pattern made here.
pub struct DefaultFactory {
    pub ffmpeg: Option<PathBuf>,
    /// Cameras become test patterns (development without cameras, the benchmark).
    pub fake_cameras: bool,
    /// Where a show's media path is on disk.
    pub resolve: Box<dyn Fn(&str) -> PathBuf + Send>,
    seed: usize,
}

impl DefaultFactory {
    pub fn new(ffmpeg: Option<PathBuf>, fake_cameras: bool) -> Self {
        DefaultFactory {
            ffmpeg,
            fake_cameras,
            resolve: Box::new(|p: &str| PathBuf::from(p)),
            seed: 0,
        }
    }
}

impl SourceFactory for DefaultFactory {
    fn key(&self, src: &Source) -> String {
        match &src.kind {
            SourceKind::Camera { device_id, label } => format!("camera:{device_id}:{label}"),
            SourceKind::Video { path, .. } => format!("video:{path}"),
            SourceKind::Image { path } => format!("image:{path}"),
            SourceKind::Pattern => "pattern".into(),
            other => format!("other:{}", kind_name(other)),
        }
    }

    fn open(&mut self, src: &Source) -> Box<dyn VideoSource> {
        self.seed += 1;
        match &src.kind {
            SourceKind::Camera { label, .. } if self.fake_cameras => {
                Box::new(TestPattern::start(label, 1920, 1080, 60, self.seed))
            }
            #[cfg(windows)]
            SourceKind::Camera { label, .. } => Box::new(crate::mf::Camera::start(label)),
            #[cfg(not(windows))]
            SourceKind::Camera { .. } => Box::new(Unavailable::new(
                "Cameras are opened by the unified engine on Windows only for now.",
            )),
            SourceKind::Pattern => {
                Box::new(TestPattern::start(&src.name, 1920, 1080, 30, self.seed))
            }
            SourceKind::Video { path, .. } | SourceKind::Image { path } => match &self.ffmpeg {
                Some(ff) => Box::new(FfmpegFile::start(
                    ff,
                    &(self.resolve)(path),
                    matches!(src.kind, SourceKind::Image { .. }),
                )),
                None => Box::new(Unavailable::new(
                    "FFmpeg is needed to play files in the unified engine.",
                )),
            },
            other => Box::new(Unavailable::new(format!(
                "{} inputs are not in the unified engine yet (Phase 2).",
                kind_name(other)
            ))),
        }
    }
}

fn kind_name(k: &SourceKind) -> &'static str {
    match k {
        SourceKind::Stream(_) => "Stream",
        SourceKind::Screen(_) => "Screen capture",
        SourceKind::Guest(_) => "Guest",
        SourceKind::Browser(_) => "Web page",
        _ => "These",
    }
}

/// Which preview tile.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PreviewId {
    /// What a screen shows on air.
    Program(ScreenId),
    /// What is lined up next on a screen.
    Next(ScreenId),
    /// One input.
    Source(SourceId),
}

impl PreviewId {
    /// As the app's preview addresses spell it: `program/live`, `next/back`, `source/<id>`.
    pub fn key(&self) -> String {
        match self {
            PreviewId::Program(s) => format!("program/{}", screen_name(*s)),
            PreviewId::Next(s) => format!("next/{}", screen_name(*s)),
            PreviewId::Source(id) => format!("source/{id}"),
        }
    }
}

pub fn screen_name(s: ScreenId) -> &'static str {
    match s {
        ScreenId::Live => "live",
        ScreenId::Back => "back",
        ScreenId::Monitor => "monitor",
    }
}

/// One preview tile: RGBA, top row first.
#[derive(Debug, Clone)]
pub struct Preview {
    pub width: u32,
    pub height: u32,
    pub rgba: Arc<Vec<u8>>,
    /// The engine frame it was drawn on.
    pub frame: u64,
}

/// A screen as the test event checks it (see [`LiveEngine::probe`]).
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenProbe {
    pub fps: f32,
    pub in_sync: Option<bool>,
    pub black: Option<bool>,
    pub overlays: Option<bool>,
    pub width: u32,
    pub height: u32,
    /// Shown in the engine's own window now.
    pub window: bool,
}

/// What the engine reports.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub frames: u64,
    /// Average over the last second: the whole frame, and its parts.
    pub ms_per_frame: f32,
    /// Frames drawn in the last second.
    pub fps: f32,
    pub upload_ms: f32,
    pub render_ms: f32,
    pub present_ms: f32,
    pub readback_ms: f32,
    /// Frames that took longer than one frame's time.
    pub late_frames: u64,
    pub upload_mb_per_s: f32,
    pub adapter: Option<AdapterInfo>,
    pub outputs: Vec<String>,
    /// The first screen feed (the recording or stream).
    pub feed: Option<FeedStats>,
    /// Every feed: screens (recording, stream, vertical, NDI) and inputs (ISO files).
    pub feeds: Vec<FeedInfo>,
    /// How the graphics from the web overlay renderers arrive.
    pub overlay: OverlayStats,
    /// Things that don't work in the unified engine yet, in words for the operator.
    pub notes: Vec<String>,
    pub error: Option<String>,
}

/// Draw targets.
const PROGRAM: [(ScreenId, usize); 3] = [
    (ScreenId::Live, 0),
    (ScreenId::Back, 1),
    (ScreenId::Monitor, 2),
];
const NEXT: [(ScreenId, usize); 2] = [(ScreenId::Live, 3), (ScreenId::Back, 4)];
/// The multiview is drawn here (feeds' targets come after it).
pub const MULTIVIEW: usize = 8;
/// The multiview's background, borders and tally (`MultiviewView.css`: --chrome, #272727, --program-bright, --preview-bright).
const MV_CHROME: [f32; 4] = [11.0 / 255.0, 11.0 / 255.0, 11.0 / 255.0, 1.0];
const MV_BORDER: [f32; 4] = [39.0 / 255.0, 39.0 / 255.0, 39.0 / 255.0, 1.0];
const MV_PGM: [f32; 4] = [1.0, 75.0 / 255.0, 62.0 / 255.0, 1.0];
const MV_PVW: [f32; 4] = [52.0 / 255.0, 210.0 / 255.0, 107.0 / 255.0, 1.0];
/// The plane of words (names, tally tags, clock) the Live Screen's overlay renderer draws for it.
pub const MULTIVIEW_PLANE: &str = "mv";
/// Preview tiles per row of the atlas.
const ATLAS_COLUMNS: u32 = 6;

fn program_target(s: ScreenId) -> usize {
    PROGRAM.iter().find(|p| p.0 == s).map_or(0, |p| p.1)
}

/// Milliseconds on the show's clock (the wall clock, as the windows use).
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Graphics frames since the statistics were last worked out.
#[derive(Default)]
struct GraphicsTally {
    messages: u32,
    records: u32,
    bytes: u64,
    latency_ms: f64,
}

#[derive(Default)]
struct Timing {
    since: Option<Instant>,
    frames: u32,
    total: f64,
    upload: f64,
    render: f64,
    present: f64,
    readback: f64,
    bytes: u64,
}

/// The engine loop.
pub struct LiveEngine {
    pub config: Config,
    pub gpu: Compositor,
    factory: Box<dyn SourceFactory>,
    show: Option<Show>,
    sources: HashMap<SourceId, (String, Box<dyn VideoSource>)>,
    outputs: HashMap<ScreenId, NativeOutput>,
    feeds: Feeds,
    /// The multiview's window, and its layout for the show now.
    multiview: Option<NativeOutput>,
    mv_layout: Option<multiview::Layout>,
    graphics: GraphicsTally,
    previews: HashMap<String, Preview>,
    frame_no: u64,
    timing: Timing,
    pub stats: Stats,
}

impl LiveEngine {
    pub fn new(config: Config, gpu: Compositor, factory: Box<dyn SourceFactory>) -> Self {
        let mut gpu = gpu;
        for (_, i) in PROGRAM {
            gpu.ensure_target(i, config.width, config.height);
        }
        // Next is only ever seen small (the control window): half size is plenty.
        for (_, i) in NEXT {
            gpu.ensure_target(i, config.width / 2, config.height / 2);
        }
        let stats = Stats {
            adapter: Some(gpu.describe()),
            ..Stats::default()
        };
        LiveEngine {
            config,
            gpu,
            factory,
            show: None,
            sources: HashMap::new(),
            outputs: HashMap::new(),
            feeds: Feeds::default(),
            multiview: None,
            mv_layout: None,
            graphics: GraphicsTally::default(),
            previews: HashMap::new(),
            frame_no: 0,
            timing: Timing::default(),
            stats,
        }
    }

    /// A new version of the show: open new inputs, close removed ones.
    pub fn set_show(&mut self, show: Show) {
        let wanted: HashMap<SourceId, String> = scene::video_inputs(&show)
            .into_iter()
            .map(|s| (s.id.clone(), self.factory.key(s)))
            .collect();
        self.sources
            .retain(|id, (key, _)| wanted.get(id) == Some(key));
        for s in scene::video_inputs(&show) {
            if !self.sources.contains_key(&s.id) {
                let key = self.factory.key(s);
                let src = self.factory.open(s);
                self.sources.insert(s.id.clone(), (key, src));
            }
        }
        self.gpu.keep_sources(&|id| wanted.contains_key(id));
        self.previews.retain(|k, _| {
            !k.starts_with("source/")
                || wanted
                    .keys()
                    .any(|id| k == &PreviewId::Source(id.clone()).key())
        });
        self.mv_layout = Some(multiview::layout(
            &show,
            multiview::SIZE.0,
            multiview::SIZE.1,
        ));
        self.show = Some(show);
    }

    /// How a screen is doing, as the test event asks the output windows:
    /// what is on air is really drawn (its frames or its graphics are
    /// there), whether the picture is black, whether the overlays on air are drawn.
    pub fn probe(&self, screen: ScreenId) -> ScreenProbe {
        let mut p = ScreenProbe {
            fps: self.stats.fps,
            width: self.config.width,
            height: self.config.height,
            window: self.outputs.contains_key(&screen),
            ..ScreenProbe::default()
        };
        let Some(show) = &self.show else { return p };
        let slot = program_target(screen);
        let drawn = |id: &SourceId| match show.source(id).map(|s| &s.kind) {
            Some(k) if scene::is_video_kind(k) => self.gpu.source_size(id).is_some(),
            Some(SourceKind::Color { .. } | SourceKind::Split(_)) => true,
            Some(_) => self
                .gpu
                .has_plane(slot, &overlay::graphic_plane(id.as_str())),
            None => false,
        };
        let sc = show.screens.get(screen);
        p.in_sync = sc.program.as_ref().map(&drawn);
        if !sc.blank && !show.panic {
            if let Some(t) = self.previews.get(&PreviewId::Program(screen).key()) {
                let px = t.rgba.as_chunks::<4>().0;
                let sum: f64 = px
                    .iter()
                    .map(|c| {
                        0.2126 * f64::from(c[0])
                            + 0.7152 * f64::from(c[1])
                            + 0.0722 * f64::from(c[2])
                    })
                    .sum();
                p.black = Some(sum / (px.len().max(1) as f64) < 3.0);
            }
        }
        let on: Vec<&SourceId> = show
            .overlays
            .iter()
            .filter(|o| o.on && o.screens.contains(&screen))
            .filter_map(|o| o.source_id.as_ref())
            .collect();
        if !on.is_empty() {
            p.overlays = Some(on.into_iter().all(drawn));
        }
        p
    }

    /// Each input's health, for the backup lineup's watch.
    pub fn health(&self) -> Vec<(SourceId, SourceHealth)> {
        self.sources
            .iter()
            .map(|(id, (_, s))| (id.clone(), s.health()))
            .collect()
    }

    /// Open (or move) a screen's window; None closes it.
    ///
    /// # Errors
    /// The window could not be made (and on computers other than Windows).
    pub fn set_output(
        &mut self,
        screen: ScreenId,
        placement: Option<Placement>,
    ) -> Result<(), String> {
        match placement {
            None => {
                self.outputs.remove(&screen);
            }
            Some(p) => {
                if let Some(o) = self.outputs.get_mut(&screen) {
                    o.place(p);
                } else {
                    let o = NativeOutput::open(&self.gpu.instance, p)?;
                    self.outputs.insert(screen, o);
                }
            }
        }
        Ok(())
    }

    /// Open (or move) the multiview's window; None closes it.
    ///
    /// # Errors
    /// The window could not be made (and on computers other than Windows).
    pub fn set_multiview(&mut self, placement: Option<Placement>) -> Result<(), String> {
        match placement {
            None => {
                self.multiview = None;
                self.gpu.drop_target(MULTIVIEW);
            }
            Some(p) => {
                if let Some(o) = self.multiview.as_mut() {
                    o.place(p);
                } else {
                    self.multiview = Some(NativeOutput::open(&self.gpu.instance, p)?);
                }
            }
        }
        Ok(())
    }

    /// The multiview's layout (for its words), when it is open.
    pub fn multiview_layout(&self) -> Option<multiview::Layout> {
        self.multiview.as_ref().and(self.mv_layout.clone())
    }

    /// Draw the multiview (into its own target) from this frame's pictures.
    pub fn draw_multiview(&mut self) {
        let (Some(show), Some(l)) = (&self.show, &self.mv_layout) else {
            return;
        };
        self.gpu.ensure_target(MULTIVIEW, l.width, l.height);
        let (w, h) = (self.config.width as f32, self.config.height as f32);
        let aspect = w / h.max(1.0);
        let scenes: Vec<(usize, ScreenScene)> = l
            .tiles
            .iter()
            .enumerate()
            .filter_map(|(i, t)| match &t.content {
                TileContent::Input(id) => Some((i, scene::source_scene(show, id))),
                _ => None,
            })
            .collect();
        let mut passes: Vec<Pass<'_>> = vec![Pass {
            dest: Dest::Target(MULTIVIEW),
            viewport: None,
            paint: Paint::Solid(MV_CHROME),
        }];
        let border = l.scale.max(1.0).round() as u32;
        for (i, t) in l.tiles.iter().enumerate() {
            let [x, y, tw, th] = t.rect;
            let (color, b) = match t.tally {
                Tally::Pgm => (MV_PGM, border * 2),
                Tally::Pvw => (MV_PVW, border * 2),
                Tally::None => (MV_BORDER, border),
            };
            // The box: its border, then black inside.
            passes.push(Pass {
                dest: Dest::Target(MULTIVIEW),
                viewport: Some(t.rect),
                paint: Paint::Solid(color),
            });
            passes.push(Pass {
                dest: Dest::Target(MULTIVIEW),
                viewport: Some([
                    x + b,
                    y + b,
                    tw.saturating_sub(2 * b).max(1),
                    th.saturating_sub(2 * b).max(1),
                ]),
                paint: Paint::Solid([0.0, 0.0, 0.0, 1.0]),
            });
            let pic = multiview::fit(t.picture, aspect);
            let paint = match &t.content {
                TileContent::Program(s) => Paint::Target(program_target(*s)),
                TileContent::Next(s) => match NEXT.iter().find(|n| n.0 == *s) {
                    Some(n) => Paint::Target(n.1),
                    None => continue,
                },
                TileContent::Input(_) => match scenes.iter().find(|(n, _)| *n == i) {
                    // A graphics input shows when the Live Screen's renderer has it (on air there).
                    Some((_, sc)) => Paint::Scene {
                        scene: sc,
                        planes: Some(program_target(ScreenId::Live)),
                    },
                    None => continue,
                },
            };
            passes.push(Pass {
                dest: Dest::Target(MULTIVIEW),
                viewport: Some(pic),
                paint,
            });
        }
        passes.push(Pass {
            dest: Dest::Target(MULTIVIEW),
            // Over what is drawn (a whole-target pass would clear it first).
            viewport: Some([0, 0, l.width, l.height]),
            paint: Paint::Plane {
                slot: program_target(ScreenId::Live),
                name: MULTIVIEW_PLANE,
            },
        });
        self.gpu.render(&passes);
    }

    pub fn open_outputs(&self) -> Vec<ScreenId> {
        self.outputs.keys().copied().collect()
    }

    /// A screen's whole-screen `top` graphics plane (straight-alpha RGBA at
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
    }

    /// Start feed `id` (see [`crate::feeds`]); the answer says whether its encoder started.
    pub fn start_feed(
        &mut self,
        id: u64,
        spec: FeedSpec,
        make: MakeFeed,
    ) -> Receiver<Result<(), String>> {
        let (tx, rx) = channel();
        let size = (self.config.width, self.config.height);
        self.feeds.start(&mut self.gpu, id, spec, make, size, tx);
        rx
    }

    /// Stop feed `id`: its encoder, for the caller to finish (off the engine's thread).
    pub fn stop_feed(&mut self, id: u64) -> Option<EncoderFeed> {
        self.feeds.stop(&mut self.gpu, id)
    }

    /// The newest preview tiles.
    pub fn previews(&self) -> &HashMap<String, Preview> {
        &self.previews
    }

    /// Draw and send out one frame at show time `now`.
    pub fn frame(&mut self, now: u64) {
        let t0 = Instant::now();
        let preview_frame = self
            .frame_no
            .is_multiple_of(u64::from(self.config.preview_every.max(1)));
        let Some(show) = self.show.as_ref() else {
            self.frame_no += 1;
            return;
        };
        // 1. What every screen shows now.
        let program: Vec<(ScreenId, usize, ScreenScene)> = PROGRAM
            .iter()
            .map(|&(s, i)| {
                // The stage monitor is all words: drawn by the overlay renderer.
                let sc = if s == ScreenId::Monitor {
                    ScreenScene {
                        panic: crate::mix::fade_amount(show.panic, show.panic_changed_at, now, 0),
                        ..ScreenScene::default()
                    }
                } else {
                    scene::program_scene(show, s, now)
                };
                (s, i, sc)
            })
            .collect();
        let next: Vec<(usize, ScreenScene)> = NEXT
            .iter()
            .map(|&(s, i)| (i, scene::preview_scene(show, s)))
            .collect();
        let inputs: Vec<(SourceId, ScreenScene)> = if preview_frame {
            scene::video_inputs(show)
                .into_iter()
                .map(|s| (s.id.clone(), scene::source_scene(show, &s.id)))
                .collect()
        } else {
            Vec::new()
        };
        // 2. Each needed source's newest frame to the GPU (once, however many screens show it).
        // The multiview shows every input at the engine's full rate.
        let all: Vec<&SourceId> = if self.multiview.is_some() {
            scene::video_inputs(show)
                .into_iter()
                .map(|s| &s.id)
                .collect()
        } else {
            Vec::new()
        };
        let mut needed: Vec<&SourceId> = program
            .iter()
            .flat_map(|p| p.2.videos())
            .chain(next.iter().flat_map(|n| n.1.videos()))
            .chain(inputs.iter().map(|i| &i.0))
            .chain(all)
            .collect();
        needed.sort();
        needed.dedup();
        for id in needed {
            if let Some(f) = self.sources.get(id).and_then(|(_, s)| s.latest()) {
                self.gpu.upload(id, &f);
            }
        }
        let t1 = Instant::now();
        // 3. Draw every screen once.
        let mut passes: Vec<Pass<'_>> = Vec::new();
        for (s, i, sc) in &program {
            passes.push(Pass {
                dest: Dest::Target(*i),
                viewport: None,
                paint: Paint::Scene {
                    scene: sc,
                    planes: (*s != ScreenId::Monitor).then_some(*i),
                },
            });
        }
        for (i, sc) in &next {
            passes.push(Pass {
                dest: Dest::Target(*i),
                viewport: None,
                paint: Paint::Scene {
                    scene: sc,
                    planes: None,
                },
            });
        }
        let mut tiles: Vec<(PreviewId, [u32; 4])> = Vec::new();
        if preview_frame {
            let (pw, ph) = (self.config.preview_w, self.config.preview_h);
            let count = (PROGRAM.len() + NEXT.len() + inputs.len()) as u32;
            let rows = count.div_ceil(ATLAS_COLUMNS);
            self.gpu.ensure_atlas(pw * ATLAS_COLUMNS, ph * rows.max(1));
            let mut slot = 0u32;
            let mut place = |id: PreviewId| {
                let r = [
                    (slot % ATLAS_COLUMNS) * pw,
                    (slot / ATLAS_COLUMNS) * ph,
                    pw,
                    ph,
                ];
                slot += 1;
                tiles.push((id, r));
                r
            };
            for (s, i, _) in &program {
                let r = place(PreviewId::Program(*s));
                passes.push(Pass {
                    dest: Dest::Atlas,
                    viewport: Some(r),
                    paint: Paint::Target(*i),
                });
            }
            for (s, i) in NEXT {
                let r = place(PreviewId::Next(s));
                passes.push(Pass {
                    dest: Dest::Atlas,
                    viewport: Some(r),
                    paint: Paint::Target(i),
                });
            }
            for (id, sc) in &inputs {
                let r = place(PreviewId::Source(id.clone()));
                passes.push(Pass {
                    dest: Dest::Atlas,
                    viewport: Some(r),
                    paint: Paint::Scene {
                        scene: sc,
                        planes: None,
                    },
                });
            }
        }
        self.gpu.render(&passes);
        drop(passes);
        let t2 = Instant::now();
        // 4. The screens in their windows. An audience screen never closes by
        // accident (Alt+F4 on the projector): a close request is ignored.
        for (s, o) in &mut self.outputs {
            let _ = o.pump();
            let (w, h) = o.size();
            self.gpu.present(&mut o.out, program_target(*s), w, h);
        }
        if self.multiview.is_some() {
            self.draw_multiview();
            if let Some(o) = self.multiview.as_mut() {
                let _ = o.pump();
                let (w, h) = o.size();
                self.gpu.present(&mut o.out, MULTIVIEW, w, h);
            }
        }
        let t3 = Instant::now();
        // 5. The encoders (read back one frame late, so the engine never
        // waits for the GPU to finish a copy), and the previews.
        if !self.feeds.is_empty() {
            let sources = &self.sources;
            let latest = |id: &SourceId| sources.get(id).and_then(|(_, s)| s.latest());
            self.feeds
                .tick(&mut self.gpu, now, &program_target, &latest);
        }
        if preview_frame && !tiles.is_empty() {
            if let Ok((aw, _, px)) = self.gpu.read(Dest::Atlas) {
                for (id, [x, y, w, h]) in tiles {
                    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
                    for row in y..y + h {
                        let start = ((row * aw + x) * 4) as usize;
                        rgba.extend_from_slice(&px[start..start + (w * 4) as usize]);
                    }
                    self.previews.insert(
                        id.key(),
                        Preview {
                            width: w,
                            height: h,
                            rgba: Arc::new(rgba),
                            frame: self.frame_no,
                        },
                    );
                }
            }
        }
        let t4 = Instant::now();
        self.account(t0, t1, t2, t3, t4);
        self.frame_no += 1;
    }

    fn account(&mut self, t0: Instant, t1: Instant, t2: Instant, t3: Instant, t4: Instant) {
        let ms = |a: Instant, b: Instant| b.duration_since(a).as_secs_f64() * 1000.0;
        let tm = &mut self.timing;
        let since = *tm.since.get_or_insert(t0);
        tm.frames += 1;
        let total = ms(t0, t4);
        tm.total += total;
        tm.upload += ms(t0, t1);
        tm.render += ms(t1, t2);
        tm.present += ms(t2, t3);
        tm.readback += ms(t3, t4);
        tm.bytes += self.gpu.take_upload_bytes();
        self.stats.frames += 1;
        if total > 1000.0 / f64::from(self.config.fps.max(1)) {
            self.stats.late_frames += 1;
        }
        let span = t4.duration_since(since).as_secs_f64();
        if span >= 1.0 {
            let n = f64::from(tm.frames);
            self.stats.ms_per_frame = (tm.total / n) as f32;
            self.stats.fps = (n / span) as f32;
            self.stats.upload_ms = (tm.upload / n) as f32;
            self.stats.render_ms = (tm.render / n) as f32;
            self.stats.present_ms = (tm.present / n) as f32;
            self.stats.readback_ms = (tm.readback / n) as f32;
            self.stats.upload_mb_per_s = (tm.bytes as f64 / span / 1e6) as f32;
            self.stats.outputs = self
                .outputs
                .keys()
                .map(|s| screen_name(*s).to_owned())
                .chain(self.multiview.as_ref().map(|_| "multiview".to_owned()))
                .collect();
            self.stats.feeds = self.feeds.info();
            self.stats.feed = self
                .stats
                .feeds
                .iter()
                .find(|f| f.kind != "input")
                .and_then(|f| f.stats.clone());
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
            };
            self.stats.notes = self.notes();
            self.timing = Timing::default();
        }
    }

    /// What doesn't work in the unified engine yet, for what is in the show now.
    fn notes(&self) -> Vec<String> {
        let mut notes = Vec::new();
        let Some(show) = &self.show else { return notes };
        let behind = show.sources.iter().any(|s| match &s.kind {
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
        notes
    }
}

// ---------------------------------------------------------------------------
// The engine on its own thread

enum Command {
    Show(Box<Show>),
    Output(ScreenId, Option<Placement>, Sender<Result<(), String>>),
    Overlay(ScreenId, Option<(u32, u32, Vec<u8>)>),
    Graphics(Box<overlay::Message>),
    StartFeed(u64, FeedSpec, MakeFeed, Sender<Result<(), String>>),
    StopFeed(u64, Sender<Option<FeedStats>>),
    Probe(ScreenId, Sender<ScreenProbe>),
    Multiview(Option<Placement>, Sender<Result<(), String>>),
    MultiviewLayout(Sender<Option<multiview::Layout>>),
    Stop,
}

/// What the engine thread shares with the app.
#[derive(Default)]
pub struct Shared {
    pub stats: Mutex<Stats>,
    pub previews: Mutex<HashMap<String, Preview>>,
    pub health: Mutex<Vec<(SourceId, SourceHealth)>>,
}

/// The engine running on its own thread at a steady frame rate.
pub struct Runner {
    tx: Sender<Command>,
    pub shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Runner {
    /// Start the engine (the graphics card is found on its thread).
    ///
    /// # Errors
    /// No graphics card the engine can use.
    pub fn start(config: Config, factory: Box<dyn SourceFactory>) -> Result<Self, String> {
        let (tx, rx) = channel();
        let shared = Arc::new(Shared::default());
        let (ready_tx, ready_rx) = channel();
        let sh = Arc::clone(&shared);
        let thread = thread::Builder::new()
            .name("lumora-live-engine".into())
            .spawn(move || {
                let gpu = match Compositor::headless() {
                    Ok(g) => {
                        let _ = ready_tx.send(Ok(()));
                        g
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                run(LiveEngine::new(config, gpu, factory), &rx, &sh);
            })
            .map_err(|e| e.to_string())?;
        ready_rx
            .recv()
            .map_err(|_| "The unified engine stopped while starting.".to_owned())??;
        Ok(Runner {
            tx,
            shared,
            thread: Some(thread),
        })
    }

    pub fn set_show(&self, show: Show) {
        let _ = self.tx.send(Command::Show(Box::new(show)));
    }

    /// Open, move or (None) close a screen's window.
    ///
    /// # Errors
    /// The window could not be made.
    pub fn set_output(&self, screen: ScreenId, placement: Option<Placement>) -> Result<(), String> {
        let (tx, rx) = channel();
        self.tx
            .send(Command::Output(screen, placement, tx))
            .map_err(|_| "The unified engine has stopped.".to_owned())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "The unified engine did not answer.".to_owned())?
    }

    pub fn set_overlay(&self, screen: ScreenId, frame: Option<(u32, u32, Vec<u8>)>) {
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
    }

    /// Start feed `id`: a screen or an input to an encoder `make` starts
    /// (see [`crate::feeds`]).
    ///
    /// # Errors
    /// The encoder could not start.
    pub fn start_feed(&self, id: u64, spec: FeedSpec, make: MakeFeed) -> Result<(), String> {
        let (tx, rx) = channel();
        self.tx
            .send(Command::StartFeed(id, spec, make, tx))
            .map_err(|_| "The unified engine has stopped.".to_owned())?;
        rx.recv_timeout(Duration::from_secs(15))
            .map_err(|_| "The unified engine did not answer.".to_owned())?
    }

    /// Stop feed `id`; waits until FFmpeg has written the last of it.
    pub fn stop_feed(&self, id: u64) -> Option<FeedStats> {
        let (tx, rx) = channel();
        self.tx.send(Command::StopFeed(id, tx)).ok()?;
        rx.recv_timeout(Duration::from_secs(40)).ok().flatten()
    }

    pub fn stats(&self) -> Stats {
        lock(&self.shared.stats).clone()
    }

    /// Open, move or (None) close the multiview's window.
    ///
    /// # Errors
    /// The window could not be made.
    pub fn set_multiview(&self, placement: Option<Placement>) -> Result<(), String> {
        let (tx, rx) = channel();
        self.tx
            .send(Command::Multiview(placement, tx))
            .map_err(|_| "The unified engine has stopped.".to_owned())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "The unified engine did not answer.".to_owned())?
    }

    /// The multiview's layout while it is open (for its words).
    pub fn multiview_layout(&self) -> Option<multiview::Layout> {
        let (tx, rx) = channel();
        self.tx.send(Command::MultiviewLayout(tx)).ok()?;
        rx.recv_timeout(Duration::from_secs(5)).ok().flatten()
    }

    /// Check a screen (the test event).
    pub fn probe(&self, screen: ScreenId) -> Option<ScreenProbe> {
        let (tx, rx) = channel();
        self.tx.send(Command::Probe(screen, tx)).ok()?;
        rx.recv_timeout(Duration::from_secs(5)).ok()
    }

    pub fn preview(&self, key: &str) -> Option<Preview> {
        lock(&self.shared.previews).get(key).cloned()
    }

    pub fn health(&self) -> Vec<(SourceId, SourceHealth)> {
        lock(&self.shared.health).clone()
    }
}

impl Drop for Runner {
    fn drop(&mut self) {
        let _ = self.tx.send(Command::Stop);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn run(mut engine: LiveEngine, rx: &Receiver<Command>, shared: &Shared) {
    let period = Duration::from_secs_f64(1.0 / f64::from(engine.config.fps.max(1)));
    let mut next = Instant::now();
    loop {
        // Everything the app asked for since the last frame.
        loop {
            match rx.try_recv() {
                Ok(Command::Show(s)) => engine.set_show(*s),
                Ok(Command::Output(s, p, reply)) => {
                    let _ = reply.send(engine.set_output(s, p));
                }
                Ok(Command::Overlay(s, f)) => {
                    engine.set_overlay(s, f.as_ref().map(|(w, h, px)| (*w, *h, px.as_slice())));
                }
                Ok(Command::Graphics(m)) => engine.apply_graphics(&m),
                Ok(Command::Probe(s, reply)) => {
                    let _ = reply.send(engine.probe(s));
                }
                Ok(Command::Multiview(p, reply)) => {
                    let _ = reply.send(engine.set_multiview(p));
                }
                Ok(Command::MultiviewLayout(reply)) => {
                    let _ = reply.send(engine.multiview_layout());
                }
                Ok(Command::StartFeed(id, spec, make, reply)) => {
                    let started = engine.start_feed(id, spec, make);
                    // The answer comes from the thread starting FFmpeg.
                    thread::spawn(move || {
                        let r = started
                            .recv()
                            .unwrap_or_else(|_| Err("The encoder could not start.".to_owned()));
                        let _ = reply.send(r);
                    });
                }
                Ok(Command::StopFeed(id, reply)) => {
                    let feed = engine.stop_feed(id);
                    thread::spawn(move || {
                        let _ = reply.send(feed.map(EncoderFeed::finish));
                    });
                }
                Ok(Command::Stop) | Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    engine.feeds.stop_all(&mut engine.gpu);
                    return;
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
            }
        }
        let caught =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| engine.frame(now_ms())));
        if caught.is_err() {
            engine.stats.error = Some("A frame failed to draw (the engine carries on).".into());
        }
        if engine.frame_no % u64::from(engine.config.preview_every.max(1)) == 1 {
            *lock(&shared.previews) = engine.previews().clone();
            *lock(&shared.health) = engine.health();
            *lock(&shared.stats) = engine.stats.clone();
        }
        next += period;
        let now = Instant::now();
        if next > now {
            thread::sleep(next - now);
        } else {
            // Fell behind: start counting again from now instead of racing to catch up.
            next = now;
        }
    }
}
