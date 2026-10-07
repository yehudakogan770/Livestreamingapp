//! The commands behind delivery and media management: encoders that work
//! here, encoding frames the editor draws, finding shots, collecting files,
//! and the recovery folder (autosaves and backups).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{Emitter, Manager, State};

use crate::{finishing, is_work_file, manage, AppState};

/// The encoders that work on this computer (hardware ones are tried for real, once).
#[tauri::command]
pub async fn encoders_available(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let ffmpeg = state.ffmpeg()?;
    let enc = Arc::clone(&state.encoders);
    tauri::async_runtime::spawn_blocking(move || enc.available(&ffmpeg))
        .await
        .map_err(|e| e.to_string())
}

/// Start an encoder that reads raw frames (it writes into the film's work folder, or the film itself).
#[tauri::command]
pub fn encode_open(
    state: State<'_, AppState>,
    args: Vec<String>,
    tmp: String,
    out: String,
    frame_bytes: usize,
) -> Result<u32, String> {
    let ffmpeg = state.ffmpeg()?;
    let tmp = PathBuf::from(tmp);
    if !is_work_file(&tmp) {
        return Err("That is not a work folder.".into());
    }
    state
        .encoders
        .open(&ffmpeg, &args, &tmp, Path::new(&out), frame_bytes)
}

/// One frame's pixels (raw bytes; the encoder's number is in a header).
#[tauri::command]
pub async fn encode_frame(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Nothing to encode.".into());
    };
    let id: u32 = request
        .headers()
        .get("x-encoder")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("No encoder given.")?;
    let bytes = bytes.clone();
    let enc = Arc::clone(&state.encoders);
    tauri::async_runtime::spawn_blocking(move || enc.frame(id, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

/// No more frames: wait until the file is finished.
#[tauri::command]
pub async fn encode_close(state: State<'_, AppState>, id: u32) -> Result<(), String> {
    let enc = Arc::clone(&state.encoders);
    tauri::async_runtime::spawn_blocking(move || enc.close(id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn encode_abort(state: State<'_, AppState>, id: u32) {
    state.encoders.abort(id);
}

/// Where the picture changes in a file (seconds).
#[tauri::command]
pub async fn scene_cuts(
    state: State<'_, AppState>,
    path: String,
    threshold: f64,
) -> Result<Vec<f64>, String> {
    let ffmpeg = state.ffmpeg()?;
    tauri::async_runtime::spawn_blocking(move || {
        manage::scene_cuts(&ffmpeg, Path::new(&path), threshold)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// How loud a finished file is (integrated loudness, true peak, loudness range).
#[tauri::command]
pub async fn measure_loudness(
    state: State<'_, AppState>,
    path: String,
) -> Result<finishing::Loudness, String> {
    let ffmpeg = state.ffmpeg()?;
    tauri::async_runtime::spawn_blocking(move || {
        finishing::measure_loudness(&ffmpeg, Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Make the numbered image sequence a picture belongs to into one video (next to the pictures).
#[tauri::command]
pub async fn image_sequence(
    state: State<'_, AppState>,
    path: String,
    fps: f64,
) -> Result<String, String> {
    let ffmpeg = state.ffmpeg()?;
    tauri::async_runtime::spawn_blocking(move || {
        finishing::make_sequence_video(&ffmpeg, Path::new(&path), fps)
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Save one frame of a finished film as a JPEG thumbnail (`width` wide).
#[tauri::command]
pub async fn thumbnail(
    state: State<'_, AppState>,
    film: String,
    seconds: f64,
    width: u32,
    out: String,
) -> Result<(), String> {
    let ffmpeg = state.ffmpeg()?;
    tauri::async_runtime::spawn_blocking(move || {
        finishing::make_thumbnail(&ffmpeg, Path::new(&film), seconds, width, Path::new(&out))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copy (or trim) a project's files into one folder; says how far along it is. Returns what went wrong.
#[tauri::command]
pub async fn collect_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    jobs: Vec<manage::CollectJob>,
) -> Result<Vec<String>, String> {
    let ffmpeg = state.ffmpeg.clone();
    tauri::async_runtime::spawn_blocking(move || {
        manage::collect(ffmpeg.as_deref(), &jobs, &|p| {
            let _ = app.emit("collect-progress", p);
        })
    })
    .await
    .map_err(|e| e.to_string())
}

fn recovery_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recovery");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not make the recovery folder: {e}"))?;
    Ok(dir)
}

/// Save into the recovery folder (through a new file first).
#[tauri::command]
pub fn recovery_write(app: tauri::AppHandle, name: String, text: String) -> Result<(), String> {
    let path = manage::place(&recovery_dir(&app)?, &name)?;
    let temp = path.with_extension("saving");
    std::fs::write(&temp, text).map_err(|e| format!("Could not autosave: {e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("Could not autosave: {e}"))
}

#[tauri::command]
pub fn recovery_read(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let path = manage::place(&recovery_dir(&app)?, &name)?;
    std::fs::read_to_string(path).map_err(|e| format!("Could not read the autosave: {e}"))
}

#[tauri::command]
pub fn recovery_list(app: tauri::AppHandle) -> Result<Vec<manage::Entry>, String> {
    Ok(manage::list(&recovery_dir(&app)?))
}

#[tauri::command]
pub fn recovery_remove(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let path = manage::place(&recovery_dir(&app)?, &name)?;
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
