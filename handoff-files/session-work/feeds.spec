@@@
use crate::gpu::{Compositor, Dest, Paint, Pass};
===
use crate::gpu::{Compositor, Dest, Paint, Pass};
use crate::zerocopy::{self, Handoff, Opener, Route};
@@@
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

/// What the encoder is told about the frames.
===
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// Hand the picture to the graphics card's encoder as a texture with
    /// these settings when it can (screens; see [`crate::zerocopy`]); None,
    /// or when it can't: read back as NV12 to FFmpeg.
    pub zero_copy: Option<zerocopy::Settings>,
}

/// What the encoder is told about the frames.
@@@
    pub stats: Option<FeedStats>,
    pub error: Option<String>,
}
===
    pub stats: Option<FeedStats>,
    pub error: Option<String>,
    /// How a screen's picture reaches its encoder (zero-copy or read-back, and why).
    pub route: Option<Route>,
}
@@@
pub type MakeFeed = Box<dyn FnOnce(FeedShape) -> Result<EncoderFeed, String> + Send>;
===
pub type MakeFeed = Box<dyn FnOnce(FeedShape) -> Result<EncoderFeed, String> + Send>;

/// How long a zero-copy encoder may take to open before the feed reads back instead.
const ZERO_COPY_OPEN: std::time::Duration = std::time::Duration::from_secs(10);
@@@
    /// The target's size.
    size: (u32, u32),
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
===
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
@@@
impl Feeds {
    fn target(
===
impl Feeds {
    /// Use `opener` for zero-copy encoders (None: always read back).
    pub fn set_opener(&mut self, opener: Option<Opener>) {
        self.opener = opener;
    }

    fn target(
@@@
            nv12: None,
            size: (spec.width.max(2) & !1, spec.height.max(2) & !1),
            error: None,
        };
===
            nv12: None,
            size: (spec.width.max(2) & !1, spec.height.max(2) & !1),
            error: None,
            zc: None,
            route: Route::read_back(None),
        };
@@@
                // Read back as NV12: a third of the bytes, what encoders take.
                let n = self.target(gpu, 2, 2);
                gpu.ensure_nv12_target(n, w, h);
                f.nv12 = Some(n);
                let shape = FeedShape {
                    width: w,
                    height: h,
                    fps: spec.fps,
                    pix_fmt: "nv12",
                };
                f.pending = Some(spawn_make(make, shape, Some(reply)));
===
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
@@@
        let f = self.feeds.remove(&id)?;
        for t in
===
        let mut f = self.feeds.remove(&id)?;
        // A zero-copy encoder encodes what it has and lets the picture end.
        if let Some(zc) = f.zc.as_mut() {
            zc.close();
        }
        for t in
@@@
                if let Ok(Ok(e)) = rx.recv() {
===
                if let Ok((Ok(e), _)) = rx.recv() {
@@@
    pub fn renew(&mut self, gpu: &mut Compositor, screen_size: (u32, u32)) {
        for f in self.feeds.values() {
===
    pub fn renew(&mut self, gpu: &mut Compositor, screen_size: (u32, u32)) {
        for f in self.feeds.values_mut() {
            // A zero-copy encoder's textures went with the device: it ends
            // the picture, and the app starts the session again on the new one.
            if let Some(mut zc) = f.zc.take() {
                zc.lost();
            }
@@@
                stats: f.enc.as_ref().map(EncoderFeed::stats),
                error: f.error.clone(),
            })
===
                stats: f.enc.as_ref().map(EncoderFeed::stats),
                error: f.error.clone(),
                route: matches!(f.spec.source, FeedSource::Screen { .. }).then(|| f.route.clone()),
            })
@@@
                match rx.try_recv() {
                    Ok(Ok(e)) => {
                        f.enc = Some(e);
                        f.pending = None;
                    }
                    Ok(Err(e)) => {
                        f.error = Some(e);
                        f.pending = None;
                    }
===
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
@@@
                        f.pending = Some(spawn_make(make, shape, None));
===
                        f.pending = Some(spawn_make(make, shape, None, None, Route::default()));
@@@
        let mut due: Vec<(u64, u64, Dest)> = Vec::new();
===
        let mut due: Vec<(u64, u64, Dest)> = Vec::new();
        let mut handed: Vec<(u64, u64, usize)> = Vec::new();
@@@
            let Some(nv12) = f.nv12 else { continue };
===
            if f.route.zero_copy {
                // Straight to the graphics card's encoder once drawn: no read-back.
                // (Its encoder gone with a lost device: nothing more, the feed is ending.)
                if f.zc.is_some() {
                    handed.push((*id, n, picture));
                }
                continue;
            }
            let Some(nv12) = f.nv12 else { continue };
@@@
        if !passes.is_empty() {
            gpu.render(&passes);
        }
===
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
