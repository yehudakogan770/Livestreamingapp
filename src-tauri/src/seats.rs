//! Operator seats in the app (see `crates/seats`): this computer as the show
//! computer (others join it; Settings → Operators…), or as a seat joined to
//! another computer's show (Settings → Join a show on this network…, which
//! opens the seat window).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use lumora_engine::Action;
use lumora_seats::client::{LinkEvents, LinkStatus, Pairing, SeatLink};
use lumora_seats::discovery::FoundShow;
use lumora_seats::role::{Role, SeatCommand};
use lumora_seats::server::{SeatBackend, SeatServer, SeatsStatus};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::AppState;

/// The seat window's label.
pub const WINDOW: &str = "seat";
const LINKS: &str = "seat-links.json";

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Both sides: others joining this show, and this computer joining another.
pub struct Seats {
    pub server: SeatServer,
    pub link: SeatLink,
    dir: PathBuf,
    /// The newest picture of each key, received from the show computer.
    pictures: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

impl Seats {
    pub fn new(app: &AppHandle, dir: &std::path::Path) -> Seats {
        let pictures = Arc::new(Mutex::new(HashMap::new()));
        Seats {
            server: SeatServer::new(Some(dir), ShowSide(app.clone())),
            link: SeatLink::new(JoinSide {
                app: app.clone(),
                dir: dir.to_path_buf(),
                pictures: Arc::clone(&pictures),
            }),
            dir: dir.to_path_buf(),
            pictures,
        }
    }

    /// The show changed (called with every new version; cheap with no seats).
    pub fn show_changed(&self, revision: u64, show: &lumora_engine::Show) {
        self.server.show_changed(revision, show);
    }
}

// ---------------------------------------------------------------------------
// This computer runs the show

struct ShowSide(AppHandle);

impl SeatBackend for ShowSide {
    fn snapshot(&self) -> Option<(u64, Value)> {
        let state = self.0.try_state::<AppState>()?;
        let engine = crate::lock(&state);
        Some((engine.revision(), serde_json::to_value(engine.show()).ok()?))
    }

    fn apply(&self, action: Action) -> Result<(), String> {
        let state = self
            .0
            .try_state::<AppState>()
            .ok_or_else(|| "Lumora is still starting".to_owned())?;
        crate::apply(&self.0, &state, action).map_err(|e| e.to_string())
    }

    fn event_name(&self) -> Option<String> {
        let state = self.0.try_state::<AppState>()?;
        let name = crate::lock(&state).show().event.name.clone();
        Some(name)
    }

    fn command(&self, command: SeatCommand) -> Result<(), String> {
        // The same requests as the phone remote's, run by the control window.
        let command: crate::remote::AppCommand =
            serde_json::from_value(serde_json::to_value(command).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        self.0
            .emit_to("control", "remote-command", command)
            .map_err(|e| e.to_string())
    }

    fn ptz(&self, source: &str, command: Value) -> Result<(), String> {
        let command: crate::ptz::PtzCommand = serde_json::from_value(command)
            .map_err(|_| "Lumora doesn’t know this camera move.".to_owned())?;
        let ptz = {
            let state = self
                .0
                .try_state::<AppState>()
                .ok_or_else(|| "Lumora is still starting".to_owned())?;
            let engine = crate::lock(&state);
            engine
                .show()
                .sources
                .iter()
                .find(|s| s.id.as_str() == source)
                .and_then(|s| s.ptz.clone())
                .ok_or_else(|| "This input has no PTZ control set up.".to_owned())?
        };
        crate::ptz::send(&ptz, command)
    }

    fn picture(&self, key: &str) -> Option<Vec<u8>> {
        // The Unified engine draws every screen and input itself.
        let live = self.0.try_state::<crate::live::Live>()?;
        let p = live.runner().and_then(|r| r.preview(key))?;
        let (w, h) = (u16::try_from(p.width).ok()?, u16::try_from(p.height).ok()?);
        let mut out = Vec::new();
        jpeg_encoder::Encoder::new(&mut out, 70)
            .encode(&p.rgba, w, h, jpeg_encoder::ColorType::Rgba)
            .ok()?;
        Some(out)
    }

    fn changed(&self) {
        if let Some(seats) = self.0.try_state::<Seats>() {
            let _ = self
                .0
                .emit_to("control", "seats-changed", seats.server.status());
        }
    }
}

#[tauri::command]
pub fn seats_status(seats: State<'_, Seats>) -> SeatsStatus {
    seats.server.status()
}

/// Let other computers join this show (or stop).
#[tauri::command]
pub fn seats_set_enabled(on: bool, seats: State<'_, Seats>) -> SeatsStatus {
    seats.server.set_enabled(on)
}

#[tauri::command]
pub fn seats_approve(
    pending: u64,
    role: Role,
    seats: State<'_, Seats>,
) -> Result<SeatsStatus, String> {
    seats.server.approve(pending, role)
}

#[tauri::command]
pub fn seats_deny(pending: u64, seats: State<'_, Seats>) -> SeatsStatus {
    seats.server.deny(pending)
}

#[tauri::command]
pub fn seats_set_role(
    seat: String,
    role: Role,
    seats: State<'_, Seats>,
) -> Result<SeatsStatus, String> {
    seats.server.set_role(&seat, role)
}

#[tauri::command]
pub fn seats_set_locked(
    seat: String,
    locked: bool,
    seats: State<'_, Seats>,
) -> Result<SeatsStatus, String> {
    seats.server.set_locked(&seat, locked)
}

/// Disconnect a seat; it has to pair again to come back.
#[tauri::command]
pub fn seats_remove(seat: String, seats: State<'_, Seats>) -> SeatsStatus {
    seats.server.remove(&seat)
}

/// What the seats are watching (the control window makes only those pictures).
#[tauri::command]
pub fn seats_watched(seats: State<'_, Seats>) -> Vec<String> {
    seats.server.watched()
}

/// A preview picture from the control window (JPEG in the body, `key` header).
#[tauri::command]
pub fn seats_picture(
    request: tauri::ipc::Request<'_>,
    seats: State<'_, Seats>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let key = request
        .headers()
        .get("key")
        .and_then(|v| v.to_str().ok())
        .ok_or("which picture?")?;
    seats.server.set_picture(key, bytes.clone());
    Ok(())
}

/// The mixer's levels, from the control window (for Audio seats).
#[tauri::command]
pub fn seats_meters(meters: Value, seats: State<'_, Seats>) {
    seats.server.set_meters(meters);
}

// ---------------------------------------------------------------------------
// This computer joins another computer's show

struct JoinSide {
    app: AppHandle,
    dir: PathBuf,
    pictures: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

fn load_links(dir: &std::path::Path) -> Vec<Pairing> {
    std::fs::read_to_string(dir.join(LINKS))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_links(dir: &std::path::Path, links: &[Pairing]) {
    if let Ok(text) = serde_json::to_string_pretty(links) {
        let _ = crate::store::write_file_atomic(&dir.join(LINKS), &text);
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PictureEvent<'a> {
    key: &'a str,
}

impl LinkEvents for JoinSide {
    fn status(&self, status: &LinkStatus) {
        let _ = self.app.emit("seat-status", status);
    }

    fn document(&self, doc: &Value) {
        let _ = self.app.emit_to(WINDOW, "seat-document", doc);
    }

    fn picture(&self, key: &str, jpeg: &[u8]) {
        lock(&self.pictures).insert(key.to_owned(), jpeg.to_vec());
        let _ = self
            .app
            .emit_to(WINDOW, "seat-picture", PictureEvent { key });
    }

    fn meters(&self, meters: &Value) {
        let _ = self.app.emit_to(WINDOW, "seat-meters", meters);
    }

    fn paired(&self, pairing: &Pairing) {
        let mut links = load_links(&self.dir);
        links.retain(|l| l.show_id != pairing.show_id);
        links.insert(0, pairing.clone());
        save_links(&self.dir, &links);
    }

    fn forget(&self, show_id: &str) {
        let mut links = load_links(&self.dir);
        links.retain(|l| l.show_id != show_id);
        save_links(&self.dir, &links);
    }
}

/// A show this computer joined before (no secret: that stays in Rust).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SavedShow {
    show_id: String,
    show: String,
    address: String,
    name: String,
}

fn open_window(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(WINDOW) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let w = WebviewWindowBuilder::new(app, WINDOW, WebviewUrl::default())
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Lumora — Seat")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .background_color(tauri::webview::Color(24, 24, 27, 255))
        .build()
        .map_err(|e| e.to_string())?;
    let _ = w.maximize();
    Ok(())
}

/// Shows on this network (mDNS and broadcast; about a second and a half).
#[tauri::command]
pub async fn seat_discover() -> Vec<FoundShow> {
    tauri::async_runtime::spawn_blocking(|| lumora_seats::discover(Duration::from_millis(1500)))
        .await
        .unwrap_or_default()
}

/// This computer's name (what the show operator sees).
#[tauri::command]
pub fn seat_computer_name() -> String {
    lumora_seats::computer_name()
}

/// Shows joined before (joining again needs no code).
#[tauri::command]
pub fn seat_saved(seats: State<'_, Seats>) -> Vec<SavedShow> {
    load_links(&seats.dir)
        .into_iter()
        .map(|p| SavedShow {
            show_id: p.show_id,
            show: p.show,
            address: p.address,
            name: p.name,
        })
        .collect()
}

/// Ask to join the show at `address`.
#[tauri::command]
pub fn seat_join(
    address: String,
    name: String,
    seats: State<'_, Seats>,
) -> Result<LinkStatus, String> {
    lumora_seats::discovery::parse_address(&address)?;
    let name = if name.trim().is_empty() {
        lumora_seats::computer_name()
    } else {
        name
    };
    seats.link.pair(&address, &name);
    Ok(seats.link.status())
}

/// Join a show again (no code) and open the seat window.
#[tauri::command]
pub fn seat_rejoin(
    show_id: String,
    app: AppHandle,
    seats: State<'_, Seats>,
) -> Result<LinkStatus, String> {
    let p = load_links(&seats.dir)
        .into_iter()
        .find(|p| p.show_id == show_id)
        .ok_or("This computer hasn’t joined that show before.")?;
    seats.link.resume(p);
    open_window(&app)?;
    Ok(seats.link.status())
}

#[tauri::command]
pub fn seat_forget(show_id: String, seats: State<'_, Seats>) -> Vec<SavedShow> {
    let mut links = load_links(&seats.dir);
    links.retain(|l| l.show_id != show_id);
    save_links(&seats.dir, &links);
    seat_saved(seats)
}

/// The code shown on the show computer.
#[tauri::command]
pub fn seat_code(code: String, seats: State<'_, Seats>) -> Result<LinkStatus, String> {
    seats.link.enter_code(&code)?;
    Ok(seats.link.status())
}

/// Open (or bring forward) the seat window.
#[tauri::command]
pub fn seat_open_window(app: AppHandle) -> Result<(), String> {
    open_window(&app)
}

/// Leave the show (nothing changes on the show computer's show).
#[tauri::command]
pub fn seat_leave(seats: State<'_, Seats>) {
    seats.link.leave();
    lock(&seats.pictures).clear();
}

#[tauri::command]
pub fn seat_status(seats: State<'_, Seats>) -> LinkStatus {
    seats.link.status()
}

#[tauri::command]
pub fn seat_document(seats: State<'_, Seats>) -> Option<Value> {
    seats.link.document()
}

/// Change the show on the show computer (it checks the seat's role).
#[tauri::command]
pub async fn seat_action(action: Value, app: AppHandle) -> Result<(), String> {
    let link = app.state::<Seats>().link.clone();
    tauri::async_runtime::spawn_blocking(move || link.action(action))
        .await
        .map_err(|e| e.to_string())?
}

/// Recording, streaming or replay on the show computer.
#[tauri::command]
pub async fn seat_command(command: Value, app: AppHandle) -> Result<(), String> {
    let link = app.state::<Seats>().link.clone();
    tauri::async_runtime::spawn_blocking(move || link.command(command))
        .await
        .map_err(|e| e.to_string())?
}

/// Move a PTZ camera, through the show computer.
#[tauri::command]
pub async fn seat_ptz(source: String, command: Value, app: AppHandle) -> Result<(), String> {
    let link = app.state::<Seats>().link.clone();
    tauri::async_runtime::spawn_blocking(move || link.ptz(&source, command))
        .await
        .map_err(|e| e.to_string())?
}

/// The pictures and levels this seat wants.
#[tauri::command]
pub fn seat_watch(keys: Vec<String>, seats: State<'_, Seats>) {
    seats.link.watch(keys);
}

/// The newest picture for a key (JPEG; empty when there is none yet).
#[tauri::command]
pub fn seat_picture(key: String, seats: State<'_, Seats>) -> tauri::ipc::Response {
    tauri::ipc::Response::new(lock(&seats.pictures).get(&key).cloned().unwrap_or_default())
}
