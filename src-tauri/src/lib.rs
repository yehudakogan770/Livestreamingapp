//! The Lumora desktop app: opens the windows and connects them to the engine.

mod outputs;
mod store;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use lumora_engine::{Action, ActionError, Engine, Outcome, ScreenId, Show};
use serde::Serialize;
use tauri::{Emitter, Manager, State, WindowEvent};

use outputs::Display;

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
    let moved_display = match &action {
        Action::SetDisplay { screen, .. } => Some(*screen),
        _ => None,
    };
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
    // A new display choice takes effect straight away if that output is open.
    if let Some(screen) = moved_display {
        if let Some(w) = app.get_webview_window(&outputs::label(screen)) {
            let _ = outputs::place(&app, &w, &snapshot.show, screen);
        }
    }
    let _ = app.emit("show-changed", snapshot);
    Ok(())
}

/// Displays connected to this computer, for choosing where each output goes.
#[tauri::command]
fn list_displays(app: tauri::AppHandle) -> Vec<Display> {
    outputs::displays(&app)
}

/// Screens whose output window is open.
#[tauri::command]
fn open_outputs(app: tauri::AppHandle) -> Vec<ScreenId> {
    outputs::open_screens(&app)
}

#[tauri::command]
fn open_output(
    screen: ScreenId,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let show = lock(&state).show().clone();
    outputs::open(&app, &show, screen).map_err(|e| e.to_string())
}

#[tauri::command]
fn close_output(screen: ScreenId, app: tauri::AppHandle) -> Result<(), String> {
    outputs::close(&app, screen).map_err(|e| e.to_string())
}

/// Start Lumora.
///
/// # Panics
/// If the operating system refuses to start the app (no display, no WebView).
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if window.label() == "control" {
                    // Closing the control window ends the show: close the outputs too.
                    app.exit(0);
                } else {
                    outputs::notify(app);
                }
            }
        })
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let (store, show, from) = Store::open(dir);
            eprintln!("lumora: show loaded ({from:?})");
            app.manage(AppState {
                engine: Mutex::new(Engine::with_show(show)),
                store,
            });
            if std::env::var_os("LUMORA_SMOKE_TEST").is_some() {
                smoke_test(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_show,
            dispatch,
            list_displays,
            open_outputs,
            open_output,
            close_output
        ])
        .run(tauri::generate_context!())
        .expect("Lumora could not start");
}

/// `LUMORA_SMOKE_TEST=1`: open all three outputs, check they exist, report and
/// quit (exit code 0 when everything opened). Used to check a build starts.
fn smoke_test(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let show = lock(&handle.state::<AppState>()).show().clone();
            for screen in ScreenId::ALL {
                if let Err(e) = outputs::open(&handle, &show, screen) {
                    eprintln!("lumora smoke test: {screen:?} output failed: {e}");
                }
            }
        });
        std::thread::sleep(std::time::Duration::from_secs(3));
        let open = outputs::open_screens(&app);
        eprintln!("lumora smoke test: displays {:?}", outputs::displays(&app));
        eprintln!("lumora smoke test: outputs open {open:?}");
        app.exit(i32::from(open.len() != ScreenId::ALL.len()));
    });
}
