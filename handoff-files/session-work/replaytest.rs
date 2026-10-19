
// ---------------------------------------------------------------------------
// Instant replay from the engine's own frames

#[test]
fn instant_replay_keeps_pieces_of_the_live_screen_and_plays_them_as_an_input() {
    use live_engine::replay::{container_args, keyframe_args, Ring};
    if std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .is_err()
    {
        eprintln!("no FFmpeg here; skipped");
        return;
    }
    let Some(mut e) = engine() else { return };
    let mut show = Show {
        sources: vec![cam("a")],
        ..Show::default()
    };
    show.screens.live.program = Some(SourceId::new("a"));
    e.set_show(show);
    let base = std::env::temp_dir().join(format!("lumora-replay-{}", std::process::id()));
    let mut ring = Ring::new(&base.join("ring"), 1).unwrap();
    let dir = ring.dir.clone();
    let make: MakeFeed = Box::new(move |shape| {
        let mut encode: Vec<String> = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]
            .map(str::to_owned)
            .to_vec();
        encode.extend(keyframe_args(1));
        EncoderFeed::start(
            std::path::Path::new("ffmpeg"),
            FeedArgs {
                width: shape.width,
                height: shape.height,
                fps: shape.fps,
                pix_fmt: shape.pix_fmt,
                encode,
                container: container_args(&dir, 1),
                audio: None,
            },
            Box::new(|_| {}),
            None,
        )
    });
    let spec = FeedSpec {
        source: FeedSource::Screen {
            screen: ScreenId::Live,
            vertical: false,
            captions: false,
        },
        width: W,
        height: H,
        fps: 30,
    };
    e.start_feed(9, spec, make).recv().unwrap().expect("starts");
    ring.t0_ms = live_engine::engine::now_ms();
    let now = live_engine::engine::now_ms;
    let until = now() + 3500;
    while now() < until {
        e.frame(now());
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    // Pieces finished while it runs (the last is finished when the feed stops).
    let during = ring.pieces();
    assert!(during.len() >= 2, "{during:?}");
    let took = ring.take(2000, now(), std::time::Duration::from_secs(3));
    assert!(!took.is_empty());
    e.stop_feed(9).expect("running").finish();
    // A piece plays back as one of the engine's inputs, in slow motion: the red Live Screen.
    let clip = live_engine::source::FfmpegFile::play(
        std::path::Path::new("ffmpeg"),
        &took[0].path,
        false,
        live_engine::source::Clip {
            speed: 0.5,
            looping: false,
            ..live_engine::source::Clip::LOOP
        },
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while clip.latest().is_none() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let f = clip.latest().expect("a picture from the replay");
    let p = f.data.as_slice();
    assert!(p[0] > 200 && p[1] < 60 && p[2] < 60, "{:?}", &p[..4]);
    let _ = std::fs::remove_dir_all(&base);
}
