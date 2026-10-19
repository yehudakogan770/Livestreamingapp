W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'crates/live-engine/src/bin/live-bench.rs'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep("""use live_engine::encoder::EncoderFeed;
use live_engine::engine::{Config, DefaultFactory, LiveEngine};""","""use live_engine::encoder::{EncoderFeed, FeedArgs};
use live_engine::engine::{Config, DefaultFactory, LiveEngine};
use live_engine::feeds::{FeedSource, FeedSpec};""")
rep("""        match EncoderFeed::start(&ff, w, h, fps, &enc, &container, Box::new(|_| {})) {
            Ok(f) => engine.start_feed(ScreenId::Live, f),
            Err(e) => eprintln!("encode skipped: {e}"),
        }""","""        let started = engine.start_feed(
            1,
            FeedSpec {
                source: FeedSource::Screen {
                    screen: ScreenId::Live,
                    vertical: false,
                },
                width: w,
                height: h,
                fps,
            },
            Box::new(move |shape| {
                EncoderFeed::start(
                    &ff,
                    FeedArgs {
                        width: shape.width,
                        height: shape.height,
                        fps: shape.fps,
                        pix_fmt: shape.pix_fmt,
                        encode: enc,
                        container,
                        audio: None,
                    },
                    Box::new(|_| {}),
                    None,
                )
            }),
        );
        if let Ok(Err(e)) = started.recv() {
            eprintln!("encode skipped: {e}");
        }""")
rep("""    if let Some(f) = engine.stop_feed() {""","""    if let Some(f) = engine.stop_feed(1).map(EncoderFeed::finish) {""")
open(p,'w').write(s)
