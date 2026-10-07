//! The Lumora desktop app: opens the windows and connects them to the engine.

mod api;
mod browser;
mod captions;
mod capture;
mod control;
mod desktop;
mod encode;
mod events;
mod export;
mod iso;
mod library;
mod live;
mod media;
mod ndi;
mod outputs;
mod perf;
mod ptz;
mod remote;
mod selftest;
mod speaker;
mod store;
mod streamdeck;
mod streams;
mod syscheck;
mod testevent;
mod tunnel;

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
    api: api::Api,
    capture: capture::Capture,
    library: library::Library,
    media: media::Media,
    exports: export::Exports,
    browsers: browser::Browsers,
    streams: streams::Streams,
    desktop: desktop::Desktop,
    isos: iso::Isos,
    perf: perf::Perf,
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

/// When Lumora started, so the loading window shows long enough to be seen.
static STARTED: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
/// The loading window stays at least this long.
const SPLASH_MIN: std::time::Duration = std::time::Duration::from_millis(2500);

/// Close requests the control window has not answered yet.
static CLOSE_ASKED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static CLOSE_ANSWERED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// How long the control window has to show "Close Lumora?" before it closes anyway.
const CLOSE_ANSWER: std::time::Duration = std::time::Duration::from_secs(3);

/// Ask the control window to confirm closing; if it does not answer (it is
/// still loading, or stuck), close it so the app can always be closed.
fn ask_to_close(window: &tauri::Window) {
    use std::sync::atomic::Ordering;
    let n = CLOSE_ASKED.fetch_add(1, Ordering::SeqCst) + 1;
    if window.emit("close-requested", n).is_err() {
        let _ = window.destroy();
        return;
    }
    let w = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(CLOSE_ANSWER);
        if CLOSE_ANSWERED.load(Ordering::SeqCst) < n {
            let _ = w.destroy();
        }
    });
}

/// The control window is showing "Close Lumora?" for this request.
#[tauri::command]
fn close_seen(request: u64) {
    CLOSE_ANSWERED.fetch_max(request, std::sync::atomic::Ordering::SeqCst);
}

/// The person confirmed: close Lumora (the stream and recording end).
#[tauri::command]
fn close_app(app: tauri::AppHandle) {
    match app.get_webview_window("control") {
        Some(w) => {
            let _ = w.destroy();
        }
        None => app.exit(0),
    }
}

/// The control window has loaded: show it and close the loading window (once
/// the loading window has been up for a moment, so it never just flickers).
#[tauri::command]
fn app_ready(app: tauri::AppHandle) {
    let shown = STARTED
        .get()
        .map_or(SPLASH_MIN, std::time::Instant::elapsed);
    if shown >= SPLASH_MIN {
        reveal(&app);
    } else {
        std::thread::spawn(move || {
            std::thread::sleep(SPLASH_MIN - shown);
            reveal(&app);
        });
    }
}

/// Show the control window (filling the screen) and close the loading window.
fn reveal(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("control") {
        if !w.is_visible().unwrap_or(true) {
            let _ = w.maximize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
    if let Some(s) = app.get_webview_window("splash") {
        let _ = s.close();
    }
}

/// The loading window: a good size for the screen (about 45% of its width,
/// 5:3), in the middle of it.
fn place_splash(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window("splash") else {
        return;
    };
    let monitor = w
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| w.current_monitor().ok().flatten());
    if let Some(m) = monitor {
        let (sw, sh) = (f64::from(m.size().width), f64::from(m.size().height));
        let width = (sw * 0.45).clamp(560.0, 1100.0).min(sw * 0.9);
        let height = (width * 0.6).min(sh * 0.8);
        let (x, y) = (
            f64::from(m.position().x) + (sw - width) / 2.0,
            f64::from(m.position().y) + (sh - height) / 2.0,
        );
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        {
            let _ = w.set_size(tauri::PhysicalSize::new(width as u32, height as u32));
            let _ = w.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        }
    } else {
        let _ = w.center();
    }
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
        app.state::<live::Live>().place(app, &snapshot.show, screen);
    }
    announce(app, state, &snapshot);
    Ok(())
}

/// Save a new version of the show and send it to every window and phone.
fn announce(app: &tauri::AppHandle, state: &AppState, snapshot: &Snapshot) {
    state.store.save(snapshot.show.clone(), snapshot.revision);
    state.browsers.sync(&snapshot.show);
    state.streams.sync(&snapshot.show);
    state.desktop.sync(&snapshot.show);
    if let Some(live) = app.try_state::<live::Live>() {
        live.sync(&snapshot.show);
    }
    let _ = app.emit("show-changed", snapshot);
    if let Ok(json) = serde_json::to_string(snapshot) {
        state.remote.broadcast(&json);
    }
    state.api.show_changed(&snapshot.show);
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
/// The NDI sources on the network (asks `extra_ips` directly too).
#[tauri::command]
async fn ndi_sources(extra_ips: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || ndi::sources(2500, &extra_ips))
        .await
        .map_err(|e| e.to_string())?
}

/// The live captions model on this computer (downloaded the first time).
#[tauri::command]
async fn captions_model(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || captions::model(&dir, &name))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.to_string_lossy().into_owned())
}

/// Send a caption line to `YouTube` (closed captions viewers turn on and off).
#[tauri::command]
async fn captions_send(url: String, seq: u64, at: u64, text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || captions::send_youtube(&url, seq, at, &text))
        .await
        .map_err(|e| e.to_string())?
}

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
    live::all_open(&app)
}

#[tauri::command]
fn open_output(
    screen: ScreenId,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let show = lock(&state).show().clone();
    // Settings → Engine → Unified (beta): the engine shows it in its own window.
    if app.state::<live::Live>().open_output(&app, &show, screen)? {
        return Ok(());
    }
    outputs::open(&app, &show, screen).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_multiview(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let show = lock(&state).show().clone();
    outputs::open_multiview(&app, &show).map_err(|e| e.to_string())
}

/// The Lumora website. When it moves to its own domain, change this one line
/// (and `SITE_URL` in app/src/site.ts and the other app's lib.rs).
pub(crate) const SITE_URL: &str = "https://yehudakogan770.github.io/Livestreamingapp/";

/// The pages of the website the app may open in the browser (only these).
const SITE_PAGES: [&str; 3] = ["planner/", "terms.html", "privacy.html"];

/// Opens a web address in the computer's browser.
fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("The browser could not be opened: {e}"))?;
    // Reaped once the opener hands the address to the browser.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Opens a page of the Lumora website (the Planner, Terms of Use or Privacy
/// Policy) in the browser.
#[tauri::command]
fn open_site_page(page: String) -> Result<(), String> {
    if !SITE_PAGES.contains(&page.as_str()) {
        return Err("That page is not part of the Lumora website.".to_owned());
    }
    open_in_browser(&format!("{SITE_URL}{page}"))
}

/// Opens the web Lumora Planner (the team's shared run of show) in the browser.
#[tauri::command]
fn open_planner() -> Result<(), String> {
    open_in_browser(&format!("{SITE_URL}planner/"))
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
    if app.state::<live::Live>().close_output(&app, screen) {
        return Ok(());
    }
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

/// A QR code (SVG) for some text: the guests' Wi-Fi, a link.
#[tauri::command]
fn qr_code(text: String) -> String {
    remote::qr_svg(&text)
}

/// Put the audience page on the internet, for phones on any network (or take it off).
#[tauri::command]
fn set_audience_internet(
    on: bool,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> remote::RemoteStatus {
    let status = state.remote.set_internet(on);
    let _ = app.emit("remote-changed", &status);
    status
}

#[tauri::command]
fn new_remote_pin(state: State<'_, AppState>, app: tauri::AppHandle) -> remote::RemoteStatus {
    let status = state.remote.change_pin();
    let _ = app.emit("remote-changed", &status);
    status
}

/// The speaker's clicker: pause it (or let it change slides again), and
/// whether the speaker may black out the slides.
#[tauri::command]
fn set_speaker(
    locked: Option<bool>,
    black: Option<bool>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> remote::RemoteStatus {
    let status = state.remote.set_speaker(locked, black);
    let _ = app.emit("remote-changed", &status);
    status
}

#[tauri::command]
fn new_speaker_pin(state: State<'_, AppState>, app: tauri::AppHandle) -> remote::RemoteStatus {
    let status = state.remote.change_speaker_pin();
    let _ = app.emit("remote-changed", &status);
    status
}

/// Disconnect a device from the slides page.
#[tauri::command]
fn disconnect_speaker(
    id: u64,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> remote::RemoteStatus {
    let status = state.remote.disconnect_device(id);
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
    rehearse: Option<bool>,
    state: State<'_, AppState>,
) -> Result<capture::Running, String> {
    state
        .capture
        .start_with(kind, &mime, &name, rehearse.unwrap_or(false))
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

/// Save the event file the editing program opens, next to the recording.
#[tauri::command]
fn save_event_file(
    recording: String,
    json: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    iso::save_event(&state.capture.folder(), &recording, &json)
        .map(|p| p.to_string_lossy().into_owned())
}

/// Read the data file titles take their words from (a CSV or JSON file, up to 4 MB).
#[tauri::command]
async fn read_data_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|_| "the file is not there".to_owned())?;
    if meta.len() > 4_000_000 {
        return Err("the file is too big (over 4 MB)".to_owned());
    }
    let bytes = std::fs::read(&path).map_err(|e| {
        format!("it could not be read ({e}) — is it open and locked in another program?")
    })?;
    // Excel saves CSV as UTF-8 with a mark at the start, or in the old Windows code page.
    let text = String::from_utf8(bytes.clone())
        .unwrap_or_else(|_| bytes.iter().map(|&b| char::from(b)).collect());
    Ok(text.trim_start_matches('\u{feff}').to_owned())
}

/// What went wrong with a Google Sheet or CSV link, from its answer.
fn data_url_problem(status: u16, body_start: &str) -> Option<String> {
    const SHARE: &str =
        "share it with \"Anyone with the link\" or publish it to the web as CSV (File → Share → Publish to web)";
    match status {
        401 | 403 | 404 => Some(format!("the sheet answered {status} — {SHARE}")),
        200..=299 => {
            let t = body_start.trim_start();
            // A sign-in page instead of the sheet: it is not shared.
            (t.starts_with("<!DOCTYPE html")
                || t.starts_with("<!doctype html")
                || t.starts_with("<html"))
            .then(|| format!("a web page came back instead of the sheet — {SHARE}"))
        }
        _ => Some(format!("the link answered {status}")),
    }
}

/// A data file from the web: a Google Sheet's CSV or any CSV or JSON link.
/// Fetched here, not in the WebView, so any site works (no browser limits).
#[tauri::command]
async fn read_data_url(url: String) -> Result<String, String> {
    const MAX: usize = 4_000_000;
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("the link must start with https://".to_owned());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(concat!("Lumora/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("could not reach the internet ({e})"))?;
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("could not reach it ({e}) — is the internet working?"))?;
    let status = res.status().as_u16();
    if res.content_length().is_some_and(|n| n > MAX as u64) {
        return Err("the sheet is too big (over 4 MB)".to_owned());
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("it stopped half way ({e})"))?;
    if bytes.len() > MAX {
        return Err("the sheet is too big (over 4 MB)".to_owned());
    }
    let text = String::from_utf8_lossy(&bytes);
    let start: String = text.chars().take(200).collect();
    if let Some(problem) = data_url_problem(status, &start) {
        return Err(problem);
    }
    Ok(text.trim_start_matches('\u{feff}').to_owned())
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

/// How hard the computer is working (processor, memory).
#[tauri::command]
async fn perf_stats(state: State<'_, AppState>) -> Result<perf::PerfStats, String> {
    Ok(state.perf.sample())
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
    state.browsers.info.clone()
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

    fn app_command(&self, command: remote::AppCommand) -> Result<(), String> {
        // Recording, streaming and replay run in the control window.
        self.0
            .emit_to("control", "remote-command", command)
            .map_err(|e| e.to_string())
    }
}

/// The control window says what is running (recording, stream, rehearsal,
/// replay), for control surfaces such as the Stream Deck.
#[tauri::command]
fn remote_app_state(app_state: serde_json::Value, state: State<'_, AppState>) {
    state.remote.set_app_state(&app_state);
    state.api.set_app_state(&app_state);
}

/// Lets the control API reach the engine and the control window.
struct ApiLink(tauri::AppHandle);

impl api::ApiBackend for ApiLink {
    fn show(&self) -> Option<serde_json::Value> {
        let state = self.0.try_state::<AppState>()?;
        let engine = lock(&state);
        serde_json::to_value(engine.show()).ok()
    }

    fn apply(&self, action: Action) -> Result<(), String> {
        let state = self
            .0
            .try_state::<AppState>()
            .ok_or_else(|| "Lumora is still starting".to_owned())?;
        apply(&self.0, &state, action).map_err(|e| e.to_string())
    }

    fn app_command(&self, command: remote::AppCommand) -> Result<(), String> {
        // Recording, streaming and replay run in the control window.
        self.0
            .emit_to("control", "remote-command", command)
            .map_err(|e| e.to_string())
    }
}

/// The control API: its settings, token and addresses.
#[tauri::command]
fn api_status(state: State<'_, AppState>) -> api::ApiStatus {
    state.api.status()
}

#[tauri::command]
fn set_api(config: api::ApiConfig, state: State<'_, AppState>) -> api::ApiStatus {
    state.api.set(config)
}

/// A new token for the control API (the old one stops working).
#[tauri::command]
fn new_api_token(state: State<'_, AppState>) -> api::ApiStatus {
    let status = state.api.new_token();
    state.remote.set_api_token(&status.config.token);
    status
}

fn deck_places(app: &tauri::AppHandle) -> streamdeck::Places {
    streamdeck::Places::here(
        app.path().resource_dir().ok(),
        app.path().app_data_dir().ok(),
    )
}

/// Is the Stream Deck app here, and is Lumora's plugin in it?
#[tauri::command]
fn streamdeck_status(app: tauri::AppHandle) -> streamdeck::DeckStatus {
    streamdeck::status(&deck_places(&app))
}

/// Add (or update) Lumora's buttons in the Stream Deck app.
#[tauri::command]
fn streamdeck_install(app: tauri::AppHandle) -> Result<streamdeck::DeckStatus, String> {
    streamdeck::install(&deck_places(&app))
}

/// "Not now": don't offer this version of the plugin again.
#[tauri::command]
fn streamdeck_dismiss(app: tauri::AppHandle) -> streamdeck::DeckStatus {
    streamdeck::answer(&deck_places(&app))
}

/// Crashes since last time (see crates/crash); the screens send them only if
/// the person agreed to error reports.
#[tauri::command]
fn take_crash_reports(app: tauri::AppHandle) -> Vec<lumora_crash::CrashReport> {
    app.path()
        .app_data_dir()
        .map(|dir| lumora_crash::take(&dir))
        .unwrap_or_default()
}

/// Start Lumora.
///
/// # Panics
/// If the operating system refuses to start the app (no display, no WebView).
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            // A web page's window stays open while its input exists (closing it
            // would stop the picture); it goes away when the input is removed.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label().starts_with("page-") {
                    api.prevent_close();
                } else if window.label() == "control" {
                    // Lumora asks before it closes (a stream or recording
                    // would end). A window that cannot answer still closes.
                    api.prevent_close();
                    ask_to_close(window);
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
                } else if window.label() != "splash" {
                    outputs::notify(app);
                }
            }
        })
        .setup(|app| {
            STARTED.get_or_init(std::time::Instant::now);
            place_splash(app.handle());
            let dir = app.path().app_data_dir()?;
            // A crash leaves a note for an (opt-in) error report next time.
            lumora_crash::install(dir.clone(), app.package_info().version.to_string());
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
            let control_api = api::Api::new(Some(&dir), ApiLink(app.handle().clone()));
            remote.set_api_token(&control_api.token());
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
            // A test event that was cut short: the person's own show comes back first.
            let mut show = show;
            if lumora_testevent::read_marker(&dir).is_some() {
                testevent::restore_at_start(&dir, &mut show, &capture);
                store.save(show.clone(), 0);
            }
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
            app.manage(live::Live::new(&dir, ffmpeg.clone()));
            app.manage(AppState {
                engine: Mutex::new(Engine::with_show(show)),
                store,
                files: Mutex::new(files),
                dir,
                remote,
                api: control_api,
                capture,
                library,
                media,
                exports: export::Exports::default(),
                browsers,
                streams,
                desktop,
                isos: iso::Isos::default(),
                perf: perf::Perf::default(),
                ffmpeg,
            });
            // If the control window never says it is ready, show it anyway.
            let late = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(20));
                reveal(&late);
            });
            // Which graphics-card encoders really work here (a tiny encode
            // each, a few seconds, off the main thread).
            let probe = app.handle().clone();
            std::thread::spawn(move || {
                let state = probe.state::<AppState>();
                let working = state
                    .ffmpeg
                    .as_deref()
                    .map(lumora_syscheck::working_hw_encoders)
                    .unwrap_or_default();
                state.capture.set_hw_encoders(working);
            });
            live::start_saved(app.handle());
            heartbeat(app.handle().clone());
            media_keeper(app.handle().clone());
            // The CI self-test: close (with a failed result) if it never finishes.
            let quit = app.handle().clone();
            lumora_selftest::watchdog(move || quit.exit(1));
            if std::env::var_os("LUMORA_SMOKE_TEST").is_some() {
                smoke_test(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            syscheck::system_facts,
            selftest::selftest_config,
            selftest::selftest_finish,
            selftest::selftest_temp_folder,
            selftest::selftest_videos,
            selftest::selftest_decode,
            testevent::test_event_begin,
            testevent::test_event_end,
            testevent::test_event_restored_at_start,
            testevent::test_event_media,
            testevent::test_event_disk_speed,
            testevent::test_event_videos,
            testevent::test_event_probe,
            testevent::test_event_cleanup,
            testevent::test_event_receivers,
            testevent::test_event_stop_receivers,
            testevent::test_event_preflight,
            testevent::test_event_real_destination,
            testevent::test_event_arrange_outputs,
            testevent::test_event_fullscreen,
            testevent::test_event_system,
            testevent::test_event_save_report,
            testevent::test_event_open_report,
            take_crash_reports,
            close_seen,
            close_app,
            captions_model,
            ndi_sources,
            captions_send,
            get_show,
            dispatch,
            list_displays,
            open_outputs,
            open_output,
            close_output,
            open_multiview,
            open_planner,
            open_site_page,
            close_multiview,
            multiview_open,
            event_files,
            new_event,
            open_event,
            save_event_as,
            remote_status,
            set_remote,
            new_remote_pin,
            api_status,
            set_api,
            new_api_token,
            set_speaker,
            new_speaker_pin,
            disconnect_speaker,
            set_audience_internet,
            read_data_file,
            read_data_url,
            qr_code,
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
            save_event_file,
            save_chapters,
            perf_stats,
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
            import_library,
            remote_app_state,
            streamdeck_status,
            streamdeck_install,
            streamdeck_dismiss,
            live::live_engine_info,
            live::live_engine_set_mode,
            live::live_engine_preview,
            live::live_engine_health,
            live::live_engine_test_record,
            live::live_engine_graphics
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
            // A bug in one tick must never stop time for the rest of the event
            // (a tick works on a copy, so the show is unharmed).
            let ticked =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| engine.tick(now_ms())));
            match ticked.unwrap_or(Outcome::Unchanged) {
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
    use super::{data_url_problem, snapshot_name};

    #[test]
    fn a_sheet_that_is_not_shared_is_explained() {
        assert_eq!(data_url_problem(200, "Name,Score\nA,1"), None);
        assert!(data_url_problem(200, "  <!DOCTYPE html><html>Sign in")
            .is_some_and(|p| p.contains("Anyone with the link")));
        assert!(data_url_problem(403, "").is_some_and(|p| p.contains("403")));
        assert_eq!(
            data_url_problem(500, "").as_deref(),
            Some("the link answered 500")
        );
    }

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

    /// Web page windows (`page-*`) show pages from the internet: no
    /// capability may cover them, and the screens get only their own window.
    #[test]
    fn web_page_windows_get_no_permissions() {
        for text in [
            include_str!("../capabilities/default.json"),
            include_str!("../capabilities/outputs.json"),
        ] {
            let v: serde_json::Value = serde_json::from_str(text).unwrap();
            for w in v["windows"].as_array().unwrap() {
                let w = w.as_str().unwrap();
                assert!(w == "control" || w == "output-*", "{w}");
            }
            assert!(
                v.get("remote").is_none(),
                "no web address may use Lumora's commands"
            );
            if v["windows"][0] == "output-*" {
                let perms = v["permissions"].to_string();
                assert!(
                    !perms.contains("dialog")
                        && !perms.contains("updater")
                        && !perms.contains("process"),
                    "{perms}"
                );
            }
        }
    }
}
