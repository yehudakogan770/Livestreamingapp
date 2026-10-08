//! The show computer's side: other computers join as seats.
//!
//! The show never waits for a seat. Each seat has its own reader and writer
//! threads and a short queue; a seat that falls behind or drops is simply
//! let go (it reconnects by itself and gets the whole show again). Seats'
//! requests reach the engine one at a time, in the order they arrive, the
//! same way the show computer's own clicks do.

use std::collections::{HashMap, HashSet};
use std::io;
use std::net::{IpAddr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use lumora_engine::action::Action;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::crypto::{self, KeyPair, Opener, Sealer, Side, Transcript};
use crate::discovery::{self, Announcer};
use crate::role::{seat_may, seat_may_command, Refusal, Role, SeatCommand};
use crate::sync::{diff, document};
use crate::wire::{self, FromSeat, Plain, SeatView, ToSeat, MAX_FRAME, MAX_PLAIN, VERSION};

const FILE: &str = "seats.json";
/// Messages waiting for one seat; one this far behind is let go.
const QUEUE: usize = 256;
/// Pictures are skipped for a seat with this many messages still waiting.
const PICTURE_BACKLOG: usize = 6;
/// Changes are sent at most this often (so a fader drag is not 200 messages).
const THROTTLE: Duration = Duration::from_millis(30);
/// A seat that says nothing for this long is gone (seats ping every second).
const SILENT: Duration = Duration::from_secs(8);
/// A pairing request nobody answers is dropped.
const PAIRING_WAIT: Duration = Duration::from_secs(5 * 60);
const MAX_PENDING: usize = 4;
const MAX_CONNECTED: usize = 12;
/// Connections allowed in the key exchange at once.
const MAX_GREETING: usize = 16;
/// Requests per seat: a burst of this many, refilled at `RATE` a second.
const BURST: f64 = 40.0;
const RATE: f64 = 20.0;
/// Wrong codes from one address before it has to wait.
const FREE_TRIES: u32 = 3;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// What the seats need from the app.
pub trait SeatBackend: Send + Sync + 'static {
    /// The show's revision and the show as JSON (`None`: still starting).
    fn snapshot(&self) -> Option<(u64, Value)>;
    /// Change the show, as if clicked on the show computer.
    ///
    /// # Errors
    /// Why the engine refused.
    fn apply(&self, action: Action) -> Result<(), String>;
    /// Recording, streaming or replay, for the control window.
    ///
    /// # Errors
    /// The control window can't be reached.
    fn command(&self, command: SeatCommand) -> Result<(), String>;
    /// Move the PTZ camera of input `source` (the show computer talks to it).
    ///
    /// # Errors
    /// No such camera, or it did not answer.
    fn ptz(&self, source: &str, command: Value) -> Result<(), String> {
        let _ = (source, command);
        Err("PTZ cameras can’t be moved from here.".to_owned())
    }
    /// A preview picture as JPEG, when the engine draws them itself (the
    /// Unified engine). Otherwise the control window sends them (`set_picture`).
    fn picture(&self, key: &str) -> Option<Vec<u8>> {
        let _ = key;
        None
    }
    /// The event's name (seats see it with this computer's name). The usual
    /// way reads the whole show; the app has a cheaper one.
    fn event_name(&self) -> Option<String> {
        self.snapshot()
            .and_then(|(_, s)| s["event"]["name"].as_str().map(str::to_owned))
    }
    /// Something the Operators panel shows changed.
    fn changed(&self) {}
}

/// An approved seat, remembered between starts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatRecord {
    pub id: String,
    /// The joining computer's name.
    pub name: String,
    pub role: Role,
    /// Hex; only these two computers know it.
    pub secret: String,
    #[serde(default)]
    pub locked: bool,
}

/// Remembered between starts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SeatsConfig {
    /// Other computers may join.
    pub enabled: bool,
    pub port: u16,
    /// This show computer, so a seat finds it again after the address changes.
    pub show_id: String,
    pub seats: Vec<SeatRecord>,
}

impl Default for SeatsConfig {
    fn default() -> Self {
        SeatsConfig {
            enabled: false,
            port: wire::DEFAULT_PORT,
            show_id: crypto::hex(&crypto::random::<8>()),
            seats: Vec::new(),
        }
    }
}

/// A computer waiting to be let in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingView {
    pub id: u64,
    pub name: String,
    pub address: String,
    /// The code to read out (the other computer types it).
    pub code: String,
    /// The other computer typed the right code.
    pub code_typed: bool,
    /// Approved already (it joins once the code is typed).
    pub approved: bool,
}

/// A seat, for the Operators panel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatInfo {
    pub id: String,
    pub name: String,
    pub role: Role,
    pub locked: bool,
    pub connected: bool,
    pub address: Option<String>,
    /// Round trip, as the seat measured it.
    pub latency_ms: Option<u32>,
    /// When it connected (ms since 1970).
    pub since: Option<u64>,
}

/// For the Operators panel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatsStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    /// Where other computers reach this one (`192.168.1.20:8097`).
    pub addresses: Vec<String>,
    pub error: Option<String>,
    /// The name seats see.
    pub show: String,
    pub pending: Vec<PendingView>,
    pub seats: Vec<SeatInfo>,
}

enum Out {
    Msg(Vec<u8>),
    Close,
}

struct PendingSeat {
    name: String,
    code: String,
    code_typed: bool,
    approved: Option<Role>,
    since: Instant,
}

enum Stage {
    Pending(PendingSeat),
    Seat(String),
}

struct Bucket {
    tokens: f64,
    at: Instant,
}

impl Bucket {
    fn take(&mut self) -> bool {
        let now = Instant::now();
        self.tokens = (self.tokens + now.duration_since(self.at).as_secs_f64() * RATE).min(BURST);
        self.at = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

struct Conn {
    tx: SyncSender<Out>,
    /// Messages queued and not yet written.
    backlog: Arc<AtomicUsize>,
    stream: TcpStream,
    ip: IpAddr,
    stage: Stage,
    /// Has the whole document, so changes may follow.
    synced: bool,
    watch: HashSet<String>,
    /// The last picture sent for each key (a hash), so unchanged ones are not sent again.
    sent: HashMap<String, u64>,
    rtt: Option<u32>,
    since: u64,
    bucket: Bucket,
}

impl Conn {
    fn send(&self, text: &[u8]) -> bool {
        self.backlog.fetch_add(1, Ordering::SeqCst);
        let ok = self.tx.try_send(Out::Msg(text.to_vec())).is_ok();
        if !ok {
            self.backlog.fetch_sub(1, Ordering::SeqCst);
        }
        ok
    }

    fn close(&self) {
        let _ = self.tx.try_send(Out::Close);
        let _ = self.stream.shutdown(Shutdown::Read);
    }
}

fn msg(m: &ToSeat) -> Vec<u8> {
    serde_json::to_vec(m).unwrap_or_default()
}

#[derive(Default)]
struct SyncState {
    /// What the seats have.
    doc: Value,
    rev: u64,
    dirty: bool,
    last: Option<Instant>,
}

struct Inner {
    backend: Box<dyn SeatBackend>,
    dir: Option<PathBuf>,
    config: Mutex<SeatsConfig>,
    conns: Mutex<HashMap<u64, Conn>>,
    next: AtomicU64,
    /// The newest show (kept only while seats are connected).
    latest: Mutex<Option<(u64, Value)>>,
    app: Mutex<Value>,
    sync: Mutex<SyncState>,
    wake: Condvar,
    /// Wrong codes per address.
    tries: Mutex<HashMap<IpAddr, (u32, Instant)>>,
    /// Pictures the control window sent (Standard engine).
    pictures: Mutex<HashMap<String, (Vec<u8>, Instant)>>,
    meters: Mutex<Option<Value>>,
    stop: AtomicBool,
    /// Connections still in the key exchange (a flood of them is turned away).
    greeting: AtomicUsize,
}

struct Running {
    stop: Arc<AtomicBool>,
    port: u16,
    _announcer: Option<Announcer>,
}

/// The seats server. Starts by itself if it was on last time.
pub struct SeatServer {
    inner: Arc<Inner>,
    running: Mutex<Option<Running>>,
    error: Mutex<Option<String>>,
}

impl SeatServer {
    /// `dir`: where the settings are kept (`None`: not saved, for tests).
    pub fn new(dir: Option<&Path>, backend: impl SeatBackend) -> SeatServer {
        let config = dir
            .and_then(|d| std::fs::read_to_string(d.join(FILE)).ok())
            .and_then(|t| serde_json::from_str::<SeatsConfig>(&t).ok())
            .unwrap_or_default();
        let inner = Arc::new(Inner {
            backend: Box::new(backend),
            dir: dir.map(Path::to_path_buf),
            config: Mutex::new(config),
            conns: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            latest: Mutex::new(None),
            app: Mutex::new(json!({})),
            sync: Mutex::new(SyncState::default()),
            wake: Condvar::new(),
            tries: Mutex::new(HashMap::new()),
            pictures: Mutex::new(HashMap::new()),
            meters: Mutex::new(None),
            stop: AtomicBool::new(false),
            greeting: AtomicUsize::new(0),
        });
        inner.save();
        for (name, run) in [
            ("lumora-seats-sync", sync_loop as fn(&Arc<Inner>)),
            ("lumora-seats-pictures", picture_loop),
        ] {
            let i = Arc::clone(&inner);
            let _ = thread::Builder::new()
                .name(name.into())
                .spawn(move || run(&i));
        }
        let server = SeatServer {
            inner,
            running: Mutex::new(None),
            error: Mutex::new(None),
        };
        server.apply_config();
        server
    }

    /// For tests: a server on this port (0: any free one), on at once.
    pub fn start_on(backend: impl SeatBackend, port: u16) -> SeatServer {
        let s = SeatServer::new(None, backend);
        {
            let mut c = lock(&s.inner.config);
            c.port = port;
            c.enabled = true;
        }
        s.apply_config();
        // Keep the port it got, so stopping and starting again reuses it.
        if let Some(p) = s.port() {
            lock(&s.inner.config).port = p;
        }
        s
    }

    /// The port seats connect to (while running).
    pub fn port(&self) -> Option<u16> {
        lock(&self.running).as_ref().map(|r| r.port)
    }

    pub fn status(&self) -> SeatsStatus {
        let config = lock(&self.inner.config).clone();
        let port = self.port();
        let conns = lock(&self.inner.conns);
        let mut pending: Vec<PendingView> = conns
            .iter()
            .filter_map(|(id, c)| match &c.stage {
                Stage::Pending(p) => Some(PendingView {
                    id: *id,
                    name: p.name.clone(),
                    address: c.ip.to_string(),
                    code: p.code.clone(),
                    code_typed: p.code_typed,
                    approved: p.approved.is_some(),
                }),
                Stage::Seat(_) => None,
            })
            .collect();
        pending.sort_by_key(|p| p.id);
        let seats = config
            .seats
            .iter()
            .map(|s| {
                let live = conns
                    .values()
                    .find(|c| matches!(&c.stage, Stage::Seat(id) if *id == s.id));
                SeatInfo {
                    id: s.id.clone(),
                    name: s.name.clone(),
                    role: s.role.clone(),
                    locked: s.locked,
                    connected: live.is_some(),
                    address: live.map(|c| c.ip.to_string()),
                    latency_ms: live.and_then(|c| c.rtt),
                    since: live.map(|c| c.since),
                }
            })
            .collect();
        drop(conns);
        SeatsStatus {
            enabled: config.enabled,
            running: port.is_some(),
            port: port.unwrap_or(config.port),
            addresses: port.map(addresses).unwrap_or_default(),
            error: lock(&self.error).clone(),
            show: self.inner.show_name(),
            pending,
            seats,
        }
    }

    /// Let other computers join (or stop: every seat is disconnected; the
    /// approved ones can come back when it is on again).
    pub fn set_enabled(&self, on: bool) -> SeatsStatus {
        lock(&self.inner.config).enabled = on;
        self.inner.save();
        if !on {
            self.stop_listening();
        }
        self.apply_config();
        self.inner.backend.changed();
        self.status()
    }

    /// Let a waiting computer in with this role (it joins as soon as its code
    /// is typed, if it has not been yet).
    ///
    /// # Errors
    /// It is no longer waiting.
    pub fn approve(&self, pending: u64, role: Role) -> Result<SeatsStatus, String> {
        {
            let mut conns = lock(&self.inner.conns);
            let Some(Conn {
                stage: Stage::Pending(p),
                ..
            }) = conns.get_mut(&pending)
            else {
                return Err(
                    "That computer is no longer waiting. Ask them to join again.".to_owned(),
                );
            };
            p.approved = Some(role);
        }
        self.inner.try_admit(pending);
        self.inner.backend.changed();
        Ok(self.status())
    }

    /// Say no to a waiting computer.
    pub fn deny(&self, pending: u64) -> SeatsStatus {
        if let Some(c) = lock(&self.inner.conns).remove(&pending) {
            let _ = c.send(&msg(&ToSeat::Bye {
                reason: "The show operator said no.".to_owned(),
                forget: true,
            }));
            c.close();
        }
        self.inner.backend.changed();
        self.status()
    }

    /// # Errors
    /// No such seat.
    pub fn set_role(&self, seat: &str, role: Role) -> Result<SeatsStatus, String> {
        self.inner.edit_seat(seat, |s| s.role = role)?;
        Ok(self.status())
    }

    /// A locked seat still sees the show but can't change anything.
    ///
    /// # Errors
    /// No such seat.
    pub fn set_locked(&self, seat: &str, locked: bool) -> Result<SeatsStatus, String> {
        self.inner.edit_seat(seat, |s| s.locked = locked)?;
        Ok(self.status())
    }

    /// Disconnect a seat and forget it: to come back it has to pair again
    /// (with a new code, approved again).
    pub fn remove(&self, seat: &str) -> SeatsStatus {
        lock(&self.inner.config).seats.retain(|s| s.id != seat);
        self.inner.save();
        let mut conns = lock(&self.inner.conns);
        conns.retain(|_, c| {
            let this = matches!(&c.stage, Stage::Seat(id) if id == seat);
            if this {
                let _ = c.send(&msg(&ToSeat::Bye {
                    reason: "The show operator removed this seat.".to_owned(),
                    forget: true,
                }));
                c.close();
            }
            !this
        });
        drop(conns);
        self.inner.backend.changed();
        self.status()
    }

    /// The show changed. Cheap when no seat is connected.
    pub fn show_changed(&self, revision: u64, show: &impl Serialize) {
        if !self.inner.any_synced() {
            *lock(&self.inner.latest) = None;
            return;
        }
        let Ok(v) = serde_json::to_value(show) else {
            return;
        };
        *lock(&self.inner.latest) = Some((revision, v));
        self.inner.mark_dirty();
    }

    /// What the control window says is running (recording, stream…).
    pub fn set_app_state(&self, app: &Value) {
        {
            let mut cur = lock(&self.inner.app);
            if *cur == *app {
                return;
            }
            cur.clone_from(app);
        }
        self.inner.mark_dirty();
    }

    /// A preview picture from the control window (JPEG).
    pub fn set_picture(&self, key: &str, jpeg: Vec<u8>) {
        if key.len() > 200 || jpeg.len() > 2 << 20 {
            return;
        }
        lock(&self.inner.pictures).insert(key.to_owned(), (jpeg, Instant::now()));
    }

    /// The mixer's levels, from the control window.
    pub fn set_meters(&self, meters: Value) {
        *lock(&self.inner.meters) = Some(meters);
    }

    /// The pictures and levels any seat is watching (so the control window
    /// only makes those).
    pub fn watched(&self) -> Vec<String> {
        let mut keys: Vec<String> = lock(&self.inner.conns)
            .values()
            .filter(|c| c.synced)
            .flat_map(|c| c.watch.iter().cloned())
            .collect();
        keys.sort();
        keys.dedup();
        keys
    }

    fn apply_config(&self) {
        let c = lock(&self.inner.config).clone();
        if !c.enabled {
            return;
        }
        let mut running = lock(&self.running);
        if running.is_some() {
            return;
        }
        *lock(&self.error) = None;
        match TcpListener::bind(("0.0.0.0", c.port)) {
            Ok(listener) => {
                let port = listener.local_addr().map_or(c.port, |a| a.port());
                let stop = Arc::new(AtomicBool::new(false));
                let (inner, flag) = (Arc::clone(&self.inner), Arc::clone(&stop));
                let _ = thread::Builder::new()
                    .name("lumora-seats".into())
                    .spawn(move || accept(&listener, &inner, &flag));
                let who = Arc::clone(&self.inner);
                let announcer = Announcer::start(
                    port,
                    Arc::new(move || discovery::ShowInfo {
                        id: lock(&who.config).show_id.clone(),
                        name: who.show_name(),
                        port,
                    }),
                );
                *running = Some(Running {
                    stop,
                    port,
                    _announcer: announcer,
                });
            }
            Err(e) => {
                *lock(&self.error) = Some(format!(
                    "Other computers can't join: port {} is in use ({e}). Close the other program using it, or restart the computer.",
                    c.port
                ));
            }
        }
    }

    fn stop_listening(&self) {
        let Some(r) = lock(&self.running).take() else {
            return;
        };
        r.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], r.port)),
            Duration::from_millis(300),
        );
        for (_, c) in lock(&self.inner.conns).drain() {
            let _ = c.send(&msg(&ToSeat::Bye {
                reason: "The show computer stopped letting other computers join.".to_owned(),
                forget: false,
            }));
            c.close();
        }
    }
}

impl Drop for SeatServer {
    fn drop(&mut self) {
        self.stop_listening();
        self.inner.stop.store(true, Ordering::SeqCst);
        self.inner.wake.notify_all();
    }
}

/// This computer's name.
#[must_use]
pub fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|n| !n.trim().is_empty())
        .or_else(|| {
            std::fs::read_to_string("/etc/hostname")
                .ok()
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "Lumora".to_owned())
}

/// Where other computers on the network reach this one.
fn addresses(port: u16) -> Vec<String> {
    discovery::local_ips()
        .into_iter()
        .map(|ip| format!("{ip}:{port}"))
        .collect()
}

impl Inner {
    fn save(&self) {
        let Some(dir) = &self.dir else { return };
        let Ok(text) = serde_json::to_string_pretty(&*lock(&self.config)) else {
            return;
        };
        let tmp = dir.join(format!("{FILE}.tmp"));
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, dir.join(FILE));
        }
    }

    fn show_name(&self) -> String {
        let event = lock(&self.latest)
            .as_ref()
            .and_then(|(_, s)| s["event"]["name"].as_str().map(str::to_owned))
            .or_else(|| self.backend.event_name())
            .filter(|n| !n.trim().is_empty());
        let computer = computer_name();
        match event {
            Some(e) => format!("{e} ({computer})"),
            None => computer,
        }
    }

    fn any_synced(&self) -> bool {
        lock(&self.conns).values().any(|c| c.synced)
    }

    fn mark_dirty(&self) {
        lock(&self.sync).dirty = true;
        self.wake.notify_all();
    }

    fn seat(&self, id: &str) -> Option<SeatRecord> {
        lock(&self.config)
            .seats
            .iter()
            .find(|s| s.id == id)
            .cloned()
    }

    fn edit_seat(&self, id: &str, change: impl FnOnce(&mut SeatRecord)) -> Result<(), String> {
        let view = {
            let mut c = lock(&self.config);
            let s = c
                .seats
                .iter_mut()
                .find(|s| s.id == id)
                .ok_or("That seat is no longer there.")?;
            change(s);
            view_of(s)
        };
        self.save();
        let text = msg(&ToSeat::Seat { seat: view });
        for c in lock(&self.conns).values() {
            if matches!(&c.stage, Stage::Seat(s) if s == id) {
                c.send(&text);
            }
        }
        self.backend.changed();
        Ok(())
    }

    /// Bring the seats' document up to date (sends the change to every synced seat).
    fn flush(&self, s: &mut SyncState) {
        let latest = lock(&self.latest).clone();
        let Some((revision, show)) = latest else {
            return;
        };
        let doc = document(revision, show, lock(&self.app).clone());
        let ops = diff(&s.doc, &doc);
        s.doc = doc;
        s.last = Some(Instant::now());
        if ops.is_empty() {
            return;
        }
        s.rev += 1;
        let text = msg(&ToSeat::Diff {
            base: s.rev - 1,
            rev: s.rev,
            ops,
        });
        lock(&self.conns).retain(|_, c| {
            if !c.synced {
                return true;
            }
            let ok = c.send(&text);
            if !ok {
                // Too far behind: let it go (it reconnects and gets everything).
                c.close();
            }
            ok
        });
    }

    /// Send a seat the whole document (it joined, or asked again).
    fn send_whole(&self, conn: u64) {
        // Read the show before taking any of the seats' locks: the app may be
        // telling us about a change while holding the engine.
        let fresh = if lock(&self.latest).is_none() {
            self.backend.snapshot()
        } else {
            None
        };
        if let Some(f) = fresh {
            let mut l = lock(&self.latest);
            if l.is_none() {
                *l = Some(f);
            }
        }
        let mut s = lock(&self.sync);
        self.flush(&mut s);
        let text = msg(&ToSeat::State {
            rev: s.rev,
            doc: s.doc.clone(),
        });
        if let Some(c) = lock(&self.conns).get_mut(&conn) {
            if c.send(&text) {
                c.synced = true;
            }
        }
    }

    /// A waiting computer becomes a seat once approved and its code typed.
    fn try_admit(&self, conn: u64) {
        let record = {
            let mut conns = lock(&self.conns);
            let Some(c) = conns.get_mut(&conn) else {
                return;
            };
            let Stage::Pending(p) = &c.stage else {
                return;
            };
            if !p.code_typed {
                return;
            }
            let Some(role) = p.approved.clone() else {
                return;
            };
            let record = SeatRecord {
                id: crypto::hex(&crypto::random::<8>()),
                name: p.name.clone(),
                role,
                secret: crypto::hex(&crypto::random::<32>()),
                locked: false,
            };
            c.stage = Stage::Seat(record.id.clone());
            c.since = now_ms();
            record
        };
        {
            let mut cfg = lock(&self.config);
            cfg.seats.push(record.clone());
        }
        self.save();
        let welcome = ToSeat::Welcome {
            seat: view_of(&record),
            show: self.show_name(),
            show_id: lock(&self.config).show_id.clone(),
            secret: Some(record.secret.clone()),
        };
        if let Some(c) = lock(&self.conns).get(&conn) {
            c.send(&msg(&welcome));
        }
        self.send_whole(conn);
        self.backend.changed();
    }

    /// Too many wrong codes from this address lately?
    fn locked_out(&self, ip: IpAddr) -> bool {
        let mut t = lock(&self.tries);
        let now = Instant::now();
        t.retain(|_, (_, at)| now.duration_since(*at) < Duration::from_secs(30 * 60));
        t.get(&ip).is_some_and(|&(wrong, at)| {
            wrong >= FREE_TRIES && now.duration_since(at) < wait_after(wrong)
        })
    }

    fn wrong_try(&self, ip: IpAddr) {
        let mut t = lock(&self.tries);
        let e = t.entry(ip).or_insert((0, Instant::now()));
        *e = (e.0.saturating_add(1), Instant::now());
    }

    /// Answer one request from a seat.
    fn request(&self, conn: u64, m: FromSeat) -> Option<ToSeat> {
        let (seat_id, allowed) = {
            let mut conns = lock(&self.conns);
            let c = conns.get_mut(&conn)?;
            let Stage::Seat(id) = &c.stage else {
                return None;
            };
            let id = id.clone();
            match &m {
                FromSeat::Action { .. } | FromSeat::Command { .. } | FromSeat::Ptz { .. } => {
                    (id, c.bucket.take())
                }
                _ => (id, true),
            }
        };
        match m {
            FromSeat::Action { id, action } => {
                let record = self.seat(&seat_id)?;
                let refuse = |r: Refusal| ToSeat::Result {
                    id,
                    ok: false,
                    refusal: Some(r),
                    error: Some(r.message().to_owned()),
                };
                if !allowed {
                    return Some(refuse(Refusal::TooFast));
                }
                let Ok(action) = serde_json::from_value::<Action>(action) else {
                    return Some(ToSeat::Result {
                        id,
                        ok: false,
                        refusal: None,
                        error: Some(
                            "The show computer doesn’t know this change. Use the same version of Lumora on both computers.".to_owned(),
                        ),
                    });
                };
                if let Err(r) = seat_may(&action, &record.role, record.locked) {
                    return Some(refuse(r));
                }
                Some(match self.backend.apply(action) {
                    Ok(()) => ToSeat::Result {
                        id,
                        ok: true,
                        refusal: None,
                        error: None,
                    },
                    Err(e) => ToSeat::Result {
                        id,
                        ok: false,
                        refusal: None,
                        error: Some(e),
                    },
                })
            }
            FromSeat::Command { id, command } => {
                let record = self.seat(&seat_id)?;
                let refuse = |r: Refusal| ToSeat::Result {
                    id,
                    ok: false,
                    refusal: Some(r),
                    error: Some(r.message().to_owned()),
                };
                if !allowed {
                    return Some(refuse(Refusal::TooFast));
                }
                let command = match serde_json::from_value::<SeatCommand>(command) {
                    Ok(c) if c.valid() => c,
                    _ => {
                        return Some(ToSeat::Result {
                            id,
                            ok: false,
                            refusal: None,
                            error: Some("The show computer doesn’t know this request.".to_owned()),
                        })
                    }
                };
                if let Err(r) = seat_may_command(&command, &record.role, record.locked) {
                    return Some(refuse(r));
                }
                Some(match self.backend.command(command) {
                    Ok(()) => ToSeat::Result {
                        id,
                        ok: true,
                        refusal: None,
                        error: None,
                    },
                    Err(e) => ToSeat::Result {
                        id,
                        ok: false,
                        refusal: None,
                        error: Some(e),
                    },
                })
            }
            FromSeat::Ptz {
                id,
                source,
                command,
            } => {
                let record = self.seat(&seat_id)?;
                let refusal = if record.locked {
                    Some(Refusal::Locked)
                } else if !record.role.allows(crate::role::Group::Cameras) {
                    Some(Refusal::NotYourSeat)
                } else if !allowed {
                    Some(Refusal::TooFast)
                } else {
                    None
                };
                Some(match refusal {
                    Some(r) => ToSeat::Result {
                        id,
                        ok: false,
                        refusal: Some(r),
                        error: Some(r.message().to_owned()),
                    },
                    None => match self.backend.ptz(&source, command) {
                        Ok(()) => ToSeat::Result {
                            id,
                            ok: true,
                            refusal: None,
                            error: None,
                        },
                        Err(e) => ToSeat::Result {
                            id,
                            ok: false,
                            refusal: None,
                            error: Some(e),
                        },
                    },
                })
            }
            FromSeat::Ping { t, rtt } => {
                let changed = {
                    let mut conns = lock(&self.conns);
                    let c = conns.get_mut(&conn)?;
                    let before = c.rtt;
                    c.rtt = rtt;
                    // The panel is told when the latency moves noticeably.
                    match (before, rtt) {
                        (Some(a), Some(b)) => a.abs_diff(b) > 5,
                        (a, b) => a != b,
                    }
                };
                if changed {
                    self.backend.changed();
                }
                Some(ToSeat::Pong { t })
            }
            FromSeat::Watch { keys } => {
                if let Some(c) = lock(&self.conns).get_mut(&conn) {
                    c.watch = keys
                        .into_iter()
                        .filter(|k| k.len() <= 200)
                        .take(24)
                        .collect();
                    c.sent.retain(|k, _| c.watch.contains(k));
                }
                None
            }
            FromSeat::Resync => {
                self.send_whole(conn);
                None
            }
            FromSeat::Confirm { .. } | FromSeat::Leave => None,
        }
    }
}

fn wait_after(wrong: u32) -> Duration {
    // 3 free tries, then 30 s, 60 s, 120 s… up to 15 minutes.
    let extra = wrong.saturating_sub(FREE_TRIES).min(5);
    Duration::from_secs(30u64 << extra).min(Duration::from_secs(15 * 60))
}

fn view_of(s: &SeatRecord) -> SeatView {
    SeatView {
        id: s.id.clone(),
        name: s.name.clone(),
        role: s.role.clone(),
        locked: s.locked,
    }
}

fn sync_loop(inner: &Arc<Inner>) {
    loop {
        let mut s = lock(&inner.sync);
        while !s.dirty && !inner.stop.load(Ordering::SeqCst) {
            s = inner
                .wake
                .wait_timeout(s, Duration::from_secs(1))
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        if inner.stop.load(Ordering::SeqCst) {
            return;
        }
        // At most one change per THROTTLE: later changes in the window go together.
        if let Some(wait) = s.last.and_then(|l| THROTTLE.checked_sub(l.elapsed())) {
            drop(s);
            thread::sleep(wait);
            s = lock(&inner.sync);
        }
        s.dirty = false;
        inner.flush(&mut s);
    }
}

fn hash(bytes: &[u8]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

/// Pictures about 5 times a second, levels about 10 times.
fn picture_loop(inner: &Arc<Inner>) {
    let mut tick = 0u64;
    let mut last_meters = Value::Null;
    while !inner.stop.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(100));
        tick += 1;
        let watched: HashSet<String> = lock(&inner.conns)
            .values()
            .filter(|c| c.synced)
            .flat_map(|c| c.watch.iter().cloned())
            .collect();
        if watched.is_empty() {
            continue;
        }
        if watched.contains("meters") {
            let m = lock(&inner.meters).clone();
            if let Some(m) = m.filter(|m| *m != last_meters) {
                let text = msg(&ToSeat::Meters { meters: m.clone() });
                for c in lock(&inner.conns).values() {
                    if c.synced
                        && c.watch.contains("meters")
                        && c.backlog.load(Ordering::SeqCst) < PICTURE_BACKLOG
                    {
                        c.send(&text);
                    }
                }
                last_meters = m;
            }
        }
        if !tick.is_multiple_of(2) {
            continue;
        }
        lock(&inner.pictures).retain(|_, (_, at)| at.elapsed() < Duration::from_secs(5));
        for key in watched.iter().filter(|k| *k != "meters") {
            let jpeg = inner
                .backend
                .picture(key)
                .filter(|j| !j.is_empty())
                .or_else(|| lock(&inner.pictures).get(key).map(|(j, _)| j.clone()));
            let Some(jpeg) = jpeg else { continue };
            let h = hash(&jpeg);
            let mut text: Option<Vec<u8>> = None;
            for c in lock(&inner.conns).values_mut() {
                if !c.synced
                    || !c.watch.contains(key)
                    || c.sent.get(key) == Some(&h)
                    || c.backlog.load(Ordering::SeqCst) >= PICTURE_BACKLOG
                {
                    continue;
                }
                let t = text.get_or_insert_with(|| {
                    msg(&ToSeat::Preview {
                        key: key.clone(),
                        jpeg: wire::base64(&jpeg),
                    })
                });
                if c.send(t) {
                    c.sent.insert(key.clone(), h);
                }
            }
        }
    }
}

fn accept(listener: &TcpListener, inner: &Arc<Inner>, stop: &Arc<AtomicBool>) {
    for conn in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok(stream) = conn else { continue };
        let inner = Arc::clone(inner);
        let _ = thread::Builder::new()
            .name("lumora-seat".into())
            .spawn(move || {
                let _ = serve(stream, &inner);
            });
    }
}

fn read_plain(stream: &mut TcpStream) -> io::Result<Plain> {
    let f = wire::read_frame(stream, MAX_PLAIN)?;
    serde_json::from_slice(&f).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn send_plain(stream: &mut TcpStream, m: &Plain) -> io::Result<()> {
    wire::write_frame(stream, &serde_json::to_vec(m).unwrap_or_default())
}

fn refuse(stream: &mut TcpStream, code: &str, message: &str) -> io::Result<()> {
    send_plain(
        stream,
        &Plain::Refused {
            code: code.to_owned(),
            message: message.to_owned(),
        },
    )
}

fn bad(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, what.to_owned())
}

fn read_sealed(stream: &mut TcpStream, opener: &mut Opener) -> io::Result<FromSeat> {
    let f = wire::read_frame(stream, MAX_FRAME)?;
    let plain = opener.open(&f).map_err(|_| bad("did not open"))?;
    serde_json::from_slice(&plain).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// One connection, from the key exchange to the end.
/// Counts a connection as still greeting until dropped.
struct Greeting<'a>(&'a AtomicUsize);

impl Drop for Greeting<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn serve(stream: TcpStream, inner: &Arc<Inner>) -> io::Result<()> {
    if inner.greeting.fetch_add(1, Ordering::SeqCst) >= MAX_GREETING {
        inner.greeting.fetch_sub(1, Ordering::SeqCst);
        let _ = stream.shutdown(Shutdown::Both);
        return Ok(());
    }
    let greeting = Greeting(&inner.greeting);
    serve_counted(stream, inner, greeting)
}

fn serve_counted(
    mut stream: TcpStream,
    inner: &Arc<Inner>,
    greeting: Greeting<'_>,
) -> io::Result<()> {
    let ip = stream.peer_addr()?.ip();
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_nodelay(true)?;
    let hello = read_plain(&mut stream)?;
    if !lock(&inner.config).enabled {
        return refuse(
            &mut stream,
            "off",
            "This show isn’t letting other computers join right now.",
        );
    }
    let show = inner.show_name();
    let show_id = lock(&inner.config).show_id.clone();
    let mine = KeyPair::new().map_err(|_| bad("keys"))?;
    let (public, nonce) = (mine.public, mine.nonce);
    let (session, stage) = match hello {
        Plain::PairHello { v, name, commit } => {
            if v != VERSION {
                return refuse(
                    &mut stream,
                    "version",
                    "Use the same version of Lumora on both computers.",
                );
            }
            if inner.locked_out(ip) {
                return refuse(
                    &mut stream,
                    "tooManyTries",
                    "Too many wrong codes. Wait a few minutes and try again.",
                );
            }
            let waiting = lock(&inner.conns)
                .values()
                .filter(|c| matches!(c.stage, Stage::Pending(_)))
                .count();
            if waiting >= MAX_PENDING {
                return refuse(
                    &mut stream,
                    "busy",
                    "Other computers are waiting to join. Try again in a minute.",
                );
            }
            send_plain(
                &mut stream,
                &Plain::PairChallenge {
                    key: crypto::hex(&public),
                    nonce: crypto::hex(&nonce),
                    show,
                    show_id,
                },
            )?;
            let Plain::PairOpen {
                key,
                nonce: seat_nonce,
            } = read_plain(&mut stream)?
            else {
                return Err(bad("expected pairOpen"));
            };
            let (key, seat_nonce, commit) = (
                crypto::unhex(&key).map_err(|_| bad("key"))?,
                crypto::unhex(&seat_nonce).map_err(|_| bad("nonce"))?,
                crypto::unhex(&commit).map_err(|_| bad("commit"))?,
            );
            if !crypto::same(&crypto::commitment(&key, &seat_nonce), &commit) {
                inner.wrong_try(ip);
                return Err(bad("commitment"));
            }
            let t = Transcript {
                seat_key: &key,
                seat_nonce: &seat_nonce,
                show_key: &public,
                show_nonce: &nonce,
            };
            let session = crypto::session(Side::Show, mine, &t, None).map_err(|_| bad("keys"))?;
            let code = session.code.clone();
            let name: String = name.chars().filter(|c| !c.is_control()).take(60).collect();
            (
                session,
                Stage::Pending(PendingSeat {
                    name: if name.trim().is_empty() {
                        "Another computer".to_owned()
                    } else {
                        name
                    },
                    code,
                    code_typed: false,
                    approved: None,
                    since: Instant::now(),
                }),
            )
        }
        Plain::ResumeHello {
            v,
            seat,
            key,
            nonce: seat_nonce,
            ..
        } => {
            if v != VERSION {
                return refuse(
                    &mut stream,
                    "version",
                    "Use the same version of Lumora on both computers.",
                );
            }
            let Some(record) = inner.seat(&seat) else {
                return refuse(
                    &mut stream,
                    "unknownSeat",
                    "This show doesn’t know this computer any more. Join again.",
                );
            };
            let connected = lock(&inner.conns).len();
            if connected >= MAX_CONNECTED {
                return refuse(
                    &mut stream,
                    "busy",
                    "Too many computers are connected to this show.",
                );
            }
            send_plain(
                &mut stream,
                &Plain::ResumeChallenge {
                    key: crypto::hex(&public),
                    nonce: crypto::hex(&nonce),
                    show,
                    show_id,
                },
            )?;
            let (key, seat_nonce) = (
                crypto::unhex(&key).map_err(|_| bad("key"))?,
                crypto::unhex(&seat_nonce).map_err(|_| bad("nonce"))?,
            );
            let secret = crypto::unhex(&record.secret).map_err(|_| bad("secret"))?;
            let t = Transcript {
                seat_key: &key,
                seat_nonce: &seat_nonce,
                show_key: &public,
                show_nonce: &nonce,
            };
            let session =
                crypto::session(Side::Show, mine, &t, Some(&secret)).map_err(|_| bad("keys"))?;
            (session, Stage::Seat(record.id))
        }
        _ => return Err(bad("expected hello")),
    };
    let crypto::Session {
        sealer, mut opener, ..
    } = session;
    // A resuming seat proves it has the secret with its first message.
    let first = if matches!(stage, Stage::Seat(_)) {
        match read_sealed(&mut stream, &mut opener) {
            Ok(m) => Some(m),
            Err(e) => {
                inner.wrong_try(ip);
                return Err(e);
            }
        }
    } else {
        None
    };
    drop(greeting);
    stream.set_read_timeout(Some(SILENT))?;
    let (tx, rx) = mpsc::sync_channel::<Out>(QUEUE);
    let backlog = Arc::new(AtomicUsize::new(0));
    let writer = {
        let w = stream.try_clone()?;
        let b = Arc::clone(&backlog);
        thread::Builder::new()
            .name("lumora-seat-writer".into())
            .spawn(move || write_loop(w, sealer, &rx, &b))?
    };
    let id = inner.next.fetch_add(1, Ordering::SeqCst);
    let resumed = match &stage {
        Stage::Seat(s) => Some(s.clone()),
        Stage::Pending(_) => None,
    };
    {
        let mut conns = lock(&inner.conns);
        // The same seat connected again (its old connection is gone): let the old one go.
        if let Some(seat) = &resumed {
            conns.retain(|_, c| {
                let old = matches!(&c.stage, Stage::Seat(s) if s == seat);
                if old {
                    c.close();
                }
                !old
            });
        }
        conns.insert(
            id,
            Conn {
                tx: tx.clone(),
                backlog: Arc::clone(&backlog),
                stream: stream.try_clone()?,
                ip,
                stage,
                synced: false,
                watch: HashSet::new(),
                sent: HashMap::new(),
                rtt: None,
                since: now_ms(),
                bucket: Bucket {
                    tokens: BURST,
                    at: Instant::now(),
                },
            },
        );
    }
    if let Some(seat) = &resumed {
        if let Some(record) = inner.seat(seat) {
            let welcome = ToSeat::Welcome {
                seat: view_of(&record),
                show: inner.show_name(),
                show_id: lock(&inner.config).show_id.clone(),
                secret: None,
            };
            if let Some(c) = lock(&inner.conns).get(&id) {
                c.send(&msg(&welcome));
            }
            inner.send_whole(id);
        }
    }
    inner.backend.changed();
    let result = read_loop(&mut stream, &mut opener, inner, id, ip, first, &tx);
    let was_seat = lock(&inner.conns).remove(&id).is_some();
    let _ = tx.try_send(Out::Close);
    drop(tx);
    let _ = stream.shutdown(Shutdown::Both);
    let _ = writer.join();
    if was_seat {
        inner.backend.changed();
    }
    result
}

fn read_loop(
    stream: &mut TcpStream,
    opener: &mut Opener,
    inner: &Arc<Inner>,
    id: u64,
    ip: IpAddr,
    first: Option<FromSeat>,
    tx: &SyncSender<Out>,
) -> io::Result<()> {
    let mut next = first;
    loop {
        let m = match next.take() {
            Some(m) => m,
            None => read_sealed(stream, opener)?,
        };
        let pending = {
            let conns = lock(&inner.conns);
            let Some(c) = conns.get(&id) else {
                return Ok(()); // removed or denied
            };
            match &c.stage {
                Stage::Pending(p) if p.since.elapsed() > PAIRING_WAIT => return Ok(()),
                Stage::Pending(p) => Some(p.code.clone()),
                Stage::Seat(_) => None,
            }
        };
        if let Some(code) = pending {
            match m {
                FromSeat::Confirm { code: typed } => {
                    if crypto::same(typed.as_bytes(), code.as_bytes()) {
                        if let Some(Conn {
                            stage: Stage::Pending(p),
                            ..
                        }) = lock(&inner.conns).get_mut(&id)
                        {
                            p.code_typed = true;
                        }
                        let _ = tx.try_send(Out::Msg(msg(&ToSeat::Waiting)));
                        inner.backend.changed();
                        inner.try_admit(id);
                    } else {
                        inner.wrong_try(ip);
                        return Ok(());
                    }
                }
                FromSeat::Ping { t, .. } => {
                    let _ = tx.try_send(Out::Msg(msg(&ToSeat::Pong { t })));
                }
                FromSeat::Leave => return Ok(()),
                _ => {}
            }
            continue;
        }
        if m == FromSeat::Leave {
            return Ok(());
        }
        if let Some(reply) = inner.request(id, m) {
            let text = msg(&reply);
            if let Some(c) = lock(&inner.conns).get(&id) {
                if !c.send(&text) {
                    c.close();
                }
            }
        }
    }
}

fn write_loop(mut w: TcpStream, mut sealer: Sealer, rx: &Receiver<Out>, backlog: &AtomicUsize) {
    while let Ok(out) = rx.recv() {
        let Out::Msg(plain) = out else { break };
        let _ = backlog.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |b| {
            Some(b.saturating_sub(1))
        });
        let ok = sealer
            .seal(&plain)
            .ok()
            .is_some_and(|sealed| wire::write_frame(&mut w, &sealed).is_ok());
        if !ok {
            break;
        }
    }
    let _ = w.shutdown(Shutdown::Both);
}
