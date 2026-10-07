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

/// What a feed sends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeedSource {
    /// A screen as drawn (the recording, the stream); `vertical`: the 9:16
    /// version (the whole picture across the middle, a soft copy of it behind).
    Screen { screen: ScreenId, vertical: bool },
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

/// One feed and how it is doing (for the statistics).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedInfo {
    pub id: u64,
    /// `screen`, `vertical` or `input`.
    pub kind: &'static str,
    pub stats: Option<FeedStats>,
    pub error: Option<String>,
}

/// FFmpeg's name for a source's pixels.
pub fn pix_fmt(f: PixelFormat) -> &'static str {
    match f {
        PixelFormat::Rgba8 => "rgba",
        PixelFormat::Bgra8 => "bgra",
        PixelFormat::Bgrx8 => "bgr0",
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
    pending: Option<Receiver<Result<EncoderFeed, String>>>,
    /// Drawn at its own size (and the vertical's small copy).
    target: Option<usize>,
    small: Option<usize>,
    error: Option<String>,
}

#[derive(Default)]
pub struct Feeds {
    feeds: HashMap<u64, Feed>,
    free: Vec<usize>,
    next: usize,
}

fn spawn_make(
    make: MakeFeed,
    shape: FeedShape,
    reply: Option<Sender<Result<(), String>>>,
) -> Receiver<Result<EncoderFeed, String>> {
    let (tx, rx) = channel();
    let started = thread::Builder::new()
        .name("lumora-live-feed-start".into())
        .spawn(move || {
            let r = make(shape);
            if let Some(reply) = reply {
                let _ = reply.send(r.as_ref().map(|_| ()).map_err(Clone::clone));
            }
            let _ = tx.send(r);
        });
    if let Err(e) = started {
        eprintln!("lumora: a feed could not start: {e}");
    }
    rx
}

impl Feeds {
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
            error: None,
        };
        match &spec.source {
            FeedSource::Screen { vertical, .. } => {
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
                };
                f.pending = Some(spawn_make(make, shape, Some(reply)));
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
        let f = self.feeds.remove(&id)?;
        for t in [f.target, f.small].into_iter().flatten() {
            gpu.drop_target(t);
            self.free.push(t);
        }
        // One still starting is finished when it arrives.
        if let Some(rx) = f.pending {
            thread::spawn(move || {
                if let Ok(Ok(e)) = rx.recv() {
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
                    Ok(Ok(e)) => {
                        f.enc = Some(e);
                        f.pending = None;
                    }
                    Ok(Err(e)) => {
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
                        f.pending = Some(spawn_make(make, shape, None));
                    }
                }
            }
        }
        // Screens: draw each feed at its size, then read every one back (one frame late).
        let mut passes: Vec<Pass<'_>> = Vec::new();
        let mut due: Vec<(u64, u64, Dest)> = Vec::new();
        for (id, f) in &mut self.feeds {
            let (FeedSource::Screen { screen, .. }, Some(enc)) = (&f.spec.source, f.enc.as_mut())
            else {
                continue;
            };
            let n = enc.due(now);
            if n == 0 {
                continue;
            }
            let src = program(*screen);
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
            due.push((*id, n, dest));
        }
        if !passes.is_empty() {
            gpu.render(&passes);
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
