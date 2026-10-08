//! Everything the engine sends to encoders at once: the recording, the
//! stream, the vertical version and NDI (each a drawn screen, scaled on the
//! GPU to its own size before it is read back), and each camera's own ISO
//! file (its frames as they came, no GPU at all).
//!
//! FFmpeg is started and finished on threads of its own, so the engine
//! never waits for a process to start or for an encoder to write its last
//! frames.

use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
use std::sync::Arc;
use std::thread;

use lumora_engine::{ScreenId, SourceId};
use serde::Serialize;

use crate::encoder::{EncoderFeed, FeedStats, Pixels};
use crate::frame::{PixelFormat, VideoFrame};
use crate::gpu::{Compositor, Dest, Paint, Pass};
use crate::zerocopy::{self, Handoff, Opener, Route};

/// What a feed sends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeedSource {
    /// A screen as drawn (the recording, the stream); `vertical`: the 9:16
    /// version (the whole picture across the middle, a soft copy of it behind);
    /// `captions`: the live captions written in the picture (the stream and
    /// its vertical version, when asked: the screen's `cap` plane; the
    /// recording stays clean).
    Screen {
        screen: ScreenId,
        vertical: bool,
        captions: bool,
    },
    /// One input's own frames (a camera's ISO file).
    Input(SourceId),
}

/// A feed's source and its picture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeedSpec {
    pub source: FeedSource,
    /// The size it is sent at (screens; an input is sent at its own size).
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// Hand the picture to the graphics card's encoder as a texture with
    /// these settings when it can (screens; see [`crate::zerocopy`]); None,
    /// or when it can't: read back as NV12 to FFmpeg.
    pub zero_copy: Option<zerocopy::Settings>,
}

/// What the encoder is told about the frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeedShape {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// FFmpeg's pixel format name.
    pub pix_fmt: &'static str,
}

/// Starts the encoder once the frames' shape is known (on a thread of its own).
pub type MakeFeed = Box<dyn FnOnce(FeedShape) -> Result<EncoderFeed, String> + Send>;

/// How long a zero-copy encoder may take to open before the feed reads back instead.
const ZERO_COPY_OPEN: std::time::Duration = std::time::Duration::from_secs(10);

/// One feed and how it is doing (for the statistics).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedInfo {
    pub id: u64,
    /// `screen`, `vertical` or `input`.
    pub kind: &'static str,
    pub stats: Option<FeedStats>,
    pub error: Option<String>,
    /// How a screen's picture reaches its encoder (zero-copy or read-back, and why).
    pub route: Option<Route>,
}

/// FFmpeg's name for a source's pixels.
pub fn pix_fmt(f: PixelFormat) -> &'static str {
    match f {
        PixelFormat::Rgba8 => "rgba",
        PixelFormat::Bgra8 => "bgra",
        PixelFormat::Bgrx8 => "bgr0",
        PixelFormat::Nv12 => "nv12",
        // HDR cameras' and files' own pixels (an ISO file is made SDR by the encoder's format).
        PixelFormat::Rgb10(_) => "x2bgr10le",
        PixelFormat::P010(_) => "p010le",
    }
}

/// The small copy the vertical version's soft background is stretched from.
const SMALL: (u32, u32) = (48, 27);
/// Feed targets are numbered from here (the screens, Next and the multiview come first).
const FIRST_TARGET: usize = 16;

struct Feed {
    spec: FeedSpec,
    enc: Option<EncoderFeed>,
    /// An input's encoder waits for its first frame (its size).
    make: Option<MakeFeed>,
    pending: Option<Receiver<Started>>,
    /// Drawn at its own size (and the vertical's small copy).
    target: Option<usize>,
    small: Option<usize>,
    /// The screen with the captions written on it (the screen's size).
    captioned: Option<usize>,
    /// Its NV12 copy, read back for the encoder (screens).
    nv12: Option<usize>,
    /// The target's size.
    size: (u32, u32),
    error: Option<String>,
    /// The graphics card's encoder taking the picture as a texture (zero-copy).
    zc: Option<Box<dyn Handoff>>,
    route: Route,
}

type Started = (Result<EncoderFeed, String>, Route);

pub struct Feeds {
    feeds: HashMap<u64, Feed>,
    free: Vec<usize>,
    next: usize,
    /// Opens zero-copy encoders (this computer's; a stand-in in tests).
    opener: Option<Opener>,
}

impl Default for Feeds {
    fn default() -> Self {
        Feeds {
            feeds: HashMap::new(),
            free: Vec::new(),
            next: 0,
            opener: zerocopy::platform(),
        }
    }
}

/// Start the encoder on a thread of its own. With a zero-copy encoder being
/// opened (`zc`: its answer and the encoded picture's name), it waits for
/// it: open, FFmpeg copies the encoded picture; not, it takes NV12 as before.
fn spawn_make(
    make: MakeFeed,
    mut shape: FeedShape,
    reply: Option<Sender<Result<(), String>>>,
    zc: Option<(Receiver<Result<String, String>>, &'static str)>,
    mut route: Route,
) -> Receiver<Started> {
    let (tx, rx) = channel();
    let started = thread::Builder::new()
        .name("lumora-live-feed-start".into())
        .spawn(move || {
            if let Some((ready, pix_fmt)) = zc {
                route = match ready.recv_timeout(ZERO_COPY_OPEN) {
                    Ok(Ok(path)) => {
                        shape.pix_fmt = pix_fmt;
                        Route {
                            zero_copy: true,
                            path,
                        }
                    }
                    Ok(Err(why)) => Route::read_back(Some(&why)),
                    Err(_) => Route::read_back(Some("the graphics card's encoder did not open")),
                };
            }
            let r = make(shape);
            if let Some(reply) = reply {
                let _ = reply.send(r.as_ref().map(|_| ()).map_err(Clone::clone));
            }
            let _ = tx.send((r, route));
        });
    if let Err(e) = started {
        eprintln!("lumora: a feed could not start: {e}");
    }
    rx
}

impl Feeds {
    /// Use `opener` for zero-copy encoders (None: always read back).
    pub fn set_opener(&mut self, opener: Option<Opener>) {
        self.opener = opener;
    }

    fn target(&mut self, gpu: &mut Compositor, w: u32, h: u32) -> usize {
        let i = self.free.pop().unwrap_or_else(|| {
            self.next += 1;
            FIRST_TARGET + self.next - 1
        });
        gpu.ensure_target(i, w, h);
        i
    }

    /// Start feed `id`. A screen's encoder starts now (`reply` hears whether
    /// it did); an input's once its first frame is there (`reply` hears at once).
    pub fn start(
        &mut self,
        gpu: &mut Compositor,
        id: u64,
        spec: FeedSpec,
        make: MakeFeed,
        screen_size: (u32, u32),
        reply: Sender<Result<(), String>>,
    ) {
        if let Some(old) = self.stop(gpu, id) {
            thread::spawn(move || drop(old.finish()));
        }
        let mut f = Feed {
            spec: spec.clone(),
            enc: None,
            make: None,
            pending: None,
            target: None,
            small: None,
            captioned: None,
            nv12: None,
            size: (spec.width.max(2) & !1, spec.height.max(2) & !1),
            error: None,
            zc: None,
            route: Route::read_back(None),
        };
        match &spec.source {
            FeedSource::Screen {
                vertical, captions, ..
            } => {
                let (w, h) = f.size;
                if *vertical || (w, h) != screen_size {
                    f.target = Some(self.target(gpu, w, h));
                }
                if *captions {
                    f.captioned = Some(self.target(gpu, screen_size.0, screen_size.1));
                }
                if *vertical {
                    f.small = Some(self.target(gpu, SMALL.0, SMALL.1));
                }
                // Read back as NV12: a third of the bytes, what encoders take
                // (also when a zero-copy encoder can't be used).
                let n = self.target(gpu, 2, 2);
                gpu.ensure_nv12_target(n, w, h);
                f.nv12 = Some(n);
                let shape = FeedShape {
                    width: w,
                    height: h,
                    fps: spec.fps,
                    pix_fmt: "nv12",
                };
                // Or straight to the graphics card's encoder, as a texture.
                let mut zc = None;
                if let Some(settings) = &spec.zero_copy {
                    let opened = match (zerocopy::broken(), &self.opener) {
                        (Some(why), _) => Err(format!("zero-copy stopped earlier: {why}")),
                        (None, None) => Err("no zero-copy encoder on this computer".to_owned()),
                        (None, Some(open)) => open(gpu, (w, h), spec.fps, settings),
                    };
                    match opened {
                        Ok(o) => {
                            f.zc = Some(o.handoff);
                            zc = Some((o.ready, settings.pix_fmt()));
                        }
                        Err(why) => f.route = Route::read_back(Some(&why)),
                    }
                }
                f.pending = Some(spawn_make(make, shape, Some(reply), zc, f.route.clone()));
            }
            FeedSource::Input(_) => {
                f.make = Some(make);
                let _ = reply.send(Ok(()));
            }
        }
        self.feeds.insert(id, f);
    }

    /// Stop feed `id`; the caller finishes it (off the engine's thread).
    pub fn stop(&mut self, gpu: &mut Compositor, id: u64) -> Option<EncoderFeed> {
        let mut f = self.feeds.remove(&id)?;
        // A zero-copy encoder encodes what it has and lets the picture end.
        if let Some(zc) = f.zc.as_mut() {
            zc.close();
        }
        for t in [f.target, f.small, f.captioned, f.nv12]
            .into_iter()
            .flatten()
        {
            gpu.drop_target(t);
            self.free.push(t);
        }
        // One still starting is finished when it arrives.
        if let Some(rx) = f.pending {
            thread::spawn(move || {
                if let Ok((Ok(e), _)) = rx.recv() {
                    drop(e.finish());
                }
            });
        }
        f.enc
    }

    /// Stop every feed (the engine is stopping); they finish on their own threads.
    pub fn stop_all(&mut self, gpu: &mut Compositor) {
        let ids: Vec<u64> = self.feeds.keys().copied().collect();
        for id in ids {
            if let Some(e) = self.stop(gpu, id) {
                thread::spawn(move || drop(e.finish()));
            }
        }
    }

    /// A new graphics device: the feeds' targets are made again on it.
    pub fn renew(&mut self, gpu: &mut Compositor, screen_size: (u32, u32)) {
        for f in self.feeds.values_mut() {
            // A zero-copy encoder's textures went with the device: it ends
            // the picture, and the app starts the session again on the new one.
            if let Some(mut zc) = f.zc.take() {
                zc.lost();
            }
            if let Some(t) = f.captioned {
                gpu.ensure_target(t, screen_size.0, screen_size.1);
            }
            if let Some(t) = f.target {
                gpu.ensure_target(t, f.size.0, f.size.1);
            }
            if let Some(t) = f.small {
                gpu.ensure_target(t, SMALL.0, SMALL.1);
            }
            if let Some(t) = f.nv12 {
                gpu.ensure_nv12_target(t, f.size.0, f.size.1);
            }
        }
    }

    /// Feed `id`'s encoder has started.
    pub fn running(&self, id: u64) -> bool {
        self.feeds.get(&id).is_some_and(|f| f.enc.is_some())
    }

    pub fn is_empty(&self) -> bool {
        self.feeds.is_empty()
    }

    /// Inputs whose frames a feed needs (the engine keeps them open).
    pub fn inputs(&self) -> impl Iterator<Item = &SourceId> {
        self.feeds.values().filter_map(|f| match &f.spec.source {
            FeedSource::Input(id) => Some(id),
            FeedSource::Screen { .. } => None,
        })
    }

    pub fn info(&self) -> Vec<FeedInfo> {
        let mut v: Vec<FeedInfo> = self
            .feeds
            .iter()
            .map(|(id, f)| FeedInfo {
                id: *id,
                kind: match f.spec.source {
                    FeedSource::Screen {
                        vertical: false, ..
                    } => "screen",
                    FeedSource::Screen { vertical: true, .. } => "vertical",
                    FeedSource::Input(_) => "input",
                },
                stats: f.enc.as_ref().map(EncoderFeed::stats),
                error: f.error.clone(),
                route: matches!(f.spec.source, FeedSource::Screen { .. }).then(|| f.route.clone()),
            })
            .collect();
        v.sort_by_key(|f| f.id);
        v
    }

    /// Once a frame, after the screens are drawn: each feed's frames that
    /// fell due at `now`. `program(screen)` is where a screen is drawn;
    /// `latest(input)` an input's newest frame.
    pub fn tick(
        &mut self,
        gpu: &mut Compositor,
        now: u64,
        program: &dyn Fn(ScreenId) -> usize,
        latest: &dyn Fn(&SourceId) -> Option<VideoFrame>,
    ) {
        // Encoders that have started; inputs that have their first frame.
        for f in self.feeds.values_mut() {
            if let Some(rx) = &f.pending {
                match rx.try_recv() {
                    Ok((Ok(e), route)) => {
                        if route.zero_copy {
                            if let (Some(zc), Some(out)) = (f.zc.as_mut(), e.bitstream()) {
                                zc.attach(out);
                            }
                        } else {
                            f.zc = None;
                        }
                        f.route = route;
                        f.enc = Some(e);
                        f.pending = None;
                    }
                    Ok((Err(e), route)) => {
                        f.route = route;
                        f.zc = None;
                        f.error = Some(e);
                        f.pending = None;
                    }
                    Err(TryRecvError::Disconnected) => f.pending = None,
                    Err(TryRecvError::Empty) => {}
                }
            }
            if let (FeedSource::Input(id), Some(_)) = (&f.spec.source, &f.make) {
                if let Some(fr) = latest(id) {
                    let shape = FeedShape {
                        width: fr.width,
                        height: fr.height,
                        fps: f.spec.fps,
                        pix_fmt: pix_fmt(fr.format),
                    };
                    if let Some(make) = f.make.take() {
                        f.pending = Some(spawn_make(make, shape, None, None, Route::default()));
                    }
                }
            }
        }
        // Screens: draw each feed at its size, then read every one back (one frame late).
        let mut passes: Vec<Pass<'_>> = Vec::new();
        let mut due: Vec<(u64, u64, Dest)> = Vec::new();
        let mut handed: Vec<(u64, u64, usize)> = Vec::new();
        for (id, f) in &mut self.feeds {
            let (FeedSource::Screen { screen, .. }, Some(enc)) = (&f.spec.source, f.enc.as_mut())
            else {
                continue;
            };
            let n = enc.due(now);
            if n == 0 {
                continue;
            }
            let mut src = program(*screen);
            // Captions on the screen's picture first (only while there are some).
            if let Some(c) = f
                .captioned
                .filter(|_| gpu.has_plane(src, crate::overlay::CAPTIONS))
            {
                let size = gpu.target_size(c).unwrap_or((1, 1));
                passes.push(Pass {
                    dest: Dest::Target(c),
                    viewport: None,
                    paint: Paint::Target(src),
                });
                passes.push(Pass {
                    dest: Dest::Target(c),
                    viewport: Some([0, 0, size.0, size.1]),
                    paint: Paint::Plane {
                        slot: src,
                        name: crate::overlay::CAPTIONS,
                    },
                });
                src = c;
            }
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
            if f.route.zero_copy {
                // Straight to the graphics card's encoder once drawn: no read-back.
                // (Its encoder gone with a lost device: nothing more, the feed is ending.)
                if f.zc.is_some() {
                    handed.push((*id, n, picture));
                }
                continue;
            }
            let Some(nv12) = f.nv12 else { continue };
            passes.push(Pass {
                dest: Dest::Target(nv12),
                viewport: None,
                paint: Paint::Nv12(picture),
            });
            due.push((*id, n, Dest::Target(nv12)));
        }
        if !passes.is_empty() {
            gpu.render(&passes);
        }
        for (id, n, picture) in handed {
            let Some(f) = self.feeds.get_mut(&id) else {
                continue;
            };
            let (Some(zc), Some(enc)) = (f.zc.as_mut(), f.enc.as_mut()) else {
                continue;
            };
            let total = enc.with_owed(n);
            if zc.submit(gpu, picture, total) {
                enc.handed_over();
            } else {
                enc.missed(n, total);
            }
            if let Some(why) = zc.failed() {
                f.error = Some(why);
            }
        }
        let mut read: HashMap<Dest, Option<Arc<Vec<u8>>>> = HashMap::new();
        for (id, n, dest) in due {
            let px = read
                .entry(dest)
                .or_insert_with(|| gpu.read_pipelined(dest).map(|(_, _, v)| Arc::new(v)))
                .clone();
            if let Some(enc) = self.feeds.get_mut(&id).and_then(|f| f.enc.as_mut()) {
                match px {
                    Some(p) => {
                        enc.push(Pixels::Shared(p), n);
                    }
                    None => enc.owe(n),
                }
            }
        }
        // Inputs: their frames as they came.
        for f in self.feeds.values_mut() {
            let (FeedSource::Input(id), Some(enc)) = (&f.spec.source, f.enc.as_mut()) else {
                continue;
            };
            let n = enc.due(now);
            if n == 0 {
                continue;
            }
            match latest(id) {
                Some(fr) if fr.data.as_slice().len() == enc.frame_len() => {
                    enc.push(Pixels::Frame(fr), n);
                }
                // Not there (or another size since the camera came back): the time is kept.
                _ => enc.owe(n),
            }
        }
    }
}
