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
//! - Control surfaces (the Stream Deck plugin) can also start and stop the
//!   recording, the stream, rehearsal and instant replay. Those run in the
//!   control window, so the request is passed on to it; the control window
//!   then tells everyone connected what is running (`event: app`).

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, SyncSender};
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
/// Updates waiting for one phone; a phone this far behind has stopped
/// reading (asleep, out of range) and is let go, so memory never piles up.
const PHONE_QUEUE: usize = 32;

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
    /// Pass a recording / stream / replay request on to the control window.
    fn app_command(&self, command: AppCommand) -> Result<(), String> {
        let _ = command;
        Err("not available".to_owned())
    }
}

/// What a control surface may ask of the control window: recording,
/// streaming, rehearsal and instant replay. Kept apart from the engine's
/// actions because these run in the control window, not in the show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "camelCase", deny_unknown_fields)]
pub enum AppCommand {
    /// Start (`on`) or stop the recording.
    Record { on: bool },
    /// Go live (`on`) or end the stream.
    Stream { on: bool },
    /// Choose rehearsal (only before going live).
    Rehearsal { on: bool },
    /// Keep the last minute ready to replay (or stop keeping it).
    ReplayBuffer { on: bool },
    /// Replay the last few seconds into Next.
    Replay {
        seconds: u32,
        #[serde(default)]
        slow: bool,
    },
}

impl AppCommand {
    /// The longest replay: the buffer keeps one minute.
    pub const MAX_REPLAY_S: u32 = 60;

    fn valid(&self) -> bool {
        match self {
            AppCommand::Replay { seconds, .. } => (1..=Self::MAX_REPLAY_S).contains(seconds),
            _ => true,
        }
    }
}

/// Remembered between starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteConfig {
    pub enabled: bool,
    pub pin: String,
    /// The audience page is also on the internet.
    pub internet: bool,
}

impl Default for RemoteConfig {
    fn default() -> Self {
        RemoteConfig {
            enabled: false,
            pin: new_pin(),
            internet: false,
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
    /// The audience page on the internet.
    pub internet: InternetStatus,
}

/// The audience page's internet address (for phones on any network).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InternetStatus {
    /// Switched on (it may still be connecting).
    pub on: bool,
    pub phase: crate::tunnel::Phase,
    /// The audience page's address and its QR code, once connected.
    pub vote_url: Option<String>,
    pub vote_qr: Option<String>,
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
            | Action::QnaShow { .. }
            | Action::RaffleDraw { .. }
            | Action::WallPin { .. }
            | Action::ScriptureStep { .. }
            | Action::DataStep { .. }
            | Action::PrompterRun { .. }
            | Action::PrompterJump { .. }
            | Action::PrompterSpeed { .. }
            | Action::DataRow { .. }
            | Action::TriviaAsk { .. }
            | Action::TriviaReveal { .. }
            | Action::TriviaBoard { .. }
            | Action::ScriptureGo { .. }
            | Action::ScriptureBlank { .. }
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
    tx: SyncSender<String>,
}

struct Shared {
    backend: Box<dyn Backend>,
    pin: Mutex<String>,
    phones: Mutex<Vec<Phone>>,
    next_phone: Mutex<u64>,
    /// Each phone's vote in each poll round, so a phone votes once (and may change it).
    votes: Mutex<HashMap<(String, u32), HashMap<String, usize>>>,
    /// When each phone last asked a question.
    asked: Mutex<HashMap<String, u64>>,
    /// Where photos sent to a messages wall are kept.
    photos: Option<PathBuf>,
    /// What the control window says is running (recording, stream…), as JSON.
    app_state: Mutex<String>,
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
            phones.retain(|p| p.tx.try_send(message.to_owned()).is_ok());
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
    /// The audience-only server the internet link leads to.
    public: Mutex<Option<Running>>,
    tunnel: Arc<crate::tunnel::Tunnel>,
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
                asked: Mutex::new(HashMap::new()),
                photos: dir.map(|d| d.join("wall-photos")),
                app_state: Mutex::new("{}".to_owned()),
            }),
            config: Mutex::new(config),
            running: Mutex::new(None),
            error: Mutex::new(None),
            first_port,
            public: Mutex::new(None),
            tunnel: Arc::default(),
        };
        remote.save();
        if lock(&remote.config).enabled {
            remote.start();
        }
        if lock(&remote.config).internet {
            remote.set_internet(true);
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
            internet: self.internet(config.internet),
        }
    }

    fn internet(&self, on: bool) -> InternetStatus {
        let t = self.tunnel.state();
        let vote_url = t.url.map(|u| format!("{u}/vote"));
        InternetStatus {
            on,
            phase: t.phase,
            vote_qr: vote_url.as_deref().map(qr_svg),
            vote_url,
            error: t.error,
        }
    }

    /// Put the audience page on the internet (or take it off).
    pub fn set_internet(&self, on: bool) -> RemoteStatus {
        lock(&self.config).internet = on;
        self.save();
        if on {
            let mut public = lock(&self.public);
            if public.is_none() {
                // Only this computer can reach it; the tunnel takes it to the internet.
                match Server::http(("127.0.0.1", 0)) {
                    Ok(server) => {
                        let server = Arc::new(server);
                        let port = server.server_addr().to_ip().map_or(0, |a| a.port());
                        serve_as(Arc::clone(&server), Arc::clone(&self.shared), true);
                        *public = Some(Running { server, port });
                    }
                    Err(e) => {
                        *lock(&self.error) =
                            Some(format!("The internet link could not start: {e}"));
                        return self.status();
                    }
                }
            }
            let port = public.as_ref().map_or(0, |r| r.port);
            drop(public);
            let shared = Arc::clone(&self.shared);
            self.tunnel.start(
                self.dir.clone(),
                port,
                Arc::new(move || shared.backend.phones_changed()),
            );
        } else {
            self.tunnel.stop();
            if let Some(Running { server, .. }) = lock(&self.public).take() {
                server.unblock();
            }
        }
        self.status()
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

    /// What the control window says is running (recording, stream,
    /// rehearsal, replay). Everyone connected is told when it changes.
    pub fn set_app_state(&self, state: &serde_json::Value) {
        if !state.is_object() {
            return;
        }
        let text = state.to_string();
        {
            let mut current = lock(&self.shared.app_state);
            if *current == text {
                return;
            }
            current.clone_from(&text);
        }
        if lock(&self.running).is_some() {
            self.shared.send_all(&app_event(&text));
        }
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
        self.tunnel.stop();
        if let Some(Running { server, .. }) = lock(&self.public).take() {
            server.unblock();
        }
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

pub fn qr_svg(text: &str) -> String {
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

fn app_event(state: &str) -> String {
    format!("event: app\ndata: {state}\n\n")
}

// ---------------------------------------------------------------------------
// The web server

fn serve(server: Arc<Server>, shared: Arc<Shared>) {
    serve_as(server, shared, false);
}

/// `public`: the internet link's server, which answers only the audience page.
fn serve_as(server: Arc<Server>, shared: Arc<Shared>, public: bool) {
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
                    .spawn(move || {
                        let path = request.url().split('?').next().unwrap_or_default();
                        if public && path == "/" {
                            respond(request, 200, "text/html; charset=utf-8", VOTE_PAGE);
                        } else if public && !audience_path(path) {
                            respond(request, 404, "text/plain; charset=utf-8", "Not found");
                        } else {
                            handle(&shared, request);
                        }
                    });
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

/// What the audience may open (all the internet link answers).
fn audience_path(path: &str) -> bool {
    matches!(
        path,
        "/vote"
            | "/api/bid"
            | "/api/answer"
            | "/api/seat"
            | "/api/polls"
            | "/api/audience"
            | "/api/vote"
            | "/api/ask"
            | "/api/raffle"
            | "/api/pledge"
            | "/api/message"
    )
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
        (Method::Get, "/api/audience") => {
            // Everything the audience page shows: open polls, and whether questions are taken.
            let show = shared
                .backend
                .snapshot()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .map(|mut v| v["show"].take())
                .unwrap_or_default();
            let open = |kind: &str, fields: &[&str]| -> Vec<serde_json::Value> {
                show["sources"]
                    .as_array()
                    .map(|all| {
                        all.iter()
                            .filter(|s| s["kind"]["type"] == kind && s["kind"]["open"] == true)
                            .map(|s| {
                                let mut o = serde_json::json!({ "id": s["id"] });
                                for f in fields {
                                    o[*f] = s["kind"][*f].clone();
                                }
                                o
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            };
            let body = serde_json::json!({
                "polls": open_polls(&show),
                "questions": show["qna"]["open"].as_bool().unwrap_or(false),
                "raffles": open("raffle", &["title", "prize"]),
                "fundraisers": open("fundraiser", &["title", "currency"]),
                "walls": open("wall", &["title", "prompt", "photos"]),
                "auctions": open_auctions(&show),
                "trivia": open_trivia(&show, &crate::control::parse_query(query)),
                "seating": open("seating", &["title"]),
                "now": now_ms(),
                "event": show["event"]["name"],
            });
            json(request, 200, &body.to_string());
        }
        (Method::Post, "/api/raffle") => match join_raffle(shared, &mut request) {
            Ok(()) => json(request, 200, "{}"),
            Err(status) => json(request, status, r#"{"code":"notTakingNames"}"#),
        },
        (Method::Post, "/api/pledge") => match pledge(shared, &mut request) {
            Ok(()) => json(request, 200, "{}"),
            Err(status) => json(request, status, r#"{"code":"notTakingPledges"}"#),
        },
        (Method::Post, "/api/message") => match post_message(shared, &mut request, query) {
            Ok(()) => json(request, 200, "{}"),
            Err(status) => json(request, status, r#"{"code":"notTakingMessages"}"#),
        },
        (Method::Get, "/api/seat") => {
            // Only the names that match what was typed: the whole list is never sent.
            let q = crate::control::parse_query(query);
            let get = |k: &str| {
                q.iter()
                    .find(|(key, _)| key == k)
                    .map(|(_, v)| v.as_str())
                    .unwrap_or_default()
            };
            let (id, name) = (get("id"), get("name"));
            let found = shared
                .backend
                .snapshot()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| {
                    v["show"]["sources"]
                        .as_array()?
                        .iter()
                        .find(|s| s["id"] == id && s["kind"]["type"] == "seating")
                        .cloned()
                })
                .and_then(|s| {
                    serde_json::from_value::<lumora_engine::seating::Seating>(s["kind"].clone())
                        .ok()
                })
                .filter(|s| s.open)
                .map(|s| serde_json::to_string(&s.find(name, 8)).unwrap_or_default());
            match found {
                Some(list) => json(request, 200, &list),
                None => json(request, 404, r#"{"code":"notOpen"}"#),
            }
        }
        (Method::Post, "/api/answer") => match answer(shared, &mut request) {
            Ok(()) => json(request, 200, "{}"),
            Err(status) => json(request, status, r#"{"code":"notTakingAnswers"}"#),
        },
        (Method::Post, "/api/bid") => match bid(shared, &mut request) {
            Ok(()) => json(request, 200, "{}"),
            Err((status, why)) => json(
                request,
                status,
                &serde_json::json!({ "code": "notTakingBids", "reason": why }).to_string(),
            ),
        },
        (Method::Post, "/api/ask") => match ask(shared, &mut request) {
            Ok(()) => json(request, 200, "{}"),
            Err(status) => json(request, status, r#"{"code":"notTakingQuestions"}"#),
        },
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
        (method, "/api/check" | "/api/show" | "/api/events" | "/api/action" | "/api/app") => {
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
                (Method::Get, "/api/app") => {
                    let state = lock(&shared.app_state).clone();
                    json(request, 200, &state);
                }
                // Passed on: the control window's answer comes as `event: app`.
                (Method::Post, "/api/app") => match app_command(shared, &mut request) {
                    Ok(()) => json(request, 202, "{}"),
                    Err((status, body)) => json(request, status, &body),
                },
                _ => json(request, 405, r#"{"code":"wrongMethod"}"#),
            }
        }
        _ => respond(request, 404, "text/plain; charset=utf-8", "Not found"),
    }
}

#[derive(Deserialize)]
struct Join {
    id: String,
    name: String,
    voter: String,
}

/// Enter a raffle: once per phone per raffle.
fn join_raffle(shared: &Shared, request: &mut Request) -> Result<(), u16> {
    let mut body = String::new();
    request
        .as_reader()
        .take(4096)
        .read_to_string(&mut body)
        .map_err(|_| 400u16)?;
    let j: Join = serde_json::from_str(&body).map_err(|_| 400u16)?;
    if j.voter.is_empty() || j.voter.len() > 64 || j.name.trim().is_empty() {
        return Err(400);
    }
    let key = format!("raffle:{}:{}", j.id, j.voter);
    if lock(&shared.asked).contains_key(&key) {
        // Already in: that is fine.
        return Ok(());
    }
    shared
        .backend
        .apply(Action::RaffleJoin {
            id: lumora_engine::model::SourceId::new(j.id),
            name: j.name,
        })
        .map_err(|_| 409u16)?;
    lock(&shared.asked).insert(key, now_ms());
    Ok(())
}

#[derive(Deserialize)]
struct PledgeIn {
    id: String,
    name: String,
    amount: u64,
    message: String,
    voter: String,
}

/// A pledge from a phone: one every 10 seconds from each phone.
fn pledge(shared: &Shared, request: &mut Request) -> Result<(), u16> {
    let mut body = String::new();
    request
        .as_reader()
        .take(4096)
        .read_to_string(&mut body)
        .map_err(|_| 400u16)?;
    let p: PledgeIn = serde_json::from_str(&body).map_err(|_| 400u16)?;
    if p.voter.is_empty() || p.voter.len() > 64 || p.amount == 0 {
        return Err(400);
    }
    let key = format!("pledge:{}", p.voter);
    let now = now_ms();
    if lock(&shared.asked)
        .get(&key)
        .is_some_and(|&t| now.saturating_sub(t) < 10_000)
    {
        return Err(429);
    }
    shared
        .backend
        .apply(Action::Pledge {
            id: lumora_engine::model::SourceId::new(p.id),
            name: p.name,
            amount: p.amount,
            message: p.message,
        })
        .map_err(|_| 409u16)?;
    lock(&shared.asked).insert(key, now);
    Ok(())
}

/// Biggest photo from a phone (the page makes them smaller first).
const MAX_PHOTO: usize = 6_000_000;

/// A message for a wall: the words in the address, a JPEG photo (if any) as
/// the body. One every 20 seconds from each phone.
fn post_message(shared: &Shared, request: &mut Request, query: &str) -> Result<(), u16> {
    let q = crate::control::parse_query(query);
    let get = |k: &str| {
        q.iter()
            .find(|(key, _)| key == k)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    let (id, voter, name, text) = (get("id"), get("voter"), get("name"), get("text"));
    if voter.is_empty() || voter.len() > 64 || id.is_empty() {
        return Err(400);
    }
    let key = format!("wall:{voter}");
    let now = now_ms();
    if lock(&shared.asked)
        .get(&key)
        .is_some_and(|&t| now.saturating_sub(t) < 20_000)
    {
        return Err(429);
    }
    let mut body = Vec::new();
    request
        .as_reader()
        .take(MAX_PHOTO as u64 + 1)
        .read_to_end(&mut body)
        .map_err(|_| 400u16)?;
    if body.len() > MAX_PHOTO {
        return Err(413);
    }
    let photo = if body.is_empty() {
        None
    } else {
        // Only JPEG pictures are kept.
        if !body.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return Err(415);
        }
        let dir = shared.photos.as_ref().ok_or(503u16)?;
        std::fs::create_dir_all(dir).map_err(|_| 507u16)?;
        let file = dir.join(format!("{now}-{:04}.jpg", new_pin()));
        std::fs::write(&file, &body).map_err(|_| 507u16)?;
        Some(file.to_string_lossy().into_owned())
    };
    if text.trim().is_empty() && photo.is_none() {
        return Err(400);
    }
    let saved = photo.clone();
    let result = shared.backend.apply(Action::WallPost {
        id: lumora_engine::model::SourceId::new(id),
        name,
        text,
        photo,
    });
    if result.is_err() {
        if let Some(f) = saved {
            let _ = std::fs::remove_file(f);
        }
        return Err(409);
    }
    lock(&shared.asked).insert(key, now);
    Ok(())
}

/// Auctions taking bids, with only what a bidder needs: the item being sold,
/// its highest bid and the least the next may be.
fn open_auctions(show: &serde_json::Value) -> Vec<serde_json::Value> {
    let Some(all) = show["sources"].as_array() else {
        return Vec::new();
    };
    all.iter()
        .filter(|s| s["kind"]["type"] == "auction" && s["kind"]["open"] == true)
        .filter_map(|s| {
            let k: lumora_engine::auction::Auction =
                serde_json::from_value(s["kind"].clone()).ok()?;
            let it = k.items.get(k.current)?;
            let top = it.top();
            Some(serde_json::json!({
                "id": s["id"],
                "title": k.title,
                "currency": k.currency,
                "item": {
                    "id": it.id,
                    "name": it.name,
                    "detail": it.detail,
                    "top": top.map(|b| b.amount),
                    "topName": top.map(|b| b.name.clone()),
                    "min": it.minimum(),
                    "step": it.step,
                    "sold": it.sold,
                    "endsAt": k.ends_at,
                },
            }))
        })
        .collect()
}

#[derive(Deserialize)]
struct BidIn {
    id: String,
    item: u32,
    name: String,
    amount: u64,
    voter: String,
}

/// A bid from a phone: one every 3 seconds from each phone.
fn bid(shared: &Shared, request: &mut Request) -> Result<(), (u16, String)> {
    let bad = |why: &str| (400u16, why.to_owned());
    let mut body = String::new();
    request
        .as_reader()
        .take(4096)
        .read_to_string(&mut body)
        .map_err(|_| bad("unreadable"))?;
    let b: BidIn = serde_json::from_str(&body).map_err(|_| bad("unreadable"))?;
    if b.voter.is_empty() || b.voter.len() > 64 || b.name.trim().is_empty() {
        return Err(bad("please type your name"));
    }
    let key = format!("bid:{}", b.voter);
    let now = now_ms();
    if lock(&shared.asked)
        .get(&key)
        .is_some_and(|&t| now.saturating_sub(t) < 3000)
    {
        return Err((429, "please wait a moment".to_owned()));
    }
    shared
        .backend
        .apply(Action::AuctionBid {
            id: lumora_engine::model::SourceId::new(b.id),
            item: b.item,
            name: b.name,
            amount: b.amount,
        })
        .map_err(|e| match e {
            ActionError::InvalidValue { reason, .. } => (409, reason),
            _ => (409, "bidding is closed".to_owned()),
        })?;
    lock(&shared.asked).insert(key, now);
    Ok(())
}

/// Trivia games: the question and answers, the right one once it is shown,
/// and (for the phone asking, `voter`) its score, place and answer.
fn open_trivia(show: &serde_json::Value, q: &[(String, String)]) -> Vec<serde_json::Value> {
    use lumora_engine::trivia::{Trivia, TriviaPhase};
    let voter = q
        .iter()
        .find(|(k, _)| k == "voter")
        .map(|(_, v)| v.as_str())
        .unwrap_or_default();
    let now = now_ms();
    let Some(all) = show["sources"].as_array() else {
        return Vec::new();
    };
    all.iter()
        .filter(|s| s["kind"]["type"] == "trivia")
        .filter_map(|s| {
            let t: Trivia = serde_json::from_value(s["kind"].clone()).ok()?;
            let q = t.questions.get(t.current);
            let shown = matches!(t.phase, TriviaPhase::Reveal | TriviaPhase::Leaderboard);
            let mut ranked: Vec<&lumora_engine::trivia::Player> = t.players.iter().collect();
            ranked.sort_by_key(|p| std::cmp::Reverse(p.score));
            let place = ranked.iter().position(|p| p.key == voter);
            let mine = t.answers.iter().find(|a| a.key == voter);
            let asking = t.phase != TriviaPhase::Join;
            Some(serde_json::json!({
                "id": s["id"],
                "title": t.title,
                "phase": t.phase,
                "question": t.current,
                "text": q.filter(|_| asking).map(|q| q.text.clone()),
                "options": q.filter(|_| asking).map(|q| q.options.clone()),
                "taking": t.taking(now),
                "endsAt": q.map(|q| t.asked_at + u64::from(q.seconds) * 1000),
                "correct": if shown { q.map(|q| q.correct) } else { None },
                "players": t.players.len(),
                "score": place.map(|i| ranked[i].score),
                "place": place.map(|i| i + 1),
                "answered": mine.map(|a| a.option),
                "points": if shown { mine.map(|a| t.points(a)) } else { None },
            }))
        })
        .collect()
}

#[derive(Deserialize)]
struct AnswerIn {
    id: String,
    question: usize,
    option: usize,
    name: String,
    voter: String,
}

/// An answer from a phone (the first one for each question counts).
fn answer(shared: &Shared, request: &mut Request) -> Result<(), u16> {
    let mut body = String::new();
    request
        .as_reader()
        .take(4096)
        .read_to_string(&mut body)
        .map_err(|_| 400u16)?;
    let a: AnswerIn = serde_json::from_str(&body).map_err(|_| 400u16)?;
    if a.voter.is_empty() || a.voter.len() > 64 {
        return Err(400);
    }
    shared
        .backend
        .apply(Action::TriviaAnswer {
            id: lumora_engine::model::SourceId::new(a.id),
            key: a.voter,
            name: a.name,
            question: a.question,
            option: a.option,
        })
        .map_err(|_| 409u16)
}

#[derive(Deserialize)]
struct Ask {
    author: String,
    text: String,
    voter: String,
}

fn ask(shared: &Shared, request: &mut Request) -> Result<(), u16> {
    let mut body = String::new();
    request
        .as_reader()
        .take(4096)
        .read_to_string(&mut body)
        .map_err(|_| 400u16)?;
    let a: Ask = serde_json::from_str(&body).map_err(|_| 400u16)?;
    if a.voter.is_empty() || a.voter.len() > 64 || a.text.trim().is_empty() {
        return Err(400);
    }
    // One question every 15 seconds from each phone.
    let now = now_ms();
    if lock(&shared.asked)
        .get(&a.voter)
        .is_some_and(|&t| now.saturating_sub(t) < 15_000)
    {
        return Err(429);
    }
    shared
        .backend
        .apply(Action::QnaAsk {
            author: a.author,
            text: a.text,
        })
        .map_err(|_| 409u16)?;
    let mut last = lock(&shared.asked);
    if last.len() > 50_000 {
        last.clear();
    }
    last.insert(a.voter, now);
    Ok(())
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

fn app_command(shared: &Shared, request: &mut Request) -> Result<(), (u16, String)> {
    let mut body = String::new();
    request
        .as_reader()
        .take(4096)
        .read_to_string(&mut body)
        .map_err(|_| (400, r#"{"code":"badRequest"}"#.to_owned()))?;
    let command = serde_json::from_str::<AppCommand>(&body)
        .ok()
        .filter(AppCommand::valid)
        .ok_or_else(|| (400, r#"{"code":"badRequest"}"#.to_owned()))?;
    shared.backend.app_command(command).map_err(|e| {
        (
            503,
            serde_json::json!({"code": "notAvailable", "error": e}).to_string(),
        )
    })
}

/// Live updates for one phone, until it goes away.
fn stream(shared: &Shared, request: Request) {
    let Some(snapshot) = shared.backend.snapshot() else {
        return json(request, 503, r#"{"code":"starting"}"#);
    };
    let (tx, rx) = mpsc::sync_channel::<String>(PHONE_QUEUE);
    let mut out = request.into_writer();
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n";
    // What is running, once the control window has said (control surfaces show it).
    let app = Some(lock(&shared.app_state).clone())
        .filter(|s| s != "{}")
        .map(|s| app_event(&s))
        .unwrap_or_default();
    if out
        .write_all(head.as_bytes())
        .and_then(|()| out.write_all(show_event(&snapshot).as_bytes()))
        .and_then(|()| out.write_all(app.as_bytes()))
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
    fn a_phone_that_stopped_reading_is_let_go() {
        let (r, _) = remote();
        let (tx, rx) = mpsc::sync_channel(PHONE_QUEUE);
        lock(&r.shared.phones).push(Phone { id: 1, tx });
        // Hours of changes to a phone whose connection went quiet.
        for _ in 0..PHONE_QUEUE * 10 {
            r.shared.send_all("update");
        }
        assert_eq!(r.shared.phone_count(), 0, "let go, not queued forever");
        assert_eq!(rx.try_iter().count(), PHONE_QUEUE);
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

        // Questions: only while open, and not too often from one phone.
        let q = r#"{"author":"Ana","text":"When is the break?","voter":"a"}"#;
        assert_eq!(request(port, "POST", "/api/ask", "", q).0, 409);
        lock(&fake.engine)
            .apply(Action::QnaOpen { value: true }, 3)
            .unwrap();
        assert!(request(port, "GET", "/api/audience", "", "")
            .1
            .contains(r#""questions":true"#));
        assert_eq!(request(port, "POST", "/api/ask", "", q).0, 200);
        assert_eq!(request(port, "POST", "/api/ask", "", q).0, 429, "too soon");
        assert_eq!(
            lock(&fake.engine).show().qna.questions[0].text,
            "When is the break?"
        );
    }

    #[test]
    fn phones_send_messages_and_photos_to_an_open_wall() {
        let fake = Arc::new(Fake {
            engine: Mutex::new(Engine::new()),
        });
        let dir = std::env::temp_dir().join(format!("lumora-wall-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = PORT.fetch_add(PORTS_TO_TRY, Ordering::SeqCst);
        let r = Remote::new(Some(&dir), first, Arc::clone(&fake));
        let port = r.set_enabled(true).port.unwrap();
        let wall = |f: &Fake| match &lock(&f.engine).show().sources[0].kind {
            lumora_engine::SourceKind::Wall(w) => (**w).clone(),
            _ => unreachable!(),
        };
        lock(&fake.engine)
            .apply(
                Action::AddSource {
                    source: serde_json::from_value(serde_json::json!({
                        "id": "w", "name": "Wall", "kind": {"type": "wall"}
                    }))
                    .unwrap(),
                },
                1,
            )
            .unwrap();
        let path = "/api/message?id=w&voter=a&name=Ana&text=Mazel%20tov%21";
        assert_eq!(request(port, "POST", path, "", "").0, 409, "closed");
        lock(&fake.engine)
            .apply(
                Action::WallOpen {
                    id: lumora_engine::model::SourceId::new("w"),
                    value: true,
                },
                2,
            )
            .unwrap();
        assert!(request(port, "GET", "/api/audience", "", "")
            .1
            .contains(r#""prompt":"Send a message""#));
        assert_eq!(request(port, "POST", path, "", "").0, 200);
        assert_eq!(request(port, "POST", path, "", "").0, 429, "too soon");
        let w = wall(&fake);
        assert_eq!(
            (w.messages[0].name.as_str(), w.messages[0].text.as_str()),
            ("Ana", "Mazel tov!")
        );
        assert!(!w.messages[0].approved, "waits for the operator");

        let photo_to = "/api/message?id=w&voter=b&name=Ben&text=";
        assert_eq!(request(port, "POST", photo_to, "", "not a picture").0, 415);
        // A (tiny, pretend) JPEG.
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3];
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            s,
            "POST {photo_to} HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            jpeg.len()
        )
        .unwrap();
        s.write_all(&jpeg).unwrap();
        let mut reply = String::new();
        s.read_to_string(&mut reply).unwrap();
        assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
        let saved = wall(&fake).messages[1].photo.clone();
        assert!(saved.ends_with(".jpg"));
        assert_eq!(std::fs::read(&saved).unwrap(), jpeg);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_internet_link_answers_only_the_audience_page() {
        let (r, _) = remote();
        r.set_enabled(true);
        let st = r.set_internet(true);
        assert!(st.internet.on);
        let port = lock(&r.public).as_ref().unwrap().port;
        let (code, page) = request(port, "GET", "/", "", "");
        assert_eq!(code, 200);
        assert!(
            page.contains("Join in"),
            "the audience page, not the operator's"
        );
        assert_eq!(request(port, "GET", "/api/audience", "", "").0, 200);
        let pin = st.pin;
        for path in [
            "/index.html",
            "/remote.js",
            "/api/show",
            "/api/tally",
            "/api/do/cut",
        ] {
            assert_eq!(request(port, "GET", path, &pin, "").0, 404, "{path}");
        }
        assert_eq!(request(port, "POST", "/api/action", &pin, "{}").0, 404);
        assert!(!r.set_internet(false).internet.on);
        assert!(lock(&r.public).is_none());
    }

    #[test]
    fn phones_bid_on_the_item_being_sold() {
        let (r, fake) = remote();
        let port = r.set_enabled(true).port.unwrap();
        let id = lumora_engine::model::SourceId::new("a");
        {
            let mut e = lock(&fake.engine);
            e.apply(
                Action::AddSource {
                    source: serde_json::from_value(serde_json::json!({
                        "id": "a", "name": "Auction", "kind": {"type": "auction"}
                    }))
                    .unwrap(),
                },
                1,
            )
            .unwrap();
            e.apply(
                Action::AuctionSetItem {
                    id: id.clone(),
                    item: lumora_engine::auction::AuctionItem {
                        name: "Kiddush cup".into(),
                        start: 100,
                        step: 25,
                        ..Default::default()
                    },
                },
                2,
            )
            .unwrap();
        }
        let item = match &lock(&fake.engine).show().sources[0].kind {
            lumora_engine::SourceKind::Auction(a) => a.items[0].id,
            _ => unreachable!(),
        };
        let body = |amount: u64, voter: &str| {
            format!(
                r#"{{"id":"a","item":{item},"name":"Ana","amount":{amount},"voter":"{voter}"}}"#
            )
        };
        assert_eq!(
            request(port, "POST", "/api/bid", "", &body(100, "a")).0,
            409,
            "closed"
        );
        lock(&fake.engine)
            .apply(Action::AuctionOpen { id, value: true }, 3)
            .unwrap();
        let aud = request(port, "GET", "/api/audience", "", "").1;
        assert!(
            aud.contains("Kiddush cup") && aud.contains(r#""min":100"#),
            "{aud}"
        );
        assert_eq!(
            request(port, "POST", "/api/bid", "", &body(100, "a")).0,
            200
        );
        assert_eq!(
            request(port, "POST", "/api/bid", "", &body(500, "a")).0,
            429,
            "too soon"
        );
        let (code, why) = request(port, "POST", "/api/bid", "", &body(110, "b"));
        assert_eq!(code, 409);
        assert!(why.contains("at least 125"), "{why}");
        assert!(request(port, "GET", "/api/audience", "", "")
            .1
            .contains(r#""min":125"#));
    }

    #[test]
    fn phones_play_trivia() {
        let (r, fake) = remote();
        let port = r.set_enabled(true).port.unwrap();
        let id = lumora_engine::model::SourceId::new("t");
        {
            let mut e = lock(&fake.engine);
            e.apply(
                Action::AddSource {
                    source: serde_json::from_value(serde_json::json!({
                        "id": "t", "name": "Trivia", "kind": {"type": "trivia", "questions": [
                            {"text": "How many days of Chanukah?", "options": ["7", "8"], "correct": 1, "seconds": 30}
                        ]}
                    }))
                    .unwrap(),
                },
                1,
            )
            .unwrap();
        }
        let a = r#"{"id":"t","question":0,"option":1,"name":"Ana","voter":"a"}"#;
        assert_eq!(
            request(port, "POST", "/api/answer", "", a).0,
            409,
            "not asked yet"
        );
        let before = request(port, "GET", "/api/audience?voter=a", "", "").1;
        assert!(
            !before.contains("Chanukah"),
            "the question stays hidden until asked"
        );
        lock(&fake.engine)
            .apply(
                Action::TriviaAsk {
                    id: id.clone(),
                    index: 0,
                },
                now_ms(),
            )
            .unwrap();
        let asking = request(port, "GET", "/api/audience?voter=a", "", "").1;
        assert!(
            asking.contains("Chanukah") && asking.contains(r#""correct":null"#),
            "{asking}"
        );
        assert_eq!(request(port, "POST", "/api/answer", "", a).0, 200);
        assert_eq!(request(port, "POST", "/api/answer", "", a).0, 409, "once");
        lock(&fake.engine)
            .apply(Action::TriviaReveal { id }, now_ms())
            .unwrap();
        let shown = request(port, "GET", "/api/audience?voter=a", "", "").1;
        assert!(
            shown.contains(r#""correct":1"#) && shown.contains(r#""place":1"#),
            "{shown}"
        );
    }

    #[test]
    fn phones_find_their_table_but_never_see_the_whole_list() {
        let (r, fake) = remote();
        let port = r.set_enabled(true).port.unwrap();
        lock(&fake.engine)
            .apply(
                Action::AddSource {
                    source: serde_json::from_value(serde_json::json!({
                        "id": "s", "name": "Seats", "kind": {"type": "seating", "guests": [
                            {"name": "Cohen, David", "table": "12"}, {"name": "Levi, Sarah", "table": "4"}
                        ]}
                    }))
                    .unwrap(),
                },
                1,
            )
            .unwrap();
        let aud = request(port, "GET", "/api/audience", "", "").1;
        assert!(
            aud.contains(r#""seating":[{"#) && !aud.contains("Cohen"),
            "{aud}"
        );
        let (code, found) = request(port, "GET", "/api/seat?id=s&name=sarah", "", "");
        assert_eq!(code, 200);
        assert!(
            found.contains(r#""table":"4""#) && !found.contains("Cohen"),
            "{found}"
        );
        assert_eq!(
            request(port, "GET", "/api/seat?id=s&name=x", "", "").1,
            "[]",
            "too short"
        );
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

    /// A control window that keeps what it was asked to do.
    #[derive(Default)]
    struct Window {
        commands: Mutex<Vec<AppCommand>>,
    }

    impl Backend for Arc<Window> {
        fn snapshot(&self) -> Option<String> {
            Some(format!(
                "{{\"revision\":0,\"show\":{}}}",
                serde_json::to_string(Engine::new().show()).unwrap()
            ))
        }
        fn apply(&self, _: Action) -> Result<(), ActionError> {
            Ok(())
        }
        fn phones_changed(&self) {}
        fn app_command(&self, command: AppCommand) -> Result<(), String> {
            lock(&self.commands).push(command);
            Ok(())
        }
    }

    #[test]
    fn control_surfaces_record_and_go_live_through_the_control_window() {
        let window = Arc::new(Window::default());
        let first = PORT.fetch_add(PORTS_TO_TRY, Ordering::SeqCst);
        let r = Remote::new(None, first, Arc::clone(&window));
        let st = r.set_enabled(true);
        let port = st.port.unwrap();
        let rec = r#"{"command":"record","on":true}"#;
        assert_eq!(request(port, "POST", "/api/app", "0000x", rec).0, 401);
        assert_eq!(request(port, "POST", "/api/app", &st.pin, rec).0, 202);
        let replay = r#"{"command":"replay","seconds":10,"slow":true}"#;
        assert_eq!(request(port, "POST", "/api/app", &st.pin, replay).0, 202);
        for bad in [
            r#"{"command":"replay","seconds":0}"#,
            r#"{"command":"replay","seconds":600}"#,
            r#"{"command":"deleteEverything"}"#,
            r#"{"command":"stream","on":true,"extra":1}"#,
            "not json",
        ] {
            assert_eq!(
                request(port, "POST", "/api/app", &st.pin, bad).0,
                400,
                "{bad}"
            );
        }
        assert_eq!(
            *lock(&window.commands),
            vec![
                AppCommand::Record { on: true },
                AppCommand::Replay {
                    seconds: 10,
                    slow: true
                }
            ]
        );
        // The engine-free default: a remote without a control window says so.
        let (r2, _) = remote();
        let st2 = r2.set_enabled(true);
        let (code, body) = request(st2.port.unwrap(), "POST", "/api/app", &st2.pin, rec);
        assert_eq!(code, 503);
        assert!(body.contains("notAvailable"));
    }

    #[test]
    fn control_surfaces_are_told_what_is_running() {
        let (r, _) = remote();
        let st = r.set_enabled(true);
        let port = st.port.unwrap();
        assert_eq!(request(port, "GET", "/api/app", &st.pin, "").1, "{}");
        assert_eq!(request(port, "GET", "/api/app", "", "").0, 401);
        r.set_app_state(&serde_json::json!({"recording": true}));
        assert_eq!(
            request(port, "GET", "/api/app", &st.pin, "").1,
            r#"{"recording":true}"#
        );
        // Connecting: the show, then what is running; changes follow.
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            s,
            "GET /api/events?pin={} HTTP/1.1\r\nHost: x\r\n\r\n",
            st.pin
        )
        .unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut lines = BufReader::new(s).lines();
        let mut next = || loop {
            let l = lines.next().unwrap().unwrap();
            if let Some(e) = l.strip_prefix("event: ") {
                let data = lines.next().unwrap().unwrap();
                return (e.to_owned(), data);
            }
        };
        assert_eq!(next().0, "show");
        assert_eq!(next(), ("app".into(), r#"data: {"recording":true}"#.into()));
        for _ in 0..50 {
            if r.status().phones == 1 {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        // The same state again is not sent; a change is. Anything but an object is ignored.
        r.set_app_state(&serde_json::json!({"recording": true}));
        r.set_app_state(&serde_json::json!(5));
        r.set_app_state(&serde_json::json!({"recording": false, "streaming": true}));
        assert_eq!(
            next(),
            (
                "app".into(),
                r#"data: {"recording":false,"streaming":true}"#.into()
            )
        );
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
