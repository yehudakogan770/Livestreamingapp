//! The system check (Help → Check this computer…, and once after installing):
//! what this computer has, for the check's screen to judge (app/src/syscheck).

use lumora_syscheck::{gather, Display, Facts, Request};
use tauri::{Manager, State, WebviewWindow};

use crate::AppState;

/// The screens plugged in (Lumora needs a second one for the Live Screen).
fn displays(window: &WebviewWindow) -> Vec<Display> {
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| *m.position());
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| Display {
            width: m.size().width,
            height: m.size().height,
            scale: m.scale_factor(),
            primary: primary == Some(*m.position()),
        })
        .collect()
}

/// Everything the check knows about this computer (a few seconds: run it off the main thread).
#[tauri::command]
pub async fn system_facts(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Facts, String> {
    let mut places = vec![("recordings".to_owned(), state.capture.folder())];
    if let Ok(dir) = window.app_handle().path().app_data_dir() {
        places.push(("app data".to_owned(), dir));
    }
    let req = Request {
        places,
        ffmpeg: state.ffmpeg.clone(),
        test_encoders: true,
    };
    let screens = displays(&window);
    let mut facts = tauri::async_runtime::spawn_blocking(move || gather(&req))
        .await
        .map_err(|e| e.to_string())?;
    facts.displays = screens;
    Ok(facts)
}
