//! The compositor on a real GPU (or a software one such as llvmpipe /
//! WARP): scenes drawn offscreen and read back. Skipped, with a note, on a
//! computer with no graphics adapter at all.

use std::sync::{Arc, Mutex};

use live_engine::encoder::{EncoderFeed, FeedArgs};
use live_engine::engine::{Config, LiveEngine, SourceFactory};
use live_engine::feeds::{FeedSource, FeedSpec, MakeFeed};
use live_engine::frame::{FramePool, PixelFormat, VideoFrame};
use live_engine::gpu::{Compositor, Dest, Paint, Pass};
use live_engine::mix::Shape;
use live_engine::overlay::{encode, parse, Op};
use live_engine::scene::{Content, Layer, Picture, Placement, ScreenScene};
use live_engine::source::{SourceHealth, SourceState, VideoSource};
use lumora_engine::{
    ActiveTransition, Fit, ScreenId, Show, Source, SourceAudio, SourceId, SourceKind,
    TransitionKind,
};

fn gpu() -> Option<Compositor> {
    // On Windows (CI's software adapter included) only when asked, as the Studio engine's tests.
    if cfg!(windows) && std::env::var_os("LUMORA_GPU_TESTS").is_none() {
        eprintln!("GPU tests on Windows need LUMORA_GPU_TESTS=1; skipped");
        return None;
    }
    match Compositor::headless() {
        Ok(g) => {
            eprintln!("GPU: {:?}", g.describe());
            Some(g)
        }
        Err(e) => {
            eprintln!("no GPU here ({e}); skipped");
            None
        }
    }
}

const W: u32 = 64;
const H: u32 = 36;

fn solid(rgba: [u8; 4], w: u32, h: u32, seq: u64) -> VideoFrame {
    let pool = FramePool::new(1);
    VideoFrame::build(&pool, w, h, PixelFormat::Rgba8, seq, |px| {
        for p in px.as_chunks_mut::<4>().0 {
            p.copy_from_slice(&rgba);
        }
    })
}

fn layer(id: &str, opacity: f32) -> Layer {
    Layer {
        source: SourceId::new(id),
        pictures: vec![Picture {
            content: Content::Video(SourceId::new(id)),
            placement: Placement {
                fit: Fit::Cover,
                ..Placement::default()
            },
        }],
        opacity,
        shift: [0.0, 0.0],
        scale: 1.0,
        blur: 0.0,
        shape: Shape::Whole,
        luma: None,
        top: false,
    }
}

fn draw(g: &mut Compositor, sc: &ScreenScene) -> Vec<u8> {
    g.ensure_target(0, W, H);
    g.render(&[Pass {
        dest: Dest::Target(0),
        viewport: None,
        paint: Paint::Scene {
            scene: sc,
            planes: None,
        },
    }]);
    g.read(Dest::Target(0)).expect("read back").2
}

fn px(img: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * W + x) * 4) as usize;
    [img[i], img[i + 1], img[i + 2], img[i + 3]]
}

fn near(a: [u8; 4], b: [u8; 4]) -> bool {
    a.iter().zip(b).all(|(x, y)| x.abs_diff(y) <= 3)
}

fn setup(g: &mut Compositor) {
    g.upload(&SourceId::new("red"), &solid([255, 0, 0, 255], W, H, 1));
    g.upload(&SourceId::new("blue"), &solid([0, 0, 255, 255], W, H, 1));
}

#[test]
fn a_fade_mixes_the_two_inputs() {
    let Some(mut g) = gpu() else { return };
    setup(&mut g);
    let sc = ScreenScene {
        layers: vec![layer("red", 1.0), layer("blue", 0.5)],
        ..ScreenScene::default()
    };
    let img = draw(&mut g, &sc);
    assert!(
        near(px(&img, 10, 10), [128, 0, 128, 255]),
        "{:?}",
        px(&img, 10, 10)
    );
}

#[test]
fn a_wipe_shows_the_new_input_on_the_left() {
    let Some(mut g) = gpu() else { return };
    setup(&mut g);
    let mut b = layer("blue", 1.0);
    b.shape = Shape::Rect {
        t: 0.0,
        r: 0.5,
        b: 0.0,
        l: 0.0,
    };
    let sc = ScreenScene {
        layers: vec![layer("red", 1.0), b],
        ..ScreenScene::default()
    };
    let img = draw(&mut g, &sc);
    assert!(near(px(&img, 5, 18), [0, 0, 255, 255]));
    assert!(near(px(&img, 58, 18), [255, 0, 0, 255]));
}

#[test]
fn pipelined_read_back_is_one_frame_late() {
    let Some(mut g) = gpu() else { return };
    setup(&mut g);
    let red = ScreenScene {
        layers: vec![layer("red", 1.0)],
        ..ScreenScene::default()
    };
    let blue = ScreenScene {
        layers: vec![layer("blue", 1.0)],
        ..ScreenScene::default()
    };
    g.ensure_target(0, W, H);
    let paint = |g: &mut Compositor, sc: &ScreenScene| {
        g.render(&[Pass {
            dest: Dest::Target(0),
            viewport: None,
            paint: Paint::Scene {
                scene: sc,
                planes: None,
            },
        }]);
    };
    paint(&mut g, &red);
    assert!(
        g.read_pipelined(Dest::Target(0)).is_none(),
        "nothing yet on the first call"
    );
    paint(&mut g, &blue);
    let (_, _, img) = g.read_pipelined(Dest::Target(0)).expect("the red frame");
    assert!(near(px(&img, 5, 5), [255, 0, 0, 255]));
    paint(&mut g, &red);
    let (_, _, img) = g.read_pipelined(Dest::Target(0)).expect("the blue frame");
    assert!(near(px(&img, 5, 5), [0, 0, 255, 255]));
}

#[test]
fn blank_and_panic_cover_everything() {
    let Some(mut g) = gpu() else { return };
    setup(&mut g);
    let sc = ScreenScene {
        layers: vec![layer("red", 1.0)],
        blank: 1.0,
        ..ScreenScene::default()
    };
    assert!(near(px(&draw(&mut g, &sc), 30, 20), [0, 0, 0, 255]));
    let sc = ScreenScene {
        layers: vec![layer("red", 1.0)],
        white: 1.0,
        ..ScreenScene::default()
    };
    assert!(near(px(&draw(&mut g, &sc), 30, 20), [255, 255, 255, 255]));
}

#[test]
fn a_square_picture_is_pillarboxed_when_contained() {
    let Some(mut g) = gpu() else { return };
    g.upload(&SourceId::new("sq"), &solid([0, 255, 0, 255], 16, 16, 1));
    let mut l = layer("sq", 1.0);
    l.pictures[0].placement.fit = Fit::Contain;
    let sc = ScreenScene {
        layers: vec![l],
        ..ScreenScene::default()
    };
    let img = draw(&mut g, &sc);
    assert!(near(px(&img, 2, 18), [0, 0, 0, 255]), "bars at the sides");
    assert!(
        near(px(&img, 32, 18), [0, 255, 0, 255]),
        "picture in the middle"
    );
}

#[test]
fn a_slide_moves_the_layer() {
    let Some(mut g) = gpu() else { return };
    setup(&mut g);
    let mut b = layer("blue", 1.0);
    b.shift = [50.0, 0.0];
    let sc = ScreenScene {
        layers: vec![layer("red", 1.0), b],
        ..ScreenScene::default()
    };
    let img = draw(&mut g, &sc);
    assert!(near(px(&img, 10, 18), [255, 0, 0, 255]));
    assert!(near(px(&img, 50, 18), [0, 0, 255, 255]));
}

#[test]
fn the_overlay_layer_goes_over_the_inputs() {
    let Some(mut g) = gpu() else { return };
    setup(&mut g);
    // Half-transparent white on the bottom half.
    let ov: Vec<u8> = (0..W * H)
        .flat_map(|i| {
            if i / W >= H / 2 {
                [255, 255, 255, 128]
            } else {
                [0, 0, 0, 0]
            }
        })
        .collect();
    g.set_overlay(0, Some((W, H, &ov)));
    let sc = ScreenScene {
        layers: vec![layer("blue", 1.0)],
        ..ScreenScene::default()
    };
    g.ensure_target(0, W, H);
    g.render(&[Pass {
        dest: Dest::Target(0),
        viewport: None,
        paint: Paint::Scene {
            scene: &sc,
            planes: Some(0),
        },
    }]);
    let img = g.read(Dest::Target(0)).unwrap().2;
    assert!(near(px(&img, 10, 5), [0, 0, 255, 255]));
    assert!(
        near(px(&img, 10, 30), [128, 128, 255, 255]),
        "{:?}",
        px(&img, 10, 30)
    );
}

struct Solid([u8; 4]);
impl VideoSource for Solid {
    fn latest(&self) -> Option<VideoFrame> {
        Some(solid(self.0, W, H, 0))
    }
    fn health(&self) -> SourceHealth {
        SourceHealth {
            state: SourceState::Live,
            frames: 1,
            width: W,
            height: H,
            fps: 0.0,
        }
    }
    fn describe(&self) -> String {
        "solid".into()
    }
}

struct Colors;
impl SourceFactory for Colors {
    fn key(&self, src: &Source) -> String {
        src.id.to_string()
    }
    fn open(&mut self, src: &Source) -> Box<dyn VideoSource> {
        Box::new(Solid(if src.id.as_str() == "a" {
            [255, 0, 0, 255]
        } else {
            [0, 0, 255, 255]
        }))
    }
}

fn cam(id: &str) -> Source {
    Source {
        id: SourceId::new(id),
        name: id.into(),
        kind: SourceKind::Camera {
            device_id: id.into(),
            label: id.into(),
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

#[test]
fn the_engine_draws_the_show_and_its_previews() {
    let Some(g) = gpu() else { return };
    let config = Config {
        width: W,
        height: H,
        fps: 60,
        preview_w: 16,
        preview_h: 9,
        preview_every: 1,
    };
    let mut e = LiveEngine::new(config, g, Box::new(Colors));
    let mut show = Show {
        sources: vec![cam("a"), cam("b")],
        ..Show::default()
    };
    show.screens.live.program = Some(SourceId::new("a"));
    show.screens.live.preview = Some(SourceId::new("b"));
    e.set_show(show.clone());
    e.frame(1000);
    let live = e.gpu.read(Dest::Target(0)).unwrap().2;
    assert!(near(px(&live, 30, 20), [255, 0, 0, 255]));
    // Previews: on air, next and each input.
    let p = &e.previews()["next/live"];
    assert_eq!((p.width, p.height), (16, 9));
    assert!(near(
        [p.rgba[0], p.rgba[1], p.rgba[2], p.rgba[3]],
        [0, 0, 255, 255]
    ));
    assert!(e.previews().contains_key("source/a"));
    // A fade half way.
    let sc = &mut show.screens.live;
    sc.previous = sc.program.take();
    sc.program = sc.preview.take();
    sc.transition = Some(ActiveTransition {
        kind: TransitionKind::Fade,
        duration_ms: 1000,
        started_at: 1000,
    });
    e.set_show(show);
    e.frame(1500);
    let live = e.gpu.read(Dest::Target(0)).unwrap().2;
    assert!(
        near(px(&live, 30, 20), [128, 0, 128, 255]),
        "{:?}",
        px(&live, 30, 20)
    );
    // The health of each input, for the backup lineup.
    assert_eq!(e.health().len(), 2);
    assert!(e.stats.adapter.is_some());
}

// ---------------------------------------------------------------------------
// Graphics from the web overlay renderer

fn text_input(id: &str) -> Source {
    Source {
        kind: SourceKind::Text(Default::default()),
        ..cam(id)
    }
}

/// A plane of one color, as the web renderer sends it whole.
fn plane_msg(screen: ScreenId, name: &str, w: u32, h: u32, rgba: [u8; 4]) -> Vec<u8> {
    let px: Vec<u8> = (0..w * h).flat_map(|_| rgba).collect();
    encode(&[(
        Op::Patch,
        screen,
        name,
        w,
        h,
        0,
        vec![([0, 0, w, h], &px[..])],
    )])
}

fn engine() -> Option<LiveEngine> {
    let g = gpu()?;
    let config = Config {
        width: W,
        height: H,
        fps: 60,
        preview_w: 16,
        preview_h: 9,
        preview_every: 1000,
    };
    Some(LiveEngine::new(config, g, Box::new(Colors)))
}

fn apply(e: &mut LiveEngine, bytes: Vec<u8>) {
    let m = parse(bytes).expect("a good message");
    e.apply_graphics(&m);
}

#[test]
fn a_graphics_input_fades_in_its_place_among_the_pictures() {
    let Some(mut e) = engine() else { return };
    // Camera a (red) on air; a title (green, from the web) taking over with a fade.
    let mut show = Show {
        sources: vec![cam("a"), text_input("t")],
        ..Show::default()
    };
    show.screens.live.previous = Some(SourceId::new("a"));
    show.screens.live.program = Some(SourceId::new("t"));
    show.screens.live.transition = Some(ActiveTransition {
        kind: TransitionKind::Fade,
        duration_ms: 1000,
        started_at: 1000,
    });
    e.set_show(show);
    apply(
        &mut e,
        plane_msg(ScreenId::Live, "g:t", W, H, [0, 255, 0, 255]),
    );
    e.frame(1500);
    let live = e.gpu.read(Dest::Target(0)).unwrap().2;
    // Half red, half green: the title is mixed in like a camera, not pasted on top.
    assert!(
        near(px(&live, 30, 20), [128, 128, 0, 255]),
        "{:?}",
        px(&live, 30, 20)
    );
    e.frame(2100);
    let live = e.gpu.read(Dest::Target(0)).unwrap().2;
    assert!(near(px(&live, 30, 20), [0, 255, 0, 255]));
    assert_eq!(e.gpu.plane_count(), 1);
}

#[test]
fn only_the_changed_rectangle_is_sent_and_cleared_planes_go() {
    let Some(mut e) = engine() else { return };
    let mut show = Show {
        sources: vec![cam("a"), text_input("t")],
        ..Show::default()
    };
    show.screens.live.program = Some(SourceId::new("t"));
    e.set_show(show);
    // A see-through title: transparent everywhere but where it is drawn.
    apply(&mut e, plane_msg(ScreenId::Live, "g:t", W, H, [0, 0, 0, 0]));
    let white: Vec<u8> = (0..8 * 4).flat_map(|_| [255u8, 255, 255, 255]).collect();
    apply(
        &mut e,
        encode(&[(
            Op::Patch,
            ScreenId::Live,
            "g:t",
            W,
            H,
            0,
            vec![([4, 4, 8, 4], &white[..])],
        )]),
    );
    e.frame(1000);
    let live = e.gpu.read(Dest::Target(0)).unwrap().2;
    assert!(near(px(&live, 6, 6), [255, 255, 255, 255]));
    // The screen's black everywhere else.
    assert!(near(px(&live, 30, 20), [0, 0, 0, 255]));
    apply(
        &mut e,
        encode(&[(Op::Clear, ScreenId::Live, "g:t", W, H, 0, vec![])]),
    );
    assert_eq!(e.gpu.plane_count(), 0);
    e.frame(1001);
    let live = e.gpu.read(Dest::Target(0)).unwrap().2;
    assert!(near(px(&live, 6, 6), [0, 0, 0, 255]));
}

#[test]
fn channels_dip_and_panic_keep_the_web_order() {
    let Some(mut e) = engine() else { return };
    let mut show = Show {
        sources: vec![cam("a"), cam("b"), text_input("name")],
        ..Show::default()
    };
    show.screens.live.previous = Some(SourceId::new("a"));
    show.screens.live.program = Some(SourceId::new("b"));
    // A dip to black half way: the inputs are black, the lower third stays.
    show.screens.live.transition = Some(ActiveTransition {
        kind: TransitionKind::Dip,
        duration_ms: 1000,
        started_at: 1000,
    });
    show.overlays = lumora_engine::overlays::channels();
    let o = &mut show.overlays[0];
    o.source_id = Some(SourceId::new("name"));
    o.frame = lumora_engine::overlays::Frame {
        x: 0.0,
        y: 50.0,
        w: 100.0,
        h: 50.0,
    };
    o.anim_ms = 0;
    o.set_on(true, 0);
    e.set_show(show.clone());
    apply(
        &mut e,
        plane_msg(ScreenId::Live, "g:name", W, H / 2, [255, 255, 0, 255]),
    );
    e.frame(1500);
    let live = e.gpu.read(Dest::Target(0)).unwrap().2;
    assert!(
        near(px(&live, 30, 5), [0, 0, 0, 255]),
        "dipped: {:?}",
        px(&live, 30, 5)
    );
    assert!(
        near(px(&live, 30, 30), [255, 255, 0, 255]),
        "the channel stays over the dip: {:?}",
        px(&live, 30, 30)
    );
    // PANIC: black over everything at once, then the logo from the web over that.
    show.screens.live.transition = None;
    show.panic = true;
    show.panic_changed_at = 0;
    e.set_show(show);
    e.frame(5000);
    let live = e.gpu.read(Dest::Target(0)).unwrap().2;
    assert!(
        near(px(&live, 30, 30), [0, 0, 0, 255]),
        "{:?}",
        px(&live, 30, 30)
    );
    apply(
        &mut e,
        plane_msg(ScreenId::Live, "panic", W, H, [0, 0, 0, 0]),
    );
    let logo: Vec<u8> = (0..4).flat_map(|_| [255u8, 255, 255, 255]).collect();
    apply(
        &mut e,
        encode(&[(
            Op::Patch,
            ScreenId::Live,
            "panic",
            W,
            H,
            0,
            vec![([30, 16, 2, 2], &logo[..])],
        )]),
    );
    e.frame(5001);
    let live = e.gpu.read(Dest::Target(0)).unwrap().2;
    assert!(near(px(&live, 31, 17), [255, 255, 255, 255]));
    assert!(near(px(&live, 5, 5), [0, 0, 0, 255]));
}

// ---------------------------------------------------------------------------
// Feeds: the recording, the vertical version and a camera's ISO at once

/// A feed whose "encoder" hands back the raw frames it was given.
fn raw_feed(out: Arc<Mutex<Vec<u8>>>) -> MakeFeed {
    Box::new(move |shape| {
        EncoderFeed::start(
            std::path::Path::new("ffmpeg"),
            FeedArgs {
                width: shape.width,
                height: shape.height,
                fps: shape.fps,
                pix_fmt: shape.pix_fmt,
                encode: vec![
                    "-c:v".into(),
                    "rawvideo".into(),
                    "-pix_fmt".into(),
                    "rgba".into(),
                ],
                container: vec!["-f".into(), "rawvideo".into(), "-".into()],
                audio: None,
            },
            Box::new(move |c| out.lock().unwrap().extend(c)),
            None,
        )
    })
}

#[test]
fn feeds_scale_make_the_vertical_version_and_send_cameras_as_they_come() {
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
        sources: vec![cam("a"), cam("b")],
        ..Show::default()
    };
    show.screens.live.program = Some(SourceId::new("a"));
    e.set_show(show);
    let (small, vertical, iso) = (
        Arc::new(Mutex::new(Vec::new())),
        Arc::new(Mutex::new(Vec::new())),
        Arc::new(Mutex::new(Vec::new())),
    );
    let screen = |vertical: bool, w: u32, h: u32| FeedSpec {
        source: FeedSource::Screen {
            screen: ScreenId::Live,
            vertical,
        },
        width: w,
        height: h,
        fps: 30,
    };
    let a = e.start_feed(1, screen(false, 32, 18), raw_feed(Arc::clone(&small)));
    let b = e.start_feed(2, screen(true, 18, 32), raw_feed(Arc::clone(&vertical)));
    let c = e.start_feed(
        3,
        FeedSpec {
            source: FeedSource::Input(SourceId::new("b")),
            width: 0,
            height: 0,
            fps: 30,
        },
        raw_feed(Arc::clone(&iso)),
    );
    for r in [a, b, c] {
        r.recv().unwrap().expect("starts");
    }
    // Half a second of frames in real time.
    let t0 = live_engine::engine::now_ms();
    while live_engine::engine::now_ms() < t0 + 500 {
        e.frame(live_engine::engine::now_ms());
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let stats: Vec<_> = [1, 2, 3]
        .into_iter()
        .map(|id| e.stop_feed(id).expect("running").finish())
        .collect();
    eprintln!("{stats:?}");
    // The recording: red (camera a), scaled to 32 × 18.
    let small = small.lock().unwrap();
    assert!(small.len() >= 32 * 18 * 4 * 8, "{}", small.len());
    assert_eq!(small.len() % (32 * 18 * 4), 0);
    let last = &small[small.len() - 32 * 18 * 4..];
    assert!(near([last[0], last[1], last[2], last[3]], [255, 0, 0, 255]));
    // The vertical version: the picture across the middle, darkened red above and below.
    let v = vertical.lock().unwrap();
    assert_eq!(v.len() % (18 * 32 * 4), 0);
    let last = &v[v.len() - 18 * 32 * 4..];
    let at = |x: usize, y: usize| {
        let i = (y * 18 + x) * 4;
        [last[i], last[i + 1], last[i + 2], last[i + 3]]
    };
    assert!(near(at(9, 16), [255, 0, 0, 255]), "{:?}", at(9, 16));
    assert!(near(at(9, 1), [140, 0, 0, 255]), "{:?}", at(9, 1));
    // The ISO: camera b's own frames (blue), at its own size.
    let iso = iso.lock().unwrap();
    assert!(
        iso.len() >= W as usize * H as usize * 4 * 5,
        "{}",
        iso.len()
    );
    assert!(near([iso[0], iso[1], iso[2], iso[3]], [0, 0, 255, 255]));
}
