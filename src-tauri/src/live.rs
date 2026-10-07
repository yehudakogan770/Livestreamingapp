//! Settings → Engine: the Standard engine (every window draws its own copy
//! in its WebView: the default) or the Unified engine (beta,
//! `crates/live-engine`): one engine that opens each camera once, draws each
//! screen once on the GPU and feeds the outputs from there. See
//! `docs/ENGINE.md`.
//!
//! In Unified mode:
//! - the Live and Back Screens' output windows are the engine's own native
//!   windows (the Monitor, all words, stays a WebView window for now);
//! - the control window's camera pictures are the engine's small previews
//!   (`live_engine_preview`), so the WebView never opens a camera itself;
//! - each input's health comes from the engine (`live_engine_health`), for
//!   the backup lineup;
//! - "Test the engine's recording" sends ten seconds of the Live Screen
//!   through the engine's encoder feed into the normal recording code.
//!
//! The choice is kept in `live-engine.json` in the app's data folder.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use live_engine::engine::{Config, DefaultFactory, Runner, Stats};
use live_engine::present::Placement;
use live_engine::source::SourceState;
use lumora_engine::{ScreenId, Show};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::capture::Kind;
use crate::encode::{self, Codec, Rate, VideoEncode};
use crate::store::write_file_atomic;

const FILE: &str = "live-engine.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Standard,
    Unified,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    mode: Mode,
}

#[derive(Default)]
struct Inner {
    mode: Mode,
    runner: Option<Arc<Runner>>,
    error: Option<String>,
    /// Screens shown in the engine's own windows.
    native: Vec<ScreenId>,
}

pub struct Live {
    file: PathBuf,
    ffmpeg: Option<PathBuf>,
    inner: Mutex<Inner>,
}

fn lock(m: &Mutex<Inner>) -> MutexGuard<'_, Inner> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What the Engine settings show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub mode: Mode,
    pub running: bool,
    pub error: Option<String>,
    pub stats: Option<Stats>,
    /// The engine shows the Live and Back Screens in its own windows here (Windows).
    pub native_outputs: bool,
}

/// One input's health, as the engine sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub id: String,
    /// "starting", "live", "noSignal" or "failed".
    pub state: &'static str,
    pub detail: Option<String>,
    pub frames: u64,
}

/// The screens the engine draws in its own windows (the stage monitor is all words: still a WebView).
fn native_screen(screen: ScreenId) -> bool {
    cfg!(windows) && matches!(screen, ScreenId::Live | ScreenId::Back)
}

impl Live {
    pub fn new(dir: &Path, ffmpeg: Option<PathBuf>) -> Self {
        let file = dir.join(FILE);
        let saved: Saved = std::fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Live {
            file,
            ffmpeg,
            inner: Mutex::new(Inner {
                mode: saved.mode,
                ..Inner::default()
            }),
        }
    }

    pub fn mode(&self) -> Mode {
        lock(&self.inner).mode
    }

    fn runner(&self) -> Option<Arc<Runner>> {
        lock(&self.inner).runner.clone()
    }

    /// Start the engine when Unified is chosen (at start-up and when switched on).
    fn start(&self, show: &Show) {
        let mut inner = lock(&self.inner);
        if inner.mode != Mode::Unified || inner.runner.is_some() {
            return;
        }
        let fake = std::env::var_os("LUMORA_FAKE_CAMERAS").is_some();
        let factory = DefaultFactory::new(self.ffmpeg.clone(), fake);
        match Runner::start(Config::default(), Box::new(factory)) {
            Ok(r) => {
                r.set_show(show.clone());
                inner.runner = Some(Arc::new(r));
                inner.error = None;
                eprintln!("lumora: unified engine started");
            }
            Err(e) => {
                eprintln!("lumora: unified engine could not start: {e}");
                inner.error = Some(e);
            }
        }
    }

    /// The show changed.
    pub fn sync(&self, show: &Show) {
        if let Some(r) = self.runner() {
            r.set_show(show.clone());
        }
    }

    fn info(&self) -> Info {
        let inner = lock(&self.inner);
        Info {
            mode: inner.mode,
            running: inner.runner.is_some(),
            error: inner.error.clone(),
            stats: inner.runner.as_ref().map(|r| r.stats()),
            native_outputs: cfg!(windows),
        }
    }

    /// Screens open in the engine's windows.
    pub fn open_screens(&self) -> Vec<ScreenId> {
        lock(&self.inner).native.clone()
    }

    /// Where a screen's window goes (its assigned display, else a window).
    fn placement(app: &AppHandle, show: &Show, screen: ScreenId) -> Placement {
        let wanted = show.settings.displays.get(screen).as_deref();
        let display = wanted
            .and_then(|id| {
                crate::outputs::displays(app)
                    .into_iter()
                    .find(|d| d.id == id)
            })
            .map(|d| (d.x, d.y, d.width, d.height));
        Placement {
            display,
            title: format!("Lumora — {} output", screen.label()),
        }
    }

    /// Open (or move) a screen in the engine's own window. False: not the
    /// engine's to show (Standard mode, the Monitor, not on Windows).
    ///
    /// # Errors
    /// The window could not be made.
    pub fn open_output(
        &self,
        app: &AppHandle,
        show: &Show,
        screen: ScreenId,
    ) -> Result<bool, String> {
        let Some(r) = self.runner().filter(|_| native_screen(screen)) else {
            return Ok(false);
        };
        r.set_output(screen, Some(Self::placement(app, show, screen)))?;
        {
            let mut inner = lock(&self.inner);
            if !inner.native.contains(&screen) {
                inner.native.push(screen);
            }
        }
        notify(app);
        Ok(true)
    }

    /// Close a screen's engine window. False: it wasn't one.
    pub fn close_output(&self, app: &AppHandle, screen: ScreenId) -> bool {
        let was = {
            let mut inner = lock(&self.inner);
            let was = inner.native.contains(&screen);
            inner.native.retain(|s| *s != screen);
            was
        };
        if was {
            if let Some(r) = self.runner() {
                let _ = r.set_output(screen, None);
            }
            notify(app);
        }
        was
    }

    /// A display choice changed: move the engine's window there.
    pub fn place(&self, app: &AppHandle, show: &Show, screen: ScreenId) {
        if self.open_screens().contains(&screen) {
            let _ = self.open_output(app, show, screen);
        }
    }
}

/// Every open output, WebView or native, to the windows that list them.
fn notify(app: &AppHandle) {
    let _ = app.emit("outputs-changed", all_open(app));
}

/// The open outputs of both kinds.
pub fn all_open(app: &AppHandle) -> Vec<ScreenId> {
    let mut v = crate::outputs::open_screens(app);
    if let Some(l) = app.try_state::<Live>() {
        for s in l.open_screens() {
            if !v.contains(&s) {
                v.push(s);
            }
        }
    }
    v
}

/// At start-up: start the engine if Unified was chosen last time.
pub fn start_saved(app: &AppHandle) {
    let (Some(l), Some(state)) = (app.try_state::<Live>(), app.try_state::<crate::AppState>())
    else {
        return;
    };
    let show = crate::lock(&state).show().clone();
    l.start(&show);
}

#[tauri::command]
pub fn live_engine_info(live: State<'_, Live>) -> Info {
    live.info()
}

/// Switch engines. Open output windows move over to the chosen engine.
#[tauri::command]
pub fn live_engine_set_mode(
    mode: Mode,
    live: State<'_, Live>,
    state: State<'_, crate::AppState>,
    app: AppHandle,
) -> Result<Info, String> {
    if live.mode() == mode {
        return Ok(live.info());
    }
    let show = crate::lock(&state).show().clone();
    let data = serde_json::to_string_pretty(&Saved { mode }).map_err(|e| e.to_string())?;
    write_file_atomic(&live.file, &data).map_err(|e| e.to_string())?;
    match mode {
        Mode::Unified => {
            lock(&live.inner).mode = Mode::Unified;
            live.start(&show);
            // The Live and Back windows become the engine's.
            for s in crate::outputs::open_screens(&app) {
                if native_screen(s) && live.runner().is_some() {
                    let _ = crate::outputs::close(&app, s);
                    if let Err(e) = live.open_output(&app, &show, s) {
                        eprintln!("lumora: unified output {s:?}: {e}");
                        let _ = crate::outputs::open(&app, &show, s);
                    }
                }
            }
        }
        Mode::Standard => {
            let reopen = live.open_screens();
            let runner = {
                let mut inner = lock(&live.inner);
                inner.mode = Mode::Standard;
                inner.native.clear();
                inner.error = None;
                inner.runner.take()
            };
            // Dropping the last handle stops the engine thread (and its windows).
            drop(runner);
            for s in reopen {
                let _ = crate::outputs::open(&app, &show, s);
            }
        }
    }
    notify(&app);
    let info = live.info();
    let _ = app.emit("live-engine-changed", &info);
    Ok(info)
}

/// A preview tile as JPEG (`program/live`, `next/back`, `source/<id>`); empty when there is none yet.
#[tauri::command]
pub fn live_engine_preview(key: String, live: State<'_, Live>) -> tauri::ipc::Response {
    let jpeg = live
        .runner()
        .and_then(|r| r.preview(&key))
        .and_then(|p| {
            let (w, h) = (u16::try_from(p.width).ok()?, u16::try_from(p.height).ok()?);
            let mut out = Vec::new();
            jpeg_encoder::Encoder::new(&mut out, 80)
                .encode(&p.rgba, w, h, jpeg_encoder::ColorType::Rgba)
                .ok()?;
            Some(out)
        })
        .unwrap_or_default();
    tauri::ipc::Response::new(jpeg)
}

/// Each input's health as the engine sees it (the backup lineup's watch in Unified mode).
#[tauri::command]
pub fn live_engine_health(live: State<'_, Live>) -> Vec<Health> {
    let Some(r) = live.runner() else {
        return Vec::new();
    };
    r.health()
        .into_iter()
        .map(|(id, h)| {
            let (state, detail) = match h.state {
                SourceState::Starting => ("starting", None),
                SourceState::Live => ("live", None),
                SourceState::NoSignal => ("noSignal", None),
                SourceState::Failed(why) => ("failed", Some(why)),
            };
            Health {
                id: id.to_string(),
                state,
                detail,
                frames: h.frames,
            }
        })
        .collect()
}

/// Record `seconds` of the Live Screen through the engine's encoder feed
/// into the normal recording folder (video only: sound stays with the
/// Standard recorder until the engine carries it, see docs/ENGINE.md).
#[tauri::command]
pub async fn live_engine_test_record(
    seconds: Option<u32>,
    live: State<'_, Live>,
    state: State<'_, crate::AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let runner = live
        .runner()
        .ok_or("Turn on the unified engine first (Settings → Engine).")?;
    let ffmpeg = live
        .ffmpeg
        .clone()
        .ok_or("FFmpeg is needed for the engine's recording.")?;
    let settings = state.capture.settings();
    let family = encode::pick(
        settings.encoder,
        Codec::H264,
        &state.capture.status().hw_encoders,
        &[],
    );
    let fps = Config::default().fps;
    let encode_args = encode::video_args(&VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps: 12_000 },
        preset: settings.preset,
        fps,
        size: None,
    });
    let mime = "video/x-matroska;codecs=avc1";
    let running = state
        .capture
        .start_with(Kind::Record, mime, "Engine test", false)?;
    let session = running.session;
    let container: Vec<String> = ["-an", "-f", "matroska", "-"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let started = runner.start_feed(
        ScreenId::Live,
        Box::new(move |w, h, fps| {
            live_engine::encoder::EncoderFeed::start(
                &ffmpeg,
                w,
                h,
                fps,
                &encode_args,
                &container,
                Box::new(move |chunk| {
                    let _ = app.state::<crate::AppState>().capture.chunk(session, chunk);
                }),
            )
        }),
    );
    if let Err(e) = started {
        state.capture.stop(session);
        return Err(e);
    }
    let secs = seconds.unwrap_or(10).clamp(1, 120);
    let r = Arc::clone(&runner);
    let stats = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_secs(u64::from(secs)));
        r.stop_feed()
    })
    .await
    .map_err(|e| e.to_string())?;
    state.capture.stop(session);
    let s = stats.unwrap_or_default();
    Ok(format!(
        "Recorded {secs} s with {} ({} frames, {} dropped){}: {}",
        family.label(),
        s.frames_in,
        s.frames_dropped,
        s.error
            .map(|e| format!(", FFmpeg said: {e}"))
            .unwrap_or_default(),
        running.path.unwrap_or_default()
    ))
}
