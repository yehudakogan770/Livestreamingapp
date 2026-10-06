//! The end-to-end self-test's commands (see `lumora_selftest`). Only the CI
//! test builds' screens call them, and each refuses unless `LUMORA_SELFTEST`
//! is set, so they do nothing in the program people download.

use lumora_selftest::{Config, Decoded, VideoFile};
use tauri::State;

use crate::AppState;

/// The self-test's settings (None: not a self-test run).
#[tauri::command]
pub fn selftest_config() -> Option<Config> {
    lumora_selftest::config()
}

/// Writes the results to the `LUMORA_SELFTEST` file, then closes the program.
#[tauri::command]
pub fn selftest_finish(app: tauri::AppHandle, results: String, code: i32) -> Result<(), String> {
    let written = lumora_selftest::write_results(&results);
    app.exit(if written.is_ok() { code } else { 2 });
    written.map(|_| ())
}

/// A new temporary folder (for the test recording).
#[tauri::command]
pub fn selftest_temp_folder(name: String) -> Result<String, String> {
    lumora_selftest::temp_folder(&name)
}

/// The video files in a folder.
#[tauri::command]
pub fn selftest_videos(folder: String) -> Result<Vec<VideoFile>, String> {
    lumora_selftest::videos(&folder)
}

/// Decodes a file with FFmpeg: its frames and length.
#[tauri::command]
pub async fn selftest_decode(state: State<'_, AppState>, file: String) -> Result<Decoded, String> {
    let ffmpeg = lumora_selftest::ffmpeg_for(state.ffmpeg.clone());
    tauri::async_runtime::spawn_blocking(move || lumora_selftest::decode(ffmpeg.as_deref(), &file))
        .await
        .map_err(|e| e.to_string())?
}
