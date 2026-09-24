//! The Lumora desktop app: opens the windows and connects them to the engine.

mod store;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use lumora_engine::{Action, ActionError, Engine, Outcome, Show};
use serde::Serialize;
use tauri::{Emitter, Manager, State};

use store::Store;

/// Everything the app shares between windows.
struct AppState {
    engine: Mutex<Engine>,
    store: Store,
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
    let snapshot = {
        let mut engine = lock(&state);
        match engine.apply(action, now_ms())? {
            Outcome::Unchanged => return Ok(()),
            Outcome::Changed => Snapshot {
                revision: engine.revision(),
                show: engine.show().clone(),
            },
        }
    };
    state.store.save(snapshot.show.clone());
    // Every window gets the new show.
    let _ = app.emit("show-changed", snapshot);
    Ok(())
}

/// Start Lumora.
///
/// # Panics
/// If the operating system refuses to start the app (no display, no WebView).
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let (store, show, from) = Store::open(dir);
            eprintln!("lumora: show loaded ({from:?})");
            app.manage(AppState {
                engine: Mutex::new(Engine::with_show(show)),
                store,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_show, dispatch])
        .run(tauri::generate_context!())
        .expect("Lumora could not start");
}
