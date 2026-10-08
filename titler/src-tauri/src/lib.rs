//! Lumora Titler, the desktop app: the designer (the same web app as
//! docs/titler, built into dist-titler) with real files, the title library
//! shared with Lumora and Lumora Studio (Documents/Lumora/Titles), and films
//! rendered through FFmpeg (ProRes 4444 with alpha and the rest).

use tauri::Manager;

/// The `.lumtitle` file Lumora Titler was opened with (double-clicking one).
#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args().skip(1).find(|a| {
        std::path::Path::new(a)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case(titler_host::EXT))
    })
}

/// Is FFmpeg here (ProRes and the other films)?
#[tauri::command]
fn ffmpeg_found() -> bool {
    titler_host::find_ffmpeg().is_some()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
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
            app.manage(titler_host::Renders::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initial_file,
            ffmpeg_found,
            titler_host::titler_library_dir,
            titler_host::titler_library_list,
            titler_host::titler_read,
            titler_host::titler_write,
            titler_host::titler_remove,
            titler_host::titler_data_url,
            titler_host::titler_autosave,
            titler_host::titler_recover,
            titler_host::titler_render_start,
            titler_host::titler_render_frame,
            titler_host::titler_render_finish,
            titler_host::titler_render_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumora Titler");
}
