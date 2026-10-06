//! The system check (Help → Check this computer…, and once after installing):
//! what this computer has, for the check's screen to judge (app/src/syscheck).
//! Studio adds what it already knows: the encoders that work, the hardware
//! decoder, and the graphics cards its native engine can use.

use std::sync::Arc;

use lumora_syscheck::{gather, Display, Facts, Native, NativeAdapter, Request};
use tauri::{Manager, State, WebviewWindow};

use crate::{encode, hwaccel, AppState};

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

fn native() -> Native {
    let adapters: Vec<NativeAdapter> = studio_engine::gpu::adapters()
        .into_iter()
        .map(|a| NativeAdapter {
            name: a.name,
            kind: a.kind.to_owned(),
            backend: a.backend,
        })
        .collect();
    let supported = adapters
        .iter()
        .any(|a| a.kind == "discrete" || a.kind == "integrated");
    Native {
        adapters,
        supported,
    }
}

/// Everything the check knows about this computer (a few seconds).
#[tauri::command]
pub async fn system_facts(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Facts, String> {
    let mut places = Vec::new();
    if let Ok(dir) = window.app_handle().path().video_dir() {
        places.push(("media".to_owned(), dir));
    }
    places.push(("cache".to_owned(), state.cache.clone()));
    let ffmpeg = state.ffmpeg.clone();
    let encoders = Arc::clone(&state.encoders);
    let screens = displays(&window);
    let mut facts = tauri::async_runtime::spawn_blocking(move || {
        let mut f = gather(&Request {
            places,
            ffmpeg: ffmpeg.clone(),
            test_encoders: false,
        });
        if let Some(ff) = ffmpeg.as_deref().filter(|_| f.ffmpeg.runs) {
            // The same checks Studio uses for exports and playback (remembered after the first time).
            f.hw_encoders = encoders
                .available(ff)
                .into_iter()
                .filter(|n| encode::is_hardware(n))
                .collect();
            f.hw_decode = hwaccel::global().method(ff);
        }
        f.native = Some(native());
        f
    })
    .await
    .map_err(|e| e.to_string())?;
    facts.displays = screens;
    Ok(facts)
}
