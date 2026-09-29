//! The Lumora desktop app: opens the windows and connects them to the engine.

mod browser;
mod capture;
mod control;
mod desktop;
mod events;
mod export;
mod iso;
mod library;
mod media;
mod outputs;
mod ptz;
mod remote;
mod store;
mod streams;

/// The same browser settings for every Lumora window (Windows needs them to
/// match): sound and video may play without a click first — the screens,
/// web pages and guests have nobody to click them.
pub const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use lumora_engine::{Action, ActionError, Engine, Outcome, ScreenId, Show};
use serde::Serialize;
use tauri::{Emitter, Manager, State, WindowEvent};

use outputs::Display;

use store::Store;

/// Everything the app shares between windows.
struct AppState {
    engine: Mutex<Engine>,
    store: Store,
    files: Mutex<events::EventFiles>,
    dir: std::path::PathBuf,
    remote: remote::Remote,
    capture: capture::Capture,
    library: library::Library,
    media: media::Media,
    exports: export::Exports,
    browsers: browser::Browsers,
    streams: streams::Streams,
    desktop: desktop::Desktop,
    isos: iso::Isos,
    ffmpeg: Option<std::path::PathBuf>,
}

/// A version of the show together with its revision number.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    revision: u64,
    show: Show,
}

/// Milliseconds since 1970 — the clock every window shares.
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn lock(state: &AppState) -> std::sync::MutexGuard<'_, Engine> {
    // A panic while holding the lock must never take the show down with it.
    state
        .engine
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[tauri::command]
fn get_show(state: State<'_, AppState>) -> Snapshot {
    let engine = lock(&state);
    Snapshot {
        revision: engine.revision(),
        show: engine.show().clone(),
    }
}

#[tauri::command]
fn dispatch(
    action: Action,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), ActionError> {
    apply(&app, &state, action)
}

/// Change the show (from the control window or a phone) and tell everyone.
fn apply(app: &tauri::AppHandle, state: &AppState, action: Action) -> Result<(), ActionError> {
    let moved_display = match &action {
        Action::SetDisplay { screen, .. } => Some(*screen),
        _ => None,
    };
    let snapshot = {
        let mut engine = lock(state);
        match engine.apply(action, now_ms())? {
            Outcome::Unchanged => return Ok(()),
            Outcome::Changed => Snapshot {
                revision: engine.revision(),
                show: engine.show().clone(),
            },
        }
    };
    // A new display choice takes effect straight away if that output is open.
    if let Some(screen) = moved_display {
        if let Some(w) = app.get_webview_window(&outputs::label(screen)) {
            let _ = outputs::place(app, &w, &snapshot.show, screen);
        }
    }
    announce(app, state, &snapshot);
    Ok(())
}

/// Save a new version of the show and send it to every window and phone.
fn announce(app: &tauri::AppHandle, state: &AppState, snapshot: &Snapshot) {
    state.store.save(snapshot.show.clone());
    state.browsers.sync(&snapshot.show);
    state.streams.sync(&snapshot.show);
    state.desktop.sync(&snapshot.show);
    let _ = app.emit("show-changed", snapshot);
    if let Ok(json) = serde_json::to_string(snapshot) {
        state.remote.broadcast(&json);
    }
}

fn publish(app: &tauri::AppHandle, state: &AppState, engine: &Engine) {
    let snapshot = Snapshot {
        revision: engine.revision(),
        show: engine.show().clone(),
    };
    announce(app, state, &snapshot);
}

fn files_changed(app: &tauri::AppHandle, state: &AppState, files: &events::EventFiles) {
    files.save(&state.dir);
    let _ = app.emit("event-files-changed", files.clone());
}

/// The open event's file and the recent list.
#[tauri::command]
fn event_files(state: State<'_, AppState>) -> events::EventFiles {
    state
        .files
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

/// Start a new event (this computer's settings are kept).
#[tauri::command]
fn new_event(state: State<'_, AppState>, app: tauri::AppHandle) {
    let mut engine = lock(&state);
    let fresh = events::fresh(engine.show());
    engine.replace(fresh);
    state.store.set_target(None);
    publish(&app, &state, &engine);
    let mut files = state
        .files
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    files.current = None;
    files_changed(&app, &state, &files);
}

/// Open an event file.
#[tauri::command]
fn open_event(
    path: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut engine = lock(&state);
    let show = events::read(std::path::Path::new(&path), engine.show())?;
    engine.replace(show);
    state.store.set_target(Some(path.clone().into()));
    publish(&app, &state, &engine);
    let mut files = state
        .files
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    files.opened(&path);
    files_changed(&app, &state, &files);
    Ok(())
}

/// Save the event to a file; from then on that file is kept up to date.
#[tauri::command]
fn save_event_as(
    path: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let path = events::with_extension(&path);
    let engine = lock(&state);
    events::write(&path, engine.show())?;
    let shown = path.to_string_lossy().into_owned();
    state.store.set_target(Some(path));
    let mut files = state
        .files
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    files.opened(&shown);
    files_changed(&app, &state, &files);
    Ok(shown)
}

/// Displays connected to this computer, for choosing where each output goes.
#[tauri::command]
fn list_displays(app: tauri::AppHandle) -> Vec<Display> {
    outputs::displays(&app)
}

/// Screens whose output window is open.
#[tauri::command]
fn open_outputs(app: tauri::AppHandle) -> Vec<ScreenId> {
    outputs::open_screens(&app)
}

#[tauri::command]
fn open_output(
    screen: ScreenId,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let show = lock(&state).show().clone();
    outputs::open(&app, &show, screen).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_multiview(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let show = lock(&state).show().clone();
    outputs::open_multiview(&app, &show).map_err(|e| e.to_string())
}

#[tauri::command]
fn close_multiview(app: tauri::AppHandle) -> Result<(), String> {
    outputs::close_multiview(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn multiview_open(app: tauri::AppHandle) -> bool {
    app.get_webview_window(outputs::MULTIVIEW).is_some()
}

#[tauri::command]
fn close_output(screen: ScreenId, app: tauri::AppHandle) -> Result<(), String> {
    outputs::close(&app, screen).map_err(|e| e.to_string())
}

/// The phone remote: on or off, its PIN, addresses and connected phones.
#[tauri::command]
fn remote_status(state: State<'_, AppState>) -> remote::RemoteStatus {
    state.remote.status()
}

#[tauri::command]
fn set_remote(on: bool, state: State<'_, AppState>, app: tauri::AppHandle) -> remote::RemoteStatus {
    let status = state.remote.set_enabled(on);
    let _ = app.emit("remote-changed", &status);
    status
}

#[tauri::command]
fn new_remote_pin(state: State<'_, AppState>, app: tauri::AppHandle) -> remote::RemoteStatus {
    let status = state.remote.change_pin();
    let _ = app.emit("remote-changed", &status);
    status
}

/// Recording and streaming: what is running, and the last problem.
#[tauri::command]
fn capture_status(state: State<'_, AppState>) -> capture::CaptureStatus {
    state.capture.status()
}

#[tauri::command]
fn capture_settings(state: State<'_, AppState>) -> capture::CaptureSettings {
    state.capture.settings()
}

#[tauri::command]
fn set_capture_settings(
    settings: capture::CaptureSettings,
    state: State<'_, AppState>,
) -> capture::CaptureSettings {
    state.capture.set_settings(settings)
}

/// Keep a snapshot (a PNG made by the control window) in the Snapshots
/// folder next to the recordings. The bytes are the body; the file name a
/// header. Returns where it was saved.
#[tauri::command]
fn save_snapshot(
    request: tauri::ipc::Request<'_>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let name = request
        .headers()
        .get("name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("Snapshot.png");
    let safe = snapshot_name(name);
    let dir = state.capture.folder().join("Snapshots");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not make the Snapshots folder: {e}"))?;
    let path = dir.join(safe);
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save the snapshot: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// A plain file name (never a path), ending in .png.
fn snapshot_name(name: &str) -> String {
    let base: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || " -_.()".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let base = base.trim_start_matches('.').trim();
    let base = base.strip_suffix(".png").unwrap_or(base);
    format!("{}.png", if base.is_empty() { "Snapshot" } else { base })
}

/// The folder recordings go to.
#[tauri::command]
fn capture_folder(state: State<'_, AppState>) -> String {
    state.capture.folder().to_string_lossy().into_owned()
}

#[tauri::command]
fn capture_start(
    kind: capture::Kind,
    mime: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<capture::Running, String> {
    state.capture.start(kind, &mime, &name)
}

/// More of the encoded Live Screen: the bytes are the body, the session a header.
#[tauri::command]
fn capture_chunk(
    request: tauri::ipc::Request<'_>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let session = request
        .headers()
        .get("session")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or("no session")?;
    state.capture.chunk(session, bytes.clone())
}

#[tauri::command]
fn capture_stop(session: u64, state: State<'_, AppState>) {
    state.capture.stop(session);
}

/// Start recording a camera to its own file (ISO), next to the recording.
#[tauri::command]
fn iso_start(
    recording: String,
    camera: String,
    ext: String,
    state: State<'_, AppState>,
) -> Result<(u64, String), String> {
    state
        .isos
        .start(&state.capture.folder(), &recording, &camera, &ext)
        .map(|(id, p)| (id, p.to_string_lossy().into_owned()))
}

/// More of a camera's recording: the bytes are the body, the id a header.
#[tauri::command]
fn iso_chunk(request: tauri::ipc::Request<'_>, state: State<'_, AppState>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let id = request
        .headers()
        .get("id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or("no id")?;
    state.isos.chunk(id, bytes)
}

#[tauri::command]
fn iso_stop(id: u64, state: State<'_, AppState>) {
    state.isos.stop(id);
}

/// Save the chapter list (what was on air when) next to the recording.
#[tauri::command]
fn save_chapters(
    recording: String,
    text: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    iso::save_chapters(&state.capture.folder(), &recording, &text)
        .map(|p| p.to_string_lossy().into_owned())
}

/// Keep a replay piece (a few seconds of what was on air) with the app's files.
#[tauri::command]
fn save_replay(
    request: tauri::ipc::Request<'_>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let name = request
        .headers()
        .get("name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("replay.webm");
    // Only a plain file name, never a path.
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let dir = state.dir.join("replays");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not keep the replay: {e}"))?;
    let path = dir.join(safe.trim_start_matches('.'));
    std::fs::write(&path, bytes).map_err(|e| format!("Could not keep the replay: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Keep a slide picture (a PDF page, rendered by the control window) with
/// the app's files. The bytes are the body; the file name a header. Returns
/// the path to use.
#[tauri::command]
fn save_slide(
    request: tauri::ipc::Request<'_>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let name = request
        .headers()
        .get("name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("slide.png");
    // Only a plain file name, never a path.
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let dir = state.dir.join("slides");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe.trim_start_matches('.'));
    std::fs::write(&path, bytes).map_err(|e| format!("Could not keep the slide: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Import a file: the app keeps its own copy and the show uses that, so the
/// original can be moved or deleted. Returns the copy's path.
#[tauri::command]
async fn keep_media(path: String, app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .media
            .keep(std::path::Path::new(&path))
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(|e| format!("Could not copy the file into Lumora: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Start exporting a video (the 3D logo maker). Returns the session.
#[tauri::command]
fn export_start(
    settings: export::ExportSettings,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    state.exports.start(state.ffmpeg.as_deref(), &settings)
}

/// One frame (raw RGBA; the session is a header). Off the main thread: FFmpeg
/// may make it wait, and the screens must never wait with it.
#[tauri::command]
async fn export_frame(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let bytes = bytes.clone();
    let session: u64 = request
        .headers()
        .get("session")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .ok_or("no session")?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().exports.frame(session, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Every frame sent: wait for the file. Returns its path.
#[tauri::command]
async fn export_finish(session: u64, app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().exports.finish(session))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn export_cancel(session: u64, state: State<'_, AppState>) {
    state.exports.cancel(session);
}

/// Where web page frames are served, and whether pages are captured here.
#[tauri::command]
fn browser_info(state: State<'_, AppState>) -> browser::BrowserInfo {
    state.browsers.info
}

/// Make a PTZ camera move, zoom or go to a preset.
#[tauri::command]
async fn ptz_command(ptz: lumora_engine::ptz::Ptz, command: ptz::PtzCommand) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || ptz::send(&ptz, command))
        .await
        .map_err(|e| e.to_string())?
}

/// The displays and windows a screen capture input can show.
#[tauri::command]
async fn capture_choices() -> Vec<browser::CaptureChoice> {
    tauri::async_runtime::spawn_blocking(browser::capture::choices)
        .await
        .unwrap_or_default()
}

/// How each stream input is doing (live, or why not).
#[tauri::command]
fn stream_status(
    state: State<'_, AppState>,
) -> std::collections::HashMap<String, streams::StreamStatus> {
    state
        .streams
        .status
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

/// Bring a web page's window to the front (to click on it) or send it back.
#[tauri::command]
async fn browser_page(id: String, front: bool, app: tauri::AppHandle) -> Result<(), String> {
    browser::show_page(&app, &id, front)
}

/// Back, forward or reload a web page.
#[tauri::command]
async fn browser_nav(id: String, how: String, app: tauri::AppHandle) -> Result<(), String> {
    browser::navigate(&app, &id, &how)
}

/// Every few seconds, copy in any file the show still uses from elsewhere
/// (older events, library items, an event opened from a USB stick) while
/// it is still there, and point the show at the copy.
fn media_keeper(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(5));
        let state = app.state::<AppState>();
        let (paths, on_air) = {
            let engine = lock(&state);
            let show = engine.show();
            (
                lumora_engine::media::paths(show),
                lumora_engine::media::on_air_paths(show),
            )
        };
        for from in paths {
            let p = std::path::Path::new(&from);
            // Never swap a file under something the audience is watching.
            if from.contains("://")
                || state.media.is_kept(p)
                || on_air.contains(&from)
                || !p.is_file()
            {
                continue;
            }
            match state.media.keep(p) {
                Ok(to) => {
                    let to = to.to_string_lossy().into_owned();
                    let _ = apply(&app, &state, Action::RelinkMedia { from, to });
                }
                Err(e) => eprintln!("lumora: could not keep {from}: {e}"),
            }
        }
    });
}

/// The library: things kept on this computer for later events.
#[tauri::command]
fn library_items(state: State<'_, AppState>) -> serde_json::Value {
    state.library.load()
}

#[tauri::command]
fn save_library(items: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
    state.library.save(&items)
}

#[tauri::command]
fn export_library(path: String, items: serde_json::Value) -> Result<(), String> {
    library::export(std::path::Path::new(&path), &items)
}

#[tauri::command]
fn import_library(path: String) -> Result<serde_json::Value, String> {
    library::import(std::path::Path::new(&path))
}

/// Lets the remote reach the engine.
struct RemoteBackend(tauri::AppHandle);

impl remote::Backend for RemoteBackend {
    fn snapshot(&self) -> Option<String> {
        let state = self.0.try_state::<AppState>()?;
        let engine = lock(&state);
        serde_json::to_string(&Snapshot {
            revision: engine.revision(),
            show: engine.show().clone(),
        })
        .ok()
    }

    fn apply(&self, action: Action) -> Result<(), ActionError> {
        let state = self
            .0
            .try_state::<AppState>()
            .ok_or_else(|| ActionError::InvalidValue {
                field: "Lumora".to_owned(),
                reason: "still starting".to_owned(),
            })?;
        apply(&self.0, &state, action)
    }

    fn phones_changed(&self) {
        if let Some(state) = self.0.try_state::<AppState>() {
            let _ = self.0.emit("remote-changed", state.remote.status());
        }
    }
}

/// Start Lumora.
///
/// # Panics
/// If the operating system refuses to start the app (no display, no WebView).
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            // A web page's window stays open while its input exists (closing it
            // would stop the picture); it goes away when the input is removed.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label().starts_with("page-") {
                    api.prevent_close();
                }
            }
            if let WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if window.label() == "control" {
                    // Closing the control window ends the show: finish any
                    // recording or stream, and close the outputs too.
                    if let Some(state) = app.try_state::<AppState>() {
                        state.capture.stop_all();
                    }
                    app.exit(0);
                } else {
                    outputs::notify(app);
                }
            }
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let (store, show, from) = Store::open(dir.clone());
            eprintln!("lumora: show loaded ({from:?})");
            // Carry on with the event that was open (its file keeps being updated).
            let files = events::EventFiles::load(&dir);
            if let Some(current) = &files.current {
                store.set_target(Some(current.into()));
            }
            let remote = remote::Remote::new(
                Some(&dir),
                remote::DEFAULT_PORT,
                RemoteBackend(app.handle().clone()),
            );
            let videos = app
                .path()
                .video_dir()
                .or_else(|_| app.path().home_dir())
                .unwrap_or_else(|_| dir.clone())
                .join("Lumora");
            let ffmpeg = capture::find_ffmpeg();
            eprintln!("lumora: ffmpeg {ffmpeg:?}");
            let handle = app.handle().clone();
            let capture =
                capture::Capture::new(Some(&dir), videos, ffmpeg.clone(), move |status| {
                    let _ = handle.emit("capture-changed", status);
                });
            let library = library::Library::new(&dir);
            let media = media::Media::new(&dir);
            let browsers = browser::Browsers::new(app.handle().clone());
            browsers.sync(&show);
            let streams = streams::Streams::new(
                ffmpeg.clone(),
                std::sync::Arc::clone(&browsers.frames),
                std::sync::Arc::clone(&browsers.sounds),
            );
            streams.sync(&show);
            let desktop = desktop::Desktop::new(std::sync::Arc::clone(&browsers.frames));
            desktop.sync(&show);
            app.manage(AppState {
                engine: Mutex::new(Engine::with_show(show)),
                store,
                files: Mutex::new(files),
                dir,
                remote,
                capture,
                library,
                media,
                exports: export::Exports::default(),
                browsers,
                streams,
                desktop,
                isos: iso::Isos::default(),
                ffmpeg,
            });
            heartbeat(app.handle().clone());
            media_keeper(app.handle().clone());
            if std::env::var_os("LUMORA_SMOKE_TEST").is_some() {
                smoke_test(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_show,
            dispatch,
            list_displays,
            open_outputs,
            open_output,
            close_output,
            open_multiview,
            close_multiview,
            multiview_open,
            event_files,
            new_event,
            open_event,
            save_event_as,
            remote_status,
            set_remote,
            new_remote_pin,
            capture_status,
            capture_settings,
            set_capture_settings,
            capture_folder,
            capture_start,
            capture_chunk,
            capture_stop,
            save_slide,
            save_replay,
            iso_start,
            iso_chunk,
            iso_stop,
            save_chapters,
            save_snapshot,
            keep_media,
            export_start,
            export_frame,
            export_finish,
            export_cancel,
            browser_info,
            browser_page,
            browser_nav,
            stream_status,
            capture_choices,
            ptz_command,
            library_items,
            save_library,
            export_library,
            import_library
        ])
        .run(tauri::generate_context!())
        .expect("Lumora could not start");
}

/// Lets time pass in the engine ten times a second, so things that are due
/// (the countdown's at-zero action) happen on time with nobody touching anything.
fn heartbeat(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let state = app.state::<AppState>();
        let snapshot = {
            let mut engine = lock(&state);
            match engine.tick(now_ms()) {
                Outcome::Unchanged => continue,
                Outcome::Changed => Snapshot {
                    revision: engine.revision(),
                    show: engine.show().clone(),
                },
            }
        };
        announce(&app, &state, &snapshot);
    });
}

/// `LUMORA_SMOKE_TEST=1`: open all three outputs, check they exist, report and
/// quit (exit code 0 when everything opened). Used to check a build starts.
fn smoke_test(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let show = lock(&handle.state::<AppState>()).show().clone();
            for screen in ScreenId::ALL {
                if let Err(e) = outputs::open(&handle, &show, screen) {
                    eprintln!("lumora smoke test: {screen:?} output failed: {e}");
                }
            }
        });
        std::thread::sleep(std::time::Duration::from_secs(3));
        let open = outputs::open_screens(&app);
        eprintln!("lumora smoke test: displays {:?}", outputs::displays(&app));
        eprintln!("lumora smoke test: outputs open {open:?}");
        app.exit(i32::from(open.len() != ScreenId::ALL.len()));
    });
}

#[cfg(test)]
mod tests {
    use super::snapshot_name;

    #[test]
    fn snapshot_names_are_plain_files() {
        assert_eq!(
            snapshot_name("Live Screen 2026-09-29 21.14.05.png"),
            "Live Screen 2026-09-29 21.14.05.png"
        );
        let odd = snapshot_name("../../etc/passwd");
        assert!(!odd.contains('/') && !odd.starts_with('.'), "{odd}");
        assert_eq!(snapshot_name(""), "Snapshot.png");
    }
}
