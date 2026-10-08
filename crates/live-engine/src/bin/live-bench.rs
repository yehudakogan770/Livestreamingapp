//! Headless benchmark of the unified engine: four synthetic 1080p60 sources,
//! the Live Screen taking from one to the next with a different transition
//! every second, the Back Screen showing a four-way split, the Monitor an
//! overlay that changes every second; the three screens drawn and copied to
//! three stand-in output windows, the Live Screen read back for the encoder
//! every frame, previews ten times a second.
//!
//! ```sh
//! cargo run -p lumora-live-engine --release --bin live-bench -- [frames] [--encode] [--paced] [--size=WxH]
//! ```
//!
//! `--encode` also pipes the read-back frames into FFmpeg (x264 ultrafast,
//! output thrown away) to count dropped frames; `--paced` runs at 60 fps
//! instead of as fast as it can.

use std::time::{Duration, Instant};

use live_engine::encoder::{EncoderFeed, FeedArgs};
use live_engine::engine::{Config, DefaultFactory, LiveEngine};
use live_engine::feeds::{FeedSource, FeedSpec};
use live_engine::gpu::{Compositor, Dest, Paint, Pass};
use lumora_engine::{
    ActiveTransition, Fit, ScreenId, Show, Source, SourceAudio, SourceId, SourceKind, Split,
    SplitLayout, TransitionKind,
};

fn camera(i: usize) -> Source {
    Source {
        id: SourceId::new(format!("cam{i}")),
        name: format!("Camera {i}"),
        kind: SourceKind::Camera {
            device_id: format!("cam{i}"),
            label: format!("Camera {i}"),
        },
        volume: 1.0,
        muted: false,
        looping: false,
        fit: Fit::Cover,
        audio: SourceAudio::default(),
        key: Default::default(),
        adjust: Default::default(),
        speed: None,
        ptz: None,
        playlist: None,
        video_delay_ms: None,
        camera: None,
        background: Default::default(),
        auto_frame: Default::default(),
        screens: Vec::new(),
    }
}

const KINDS: [TransitionKind; 8] = [
    TransitionKind::Fade,
    TransitionKind::Wipe,
    TransitionKind::Slide,
    TransitionKind::Dip,
    TransitionKind::Iris,
    TransitionKind::LumaClock,
    TransitionKind::Zoom,
    TransitionKind::Blur,
];

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let frames: u64 = args.iter().find_map(|a| a.parse().ok()).unwrap_or(600);
    let encode = args.iter().any(|a| a == "--encode");
    let paced = args.iter().any(|a| a == "--paced");

    let gpu = match Compositor::headless() {
        Ok(g) => g,
        Err(e) => {
            eprintln!("No graphics adapter: {e}");
            std::process::exit(2);
        }
    };
    let info = gpu.describe();
    println!("adapter: {} ({}, {})", info.name, info.backend, info.kind);
    let size = args
        .iter()
        .find_map(|a| a.strip_prefix("--size="))
        .and_then(|v| v.split_once('x'))
        .and_then(|(w, h)| Some((w.parse().ok()?, h.parse().ok()?)));
    let mut config = Config::default();
    if let Some((w, h)) = size {
        config.width = w;
        config.height = h;
    }
    let fps = config.fps;
    let (w, h) = (config.width, config.height);
    let mut engine = LiveEngine::new(config, gpu, Box::new(DefaultFactory::new(None, true)));

    let mut show = Show {
        sources: (0..4).map(camera).collect(),
        ..Show::default()
    };
    let mut split = Split {
        layout: SplitLayout::Grid,
        ..Split::default()
    };
    split.apply_layout();
    for (i, b) in split.boxes.iter_mut().enumerate() {
        b.source_id = Some(SourceId::new(format!("cam{i}")));
    }
    let mut sp = camera(9);
    sp.id = SourceId::new("split");
    sp.kind = SourceKind::Split(Box::new(split));
    show.sources.push(sp);
    show.screens.live.program = Some(SourceId::new("cam0"));
    show.screens.live.preview = Some(SourceId::new("cam1"));
    show.screens.back.program = Some(SourceId::new("split"));
    show.screens.back.preview = Some(SourceId::new("cam2"));
    engine.set_show(show.clone());

    // Three stand-ins for the output windows.
    for i in 5..8 {
        engine.gpu.ensure_target(i, w, h);
    }
    if encode {
        let ff = std::path::PathBuf::from("ffmpeg");
        let enc: Vec<String> = [
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
        ]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
        let container: Vec<String> = ["-f", "null", "-"]
            .iter()
            .map(|s| (*s).to_owned())
            .collect();
        let started = engine.start_feed(
            1,
            FeedSpec {
                source: FeedSource::Screen {
                    screen: ScreenId::Live,
                    vertical: false,
                    captions: false,
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
        }
    }
    // Let the synthetic cameras deliver their first frames.
    std::thread::sleep(Duration::from_millis(300));

    let overlay: Vec<u8> = (0..w * h)
        .flat_map(|i| {
            let a = if (i / w) > h * 3 / 4 { 200 } else { 0 };
            [255u8, 255, 255, a]
        })
        .collect();
    let period = Duration::from_secs_f64(1.0 / f64::from(fps));
    let start = Instant::now();
    let mut now = 1_000_000u64;
    let mut take = 0usize;
    let mut worst = 0f64;
    let mut times = Vec::with_capacity(frames as usize);
    let mut read_ms = 0f64;
    let mut scene_ms = 0f64;
    let mut out_ms = 0f64;
    for n in 0..frames {
        let t0 = Instant::now();
        // A TAKE every second, with the next transition kind.
        if n % u64::from(fps) == 0 {
            let sc = &mut show.screens.live;
            sc.previous = sc.program.take();
            sc.program = sc.preview.take();
            sc.preview = Some(SourceId::new(format!("cam{}", (take + 2) % 4)));
            sc.transition = Some(ActiveTransition {
                kind: KINDS[take % KINDS.len()],
                duration_ms: 800,
                started_at: now,
            });
            take += 1;
            engine.set_show(show.clone());
            // The graphics layer changes about once a second.
            engine.set_overlay(ScreenId::Monitor, Some((w, h, &overlay)));
            engine.set_overlay(ScreenId::Live, Some((w, h, &overlay)));
        }
        // The engine's own CPU work: working out the three screens' scenes.
        let ts = Instant::now();
        for screen in ScreenId::ALL {
            std::hint::black_box(live_engine::scene::program_scene(&show, screen, now));
        }
        scene_ms += ts.elapsed().as_secs_f64() * 1000.0;
        engine.frame(now);
        // The three windows.
        let t1 = Instant::now();
        engine.gpu.render(&[
            Pass {
                dest: Dest::Target(5),
                viewport: None,
                paint: Paint::Target(0),
            },
            Pass {
                dest: Dest::Target(6),
                viewport: None,
                paint: Paint::Target(1),
            },
            Pass {
                dest: Dest::Target(7),
                viewport: None,
                paint: Paint::Target(2),
            },
        ]);
        let t2 = Instant::now();
        // The encoder's copy (when no FFmpeg feed is running: just the read-back).
        if !encode {
            let _ = engine.gpu.read_pipelined(Dest::Target(0));
        } else {
            engine.gpu.finish();
        }
        let t3 = Instant::now();
        out_ms += (t2 - t1).as_secs_f64() * 1000.0;
        read_ms += (t3 - t2).as_secs_f64() * 1000.0;
        let ms = (t3 - t0).as_secs_f64() * 1000.0;
        worst = worst.max(ms);
        times.push(ms);
        now += 1000 / u64::from(fps);
        if paced {
            let next = start + period * (n as u32 + 1);
            let t = Instant::now();
            if next > t {
                std::thread::sleep(next - t);
            }
        }
    }
    let wall = start.elapsed().as_secs_f64();
    times.sort_by(f64::total_cmp);
    let avg = times.iter().sum::<f64>() / times.len() as f64;
    let p95 = times[(times.len() * 95 / 100).min(times.len() - 1)];
    let s = &engine.stats;
    println!(
        "frames: {frames} in {wall:.2} s ({:.1} fps achievable)",
        frames as f64 / wall
    );
    println!("ms/frame: avg {avg:.2}, p95 {p95:.2}, worst {worst:.2}");
    println!(
        "  of which (last second): upload {:.2}, draw {:.2}, previews+read {:.2}; outputs {:.2}, encoder read-back {:.2}",
        s.upload_ms,
        s.render_ms,
        s.readback_ms,
        out_ms / frames as f64,
        read_ms / frames as f64
    );
    println!("  uploads: {:.0} MB/s", s.upload_mb_per_s);
    println!(
        "  scene maths (CPU, three screens): {:.4} ms/frame",
        scene_ms / frames as f64
    );
    if let Some(f) = engine.stop_feed(1).map(EncoderFeed::finish) {
        println!(
            "encoder feed: {} frames in, {} dropped{}",
            f.frames_in,
            f.frames_dropped,
            f.error.map(|e| format!(" ({e})")).unwrap_or_default()
        );
    }
    println!("previews: {}", engine.previews().len());
}
