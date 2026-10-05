//! Lumora Edit: open an event recorded with Lumora and edit the whole event,
//! with every camera, then make the finished film.

mod export;
mod library;
mod media;

use std::path::{Path, PathBuf};

use tauri::{Emitter, Manager, State};

struct AppState {
    ffmpeg: Option<PathBuf>,
    /// Waveforms, picture strips and playable copies.
    cache: PathBuf,
    exports: export::Exports,
}

const NO_FFMPEG: &str =
    "FFmpeg was not found. It comes with Lumora Edit: install Lumora Edit again from the website.";

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

/// The event file Lumora Edit was opened with (double-clicking a `.lumora` file).
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

/// Show a file in its folder.
#[tauri::command]
fn reveal(path: String) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn();
    }
    #[cfg(not(windows))]
    {
        if let Some(dir) = Path::new(&path).parent() {
            let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
        }
    }
}

/// # Panics
/// The window can't be made.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
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
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            ffmpeg_found,
            initial_file,
            read_text,
            write_text,
            file_exists,
            prepare_media,
            import_media,
            strip,
            peaks,
            export_folder,
            write_chunk,
            export_start,
            export_cancel,
            export_abandon,
            find_by_name,
            send_to_lumora,
            reveal,
        ])
        .run(tauri::generate_context!())
        .expect("Lumora Edit could not start");
}
