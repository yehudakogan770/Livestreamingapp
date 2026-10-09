//! Lumora Studio: open an event recorded with Lumora and edit the whole event,
//! with every camera, then make the finished film.

mod delivery;
mod encode;
mod export;
mod finishing;
mod formats;
mod frames;
mod hwaccel;
mod library;
mod manage;
mod mattes;
mod media;
mod native_view;
mod rendercache;
mod selftest;
mod speech;
mod syscheck;
mod vimeo;
mod voiceover;
mod youtube;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{Emitter, Manager, State};

struct AppState {
    ffmpeg: Option<PathBuf>,
    /// Waveforms, picture strips and playable copies.
    cache: PathBuf,
    exports: export::Exports,
    /// Originals read by FFmpeg for making the film.
    frames: frames::Readers,
    /// Delivery encoders fed with the editor's frames.
    encoders: Arc<encode::Encoders>,
}

const NO_FFMPEG: &str =
    "FFmpeg was not found. It comes with Lumora Studio: install Lumora Studio again from the website.";

impl AppState {
    fn ffmpeg(&self) -> Result<PathBuf, String> {
        self.ffmpeg.clone().ok_or_else(|| NO_FFMPEG.to_owned())
    }
}

/// The sign-in screen calls this when it shows (the window is already open).
#[tauri::command]
fn app_ready() {}

#[tauri::command]
fn ffmpeg_found(state: State<'_, AppState>) -> bool {
    state.ffmpeg.is_some()
}

/// The event file Lumora Studio was opened with (double-clicking a `.lumora` file).
#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args().skip(1).find(|a| {
        let lower = a.to_ascii_lowercase();
        lower.ends_with(".lumora") || lower.ends_with(".lumoraedit")
    })
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Could not open {path}: {e}"))
}

/// Saved through a new file first, so a crash never leaves half a project.
#[tauri::command]
fn write_text(path: String, text: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let temp = path.with_extension("saving");
    std::fs::write(&temp, text).map_err(|e| format!("Could not save: {e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("Could not save: {e}"))
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
async fn prepare_media(
    state: State<'_, AppState>,
    path: String,
) -> Result<media::Prepared, String> {
    let ffmpeg = state.ffmpeg()?;
    tauri::async_runtime::spawn_blocking(move || media::prepare(&ffmpeg, Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn peaks(state: State<'_, AppState>, path: String) -> Result<tauri::ipc::Response, String> {
    let ffmpeg = state.ffmpeg()?;
    let cache = state.cache.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        media::peaks(&ffmpeg, Path::new(&path), &cache.join("waveforms"))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Any file, ready to edit (a playable copy is made when needed, with progress).
#[tauri::command]
async fn import_media(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<media::Prepared, String> {
    let ffmpeg = state.ffmpeg()?;
    let cache = state.cache.join("optimized");
    tauri::async_runtime::spawn_blocking(move || {
        let p = path.clone();
        media::import(&ffmpeg, Path::new(&path), &cache, &move |done| {
            let _ = app.emit("import-progress", (p.clone(), done));
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What a file is and whether a copy will be made (quick: nothing is made).
#[tauri::command]
async fn probe_media(state: State<'_, AppState>, path: String) -> Result<media::Prepared, String> {
    let ffmpeg = state.ffmpeg()?;
    tauri::async_runtime::spawn_blocking(move || media::look(&ffmpeg, Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

/// A lighter copy of a heavy file for smooth playback (progress as `proxy-progress`: [path, 0–1]).
/// Several are made side by side, each with `threads` of FFmpeg's; the graphics
/// card's encoder is used when one works (`hardware`, on by default).
#[tauri::command]
async fn make_proxy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
    threads: Option<u32>,
    hardware: Option<bool>,
) -> Result<String, String> {
    let ffmpeg = state.ffmpeg()?;
    let cache = state.cache.join("proxies");
    let enc = Arc::clone(&state.encoders);
    tauri::async_runtime::spawn_blocking(move || {
        let p = path.clone();
        let encoder = if hardware.unwrap_or(true) {
            rendercache::hardware_h264(&enc.available(&ffmpeg))
        } else {
            None
        };
        let how = formats::CopyEncoding {
            encoder,
            threads: threads.map(|t| t.clamp(1, 64)),
            decode: Vec::new(),
        };
        media::playback_proxy_with(
            &ffmpeg,
            Path::new(&path),
            &cache,
            &move |done| {
                let _ = app.emit("proxy-progress", (p.clone(), done));
            },
            &how,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Start reading an original's frames through FFmpeg (RGBA, `width`×`height`, `rate` a second from `from` seconds).
#[tauri::command]
async fn frames_open(
    state: State<'_, AppState>,
    path: String,
    from: f64,
    rate: f64,
    width: u32,
    height: u32,
) -> Result<u32, String> {
    let ffmpeg = state.ffmpeg()?;
    state
        .frames
        .open(&ffmpeg, Path::new(&path), from, rate, width, height)
}

/// The next frame of a reader (empty at the end).
#[tauri::command]
async fn frames_next(state: State<'_, AppState>, id: u32) -> Result<tauri::ipc::Response, String> {
    state.frames.next(id).map(tauri::ipc::Response::new)
}

#[tauri::command]
fn frames_close(state: State<'_, AppState>, id: u32) {
    state.frames.close(id);
}

#[tauri::command]
async fn strip(
    state: State<'_, AppState>,
    path: String,
    seconds: f64,
) -> Result<media::Strip, String> {
    let ffmpeg = state.ffmpeg()?;
    let cache = state.cache.join("strips");
    tauri::async_runtime::spawn_blocking(move || {
        media::strip(&ffmpeg, Path::new(&path), seconds, &cache)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A speech model for transcribing, downloaded the first time (progress as
/// `speech-progress`: [name, 0–1]). Lumora's own copy is used when it has one.
#[tauri::command]
async fn speech_model(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let ours = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let lumora = ours.parent().map(|d| d.join("app.lumora.desktop"));
    tauri::async_runtime::spawn_blocking(move || {
        let n = name.clone();
        speech::model(&ours, lumora.as_deref(), &name, &move |done| {
            let _ = app.emit("speech-progress", (n.clone(), done));
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|p| p.to_string_lossy().into_owned())
}

/// A stretch of a file's sound for the speech model (16 kHz mono floats).
#[tauri::command]
async fn speech_audio(
    state: State<'_, AppState>,
    path: String,
    from: f64,
    seconds: f64,
) -> Result<tauri::ipc::Response, String> {
    let ffmpeg = state.ffmpeg()?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        speech::audio(&ffmpeg, Path::new(&path), from, seconds)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// AI mask results kept for a media file (empty when there are none yet).
#[tauri::command]
async fn matte_read(
    state: State<'_, AppState>,
    media: String,
    kind: String,
) -> Result<tauri::ipc::Response, String> {
    let cache = state.cache.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || mattes::read(&cache, &media, &kind))
        .await
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Keep AI mask results (raw bytes; the media file and kind are in the headers).
#[tauri::command]
fn matte_write(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Nothing to write.".into());
    };
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(decode)
    };
    let media = header("x-media").ok_or("No file given.")?;
    let kind = header("x-kind").ok_or("No kind given.")?;
    mattes::write(&state.cache, &media, &kind, bytes)
}

/// A work folder for making a film, next to where it will be saved.
#[tauri::command]
fn export_folder(out: String) -> Result<String, String> {
    export::work_folder(Path::new(&out)).map(|p| p.to_string_lossy().into_owned())
}

fn is_work_file(path: &Path) -> bool {
    path.ancestors().any(|a| {
        a.file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with(".lumora-edit-"))
    })
}

/// A piece of the film's picture (raw bytes; the file and place are in the headers).
#[tauri::command]
fn write_chunk(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Nothing to write.".into());
    };
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let path = header("x-path").ok_or("No file given.")?;
    let path = PathBuf::from(decode(&path));
    if !is_work_file(&path) {
        return Err("Only the film's work folder can be written.".into());
    }
    let position: u64 = header("x-position")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    export::write_at(&path, position, bytes)
}

/// `%xx` escapes (the path travels in a header).
fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
fn export_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    plan: export::Plan,
    out: String,
    tmp: String,
) -> Result<(), String> {
    let ffmpeg = state.ffmpeg()?;
    let tmp = PathBuf::from(tmp);
    if !is_work_file(&tmp) {
        return Err("That is not a work folder.".into());
    }
    state
        .exports
        .start(ffmpeg, plan, PathBuf::from(out), tmp, move |p| {
            let _ = app.emit("export-progress", p);
        })
}

/// Throw away a film's work folder (it was stopped before the end).
#[tauri::command]
fn export_abandon(tmp: String) {
    let tmp = PathBuf::from(tmp);
    if is_work_file(&tmp) {
        let _ = std::fs::remove_dir_all(tmp);
    }
}

/// Put a finished video in Lumora's library, ready to add to any event and show live.
#[tauri::command]
fn send_to_lumora(
    app: tauri::AppHandle,
    path: String,
    name: String,
    seconds: f64,
) -> Result<(), String> {
    // Lumora keeps its library in its own data folder, next to this program's.
    let ours = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = ours
        .parent()
        .map(|d| d.join("app.lumora.desktop"))
        .ok_or("Lumora's folder was not found.")?;
    library::add_video(&dir, &path, &name, seconds)
}

/// Look for a moved file by its name in a folder (and the folders inside it).
#[tauri::command]
async fn find_by_name(folder: String, name: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut stack = vec![(PathBuf::from(folder), 0)];
        while let Some((dir, depth)) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    if depth < 4 {
                        stack.push((p, depth + 1));
                    }
                } else if p.file_name().and_then(|n| n.to_str()) == Some(name.as_str()) {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
        }
        None
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
fn export_cancel(state: State<'_, AppState>) {
    state.exports.cancel();
}

/// A path that is safe to hand to the file manager: a whole, plain path to
/// something that is there (a project from a teammate could hold any text
/// where a media file's path goes; quotes or options must never reach the
/// command line, where they could open or run something else).
fn revealable(path: &str) -> Option<PathBuf> {
    let p = Path::new(path);
    let plain = !path.is_empty()
        && p.is_absolute()
        && !path.starts_with('-')
        && !path.chars().any(|c| c == '"' || c.is_control());
    (plain && p.exists()).then(|| p.to_path_buf())
}

/// The Lumora website. When it moves to its own domain, change this one line
/// (and `SITE_URL` in app/src/site.ts and the other app's lib.rs).
pub(crate) const SITE_URL: &str = "https://lumoraproduction.com/";

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

/// Show a file in its folder.
#[tauri::command]
fn reveal(path: String) {
    let Some(path) = revealable(&path) else {
        return;
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn();
    }
    #[cfg(not(windows))]
    {
        if let Some(dir) = path.parent() {
            let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
        }
    }
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

/// # Panics
/// The window can't be made.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // A crash leaves a note for an (opt-in) error report next time.
            if let Ok(dir) = app.path().app_data_dir() {
                lumora_crash::install(dir, app.package_info().version.to_string());
            }
            let cache = app
                .path()
                .app_cache_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            let ffmpeg = media::find_ffmpeg();
            eprintln!("lumora-edit: ffmpeg {ffmpeg:?}");
            app.manage(AppState {
                ffmpeg,
                cache,
                exports: export::Exports::default(),
                frames: frames::Readers::default(),
                encoders: Arc::default(),
            });
            app.manage(native_view::NativeView::default());
            // Publishing to YouTube (the Google registration may be in the app's data folder).
            let data = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            app.manage(youtube::Publish::new(&data));
            // Lumora Titler: its window, the shared title library and films through FFmpeg.
            app.manage(titler_host::Renders::default());
            // The CI self-test: close (with a failed result) if it never finishes.
            let quit = app.handle().clone();
            lumora_selftest::watchdog(move || quit.exit(1));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            titler_host::cmd::titler_library_dir,
            titler_host::cmd::titler_library_list,
            titler_host::cmd::titler_read,
            titler_host::cmd::titler_write,
            titler_host::cmd::titler_remove,
            titler_host::cmd::titler_data_url,
            titler_host::cmd::titler_autosave,
            titler_host::cmd::titler_recover,
            titler_host::cmd::titler_open_window,
            titler_host::cmd::titler_render_start,
            titler_host::cmd::titler_render_frame,
            titler_host::cmd::titler_render_finish,
            titler_host::cmd::titler_render_cancel,
            open_site_page,
            syscheck::system_facts,
            selftest::selftest_config,
            selftest::selftest_finish,
            selftest::selftest_temp_folder,
            selftest::selftest_videos,
            selftest::selftest_decode,
            take_crash_reports,
            ffmpeg_found,
            initial_file,
            read_text,
            write_text,
            file_exists,
            prepare_media,
            import_media,
            probe_media,
            make_proxy,
            frames_open,
            frames_next,
            frames_close,
            strip,
            peaks,
            speech_model,
            speech_audio,
            export_folder,
            write_chunk,
            matte_read,
            matte_write,
            export_start,
            export_cancel,
            export_abandon,
            find_by_name,
            send_to_lumora,
            reveal,
            youtube::youtube_info,
            youtube::youtube_connect,
            youtube::youtube_cancel,
            youtube::youtube_disconnect,
            youtube::youtube_upload,
            youtube::youtube_stop,
            youtube::youtube_watch,
            voiceover::voiceover_save,
            vimeo::vimeo_info,
            vimeo::vimeo_connect,
            vimeo::vimeo_disconnect,
            vimeo::vimeo_upload,
            vimeo::vimeo_open,
            delivery::encoders_available,
            delivery::encode_open,
            delivery::encode_frame,
            delivery::encode_close,
            delivery::encode_abort,
            delivery::scene_cuts,
            delivery::measure_loudness,
            delivery::image_sequence,
            delivery::thumbnail,
            delivery::collect_files,
            delivery::recovery_write,
            delivery::recovery_read,
            delivery::recovery_list,
            delivery::recovery_remove,
            native_view::native_view_start,
            native_view::native_view_stop,
            native_view::native_view_frame,
            native_view::native_view_play,
            native_view::native_view_sync,
            native_view::native_view_place,
            native_view::native_view_reset,
            native_view::native_view_pixels,
            rendercache::rcache_folder,
            rendercache::rcache_list,
            rendercache::rcache_open,
            rendercache::rcache_finish,
            rendercache::rcache_abort,
            rendercache::rcache_trim,
            rendercache::rcache_clear,
            rendercache::hwaccel_status,
            rendercache::hwaccel_set,
        ])
        .run(tauri::generate_context!())
        .expect("Lumora Studio could not start");
}

#[cfg(test)]
mod tests {
    use super::revealable;

    #[test]
    fn only_plain_paths_that_exist_are_shown_in_their_folder() {
        let dir = std::env::temp_dir().join(format!("lumora-reveal-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clip.mp4");
        std::fs::write(&file, b"x").unwrap();
        let f = file.to_string_lossy().into_owned();
        assert_eq!(revealable(&f), Some(file.clone()));
        // Quotes (to break out of the command line), relative or missing paths, options: never.
        assert_eq!(
            revealable(&format!("{f}\" C:\\Windows\\System32\\calc.exe")),
            None
        );
        assert_eq!(revealable("clip.mp4"), None);
        assert_eq!(revealable(&format!("{f}.missing")), None);
        assert_eq!(revealable("-e"), None);
        assert_eq!(revealable(""), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
