//! The compositor on a real GPU (or a software one such as llvmpipe /
//! WARP): scenes drawn offscreen and read back. Skipped, with a note, on a
//! computer with no graphics adapter at all.

use live_engine::engine::{Config, LiveEngine, SourceFactory};
use live_engine::frame::{FramePool, PixelFormat, VideoFrame};
use live_engine::gpu::{Compositor, Dest, Paint, Pass};
use live_engine::mix::Shape;
use live_engine::scene::{Content, Layer, Picture, Placement, ScreenScene};
use live_engine::source::{SourceHealth, SourceState, VideoSource};
use lumora_engine::{
    ActiveTransition, Fit, Show, Source, SourceAudio, SourceId, SourceKind, TransitionKind,
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
            overlay: None,
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
            overlay: Some(0),
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
