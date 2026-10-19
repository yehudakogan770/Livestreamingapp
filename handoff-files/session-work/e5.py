W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'crates/live-engine/src/engine.rs'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep("""use crate::encoder::{EncoderFeed, FeedStats};""","""use crate::encoder::{EncoderFeed, FeedStats};
use crate::feeds::{FeedInfo, FeedSpec, Feeds, MakeFeed};""")
rep("""    pub feed: Option<FeedStats>,""","""    /// The first screen feed (the recording or stream).
    pub feed: Option<FeedStats>,
    /// Every feed: screens (recording, stream, vertical, NDI) and inputs (ISO files).
    pub feeds: Vec<FeedInfo>,""")
rep("""    feed: Option<(ScreenId, EncoderFeed)>,
""","""    feeds: Feeds,
""")
rep("""            feed: None,
""","""            feeds: Feeds::default(),
""")
rep("""    /// Start feeding a screen to an encoder (one at a time for now).
    pub fn start_feed(&mut self, screen: ScreenId, feed: EncoderFeed) {
        self.feed = Some((screen, feed));
    }

    /// Stop the encoder feed; FFmpeg finishes on its own thread.
    pub fn stop_feed(&mut self) -> Option<FeedStats> {
        self.feed.take().map(|(_, f)| f.finish())
    }""","""    /// Start feed `id` (see [`crate::feeds`]); the answer says whether its encoder started.
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
    }""")
rep("""        // 5. The encoder, and the previews.
        // One frame late, so the engine never waits for the GPU to finish the copy.
        if let Some((s, feed)) = &self.feed {
            if let Some((_, _, px)) = self.gpu.read_pipelined(Dest::Target(program_target(*s))) {
                feed.push(px);
            }
        }""","""        // 5. The encoders (read back one frame late, so the engine never
        // waits for the GPU to finish a copy), and the previews.
        if !self.feeds.is_empty() {
            let sources = &self.sources;
            let latest = |id: &SourceId| sources.get(id).and_then(|(_, s)| s.latest());
            self.feeds
                .tick(&mut self.gpu, now, &program_target, &latest);
        }""")
rep("""            self.stats.feed = self.feed.as_ref().map(|(_, f)| f.stats());""","""            self.stats.feeds = self.feeds.info();
            self.stats.feed = self
                .stats
                .feeds
                .iter()
                .find(|f| f.kind != "input")
                .and_then(|f| f.stats.clone());""")
rep("""    StartFeed(
        ScreenId,
        Box<dyn FnOnce(u32, u32, u32) -> Result<EncoderFeed, String> + Send>,
        Sender<Result<(), String>>,
    ),
    StopFeed(Sender<Option<FeedStats>>),""","""    StartFeed(u64, FeedSpec, MakeFeed, Sender<Result<(), String>>),
    StopFeed(u64, Sender<Option<FeedStats>>),""")
rep("""    /// Feed a screen to an encoder made by `make(width, height, fps)`.
    ///
    /// # Errors
    /// The encoder could not start.
    pub fn start_feed(
        &self,
        screen: ScreenId,
        make: Box<dyn FnOnce(u32, u32, u32) -> Result<EncoderFeed, String> + Send>,
    ) -> Result<(), String> {
        let (tx, rx) = channel();
        self.tx
            .send(Command::StartFeed(screen, make, tx))
            .map_err(|_| "The unified engine has stopped.".to_owned())?;
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "The unified engine did not answer.".to_owned())?
    }

    pub fn stop_feed(&self) -> Option<FeedStats> {
        let (tx, rx) = channel();
        self.tx.send(Command::StopFeed(tx)).ok()?;
        rx.recv_timeout(Duration::from_secs(40)).ok().flatten()
    }""","""    /// Start feed `id`: a screen or an input to an encoder `make` starts
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
    }""")
rep("""                Ok(Command::StartFeed(s, make, reply)) => {
                    let (w, h, fps) =
                        (engine.config.width, engine.config.height, engine.config.fps);
                    let r = make(w, h, fps).map(|f| engine.start_feed(s, f));
                    let _ = reply.send(r);
                }
                Ok(Command::StopFeed(reply)) => {
                    let _ = reply.send(engine.stop_feed());
                }
                Ok(Command::Stop) | Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    engine.stop_feed();
                    return;
                }""","""                Ok(Command::StartFeed(id, spec, make, reply)) => {
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
                }""")
open(p,'w').write(s)
p=W+'crates/live-engine/src/lib.rs'
s=open(p).read()
s=s.replace("pub mod encoder;\npub mod engine;\n","pub mod audio;\npub mod encoder;\npub mod engine;\npub mod feeds;\n")
open(p,'w').write(s)
