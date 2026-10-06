//! The engine on a real GPU (or a software one such as llvmpipe): the
//! editor's programs, run natively, give what the CPU reference gives. Skipped
//! (with a note) on a computer with no graphics adapter at all.
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;
use studio_engine::blend;
use studio_engine::engine::{Config, Engine, Event, Target};
use studio_engine::gpu::{Gpu, Output, ProgramSource, VertexKind};
use studio_engine::plan::{decode, encode};

#[derive(serde::Deserialize)]
struct Program {
    name: String,
    vertex: String,
    vs: String,
    fs: String,
}

fn programs() -> Vec<ProgramSource> {
    let p: Vec<Program> = serde_json::from_str(include_str!("programs.json")).unwrap();
    p.into_iter()
        .map(|p| ProgramSource {
            name: p.name,
            vertex: if p.vertex == "layer" {
                VertexKind::Layer
            } else {
                VertexKind::Full
            },
            vs: p.vs,
            fs: p.fs,
        })
        .collect()
}

fn gpu() -> Option<Gpu> {
    // On Windows (CI's software adapter included) only when asked: LUMORA_GPU_TESTS=1.
    if cfg!(windows) && std::env::var_os("LUMORA_GPU_TESTS").is_none() {
        eprintln!("GPU tests on Windows need LUMORA_GPU_TESTS=1; skipped");
        return None;
    }
    let instance = studio_engine::wgpu::Instance::new(
        studio_engine::wgpu::InstanceDescriptor::new_without_display_handle(),
    );
    match Gpu::new(instance, None) {
        Ok(mut g) => {
            g.set_programs(programs());
            eprintln!("GPU: {}", g.describe());
            Some(g)
        }
        Err(e) => {
            eprintln!("no GPU here ({e}); skipped");
            None
        }
    }
}

fn solid(rgba: [u8; 4], n: usize) -> Vec<u8> {
    rgba.iter().copied().cycle().take(n * 4).collect()
}

#[test]
fn every_blend_mode_matches_the_cpu() {
    let Some(mut g) = gpu() else { return };
    let base = [51u8, 128, 204, 255];
    let top = [153u8, 153, 26, 200];
    let mut bytes = solid(base, 16);
    bytes.extend(solid(top, 16));
    for mode in 0..17 {
        let frame = json!({
            "frame": 0, "w": 4, "h": 4, "background": [0.0, 0.0, 0.0], "out": 2,
            "passes": [
                { "k": 1, "t": 0, "p": "copy", "x": { "uTex": "r:base" }, "u": { "uOpacity": [1.0], "uSize": [4.0, 4.0] } },
                { "k": 1, "t": 1, "p": "copy", "x": { "uTex": "r:top" }, "u": { "uOpacity": [1.0], "uSize": [4.0, 4.0] } },
                { "k": 1, "t": 2, "p": "composite", "x": { "uTex": "t1", "uBase": "t0" },
                  "u": { "uOpacity": [0.8], "uMode": [mode as f32], "uSize": [4.0, 4.0] } }
            ],
            "uploads": [
                { "id": "base", "w": 4, "h": 4, "kind": "straight", "at": 0, "len": 64 },
                { "id": "top", "w": 4, "h": 4, "kind": "straight", "at": 64, "len": 64 }
            ]
        });
        let m = decode(encode(&frame, &bytes)).unwrap();
        g.apply_uploads(&m);
        let px = g.render(&m.frame, Output::Read).unwrap().unwrap();
        let pre = |c: [u8; 4]| {
            let a = f32::from(c[3]) / 255.0;
            [
                f32::from(c[0]) / 255.0 * a,
                f32::from(c[1]) / 255.0 * a,
                f32::from(c[2]) / 255.0 * a,
                a,
            ]
        };
        let want = blend::composite(pre(base), pre(top), 0.8, mode);
        for i in 0..3 {
            let got = f32::from(px[i]) / 255.0;
            assert!(
                (got - want[i]).abs() < 0.02,
                "{} channel {i}: GPU {got}, CPU {}",
                blend::MODES[mode],
                want[i]
            );
        }
    }
}

#[test]
fn every_editor_program_builds_on_the_gpu() {
    let Some(mut g) = gpu() else { return };
    let mut failed = Vec::new();
    for p in programs() {
        if let Err(e) = g.prepare(&p.name, studio_engine::gpu::TARGET_FORMAT) {
            failed.push(e);
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}

#[test]
fn places_a_picture_and_keeps_webgls_rows() {
    let Some(mut g) = gpu() else { return };
    // A 2×2 picture: red top-left, green top-right, blue bottom-left, white bottom-right.
    let pic = [
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ];
    // Placed over the whole frame as the compositor's `place` does (top of the picture at the top).
    let q = [
        -1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 0.0, -1.0, -1.0, 0.0, 1.0, 0.0,
        1.0, 1.0, -1.0, 0.0, 1.0, 1.0, 1.0,
    ];
    let frame = json!({
        "frame": 0, "w": 8, "h": 8, "background": [0.0, 0.0, 0.0], "out": 0,
        "passes": [
            { "k": 0, "t": 0, "c": [0.0, 0.0, 0.0, 0.0] },
            { "k": 1, "t": 0, "p": "layer", "x": { "uTex": "r:pic" }, "u": { "uCrop": [0.0, 0.0, 1.0, 1.0], "uSize": [8.0, 8.0] }, "q": q }
        ],
        "uploads": [{ "id": "pic", "w": 2, "h": 2, "kind": "straight", "at": 0, "len": 16 }]
    });
    let m = decode(encode(&frame, &pic)).unwrap();
    g.apply_uploads(&m);
    let px = g.render(&m.frame, Output::Read).unwrap().unwrap();
    let at = |x: usize, y: usize| &px[(y * 8 + x) * 4..(y * 8 + x) * 4 + 3];
    // Read back top row first, as `readFrame` gives it.
    assert_eq!(at(0, 0), &[255, 0, 0]);
    assert_eq!(at(7, 0), &[0, 255, 0]);
    assert_eq!(at(0, 7), &[0, 0, 255]);
    assert_eq!(at(7, 7), &[255, 255, 255]);
}

#[test]
fn the_engine_decodes_converts_and_draws_a_video_frame() {
    let ffmpeg = std::env::var("LUMORA_FFMPEG").unwrap_or_else(|_| "ffmpeg".into());
    if std::process::Command::new(&ffmpeg)
        .arg("-version")
        .output()
        .is_err()
    {
        eprintln!("no FFmpeg here; skipped");
        return;
    }
    if gpu().is_none() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("lumora-engine-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("gray.mkv");
    // Frame N is a flat gray of brightness 16 + 4·N (limited range).
    let ok = std::process::Command::new(&ffmpeg)
        .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i"])
        .arg("color=c=black:s=64x36:r=30:d=1,format=yuv420p,geq=lum='16+N*4':cb=128:cr=128")
        .args(["-c:v", "ffv1"])
        .arg(&file)
        .status()
        .unwrap();
    assert!(ok.success());
    let events: Arc<Mutex<Vec<Event>>> = Arc::default();
    let ev = events.clone();
    let engine = Engine::start(
        Config {
            ffmpeg: ffmpeg.into(),
            hardware: false,
        },
        Target::Offscreen,
        programs(),
        Arc::new(move |e| ev.lock().unwrap().push(e)),
    )
    .unwrap();
    let q = [
        -1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 0.0, -1.0, -1.0, 0.0, 1.0, 0.0,
        1.0, 1.0, -1.0, 0.0, 1.0, 1.0, 1.0,
    ];
    for n in [10u32, 20] {
        let frame = json!({
            "frame": n, "w": 32, "h": 18, "background": [0.0, 0.0, 0.0], "out": 0, "now": true,
            "passes": [
                { "k": 0, "t": 0, "c": [0.0, 0.0, 0.0, 0.0] },
                { "k": 1, "t": 0, "p": "layer", "x": { "uTex": "v0" }, "u": { "uCrop": [0.0, 0.0, 1.0, 1.0], "uSize": [32.0, 18.0] }, "q": q }
            ],
            "videos": [{ "key": "clip", "path": file.to_string_lossy(), "time": f64::from(n) / 30.0, "fps": 30.0, "w": 64, "h": 36 }]
        });
        engine.submit(decode(encode(&frame, &[])).unwrap());
        let (f, w, h, px) = engine
            .wait_pixels(Duration::from_secs(30))
            .expect("a frame");
        assert_eq!((f, w, h), (i64::from(n), 32, 18));
        // Limited-range Y → full-range gray.
        let y = 16.0 + 4.0 * n as f32;
        let want = ((y - 16.0) * 255.0 / 219.0).round();
        let got = f32::from(px[(9 * 32 + 16) * 4]);
        assert!((got - want).abs() <= 2.0, "frame {n}: {got} vs {want}");
        assert_eq!(px[(9 * 32 + 16) * 4 + 3], 255);
    }
    let seen = events.lock().unwrap().clone();
    assert!(
        seen.iter()
            .any(|e| matches!(e, Event::Presented { frame: 20, .. })),
        "{seen:?}"
    );
    drop(engine);
    let _ = std::fs::remove_dir_all(&dir);
}

/// Frames sent ahead come out one by one at their moments, in order.
#[test]
fn the_engine_shows_queued_frames_on_its_clock() {
    if gpu().is_none() {
        return;
    }
    let engine = Engine::start(
        Config {
            ffmpeg: "ffmpeg".into(),
            hardware: false,
        },
        Target::Offscreen,
        programs(),
        Arc::new(|_| {}),
    )
    .unwrap();
    for n in 0..12u32 {
        let v = n as f32 / 20.0;
        let frame = json!({
            "frame": n, "w": 8, "h": 8, "background": [0.0, 0.0, 0.0], "out": 0,
            "passes": [{ "k": 0, "t": 0, "c": [v, 0.0, 0.0, 1.0] }]
        });
        engine.submit(decode(encode(&frame, &[])).unwrap());
    }
    let start = std::time::Instant::now();
    engine.play(0.0, 30.0, 1.0);
    let mut seen = Vec::new();
    while start.elapsed() < Duration::from_secs(5) {
        if let Some((f, _, _, px)) = engine.take_pixels() {
            // The picture is the frame's own.
            assert!((f32::from(px[0]) - f as f32 / 20.0 * 255.0).abs() <= 2.0);
            seen.push((f, start.elapsed().as_secs_f64()));
            if f >= 11 {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    assert!(seen.windows(2).all(|w| w[1].0 > w[0].0), "{seen:?}");
    let last = seen.last().expect("frames shown");
    assert_eq!(last.0, 11);
    // Frame 11 is due 11/30 s after the start: not before (and not much after).
    assert!(last.1 >= 11.0 / 30.0 - 0.02 && last.1 < 2.0, "{seen:?}");
}
