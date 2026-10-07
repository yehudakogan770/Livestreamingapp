//! The test event's commands (Settings → Run a test event…; the screens are in
//! app/src/testevent/). The person's own show and recording settings are put
//! aside in a marker file (`lumora_testevent`) while a temporary test show
//! runs, and put back exactly afterwards — or on the next start, if Lumora
//! closed in the middle of a test.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use lumora_engine::persist::{load_json, save_json};
use lumora_engine::Show;
use lumora_testevent::{self as te, Marker, Media, Probe, Saved};
use serde::Serialize;
use tauri::{Manager, State};

use crate::capture::{CaptureSettings, Destination};
use crate::{lock, now_ms, publish, AppState};

/// Lumora put the person's show back at start, after a test event was cut short.
static RESTORED_AT_START: AtomicBool = AtomicBool::new(false);

/// Where a rehearsal stream "goes" during the test: nowhere (this computer,
/// a port nothing listens on). A rehearsal sends nothing anyway; this makes
/// sure the person's real destinations can never be reached by the test.
pub const LOCAL_SINK: &str = "rtmp://127.0.0.1:1/lumora-test";

/// The recording settings while the test runs: the person's picture quality
/// and bitrates, the test folder, no NDI, and only the local sink as a
/// destination (with a vertical one when the person streams vertical too).
pub fn test_settings(own: &CaptureSettings, folder: &Path) -> CaptureSettings {
    let wants_vertical = own.destinations.iter().any(|d| d.enabled && d.vertical);
    let sink = |id: &str, vertical: bool| Destination {
        id: id.to_owned(),
        name: "Test (nothing is sent)".to_owned(),
        url: LOCAL_SINK.to_owned(),
        key: String::new(),
        enabled: true,
        vertical,
        captions_url: String::new(),
        video_kbps: None,
        backup_url: String::new(),
    };
    let mut destinations = vec![sink("lumora-test", false)];
    if wants_vertical {
        destinations.push(sink("lumora-test-vertical", true));
    }
    CaptureSettings {
        folder: Some(folder.to_string_lossy().into_owned()),
        ndi: false,
        destinations,
        ..own.clone()
    }
}

/// The test show: a fresh show with this computer's settings (displays,
/// stingers), named so nobody mistakes it for the real event.
pub fn test_show(current: &Show) -> Show {
    let mut show = crate::events::fresh(current);
    show.event.name = "Lumora test event".to_owned();
    show.event.set_up = true;
    show
}

/// The person's show and settings from a marker (None: the marker is unreadable).
pub fn from_marker(m: &Marker) -> Option<(Show, CaptureSettings)> {
    let show = load_json(&m.show).ok()?;
    let capture = serde_json::from_value(m.capture.clone()).ok()?;
    Some((show, capture))
}

/// At start: if a test event was cut short, put the person's show and
/// settings back (before anything else sees the test show).
pub fn restore_at_start(dir: &Path, show: &mut Show, capture: &crate::capture::Capture) {
    let Some(m) = te::read_marker(dir) else {
        return;
    };
    if let Some((own, settings)) = from_marker(&m) {
        *show = own;
        capture.set_settings(settings);
        RESTORED_AT_START.store(true, Ordering::SeqCst);
        eprintln!("lumora: put the event back after a test event that was cut short");
    } else {
        eprintln!("lumora: the test event's restore marker could not be read");
    }
    if let Some(f) = &m.folder {
        let _ = te::remove_folder(Path::new(f));
    }
    te::clear_marker(dir);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Begun {
    /// Where the test's files go (removed afterwards).
    pub folder: String,
    /// The person's own recording folder is on the drive tested.
    pub user_drive: bool,
}

fn refuse_if_busy(state: &AppState) -> Result<(), String> {
    let s = state.capture.status();
    if s.recording.is_some() {
        return Err("Lumora is recording. Stop the recording first; the test event can't run during a real one.".to_owned());
    }
    if s.streaming.is_some() || s.vertical.is_some() {
        return Err("Lumora is streaming. The test event can't run while you are live.".to_owned());
    }
    Ok(())
}

/// Puts the person's show and settings aside and switches to the test show.
#[tauri::command]
pub fn test_event_begin(
    user_drive: bool,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<Begun, String> {
    refuse_if_busy(&state)?;
    if te::read_marker(&state.dir).is_some() {
        return Err("A test event is already running.".to_owned());
    }
    let own_settings = state.capture.settings();
    let base = if user_drive {
        state.capture.folder()
    } else {
        std::env::temp_dir()
    };
    std::fs::create_dir_all(&base)
        .map_err(|e| format!("Could not use the recording folder: {e}"))?;
    let folder = te::new_folder(&base)?;
    let mut engine = lock(&state);
    let marker = Marker {
        version: 1,
        started_at: now_ms(),
        show: save_json(engine.show()),
        capture: serde_json::to_value(&own_settings).map_err(|e| e.to_string())?,
        folder: Some(folder.to_string_lossy().into_owned()),
    };
    if let Err(e) = te::write_marker(&state.dir, &marker) {
        let _ = te::remove_folder(&folder);
        return Err(e);
    }
    state
        .capture
        .set_settings(test_settings(&own_settings, &folder));
    // The event's own file must never get the test show.
    state.store.set_target(None);
    let show = test_show(engine.show());
    engine.replace(show);
    publish(&app, &state, &engine);
    Ok(Begun {
        folder: folder.to_string_lossy().into_owned(),
        user_drive,
    })
}

/// Puts the person's show and settings back. False: there was nothing to put back.
#[tauri::command]
pub fn test_event_end(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<bool, String> {
    stop_receivers(std::time::Duration::ZERO);
    let Some(m) = te::read_marker(&state.dir) else {
        return Ok(false);
    };
    let (show, settings) = from_marker(&m)
        .ok_or("The saved event could not be read back. It is still kept in the restore file.")?;
    state.capture.set_settings(settings);
    let mut engine = lock(&state);
    engine.replace(show);
    let target = state
        .files
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .current
        .clone();
    state.store.set_target(target.map(PathBuf::from));
    publish(&app, &state, &engine);
    drop(engine);
    te::clear_marker(&state.dir);
    Ok(true)
}

/// Lumora put the person's event back at start (asked once, for a notice).
#[tauri::command]
pub fn test_event_restored_at_start() -> bool {
    RESTORED_AT_START.swap(false, Ordering::SeqCst)
}

fn test_folder(folder: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(folder);
    if te::is_test_folder(&p) {
        Ok(p)
    } else {
        Err("Not a test event folder".to_owned())
    }
}

fn inside_test_folder(file: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(file);
    if p.ancestors().any(te::is_test_folder) {
        Ok(p)
    } else {
        Err("Not a test event file".to_owned())
    }
}

/// Makes the test video, picture and slides.
#[tauri::command]
pub async fn test_event_media(folder: String, state: State<'_, AppState>) -> Result<Media, String> {
    let folder = test_folder(&folder)?;
    let ffmpeg = state.ffmpeg.clone().ok_or("FFmpeg was not found")?;
    tauri::async_runtime::spawn_blocking(move || te::make_media(&ffmpeg, &folder))
        .await
        .map_err(|e| e.to_string())
}

/// How fast the test folder's drive writes, MB/s.
#[tauri::command]
pub async fn test_event_disk_speed(folder: String) -> Result<f64, String> {
    let folder = test_folder(&folder)?;
    tauri::async_runtime::spawn_blocking(move || te::disk_write_speed(&folder, 128))
        .await
        .map_err(|e| e.to_string())?
}

/// The video files the test recorded.
#[tauri::command]
pub fn test_event_videos(folder: String) -> Result<Vec<lumora_selftest::VideoFile>, String> {
    Ok(lumora_selftest::videos_in(&test_folder(&folder)?))
}

/// Decodes a recording the test made with FFmpeg.
#[tauri::command]
pub async fn test_event_probe(file: String, state: State<'_, AppState>) -> Result<Probe, String> {
    let file = inside_test_folder(&file)?;
    let ffmpeg = state.ffmpeg.clone().ok_or("FFmpeg was not found")?;
    tauri::async_runtime::spawn_blocking(move || te::probe(&ffmpeg, &file))
        .await
        .map_err(|e| e.to_string())?
}

/// Removes the test folder and the replays the test made.
#[tauri::command]
pub fn test_event_cleanup(
    folder: String,
    replays: Vec<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let removed = te::remove_replays(&state.dir.join("replays"), &replays);
    te::remove_folder(&test_folder(&folder)?)?;
    Ok(removed)
}

// ----- the stream test: local receivers -----

struct Receiver {
    child: std::process::Child,
    file: PathBuf,
}

static RECEIVERS: std::sync::Mutex<Vec<Receiver>> = std::sync::Mutex::new(Vec::new());

fn receivers() -> std::sync::MutexGuard<'static, Vec<Receiver>> {
    RECEIVERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// A local stream receiver: where Lumora streams to, and where it keeps what it got.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverInfo {
    pub port: u16,
    pub file: String,
    pub vertical: bool,
}

/// Starts local RTMP receivers (one, plus one for the vertical version) with
/// FFmpeg and points the test's destinations at them, so Lumora's real
/// streaming path runs end to end without anything leaving this computer.
#[tauri::command]
pub fn test_event_receivers(
    folder: String,
    vertical: bool,
    state: State<'_, AppState>,
) -> Result<Vec<ReceiverInfo>, String> {
    let folder = test_folder(&folder)?;
    let ffmpeg = state.ffmpeg.clone().ok_or("FFmpeg was not found")?;
    stop_receivers(std::time::Duration::ZERO);
    let mut out = Vec::new();
    let mut destinations = Vec::new();
    for v in if vertical {
        vec![false, true]
    } else {
        vec![false]
    } {
        let port = te::free_port()?;
        let file = folder.join(if v {
            "received-vertical.flv"
        } else {
            "received.flv"
        });
        let child = crate::capture::quiet(&ffmpeg)
            .args(te::receiver_args(port, &file))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("The test receiver could not start: {e}"))?;
        receivers().push(Receiver {
            child,
            file: file.clone(),
        });
        let (url, key) = te::receiver_url(port);
        destinations.push(Destination {
            id: format!("lumora-test-{port}"),
            name: if v {
                "Test receiver (vertical)"
            } else {
                "Test receiver"
            }
            .to_owned(),
            url,
            key,
            enabled: true,
            vertical: v,
            captions_url: String::new(),
            video_kbps: None,
            backup_url: String::new(),
        });
        out.push(ReceiverInfo {
            port,
            file: file.to_string_lossy().into_owned(),
            vertical: v,
        });
    }
    // Give the receivers a moment to listen before anything connects.
    std::thread::sleep(std::time::Duration::from_millis(600));
    let settings = state.capture.settings();
    state.capture.set_settings(CaptureSettings {
        destinations,
        ..settings
    });
    Ok(out)
}

/// Waits (up to `wait`) for the receivers to finish their files, then stops them.
fn stop_receivers(wait: std::time::Duration) {
    let deadline = std::time::Instant::now() + wait;
    let mut all = std::mem::take(&mut *receivers());
    for r in &mut all {
        while std::time::Instant::now() < deadline {
            if matches!(r.child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        if !matches!(r.child.try_wait(), Ok(Some(_))) {
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
        let _ = &r.file;
    }
}

/// Stops the receivers (after the stream has ended) and points the test's
/// destinations back at nowhere.
#[tauri::command]
pub async fn test_event_stop_receivers(state: State<'_, AppState>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| stop_receivers(std::time::Duration::from_secs(10)))
        .await
        .map_err(|e| e.to_string())?;
    if let Some(folder) = state.capture.settings().folder {
        let own = te::read_marker(&state.dir)
            .and_then(|m| from_marker(&m))
            .map(|(_, s)| s)
            .unwrap_or_default();
        state
            .capture
            .set_settings(test_settings(&own, Path::new(&folder)));
    }
    Ok(())
}

/// Checks the person's own destinations: stream key there, server answers.
/// Nothing is streamed to them.
#[tauri::command]
pub async fn test_event_preflight(state: State<'_, AppState>) -> Result<Vec<te::Reach>, String> {
    let own = te::read_marker(&state.dir)
        .and_then(|m| from_marker(&m))
        .map_or_else(|| state.capture.settings(), |(_, s)| s);
    let list: Vec<(String, String, String)> = own
        .destinations
        .iter()
        .filter(|d| d.enabled && !d.url.trim().is_empty())
        .map(|d| (d.name.clone(), d.url.clone(), d.key.clone()))
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        list.iter().map(|(n, u, k)| te::reach(n, u, k)).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// The person chose (and confirmed) a short test to one of their own
/// destinations: only that one is streamed to (never the vertical ones).
#[tauri::command]
pub fn test_event_real_destination(
    id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (_, own) = te::read_marker(&state.dir)
        .and_then(|m| from_marker(&m))
        .ok_or("No test event is running")?;
    let d = own
        .destinations
        .into_iter()
        .find(|d| d.id == id)
        .ok_or("That destination was not found")?;
    let name = d.name.clone();
    let settings = state.capture.settings();
    state.capture.set_settings(CaptureSettings {
        destinations: vec![Destination {
            vertical: false,
            enabled: true,
            captions_url: String::new(),
            video_kbps: None,
            ..d
        }],
        ..settings
    });
    Ok(name)
}

// ----- output windows -----

/// How the output windows were set out.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Arranged {
    /// Extra displays connected (besides the main one).
    pub extra_displays: usize,
    /// Each window: its label and whether it is full screen on its own display.
    pub windows: Vec<(String, bool)>,
}

/// Where the n-th small test window goes on the main display (640×360, tiled
/// from the right edge so the control window's left side stays clear).
pub fn tile(n: usize, display: (i32, i32, u32, u32)) -> (i32, i32) {
    const TW: i32 = 640;
    const TH: i32 = 360;
    let (x, y, w, h) = display;
    let w = i32::try_from(w).unwrap_or(i32::MAX);
    let h = i32::try_from(h).unwrap_or(i32::MAX);
    let cols = (w / TW).max(1);
    let n = i32::try_from(n).unwrap_or(0);
    let (col, row) = (n % cols, n / cols);
    let px = x + w - (col + 1) * TW;
    let py = y + 40 + row * TH;
    (px.max(x), py.min((y + h - TH).max(y)))
}

/// Sets out the open output windows: those placed full screen on their own
/// display stay; the others become small windows tiled on the main display.
#[tauri::command]
pub fn test_event_arrange_outputs(app: tauri::AppHandle) -> Arranged {
    let displays = crate::outputs::displays(&app);
    let main = displays
        .iter()
        .find(|d| d.primary)
        .or_else(|| displays.first())
        .map_or((0, 0, 1920, 1080), |d| (d.x, d.y, d.width, d.height));
    let mut labels: Vec<String> = lumora_engine::ScreenId::ALL
        .iter()
        .map(|s| crate::outputs::label(*s))
        .collect();
    labels.push(crate::outputs::MULTIVIEW.to_owned());
    let mut windows = Vec::new();
    let mut n = 0;
    for label in labels {
        let Some(w) = app.get_webview_window(&label) else {
            continue;
        };
        let full = w.is_fullscreen().unwrap_or(false);
        if !full {
            let (x, y) = tile(n, main);
            n += 1;
            let _ = w.set_size(tauri::PhysicalSize::new(640, 360));
            let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
        }
        windows.push((label, full));
    }
    Arranged {
        extra_displays: displays.len().saturating_sub(1),
        windows,
    }
}

/// Puts an output window full screen (or back), to check full screen works.
#[tauri::command]
pub fn test_event_fullscreen(
    label: String,
    on: bool,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    if !label.starts_with("output-") {
        return Err("Not an output window".to_owned());
    }
    let w = app
        .get_webview_window(&label)
        .ok_or("That output is not open")?;
    w.set_fullscreen(on).map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(400));
    w.is_fullscreen().map_err(|e| e.to_string())
}

/// This computer, for the report.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
    pub cpu: String,
    pub cores: usize,
    pub mem_total_mb: u64,
    pub ffmpeg: bool,
}

#[tauri::command]
pub fn test_event_system(state: State<'_, AppState>) -> SystemInfo {
    use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};
    let sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing())
            .with_memory(MemoryRefreshKind::nothing().with_ram()),
    );
    SystemInfo {
        os: System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_owned()),
        arch: std::env::consts::ARCH.to_owned(),
        cpu: sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_owned())
            .unwrap_or_default(),
        cores: sys.cpus().len(),
        mem_total_mb: sys.total_memory() / 1024 / 1024,
        ffmpeg: state.ffmpeg.is_some(),
    }
}

fn reports_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?;
    Ok(docs.join("Lumora").join("Test reports"))
}

/// Saves the report (Markdown and JSON) in Documents/Lumora/Test reports.
#[tauri::command]
pub fn test_event_save_report(
    name: String,
    markdown: String,
    json: String,
    app: tauri::AppHandle,
) -> Result<Saved, String> {
    te::save_report(&reports_folder(&app)?, &name, &markdown, &json)
}

/// Opens a saved report, or shows it in its folder.
#[tauri::command]
pub fn test_event_open_report(
    path: String,
    reveal: bool,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let folder = reports_folder(&app)?;
    let p = PathBuf::from(&path);
    if p.parent() != Some(folder.as_path()) {
        return Err("Not a test report".to_owned());
    }
    let mut cmd = open_command(&p, reveal);
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open the report: {e}"))
}

#[cfg(windows)]
fn open_command(p: &Path, reveal: bool) -> std::process::Command {
    let mut c = std::process::Command::new("explorer");
    if reveal {
        c.arg(format!("/select,{}", p.display()));
    } else {
        c.arg(p);
    }
    c
}

#[cfg(target_os = "macos")]
fn open_command(p: &Path, reveal: bool) -> std::process::Command {
    let mut c = std::process::Command::new("open");
    if reveal {
        c.arg("-R");
    }
    c.arg(p);
    c
}

#[cfg(not(any(windows, target_os = "macos")))]
fn open_command(p: &Path, reveal: bool) -> std::process::Command {
    let mut c = std::process::Command::new("xdg-open");
    c.arg(if reveal { p.parent().unwrap_or(p) } else { p });
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_test_never_reaches_real_destinations() {
        let own = CaptureSettings {
            ndi: true,
            video_kbps: 9000,
            destinations: vec![
                Destination {
                    id: "yt".into(),
                    url: "rtmp://a.rtmp.youtube.com/live2".into(),
                    key: "secret".into(),
                    ..Destination::default()
                },
                Destination {
                    id: "tt".into(),
                    url: "rtmp://tiktok".into(),
                    key: "k2".into(),
                    vertical: true,
                    ..Destination::default()
                },
            ],
            ..CaptureSettings::default()
        };
        let t = test_settings(&own, Path::new("/rec/lumora-test-event-1"));
        assert_eq!(t.folder.as_deref(), Some("/rec/lumora-test-event-1"));
        assert!(!t.ndi);
        assert_eq!(t.video_kbps, 9000);
        assert_eq!(t.destinations.len(), 2);
        assert!(t
            .destinations
            .iter()
            .all(|d| d.url == LOCAL_SINK && d.key.is_empty()));
        assert!(t.destinations.iter().any(|d| d.vertical));
        let plain = test_settings(&CaptureSettings::default(), Path::new("x"));
        assert_eq!(plain.destinations.len(), 1);
        assert!(!plain.destinations[0].vertical);
    }

    #[test]
    fn the_test_show_keeps_this_computers_settings_and_the_marker_round_trips() {
        let mut own = Show::default();
        own.event.name = "Gala".into();
        own.settings.fade_to_black_ms = 4321;
        let t = test_show(&own);
        assert_eq!(t.event.name, "Lumora test event");
        assert!(t.event.set_up);
        assert_eq!(t.settings.fade_to_black_ms, 4321);
        let m = Marker {
            version: 1,
            started_at: 1,
            show: save_json(&own),
            capture: serde_json::to_value(CaptureSettings::default()).unwrap(),
            folder: None,
        };
        let (back, settings) = from_marker(&m).unwrap();
        assert_eq!(back, own);
        assert_eq!(settings, CaptureSettings::default());
        let broken = Marker {
            show: "nope".into(),
            ..m
        };
        assert!(from_marker(&broken).is_none());
    }

    #[test]
    fn small_windows_tile_on_the_main_display() {
        let d = (0, 0, 1920, 1080);
        assert_eq!(tile(0, d), (1280, 40));
        assert_eq!(tile(1, d), (640, 40));
        assert_eq!(tile(3, d), (1280, 400));
        // A small display: never off its left or bottom edge.
        let small = (100, 0, 600, 300);
        let (x, y) = tile(5, small);
        assert!(x >= 100 && y >= 0);
    }

    #[test]
    fn a_cut_short_test_is_put_back_at_start() {
        let dir = std::env::temp_dir().join(format!("lumora-te-start-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let folder = te::new_folder(&dir).unwrap();
        let mut own = Show::default();
        own.event.name = "Wedding".into();
        let own_settings = CaptureSettings {
            video_kbps: 7777,
            ..CaptureSettings::default()
        };
        te::write_marker(
            &dir,
            &Marker {
                version: 1,
                started_at: 1,
                show: save_json(&own),
                capture: serde_json::to_value(&own_settings).unwrap(),
                folder: Some(folder.to_string_lossy().into_owned()),
            },
        )
        .unwrap();
        let capture = crate::capture::Capture::new(None, dir.clone(), None, |_| {});
        capture.set_settings(test_settings(&own_settings, &folder));
        let mut show = test_show(&own);
        restore_at_start(&dir, &mut show, &capture);
        assert_eq!(show, own);
        assert_eq!(capture.settings(), own_settings);
        assert!(te::read_marker(&dir).is_none());
        assert!(!folder.exists());
        assert!(test_event_restored_at_start());
        let _ = std::fs::remove_dir_all(dir);
    }
}
