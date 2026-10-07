//! Settings → Engine: the Standard engine (every window draws its own copy
//! in its WebView: the default) or the Unified engine (beta,
//! `crates/live-engine`): one engine that opens each camera once, draws each
//! screen once on the GPU and feeds the outputs from there. See
//! `docs/ENGINE.md`.
//!
//! In Unified mode:
//! - the Live and Back Screens' output windows are the engine's own native
//!   windows (the Monitor, all words, stays a WebView window for now);
//! - each engine screen's graphics (titles, lower thirds, countdowns…) are
//!   drawn by a hidden overlay renderer window (`overlay-live`,
//!   `overlay-back`: `app/src/engine/overlayRenderer.ts`) that sends what
//!   changed (`live_engine_graphics`);
//! - the control window's camera pictures are the engine's small previews
//!   (`live_engine_preview`), so the WebView never opens a camera itself;
//! - each input's health comes from the engine (`live_engine_health`), for
//!   the backup lineup;
//! - recordings and streams are encoded from the engine's own picture of the
//!   Live Screen, with the control window's sound mix sent here as PCM
//!   (`live_engine_capture_start`, `live_engine_audio`): the control window
//!   opens no camera for them; each camera's ISO file comes from the
//!   engine's frames of it;
//! - "Test the engine's recording" sends ten seconds of the Live Screen
//!   through the engine's encoder feed into the normal recording code.
//!
//! The choice is kept in `live-engine.json` in the app's data folder.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use live_engine::audio::AudioBus;
use live_engine::encoder::{EncoderFeed, FeedArgs, PcmChunk};
use live_engine::engine::{Config, DefaultFactory, Runner, Stats};
use live_engine::feeds::{FeedSource, FeedSpec, MakeFeed};
use live_engine::present::Placement;
use live_engine::source::SourceState;
use lumora_engine::{ScreenId, Show};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

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
    /// Recordings and streams the engine encodes, with their ISO files.
    captures: std::collections::HashMap<u64, Vec<u64>>,
    /// The engine shows the multiview in its own window (on this display: None, a window).
    multiview: Option<Option<String>>,
}

pub struct Live {
    file: PathBuf,
    ffmpeg: Option<PathBuf>,
    /// Stream, web page, screen-capture and guest inputs' pictures (`browser.rs`'s store).
    pictures: Option<Arc<dyn live_engine::source::EncodedFrames>>,
    inner: Mutex<Inner>,
    /// The control window's sound mixes, to the engine's encoders.
    audio: Arc<AudioBus>,
}

fn lock(m: &Mutex<Inner>) -> MutexGuard<'_, Inner> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The size and rate every engine screen is drawn at.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Size {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

/// What the Engine settings show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub mode: Mode,
    pub running: bool,
    /// The engine's screens (for the overlay renderers); None when it isn't running.
    pub size: Option<Size>,
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

/// The hidden graphics renderer window of a screen.
pub fn renderer_label(screen: ScreenId) -> &'static str {
    match screen {
        ScreenId::Back => "overlay-back",
        _ => "overlay-live",
    }
}

/// The overlay renderers' web view runs its own browser process (its own data
/// folder) so it can be told never to slow down while hidden: a hidden page's
/// timers and drawing are otherwise throttled.
const RENDERER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling \
--disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

/// Open (or close) the screens' overlay renderers: the Live Screen's while
/// the engine runs (the recording and stream need its graphics too), the
/// Back Screen's while the engine shows it.
pub fn sync_renderers(app: &AppHandle) {
    let Some(live) = app.try_state::<Live>() else {
        return;
    };
    let (running, native) = {
        let inner = lock(&live.inner);
        (inner.runner.is_some(), inner.native.clone())
    };
    for screen in [ScreenId::Live, ScreenId::Back] {
        let wanted = running && (screen == ScreenId::Live || native.contains(&screen));
        let label = renderer_label(screen);
        let open = app.get_webview_window(label);
        match (wanted, open) {
            (true, None) => {
                let mut b = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
                    .title(format!("Lumora — {} graphics", screen.label()))
                    .visible(false)
                    .focused(false)
                    .skip_taskbar(true)
                    .inner_size(320.0, 180.0)
                    .additional_browser_args(RENDERER_ARGS);
                if let Ok(dir) = app.path().app_local_data_dir() {
                    b = b.data_directory(dir.join("overlay-webview"));
                }
                if let Err(e) = b.build() {
                    eprintln!("lumora: the {screen:?} graphics renderer could not start: {e}");
                }
            }
            (false, Some(w)) => {
                let _ = w.close();
            }
            _ => {}
        }
    }
}

impl Live {
    pub fn new(
        dir: &Path,
        ffmpeg: Option<PathBuf>,
        pictures: Option<Arc<dyn live_engine::source::EncodedFrames>>,
    ) -> Self {
        let file = dir.join(FILE);
        let saved: Saved = std::fs::read(&file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Live {
            file,
            ffmpeg,
            pictures,
            inner: Mutex::new(Inner {
                mode: saved.mode,
                ..Inner::default()
            }),
            audio: Arc::default(),
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
        let mut factory = DefaultFactory::new(self.ffmpeg.clone(), fake);
        factory.pictures = self.pictures.clone();
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

    /// The show changed: the engine's multiview follows a new display choice.
    pub fn place_multiview(&self, app: &AppHandle, show: &Show) {
        let moved = lock(&self.inner)
            .multiview
            .as_ref()
            .is_some_and(|d| *d != show.settings.multiview.display);
        if moved {
            let _ = self.open_multiview(app, show);
        }
    }

    /// Open (or move) the multiview in the engine's own window, drawn from
    /// the same frames as the screens. False: not the engine's to show
    /// (Standard mode, not on Windows).
    ///
    /// # Errors
    /// The window could not be made.
    pub fn open_multiview(&self, app: &AppHandle, show: &Show) -> Result<bool, String> {
        let Some(r) = self.runner().filter(|_| cfg!(windows)) else {
            return Ok(false);
        };
        let wanted = show.settings.multiview.display.clone();
        let display = wanted
            .as_deref()
            .and_then(|id| {
                crate::outputs::displays(app)
                    .into_iter()
                    .find(|d| d.id == id)
            })
            .map(|d| (d.x, d.y, d.width, d.height));
        r.set_multiview(Some(Placement {
            display,
            title: "Lumora — Multiview".to_owned(),
        }))?;
        lock(&self.inner).multiview = Some(wanted);
        notify(app);
        Ok(true)
    }

    /// Close the engine's multiview. False: it wasn't open.
    pub fn close_multiview(&self, app: &AppHandle) -> bool {
        let was = lock(&self.inner).multiview.take().is_some();
        if was {
            if let Some(r) = self.runner() {
                let _ = r.set_multiview(None);
            }
            notify(app);
        }
        was
    }

    /// The engine shows the multiview now.
    pub fn multiview_open(&self) -> bool {
        lock(&self.inner).multiview.is_some()
    }

    fn info(&self) -> Info {
        let inner = lock(&self.inner);
        let c = Config::default();
        Info {
            mode: inner.mode,
            running: inner.runner.is_some(),
            size: inner.runner.as_ref().map(|_| Size {
                width: c.width,
                height: c.height,
                fps: c.fps,
            }),
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
        sync_renderers(app);
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
            sync_renderers(app);
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
    sync_renderers(app);
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
    // Each engine records and streams its own way: switching in the middle would end them.
    let st = state.capture.status();
    if st.recording.is_some() || st.streaming.is_some() || st.vertical.is_some() || st.ndi.is_some()
    {
        return Err("Stop recording, streaming and NDI before switching engines.".to_owned());
    }
    let show = crate::lock(&state).show().clone();
    let data = serde_json::to_string_pretty(&Saved { mode }).map_err(|e| e.to_string())?;
    write_file_atomic(&live.file, &data).map_err(|e| e.to_string())?;
    match mode {
        Mode::Unified => {
            lock(&live.inner).mode = Mode::Unified;
            live.start(&show);
            // The multiview and the Live and Back windows become the engine's.
            if app.get_webview_window(crate::outputs::MULTIVIEW).is_some()
                && live.runner().is_some()
            {
                let _ = crate::outputs::close_multiview(&app);
                if !matches!(live.open_multiview(&app, &show), Ok(true)) {
                    let _ = crate::outputs::open_multiview(&app, &show);
                }
            }
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
            let multiview = live.multiview_open();
            let runner = {
                let mut inner = lock(&live.inner);
                inner.mode = Mode::Standard;
                inner.native.clear();
                inner.multiview = None;
                inner.error = None;
                inner.runner.take()
            };
            // Dropping the last handle stops the engine thread (and its windows).
            drop(runner);
            for s in reopen {
                let _ = crate::outputs::open(&app, &show, s);
            }
            if multiview {
                let _ = crate::outputs::open_multiview(&app, &show);
            }
        }
    }
    notify(&app);
    sync_renderers(&app);
    let info = live.info();
    let _ = app.emit("live-engine-changed", &info);
    Ok(info)
}

/// Changed graphics from a screen's overlay renderer (the wire format in
/// `crates/live-engine/src/overlay.rs`); checked before the engine takes it.
#[tauri::command]
pub fn live_engine_graphics(
    request: tauri::ipc::Request<'_>,
    live: State<'_, Live>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let r = live.runner().ok_or("The unified engine is not running.")?;
    r.graphics(bytes.clone())
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

/// Sound from the control window's sound engine (a mix tapped by an audio
/// worklet, `app/src/audio/engineTap.ts`): 16-bit stereo, the wall-clock
/// time of its first sample, its rate and its mix in the headers.
#[tauri::command]
pub fn live_engine_audio(
    request: tauri::ipc::Request<'_>,
    live: State<'_, Live>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let mix = header("mix").ok_or("no mix")?;
    let at_ms: f64 = header("at").and_then(|v| v.parse().ok()).ok_or("no time")?;
    let rate: u32 = header("rate")
        .and_then(|v| v.parse().ok())
        .ok_or("no rate")?;
    if bytes.len() % 4 != 0 || !(8_000..=192_000).contains(&rate) {
        return Err("not 16-bit stereo sound".to_owned());
    }
    live.audio.push(
        &mix,
        &PcmChunk {
            at_ms,
            rate,
            pcm: Arc::new(bytes.clone()),
        },
    );
    Ok(())
}

/// The test event's check of an engine screen (in the engine's own window, or not shown).
#[tauri::command]
pub fn live_engine_probe(
    screen: ScreenId,
    live: State<'_, Live>,
) -> Option<live_engine::engine::ScreenProbe> {
    live.runner()?.probe(screen)
}

/// The engine's multiview layout while it shows the multiview (for its
/// words, drawn by the Live Screen's overlay renderer); None otherwise.
#[tauri::command]
pub fn live_engine_multiview_layout(
    live: State<'_, Live>,
) -> Option<live_engine::multiview::Layout> {
    if !live.multiview_open() {
        return None;
    }
    live.runner()?.multiview_layout()
}

/// The mixes the engine's encoders are listening to (the control window taps only these).
#[tauri::command]
pub fn live_engine_audio_wanted(live: State<'_, Live>) -> Vec<String> {
    live.audio.wanted()
}

/// A recording, stream, vertical stream or NDI output the engine encodes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    pub kind: Kind,
    pub name: String,
    #[serde(default)]
    pub rehearse: bool,
    /// The picture sent (the engine draws the screen at its own size and scales it).
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// The 9:16 version.
    #[serde(default)]
    pub vertical: bool,
    /// The sound: `master` (the Stream mix) or `b` (the Recording mix).
    pub mix: String,
    /// The control window's sound rate.
    pub sample_rate: u32,
    /// Each camera to its own file (recordings), but these.
    #[serde(default)]
    pub iso: bool,
    #[serde(default)]
    pub iso_skip: Vec<String>,
    pub iso_kbps: Option<u32>,
}

/// A camera's own file, made by the engine from the camera's frames.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsoFile {
    pub id: u64,
    pub source_id: String,
    pub name: String,
    pub path: String,
}

/// What `live_engine_capture_start` started.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineCapture {
    pub running: crate::capture::Running,
    pub isos: Vec<IsoFile>,
}

/// ISO feeds are numbered apart from the sessions' own.
const ISO_FEEDS: u64 = 1 << 40;

/// An encoder feed from the engine into `on_chunk`, with sound from `audio` (when given).
fn engine_feed(
    ffmpeg: PathBuf,
    encode: Vec<String>,
    audio: Option<live_engine::encoder::AudioIn>,
    on_chunk: Box<dyn FnMut(Vec<u8>) + Send>,
    on_end: Option<live_engine::encoder::OnEnd>,
) -> MakeFeed {
    Box::new(move |shape| {
        EncoderFeed::start(
            &ffmpeg,
            FeedArgs {
                width: shape.width,
                height: shape.height,
                fps: shape.fps,
                pix_fmt: shape.pix_fmt,
                encode,
                container: ["-f", "matroska", "-"].map(str::to_owned).to_vec(),
                audio,
            },
            on_chunk,
            on_end,
        )
    })
}

/// Start a recording or stream whose picture (and each camera's ISO file)
/// the engine encodes, with the control window's sound mix — so the control
/// window opens no camera for it. The encoded stream goes to the same
/// recording and streaming sessions as the WebView's own encoder's would
/// (`capture.rs`): files, destinations, reconnects and backups are theirs.
#[tauri::command]
pub async fn live_engine_capture_start(
    request: CaptureRequest,
    live: State<'_, Live>,
    state: State<'_, crate::AppState>,
    app: AppHandle,
) -> Result<EngineCapture, String> {
    let runner = live
        .runner()
        .ok_or("The unified engine is not running (Settings → Engine).")?;
    let ffmpeg = live
        .ffmpeg
        .clone()
        .ok_or("FFmpeg is needed to record and stream with the unified engine.")?;
    let r = request;
    let settings = state.capture.settings();
    let mime = "video/x-matroska;codecs=avc1,opus";
    let running = state
        .capture
        .start_with(r.kind, mime, &r.name, r.rehearse)?;
    let session = running.session;
    let family = state.capture.engine_family();
    let fps = r.fps.clamp(1, 60);
    let kbps = running.source_kbps.unwrap_or(settings.video_kbps).max(500);
    let video = encode::video_args(&VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps },
        preset: settings.preset,
        fps,
        size: None,
    });
    let audio = live_engine::encoder::AudioIn {
        rate: r.sample_rate,
        encode: vec![
            "-c:a".to_owned(),
            "libopus".to_owned(),
            "-b:a".to_owned(),
            format!("{}k", settings.audio_kbps.clamp(64, 320)),
        ],
        chunks: live.audio.subscribe(&r.mix),
    };
    let kind = r.kind;
    let to = app.clone();
    let on_chunk = Box::new(move |chunk: Vec<u8>| {
        let _ = to.state::<crate::AppState>().capture.chunk(session, chunk);
    });
    let to = app.clone();
    let on_end: live_engine::encoder::OnEnd = Box::new(move |asked, said| {
        if asked {
            return;
        }
        let said = said.unwrap_or_else(|| "it stopped".to_owned());
        if family.hardware() && encode::encoder_failed(&said) {
            to.state::<crate::AppState>()
                .capture
                .engine_hw_failed(family);
        }
        eprintln!("lumora: the engine's {kind:?} encoder stopped: {said}");
        let _ = to.emit(
            "live-engine-feed-lost",
            serde_json::json!({
                "kind": kind,
                "session": session,
                "message": format!("The unified engine's {} encoder stopped ({said}).", family.label()),
            }),
        );
    });
    let spec = FeedSpec {
        source: FeedSource::Screen {
            screen: ScreenId::Live,
            vertical: r.vertical,
        },
        width: r.width.clamp(16, 7680) & !1,
        height: r.height.clamp(16, 4320) & !1,
        fps,
    };
    let make = engine_feed(ffmpeg.clone(), video, Some(audio), on_chunk, Some(on_end));
    let started = {
        let runner = Arc::clone(&runner);
        tauri::async_runtime::spawn_blocking(move || runner.start_feed(session, spec, make))
            .await
            .map_err(|e| e.to_string())?
    };
    if let Err(e) = started {
        state.capture.stop(session);
        return Err(e);
    }
    state.capture.engine_source(
        kind,
        session,
        &format!("the unified engine ({})", family.label()),
    );
    // Each camera to its own file, from the engine's own frames of it.
    let mut isos = Vec::new();
    if kind == Kind::Record && r.iso {
        let show = crate::lock(&state).show().clone();
        let iso_kbps = r.iso_kbps.unwrap_or(settings.video_kbps.min(8000)).max(500);
        for cam in &show.sources {
            if !matches!(cam.kind, lumora_engine::SourceKind::Camera { .. })
                || r.iso_skip.iter().any(|s| s == cam.id.as_str())
            {
                continue;
            }
            let Ok((id, path)) =
                state
                    .isos
                    .start(&state.capture.folder(), &r.name, &cam.name, "mkv")
            else {
                continue;
            };
            let video = encode::video_args(&VideoEncode {
                family,
                codec: Codec::H264,
                rate: Rate::Cbr { kbps: iso_kbps },
                preset: settings.preset,
                fps: 30,
                size: None,
            });
            let to = app.clone();
            let on_chunk = Box::new(move |chunk: Vec<u8>| {
                let _ = to.state::<crate::AppState>().isos.chunk(id, &chunk);
            });
            let spec = FeedSpec {
                source: FeedSource::Input(cam.id.clone()),
                width: 0,
                height: 0,
                fps: 30,
            };
            let make = engine_feed(ffmpeg.clone(), video, None, on_chunk, None);
            if runner.start_feed(ISO_FEEDS + id, spec, make).is_ok() {
                isos.push(IsoFile {
                    id,
                    source_id: cam.id.to_string(),
                    name: cam.name.clone(),
                    path: path.to_string_lossy().into_owned(),
                });
            } else {
                state.isos.stop(id);
            }
        }
    }
    lock(&live.inner)
        .captures
        .insert(session, isos.iter().map(|i| i.id).collect());
    let running = state
        .capture
        .status()
        .running_session(session)
        .unwrap_or(running);
    Ok(EngineCapture { running, isos })
}

/// Stop a recording or stream the engine encodes: its encoder (and its
/// cameras' ISO files) write the last of it, then the session ends.
#[tauri::command]
pub async fn live_engine_capture_stop(
    session: u64,
    live: State<'_, Live>,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let isos = lock(&live.inner)
        .captures
        .remove(&session)
        .unwrap_or_default();
    if let Some(runner) = live.runner() {
        let r = Arc::clone(&runner);
        let ids = isos.clone();
        tauri::async_runtime::spawn_blocking(move || {
            // All at once: each waits for its own FFmpeg.
            let mut waits = vec![{
                let r = Arc::clone(&r);
                std::thread::spawn(move || r.stop_feed(session))
            }];
            for id in ids {
                let r = Arc::clone(&r);
                waits.push(std::thread::spawn(move || r.stop_feed(ISO_FEEDS + id)));
            }
            for w in waits {
                let _ = w.join();
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    for id in isos {
        state.isos.stop(id);
    }
    state.capture.stop(session);
    Ok(())
}

/// Record `seconds` of the Live Screen through the engine's encoder feed
/// into the normal recording folder (picture only: a quick check of the
/// encoder; real recordings carry the sound, see `live_engine_capture_start`).
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
    let family = state.capture.engine_family();
    let c = Config::default();
    let encode_args = encode::video_args(&VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps: 12_000 },
        preset: settings.preset,
        fps: c.fps,
        size: None,
    });
    let mime = "video/x-matroska;codecs=avc1";
    let running = state
        .capture
        .start_with(Kind::Record, mime, "Engine test", false)?;
    let session = running.session;
    let on_chunk = Box::new(move |chunk: Vec<u8>| {
        let _ = app.state::<crate::AppState>().capture.chunk(session, chunk);
    });
    let spec = FeedSpec {
        source: FeedSource::Screen {
            screen: ScreenId::Live,
            vertical: false,
        },
        width: c.width,
        height: c.height,
        fps: c.fps,
    };
    let make = engine_feed(ffmpeg, encode_args, None, on_chunk, None);
    let secs = seconds.unwrap_or(10).clamp(1, 120);
    let r = Arc::clone(&runner);
    let stats = tauri::async_runtime::spawn_blocking(move || {
        r.start_feed(session, spec, make)?;
        std::thread::sleep(std::time::Duration::from_secs(u64::from(secs)));
        Ok::<_, String>(r.stop_feed(session))
    })
    .await
    .map_err(|e| e.to_string())?;
    state.capture.stop(session);
    let s = stats?.unwrap_or_default();
    Ok(format!(
        "Recorded {secs} s with {} ({} frames, {} late){}: {}",
        family.label(),
        s.frames_in,
        s.frames_dropped,
        s.error
            .map(|e| format!(", FFmpeg said: {e}"))
            .unwrap_or_default(),
        running.path.unwrap_or_default()
    ))
}
