//! The phone and tablet remote: a small web server on the building's network.
//!
//! A phone opens the address (or scans the QR code), types the PIN, and gets
//! the main controls: Next / TAKE, presets, the countdown, stage messages and
//! PANIC. It changes the show through the same engine as the control window,
//! so every rule (and every safety net) is the same.
//!
//! - Off until switched on; the PIN is asked for on every request.
//! - Only show-running actions are accepted: a phone can never delete inputs,
//!   change the event or this computer's settings.
//! - Phones get each new version of the show the moment it changes
//!   (Server-Sent Events), plus the computer's clock so their countdown
//!   matches the screens to the second.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use lumora_engine::{Action, ActionError};
use serde::{Deserialize, Serialize};
use tiny_http::{Header, Method, Request, Response, Server};

use crate::store::write_file_atomic;

const FILE: &str = "remote.json";
/// The port tried first; the next few are tried if it is taken.
pub const DEFAULT_PORT: u16 = 8765;
const PORTS_TO_TRY: u16 = 10;
/// Largest action a phone may send.
const MAX_BODY: u64 = 256 * 1024;
/// How often phones are told the time (and dead connections noticed).
const PING: Duration = Duration::from_secs(10);

const PAGE: &str = include_str!("../remote/index.html");
const SCRIPT: &str = include_str!("../remote/remote.js");
const STYLE: &str = include_str!("../remote/remote.css");
/// Scene names for the stage visuals (the same file the screens use).
const VOTE_PAGE: &str = include_str!("../remote/vote.html");
const BANKS: &str = include_str!("../../app/src/visuals/banks.json");

/// What the remote needs from the app.
pub trait Backend: Send + Sync + 'static {
    /// The show as JSON: `{"revision":…,"show":…}`.
    fn snapshot(&self) -> Option<String>;
    fn apply(&self, action: Action) -> Result<(), ActionError>;
    /// The number of phones connected changed.
    fn phones_changed(&self);
}

/// Remembered between starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteConfig {
    pub enabled: bool,
    pub pin: String,
}

impl Default for RemoteConfig {
    fn default() -> Self {
        RemoteConfig {
            enabled: false,
            pin: new_pin(),
        }
    }
}

/// An address phones can open, with its QR code.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAddress {
    pub url: String,
    /// The QR code as an SVG picture.
    pub qr: String,
    /// The audience voting page, and its QR code.
    pub vote_url: String,
    pub vote_qr: String,
}

/// What the control window shows about the remote.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub enabled: bool,
    /// Listening right now.
    pub running: bool,
    pub pin: String,
    pub port: Option<u16>,
    pub addresses: Vec<RemoteAddress>,
    pub phones: usize,
    /// Why it could not start.
    pub error: Option<String>,
}

/// Can a phone do this? Only running the show: nothing that adds, removes
/// or rearranges, and nothing about this computer's settings.
pub fn allowed(action: &Action) -> bool {
    // Of the visuals settings, a phone may only black them out.
    if let Action::UpdateVisuals { patch } = action {
        return *patch
            == lumora_engine::visuals::VisualsPatch {
                blackout: patch.blackout,
                ..Default::default()
            };
    }
    matches!(
        action,
        Action::SetPreview { .. }
            | Action::Take { .. }
            | Action::CutTo { .. }
            | Action::SetBlank { .. }
            | Action::FadeToBlack { .. }
            | Action::PlayNow { .. }
            | Action::Panic { .. }
            | Action::MonitorFlash
            | Action::Play { .. }
            | Action::Pause { .. }
            | Action::Seek { .. }
            | Action::SetMasterMuted { .. }
            | Action::SetBackFollowsLive { .. }
            | Action::PickPreset { .. }
            | Action::NextPreset
            | Action::PreviousPreset
            | Action::RunSteps { .. }
            | Action::StopSteps
            | Action::UpdateMonitor { .. }
            | Action::SetCountdownLength { .. }
            | Action::StartCountdown { .. }
            | Action::PauseCountdown { .. }
            | Action::ResetCountdown { .. }
            | Action::AddCountdownTime { .. }
            | Action::SetCountdownRemaining { .. }
            | Action::CountdownTo { .. }
            | Action::SetOverlayOn { .. }
            | Action::NextCue
            | Action::PauseShow { .. }
            | Action::SlideNext { .. }
            | Action::SlidePrevious { .. }
            | Action::SlideGo { .. }
            | Action::PlaylistGo { .. }
            | Action::SetSpeed { .. }
            | Action::ShowComment { comment: None, .. }
            | Action::LyricsGo { .. }
            | Action::LyricsNext { .. }
            | Action::LyricsPrevious { .. }
            | Action::LyricsBlank { .. }
            | Action::Score { .. }
            | Action::ScoreReset { .. }
            | Action::ScoreClock { .. }
            | Action::ScoreClockSet { .. }
            | Action::CreditsPlay { .. }
            | Action::CreditsRestart { .. }
            | Action::CreditsSpeed { .. }
            | Action::OverlaysOff
            | Action::PesukimNext { .. }
            | Action::PesukimBack { .. }
            | Action::PesukimGo { .. }
            | Action::PesukimWhole { .. }
            | Action::PesukimBlank { .. }
            | Action::VisualsScene { .. }
            | Action::VisualsStep { .. }
            | Action::VisualsTempo { .. }
            | Action::VisualsSync
            | Action::VisualsFlash
            | Action::VisualsLook { store: false, .. }
    )
}

/// A new random 4-digit PIN.
pub fn new_pin() -> String {
    let n = RandomState::new().build_hasher().finish();
    format!("{:04}", n % 10_000)
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

struct Phone {
    id: u64,
    tx: Sender<String>,
}

struct Shared {
    backend: Box<dyn Backend>,
    pin: Mutex<String>,
    phones: Mutex<Vec<Phone>>,
    next_phone: Mutex<u64>,
    /// Each phone's vote in each poll round, so a phone votes once (and may change it).
    votes: Mutex<HashMap<(String, u32), HashMap<String, usize>>>,
}

impl Shared {
    fn phone_count(&self) -> usize {
        lock(&self.phones).len()
    }

    /// Send to every phone, forgetting the ones that have gone.
    fn send_all(&self, message: &str) {
        let before;
        let after;
        {
            let mut phones = lock(&self.phones);
            before = phones.len();
            phones.retain(|p| p.tx.send(message.to_owned()).is_ok());
            after = phones.len();
        }
        if before != after {
            self.backend.phones_changed();
        }
    }

    fn disconnect_all(&self) {
        let had = !lock(&self.phones).is_empty();
        lock(&self.phones).clear();
        if had {
            self.backend.phones_changed();
        }
    }
}

struct Running {
    server: Arc<Server>,
    port: u16,
}

/// The remote. Create one with [`Remote::new`]; it starts by itself if it
/// was on last time.
pub struct Remote {
    dir: Option<PathBuf>,
    config: Mutex<RemoteConfig>,
    shared: Arc<Shared>,
    running: Mutex<Option<Running>>,
    error: Mutex<Option<String>>,
    first_port: u16,
}

impl Remote {
    /// `dir`: where the settings are kept (`None`: not saved, for tests).
    pub fn new(dir: Option<&Path>, first_port: u16, backend: impl Backend) -> Remote {
        let config = dir
            .and_then(|d| std::fs::read_to_string(d.join(FILE)).ok())
            .and_then(|t| serde_json::from_str::<RemoteConfig>(&t).ok())
            .filter(|c| valid_pin(&c.pin))
            .unwrap_or_default();
        let remote = Remote {
            dir: dir.map(Path::to_path_buf),
            shared: Arc::new(Shared {
                backend: Box::new(backend),
                pin: Mutex::new(config.pin.clone()),
                phones: Mutex::new(Vec::new()),
                next_phone: Mutex::new(0),
                votes: Mutex::new(HashMap::new()),
            }),
            config: Mutex::new(config),
            running: Mutex::new(None),
            error: Mutex::new(None),
            first_port,
        };
        remote.save();
        if lock(&remote.config).enabled {
            remote.start();
        }
        remote
    }

    pub fn status(&self) -> RemoteStatus {
        let config = lock(&self.config).clone();
        let port = lock(&self.running).as_ref().map(|r| r.port);
        RemoteStatus {
            enabled: config.enabled,
            running: port.is_some(),
            pin: config.pin,
            port,
            addresses: port.map(addresses).unwrap_or_default(),
            phones: self.shared.phone_count(),
            error: lock(&self.error).clone(),
        }
    }

    /// Switch the remote on or off.
    pub fn set_enabled(&self, on: bool) -> RemoteStatus {
        lock(&self.config).enabled = on;
        self.save();
        if on {
            self.start();
        } else {
            self.stop();
            *lock(&self.error) = None;
        }
        self.status()
    }

    /// Choose a new PIN; connected phones have to type it again.
    pub fn change_pin(&self) -> RemoteStatus {
        let old = lock(&self.config).pin.clone();
        let pin = std::iter::repeat_with(new_pin)
            .find(|p| *p != old)
            .unwrap_or_default();
        lock(&self.config).pin.clone_from(&pin);
        *lock(&self.shared.pin) = pin;
        self.save();
        self.shared.disconnect_all();
        self.status()
    }

    /// Give every phone the new version of the show.
    pub fn broadcast(&self, snapshot: &str) {
        if lock(&self.running).is_none() {
            return;
        }
        self.shared.send_all(&show_event(snapshot));
    }

    fn save(&self) {
        let Some(dir) = &self.dir else { return };
        if let Ok(text) = serde_json::to_string_pretty(&*lock(&self.config)) {
            let _ = write_file_atomic(&dir.join(FILE), &text);
        }
    }

    fn start(&self) {
        let mut running = lock(&self.running);
        if running.is_some() {
            return;
        }
        let mut last_error = String::new();
        // Phones keep the address they were given, so wait a moment for the
        // usual port: Windows can take a little while to free it after the
        // remote was switched off. Only then try the next ones.
        let first = self.first_port;
        let tries = (0..15)
            .map(|_| first)
            .chain(first.saturating_add(1)..first.saturating_add(PORTS_TO_TRY));
        for (i, port) in tries.enumerate() {
            if i > 0 && port == first {
                std::thread::sleep(Duration::from_millis(100));
            }
            match Server::http(("0.0.0.0", port)) {
                Ok(server) => {
                    let server = Arc::new(server);
                    let port = server.server_addr().to_ip().map_or(port, |a| a.port());
                    serve(Arc::clone(&server), Arc::clone(&self.shared));
                    *running = Some(Running { server, port });
                    *lock(&self.error) = None;
                    eprintln!("lumora: remote listening on port {port}");
                    return;
                }
                Err(e) => last_error = e.to_string(),
            }
        }
        *lock(&self.error) = Some(format!(
            "The remote could not start (no free network port from {}): {last_error}",
            self.first_port
        ));
    }

    fn stop(&self) {
        let Some(Running { server, port }) = lock(&self.running).take() else {
            return;
        };
        self.shared.disconnect_all();
        server.unblock();
        drop(server);
        // Wake the server's listener so it notices it should close (on Windows
        // it cannot wake itself when listening on every address).
        let _ = TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_millis(300),
        );
    }
}

impl Drop for Remote {
    fn drop(&mut self) {
        self.stop();
    }
}

fn valid_pin(pin: &str) -> bool {
    pin.len() == 4 && pin.bytes().all(|b| b.is_ascii_digit())
}

/// Addresses on this computer's networks that phones can reach.
fn addresses(port: u16) -> Vec<RemoteAddress> {
    let mut ips: Vec<IpAddr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .map(|i| i.ip())
        .filter(|ip| match ip {
            IpAddr::V4(v4) => !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified(),
            IpAddr::V6(_) => false,
        })
        .collect();
    // Home and venue networks (192.168…, 10…) first.
    ips.sort_by_key(|ip| (!matches!(ip, IpAddr::V4(v4) if v4.is_private()), *ip));
    ips.dedup();
    ips.into_iter()
        .map(|ip| {
            let url = format!("http://{ip}:{port}");
            let vote_url = format!("{url}/vote");
            RemoteAddress {
                qr: qr_svg(&url),
                vote_qr: qr_svg(&vote_url),
                vote_url,
                url,
            }
        })
        .collect()
}

fn qr_svg(text: &str) -> String {
    qrcode::QrCode::new(text.as_bytes())
        .map(|code| {
            code.render::<qrcode::render::svg::Color>()
                .min_dimensions(220, 220)
                .quiet_zone(true)
                .build()
        })
        .unwrap_or_default()
}

/// Milliseconds since 1970, the clock the engine uses.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn show_event(snapshot: &str) -> String {
    format!(
        "event: show\ndata: {{\"now\":{},\"snapshot\":{snapshot}}}\n\n",
        now_ms()
    )
}

// ---------------------------------------------------------------------------
// The web server

fn serve(server: Arc<Server>, shared: Arc<Shared>) {
    let pinger = Arc::downgrade(&server);
    let pinger_shared = Arc::clone(&shared);
    std::thread::Builder::new()
        .name("lumora-remote-ping".into())
        .spawn(move || {
            // Stops once the server is gone.
            while pinger.upgrade().is_some() {
                std::thread::sleep(PING);
                pinger_shared.send_all(&format!("event: ping\ndata: {{\"now\":{}}}\n\n", now_ms()));
            }
        })
        .ok();
    std::thread::Builder::new()
        .name("lumora-remote".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                let shared = Arc::clone(&shared);
                // Each request on its own thread: a phone's live updates never end.
                let _ = std::thread::Builder::new()
                    .name("lumora-remote-request".into())
                    .spawn(move || handle(&shared, request));
            }
        })
        .ok();
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn respond(request: Request, status: u16, content_type: &str, body: &str) {
    let response = Response::from_string(body)
        .with_status_code(status)
        .with_header(header("Content-Type", content_type))
        .with_header(header("Cache-Control", "no-store"));
    let _ = request.respond(response);
}

fn json(request: Request, status: u16, body: &str) {
    respond(request, status, "application/json; charset=utf-8", body);
}

fn handle(shared: &Shared, mut request: Request) {
    let url = request.url().to_owned();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let method = request.method().clone();
    match (method, path) {
        (Method::Get, "/" | "/index.html") => {
            respond(request, 200, "text/html; charset=utf-8", PAGE)
        }
        (Method::Get, "/remote.js") => {
            respond(request, 200, "text/javascript; charset=utf-8", SCRIPT)
        }
        (Method::Get, "/remote.css") => respond(request, 200, "text/css; charset=utf-8", STYLE),
        (Method::Get, "/banks.json") => respond(request, 200, "application/json", BANKS),
        // The audience: no PIN, and they can only see open polls and vote.
        (Method::Get, "/vote") => respond(request, 200, "text/html; charset=utf-8", VOTE_PAGE),
        (Method::Get, "/api/polls") => {
            let polls = shared
                .backend
                .snapshot()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .map(|v| open_polls(&v["show"]))
                .unwrap_or_default();
            json(request, 200, &serde_json::Value::Array(polls).to_string());
        }
        (Method::Post, "/api/vote") => match vote(shared, &mut request) {
            Ok(()) => json(request, 200, "{}"),
            Err(status) => json(request, status, r#"{"code":"notTakingVotes"}"#),
        },
        (method, p) if p == "/api/tally" || p.starts_with("/api/do/") => {
            if !authorised(shared, &request, query) {
                std::thread::sleep(Duration::from_millis(500));
                return json(request, 401, r#"{"code":"wrongPin"}"#);
            }
            if !matches!(method, Method::Get | Method::Post) {
                return json(request, 405, r#"{"code":"wrongMethod"}"#);
            }
            let Some(show) = shared
                .backend
                .snapshot()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .map(|mut v| v["show"].take())
            else {
                return json(request, 503, r#"{"code":"starting"}"#);
            };
            if p == "/api/tally" {
                return json(request, 200, &crate::control::tally(&show).to_string());
            }
            let q = crate::control::parse_query(query);
            // PTZ goes straight to the camera, not through the show.
            if &p["/api/do/".len()..] == "ptz" {
                return match crate::control::ptz(&show, &q)
                    .and_then(|(cam, cmd)| crate::ptz::send(&cam, cmd))
                {
                    Ok(()) => json(request, 200, r#"{"ok":true}"#),
                    Err(e) => json(
                        request,
                        400,
                        &serde_json::json!({"ok": false, "error": e}).to_string(),
                    ),
                };
            }
            let result = crate::control::command(&show, &p["/api/do/".len()..], &q).and_then(|a| {
                if !allowed(&a) {
                    return Err("that is not allowed from outside".to_owned());
                }
                shared
                    .backend
                    .apply(a)
                    .map_err(|e| serde_json::to_string(&e).unwrap_or_default())
            });
            match result {
                Ok(()) => json(request, 200, r#"{"ok":true}"#),
                Err(e) => json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "error": e}).to_string(),
                ),
            }
        }
        (method, "/api/check" | "/api/show" | "/api/events" | "/api/action") => {
            if !authorised(shared, &request, query) {
                // Slow down anyone guessing.
                std::thread::sleep(Duration::from_millis(500));
                return json(request, 401, r#"{"code":"wrongPin"}"#);
            }
            match (method, path) {
                (Method::Post, "/api/check") => json(request, 200, "{}"),
                (Method::Get, "/api/show") => match shared.backend.snapshot() {
                    Some(s) => json(
                        request,
                        200,
                        &format!("{{\"now\":{},\"snapshot\":{s}}}", now_ms()),
                    ),
                    None => json(request, 503, r#"{"code":"starting"}"#),
                },
                (Method::Get, "/api/events") => stream(shared, request),
                (Method::Post, "/api/action") => match action(shared, &mut request) {
                    Ok(()) => json(request, 200, "{}"),
                    Err((status, body)) => json(request, status, &body),
                },
                _ => json(request, 405, r#"{"code":"wrongMethod"}"#),
            }
        }
        _ => respond(request, 404, "text/plain; charset=utf-8", "Not found"),
    }
}

/// The polls taking votes: only what a voter needs to see.
fn open_polls(show: &serde_json::Value) -> Vec<serde_json::Value> {
    show["sources"]
        .as_array()
        .map(|all| {
            all.iter()
                .filter(|s| s["kind"]["type"] == "poll" && s["kind"]["open"] == true)
                .map(|s| {
                    serde_json::json!({
                        "id": s["id"],
                        "round": s["kind"]["round"],
                        "question": s["kind"]["question"],
                        "options": s["kind"]["options"],
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Deserialize)]
struct Vote {
    id: String,
    round: u32,
    option: usize,
    voter: String,
}

fn vote(shared: &Shared, request: &mut Request) -> Result<(), u16> {
    let mut body = String::new();
    request
        .as_reader()
        .take(4096)
        .read_to_string(&mut body)
        .map_err(|_| 400u16)?;
    let v: Vote = serde_json::from_str(&body).map_err(|_| 400u16)?;
    if v.voter.is_empty() || v.voter.len() > 64 {
        return Err(400);
    }
    let mut votes = lock(&shared.votes);
    let round = votes.entry((v.id.clone(), v.round)).or_default();
    let previous = round.get(&v.voter).copied();
    if previous == Some(v.option) {
        return Ok(());
    }
    // Keep the memory small: a very big crowd still fits.
    if previous.is_none() && round.len() >= 100_000 {
        return Err(429);
    }
    let action = Action::PollVote {
        id: lumora_engine::model::SourceId::new(v.id),
        round: v.round,
        option: v.option,
        previous,
    };
    shared.backend.apply(action).map_err(|_| 409u16)?;
    round.insert(v.voter, v.option);
    Ok(())
}

fn authorised(shared: &Shared, request: &Request, query: &str) -> bool {
    let pin = lock(&shared.pin).clone();
    let given = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("X-Lumora-Pin"))
        .map(|h| h.value.as_str().to_owned())
        .or_else(|| {
            query
                .split('&')
                .find_map(|kv| kv.strip_prefix("pin="))
                .map(str::to_owned)
        });
    given.as_deref() == Some(pin.as_str())
}

fn action(shared: &Shared, request: &mut Request) -> Result<(), (u16, String)> {
    let mut body = String::new();
    request
        .as_reader()
        .take(MAX_BODY)
        .read_to_string(&mut body)
        .map_err(|_| (400, r#"{"code":"badRequest"}"#.to_owned()))?;
    let action: Action =
        serde_json::from_str(&body).map_err(|_| (400, r#"{"code":"badRequest"}"#.to_owned()))?;
    if !allowed(&action) {
        return Err((403, r#"{"code":"notFromRemote"}"#.to_owned()));
    }
    shared
        .backend
        .apply(action)
        .map_err(|e| (400, serde_json::to_string(&e).unwrap_or_default()))
}

/// Live updates for one phone, until it goes away.
fn stream(shared: &Shared, request: Request) {
    let Some(snapshot) = shared.backend.snapshot() else {
        return json(request, 503, r#"{"code":"starting"}"#);
    };
    let (tx, rx) = mpsc::channel::<String>();
    let mut out = request.into_writer();
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n";
    if out
        .write_all(head.as_bytes())
        .and_then(|()| out.write_all(show_event(&snapshot).as_bytes()))
        .and_then(|()| out.flush())
        .is_err()
    {
        return;
    }
    let id = {
        let mut next = lock(&shared.next_phone);
        *next += 1;
        *next
    };
    lock(&shared.phones).push(Phone { id, tx });
    shared.backend.phones_changed();
    while let Ok(message) = rx.recv() {
        if out
            .write_all(message.as_bytes())
            .and_then(|()| out.flush())
            .is_err()
        {
            break;
        }
    }
    let had = {
        let mut phones = lock(&shared.phones);
        let before = phones.len();
        phones.retain(|p| p.id != id);
        before != phones.len()
    };
    if had {
        shared.backend.phones_changed();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lumora_engine::{Engine, ScreenId};
    use std::io::{BufRead, BufReader};
    use std::sync::atomic::{AtomicU16, Ordering};

    struct Fake {
        engine: Mutex<Engine>,
    }

    impl Backend for Arc<Fake> {
        fn snapshot(&self) -> Option<String> {
            let e = lock(&self.engine);
            Some(format!(
                "{{\"revision\":{},\"show\":{}}}",
                e.revision(),
                serde_json::to_string(e.show()).unwrap()
            ))
        }
        fn apply(&self, action: Action) -> Result<(), ActionError> {
            lock(&self.engine).apply(action, now_ms()).map(|_| ())
        }
        fn phones_changed(&self) {}
    }

    // Each test gets its own ports.
    static PORT: AtomicU16 = AtomicU16::new(18_765);

    fn remote() -> (Remote, Arc<Fake>) {
        let fake = Arc::new(Fake {
            engine: Mutex::new(Engine::new()),
        });
        let first = PORT.fetch_add(PORTS_TO_TRY, Ordering::SeqCst);
        let r = Remote::new(None, first, Arc::clone(&fake));
        (r, fake)
    }

    fn request(port: u16, method: &str, path: &str, pin: &str, body: &str) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            s,
            "{method} {path} HTTP/1.1\r\nHost: x\r\nX-Lumora-Pin: {pin}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        let mut text = String::new();
        s.read_to_string(&mut text).unwrap();
        let status = text[9..12].parse().unwrap();
        let body = text
            .split_once("\r\n\r\n")
            .map(|(_, b)| b.to_owned())
            .unwrap_or_default();
        (status, body)
    }

    #[test]
    fn a_phone_may_black_out_the_visuals_but_not_change_their_settings() {
        use lumora_engine::visuals::VisualsPatch;
        let black = Action::UpdateVisuals {
            patch: VisualsPatch {
                blackout: Some(true),
                ..VisualsPatch::default()
            },
        };
        assert!(allowed(&black));
        let more = Action::UpdateVisuals {
            patch: VisualsPatch {
                blackout: Some(true),
                strobe: Some(true),
                ..VisualsPatch::default()
            },
        };
        assert!(!allowed(&more));
        assert!(allowed(&Action::VisualsLook {
            slot: 0,
            store: false
        }));
        assert!(!allowed(&Action::VisualsLook {
            slot: 0,
            store: true
        }));
    }

    #[test]
    fn the_audience_votes_once_each_without_the_pin() {
        let (r, fake) = remote();
        let st = r.set_enabled(true);
        let port = st.port.unwrap();
        let poll = lumora_engine::poll::Poll::default();
        {
            let mut e = lock(&fake.engine);
            e.apply(
                Action::AddSource {
                    source: serde_json::from_value(serde_json::json!({
                        "id": "p", "name": "Poll", "kind": {"type": "poll"}
                    }))
                    .unwrap(),
                },
                1,
            )
            .unwrap();
        }
        let body = |option: usize, voter: &str| {
            format!(
                r#"{{"id":"p","round":{},"option":{option},"voter":"{voter}"}}"#,
                poll.round + 1
            )
        };
        // Closed: nothing shown, votes refused.
        assert_eq!(request(port, "GET", "/api/polls", "", "").1, "[]");
        assert_eq!(request(port, "POST", "/api/vote", "", &body(0, "a")).0, 409);
        lock(&fake.engine)
            .apply(
                Action::PollOpen {
                    id: lumora_engine::model::SourceId::new("p"),
                    value: true,
                },
                2,
            )
            .unwrap();
        let (code, list) = request(port, "GET", "/api/polls", "", "");
        assert_eq!(code, 200);
        assert!(list.contains("What should we play next?") && !list.contains("votes"));
        assert_eq!(request(port, "POST", "/api/vote", "", &body(0, "a")).0, 200);
        assert_eq!(
            request(port, "POST", "/api/vote", "", &body(0, "a")).0,
            200,
            "same vote again: counted once"
        );
        assert_eq!(
            request(port, "POST", "/api/vote", "", &body(2, "a")).0,
            200,
            "changed their mind"
        );
        assert_eq!(request(port, "POST", "/api/vote", "", &body(2, "b")).0, 200);
        let votes = match &lock(&fake.engine).show().sources[0].kind {
            lumora_engine::SourceKind::Poll(p) => p.votes.clone(),
            _ => unreachable!(),
        };
        assert_eq!(votes, vec![0, 0, 2]);
        assert_eq!(request(port, "GET", "/vote", "", "").0, 200);
    }

    #[test]
    fn off_until_switched_on() {
        let (r, _) = remote();
        let st = r.status();
        assert!(!st.enabled && !st.running && st.port.is_none());
        assert!(valid_pin(&st.pin));
    }

    #[test]
    fn a_phone_with_the_pin_can_take_and_one_without_cannot() {
        let (r, fake) = remote();
        let st = r.set_enabled(true);
        let port = st.port.expect("listening");
        let add = r##"{"type":"addSource","source":{"id":"a","name":"A","kind":{"type":"color","color":"#ff0000"}}}"##;
        lock(&fake.engine)
            .apply(serde_json::from_str(add).unwrap(), 0)
            .unwrap();

        let preview = r#"{"type":"setPreview","screen":"live","sourceId":"a"}"#;
        assert_eq!(
            request(port, "POST", "/api/action", "0000x", preview).0,
            401
        );
        assert_eq!(
            request(port, "POST", "/api/action", &st.pin, preview).0,
            200
        );
        let (status, _) = request(
            port,
            "POST",
            "/api/action",
            &st.pin,
            r#"{"type":"take","screen":"live","transition":"cut"}"#,
        );
        assert_eq!(status, 200);
        assert_eq!(
            lock(&fake.engine)
                .show()
                .screens
                .get(ScreenId::Live)
                .program,
            Some(lumora_engine::SourceId::new("a"))
        );
    }

    #[test]
    fn a_phone_cannot_change_the_setup() {
        let (r, _) = remote();
        let st = r.set_enabled(true);
        let port = st.port.unwrap();
        let (status, body) = request(
            port,
            "POST",
            "/api/action",
            &st.pin,
            r#"{"type":"removeSource","id":"a"}"#,
        );
        assert_eq!(status, 403);
        assert!(body.contains("notFromRemote"));
        let (status, body) = request(
            port,
            "POST",
            "/api/action",
            &st.pin,
            r#"{"type":"take","screen":"live"}"#,
        );
        assert_eq!(status, 400, "engine refusals come back: {body}");
        assert!(body.contains("nothingInPreview"));
    }

    #[test]
    fn serves_the_page_and_the_show() {
        let (r, _) = remote();
        let st = r.set_enabled(true);
        let port = st.port.unwrap();
        let (status, page) = request(port, "GET", "/", "", "");
        assert_eq!(status, 200);
        assert!(page.contains("remote.js"));
        let (status, body) = request(port, "GET", "/api/show", &st.pin, "");
        assert_eq!(status, 200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert!(v["now"].as_u64().unwrap() > 0);
        assert!(v["snapshot"]["show"]["screens"].is_object());
    }

    #[test]
    fn phones_get_changes_live_and_a_new_pin_disconnects_them() {
        let (r, _) = remote();
        let st = r.set_enabled(true);
        let port = st.port.unwrap();
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            s,
            "GET /api/events?pin={} HTTP/1.1\r\nHost: x\r\n\r\n",
            st.pin
        )
        .unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut lines = BufReader::new(s).lines();
        let mut next_event = || loop {
            let l = lines.next().unwrap().unwrap();
            if let Some(d) = l.strip_prefix("data: ") {
                return d.to_owned();
            }
        };
        assert!(next_event().contains("\"snapshot\""));
        // Wait for the phone to be counted.
        for _ in 0..50 {
            if r.status().phones == 1 {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(r.status().phones, 1);
        r.broadcast(r#"{"revision":7,"show":{}}"#);
        assert!(next_event().contains("\"revision\":7"));
        let changed = r.change_pin();
        assert_eq!(changed.phones, 0);
        assert_ne!(changed.pin, st.pin);
    }

    #[test]
    fn switching_off_frees_the_port() {
        let (r, _) = remote();
        let port = r.set_enabled(true).port.unwrap();
        r.set_enabled(false);
        std::thread::sleep(Duration::from_millis(100));
        let again = r.set_enabled(true);
        assert_eq!(again.port, Some(port));
    }
}
