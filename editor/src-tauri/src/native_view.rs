//! Native playback (beta): the program monitor drawn by the GPU engine
//! (`studio-engine`) in a window of its own over the page, instead of by
//! WebGL. The page sends each frame's passes; the engine decodes, draws and
//! shows them. Every command runs off the main thread, which only makes and
//! moves the viewer's window.

#[cfg(windows)]
use std::sync::mpsc;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use studio_engine::engine::{Config, Engine, Event, Target};
use studio_engine::gpu::{ProgramSource, VertexKind};
use tauri::{AppHandle, Emitter, State};

use crate::AppState;

struct Running {
    engine: Engine,
    #[cfg(windows)]
    window: studio_engine::win::ChildWindow,
}

/// The engine, while native playback is on.
#[derive(Default)]
pub struct NativeView {
    running: Mutex<Option<Running>>,
}

#[derive(Deserialize)]
pub struct ProgramIn {
    name: String,
    vertex: String,
    vs: String,
    fs: String,
}

#[derive(Serialize)]
pub struct Started {
    /// The graphics card and API.
    adapter: String,
    /// `window`: frames show in the native window; `offscreen`: the page fetches them.
    mode: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Note {
    Presented {
        frame: i64,
        dropped: u64,
        late: u64,
        ms: f32,
    },
    Fallback {
        frame: i64,
        reason: String,
    },
}

fn with<T>(view: &NativeView, f: impl FnOnce(&Running) -> T) -> Result<T, String> {
    let r = view
        .running
        .lock()
        .map_err(|_| "Native playback stopped.".to_owned())?;
    r.as_ref()
        .map(f)
        .ok_or_else(|| "Native playback is off.".to_owned())
}

/// Start the engine (making the viewer's window on Windows).
#[tauri::command]
pub async fn native_view_start(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    view: State<'_, NativeView>,
    programs: Vec<ProgramIn>,
) -> Result<Started, String> {
    let ffmpeg = state.ffmpeg()?;
    stop(&app, &view);
    let programs: Vec<ProgramSource> = programs
        .into_iter()
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
        .collect();
    let emitter = app.clone();
    let events = std::sync::Arc::new(move |e: Event| {
        let note = match e {
            Event::Presented {
                frame,
                dropped,
                late,
                ms,
            } => Note::Presented {
                frame,
                dropped,
                late,
                ms,
            },
            Event::Fallback { frame, reason } => Note::Fallback { frame, reason },
        };
        let _ = emitter.emit("native-view", note);
    });
    let config = Config {
        ffmpeg,
        hardware: true,
    };

    #[cfg(windows)]
    let running = {
        let parent = parent_hwnd(&window)?;
        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(studio_engine::win::ChildWindow::create(parent));
        })
        .map_err(|e| e.to_string())?;
        let child = tauri::async_runtime::spawn_blocking(move || rx.recv())
            .await
            .map_err(|e| e.to_string())?
            .map_err(|_| "The viewer's window was not made.".to_owned())??;
        let hwnd = child.hwnd();
        let started = tauri::async_runtime::spawn_blocking(move || {
            Engine::start(config, Target::Window(hwnd), programs, events)
        })
        .await
        .map_err(|e| e.to_string())?;
        match started {
            Ok(engine) => Running {
                engine,
                window: child,
            },
            Err(e) => {
                // The window goes on the thread that made it.
                let _ = app.run_on_main_thread(move || drop(child));
                return Err(e);
            }
        }
    };
    #[cfg(not(windows))]
    let running = {
        let _ = &window;
        let engine = tauri::async_runtime::spawn_blocking(move || {
            Engine::start(config, Target::Offscreen, programs, events)
        })
        .await
        .map_err(|e| e.to_string())??;
        Running { engine }
    };

    let adapter = running.engine.adapter.clone();
    *view.running.lock().map_err(|e| e.to_string())? = Some(running);
    Ok(Started {
        adapter,
        mode: if cfg!(windows) { "window" } else { "offscreen" },
    })
}

#[cfg(windows)]
fn parent_hwnd(window: &tauri::WebviewWindow) -> Result<isize, String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let handle = window.window_handle().map_err(|e| e.to_string())?;
    match handle.as_raw() {
        RawWindowHandle::Win32(h) => Ok(h.hwnd.get()),
        _ => Err("The main window is not a Windows window.".into()),
    }
}

fn stop(app: &AppHandle, view: &NativeView) {
    let running = view.running.lock().ok().and_then(|mut r| r.take());
    if let Some(r) = running {
        #[cfg(windows)]
        {
            let Running { engine, window } = r;
            // The engine (and its surface) first, then the window it drew into.
            drop(engine);
            let _ = app.run_on_main_thread(move || drop(window));
        }
        #[cfg(not(windows))]
        {
            let _ = app;
            drop(r);
        }
    }
}

#[tauri::command]
pub async fn native_view_stop(app: AppHandle, view: State<'_, NativeView>) -> Result<(), String> {
    stop(&app, &view);
    Ok(())
}

/// One frame's passes (a binary message: see `studio_engine::plan`).
#[tauri::command]
pub async fn native_view_frame(
    view: State<'_, NativeView>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("No frame.".into());
    };
    let message = studio_engine::plan::decode(bytes.clone())?;
    with(&view, |r| r.engine.submit(message))
}

/// Playing from `frame` at `speed` (0: stopped).
#[tauri::command]
pub async fn native_view_play(
    view: State<'_, NativeView>,
    frame: f64,
    fps: f64,
    speed: f64,
) -> Result<(), String> {
    with(&view, |r| r.engine.play(frame, fps, speed))
}

/// Where the page's playhead is (it keeps the sound).
#[tauri::command]
pub async fn native_view_sync(
    view: State<'_, NativeView>,
    frame: f64,
    fps: f64,
    speed: f64,
) -> Result<(), String> {
    with(&view, |r| r.engine.sync(frame, fps, speed))
}

/// Where the program monitor's picture is (pixels in the window), and whether the native picture shows.
#[tauri::command]
pub async fn native_view_place(
    app: AppHandle,
    view: State<'_, NativeView>,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    visible: bool,
) -> Result<(), String> {
    let (w, h) = (w.clamp(1, 16384), h.clamp(1, 16384));
    with(&view, |r| {
        r.engine.view(w as u32, h as u32, visible);
        #[cfg(windows)]
        {
            let hwnd = r.window.hwnd();
            let _ = app.run_on_main_thread(move || {
                studio_engine::win::place_hwnd(hwnd, x, y, w, h, visible);
            });
        }
        #[cfg(not(windows))]
        let _ = (&app, x, y);
    })
}

/// Forget every picture the page sent (it sends them again).
#[tauri::command]
pub async fn native_view_reset(view: State<'_, NativeView>) -> Result<(), String> {
    with(&view, |r| r.engine.reset())
}

/// The last frame drawn offscreen: frame number (i64), width and height (u32), RGBA; empty when none is new.
#[tauri::command]
pub async fn native_view_pixels(
    view: State<'_, NativeView>,
) -> Result<tauri::ipc::Response, String> {
    let got = with(&view, |r| r.engine.take_pixels())?;
    let mut out = Vec::new();
    if let Some((frame, w, h, px)) = got {
        out.reserve(16 + px.len());
        out.extend_from_slice(&frame.to_le_bytes());
        out.extend_from_slice(&w.to_le_bytes());
        out.extend_from_slice(&h.to_le_bytes());
        out.extend_from_slice(&px);
    }
    Ok(tauri::ipc::Response::new(out))
}
