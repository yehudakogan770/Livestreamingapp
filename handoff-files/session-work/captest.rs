
#[test]
fn captions_are_written_into_the_stream_but_not_the_recording_or_the_screen() {
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
    // The overlay renderer's caption plane: a white box over the bottom half.
    let px: Vec<u8> = (0..W * H)
        .flat_map(|i| {
            if i / W >= H / 2 {
                [255, 255, 255, 255]
            } else {
                [0, 0, 0, 0]
            }
        })
        .collect();
    apply(
        &mut e,
        encode(&[(
            Op::Patch,
            ScreenId::Live,
            live_engine::overlay::CAPTIONS,
            W,
            H,
            0,
            vec![([0, 0, W, H], &px[..])],
        )]),
    );
    let (rec, stream) = (
        Arc::new(Mutex::new(Vec::new())),
        Arc::new(Mutex::new(Vec::new())),
    );
    let spec = |captions: bool| FeedSpec {
        source: FeedSource::Screen {
            screen: ScreenId::Live,
            vertical: false,
            captions,
        },
        width: W,
        height: H,
        fps: 30,
    };
    let a = e.start_feed(1, spec(false), raw_feed(Arc::clone(&rec)));
    let b = e.start_feed(2, spec(true), raw_feed(Arc::clone(&stream)));
    for r in [a, b] {
        r.recv().unwrap().expect("starts");
    }
    let now = live_engine::engine::now_ms;
    let t0 = now();
    let mut until = None;
    while until.is_none_or(|u| now() < u) && now() < t0 + 10_000 {
        e.frame(now());
        if until.is_none() && [1, 2].iter().all(|id| e.feed_running(*id)) {
            until = Some(now() + 500);
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    for id in [1, 2] {
        e.stop_feed(id).expect("running").finish();
    }
    let frame = (W * H * 4) as usize;
    let at = |v: &[u8], x: u32, y: u32| {
        let last = &v[v.len() - frame..];
        let i = ((y * W + x) * 4) as usize;
        [last[i], last[i + 1], last[i + 2], last[i + 3]]
    };
    let rec = rec.lock().unwrap();
    let stream = stream.lock().unwrap();
    assert!(rec.len() >= frame * 4 && stream.len() >= frame * 4);
    // The recording stays clean; the stream has the captions at the bottom.
    assert!(near(at(&rec, 30, 30), [255, 0, 0, 255]), "{:?}", at(&rec, 30, 30));
    assert!(near(at(&stream, 30, 5), [255, 0, 0, 255]), "{:?}", at(&stream, 30, 5));
    let s = at(&stream, 30, 30);
    assert!(s[1] > 200 && s[2] > 200, "{s:?}");
    // The screen itself never shows them.
    let live = e.gpu.read(Dest::Target(0)).unwrap().2;
    assert!(near(px_at(&live, 30, 30), [255, 0, 0, 255]));
}

fn px_at(img: &[u8], x: u32, y: u32) -> [u8; 4] {
    px(img, x, y)
}
