//! Lumora Edit: open an event recorded with Lumora and edit the whole event,
//! with every camera, then make the finished film.

mod export;
mod media;

use std::path::{Path, PathBuf};

use tauri::{Emitter, Manager, State};

struct AppState {
    ffmpeg: Option<PathBuf>,
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
        media::peaks(&ffmpeg, Path::new(&path), &cache)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn export_start(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    plan: export::Plan,
    out: String,
) -> Result<(), String> {
    let ffmpeg = state.ffmpeg()?;
    state
        .exports
        .start(ffmpeg, plan, PathBuf::from(out), move |p| {
            let _ = app.emit("export-progress", p);
        })
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
                .unwrap_or_else(|_| std::env::temp_dir())
                .join("waveforms");
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
            peaks,
            export_start,
            export_cancel,
            reveal,
        ])
        .run(tauri::generate_context!())
        .expect("Lumora Edit could not start");
}
