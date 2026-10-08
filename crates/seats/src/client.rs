//! The joining computer's side: one link to one show.
//!
//! Pairs the first time (code typed by the person), then keeps itself
//! connected: if the network drops it tries again by itself (and looks for
//! the show again if its address changed) until the person leaves.

use std::collections::HashMap;
use std::io;
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::crypto::{self, KeyPair, Opener, Sealer, Side, Transcript};
use crate::discovery;
use crate::sync;
use crate::wire::{self, FromSeat, Plain, SeatView, ToSeat, MAX_FRAME, MAX_PLAIN, VERSION};

/// How long to wait for the show computer to answer a request.
const ANSWER: Duration = Duration::from_secs(5);
/// No word from the show for this long: the link is gone.
const SILENT: Duration = Duration::from_secs(5);
const PING: Duration = Duration::from_secs(1);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// What this computer keeps to reconnect without a new code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pairing {
    pub show_id: String,
    pub show: String,
    /// Where it was last found (`192.168.1.20:8097`).
    pub address: String,
    pub seat_id: String,
    /// Hex.
    pub secret: String,
    /// This computer's name, as the show operator sees it.
    pub name: String,
}

/// Where the link is, for the joining computer's screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LinkStatus {
    Idle,
    Connecting {
        address: String,
    },
    /// Type the code shown on the show computer. `wrong`: the last one typed wasn't it.
    EnterCode {
        show: String,
        wrong: bool,
    },
    /// The code was right; the show operator has to let this computer in.
    Waiting {
        show: String,
    },
    Connected {
        show: String,
        seat: SeatView,
        rtt_ms: Option<u32>,
    },
    /// The link dropped; trying again by itself.
    Reconnecting {
        show: String,
        tries: u32,
        problem: String,
    },
    /// Over (refused, removed, or could not reach the show).
    Ended {
        reason: String,
    },
}

/// What the link tells the app.
pub trait LinkEvents: Send + Sync + 'static {
    fn status(&self, status: &LinkStatus);
    /// The show document changed (see `sync::document`).
    fn document(&self, doc: &Value);
    fn picture(&self, key: &str, jpeg: &[u8]) {
        let _ = (key, jpeg);
    }
    fn meters(&self, meters: &Value) {
        let _ = meters;
    }
    /// Approved: keep this, to come back without a new code.
    fn paired(&self, pairing: &Pairing) {
        let _ = pairing;
    }
    /// The show forgot this computer: drop the pairing.
    fn forget(&self, show_id: &str) {
        let _ = show_id;
    }
}

struct Active {
    generation: u64,
    stream: TcpStream,
    sealer: Sealer,
}

struct Inner {
    events: Box<dyn LinkEvents>,
    status: Mutex<LinkStatus>,
    generation: AtomicU64,
    active: Mutex<Option<Active>>,
    /// While pairing: the code the show computer shows.
    code: Mutex<Option<(u64, String)>>,
    answers: Mutex<HashMap<u64, SyncSender<Result<(), String>>>>,
    next_id: AtomicU64,
    doc: Mutex<Option<(u64, Value)>>,
    watch: Mutex<Vec<String>>,
    rtt: Mutex<Option<u32>>,
}

/// The link to a show. Cheap to clone.
#[derive(Clone)]
pub struct SeatLink {
    inner: Arc<Inner>,
}

enum Mode {
    Pair { address: String, name: String },
    Resume(Pairing),
}

/// Why one connection ended.
enum End {
    /// Try again (the network, or the show computer restarted).
    Retry(String),
    /// Stop: refused, removed, left.
    Stop(String),
}

impl SeatLink {
    pub fn new(events: impl LinkEvents) -> SeatLink {
        SeatLink {
            inner: Arc::new(Inner {
                events: Box::new(events),
                status: Mutex::new(LinkStatus::Idle),
                generation: AtomicU64::new(0),
                active: Mutex::new(None),
                code: Mutex::new(None),
                answers: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                doc: Mutex::new(None),
                watch: Mutex::new(Vec::new()),
                rtt: Mutex::new(None),
            }),
        }
    }

    pub fn status(&self) -> LinkStatus {
        lock(&self.inner.status).clone()
    }

    /// The show as last received.
    pub fn document(&self) -> Option<Value> {
        lock(&self.inner.doc).as_ref().map(|(_, d)| d.clone())
    }

    /// Ask to join the show at `address` (it shows a code to type here).
    pub fn pair(&self, address: &str, name: &str) {
        let g = self.inner.restart();
        let mode = Mode::Pair {
            address: address.trim().to_owned(),
            name: name.trim().to_owned(),
        };
        let inner = Arc::clone(&self.inner);
        let _ = thread::Builder::new()
            .name("lumora-seat-link".into())
            .spawn(move || run(&inner, g, mode));
    }

    /// Join again with a pairing kept from before.
    pub fn resume(&self, pairing: Pairing) {
        let g = self.inner.restart();
        let inner = Arc::clone(&self.inner);
        let _ = thread::Builder::new()
            .name("lumora-seat-link".into())
            .spawn(move || run(&inner, g, Mode::Resume(pairing)));
    }

    /// The code the person typed. Checked here first: a wrong code is never sent.
    ///
    /// # Errors
    /// Not the code, or not pairing now.
    pub fn enter_code(&self, typed: &str) -> Result<(), String> {
        let Some(code) = crypto::clean_code(typed) else {
            return Err("Type the 6 digits shown on the show computer.".to_owned());
        };
        let expected = lock(&self.inner.code).clone();
        let Some((g, expected)) = expected else {
            return Err("Not joining a show right now.".to_owned());
        };
        if !crypto::same(code.as_bytes(), expected.as_bytes()) {
            let show = match self.status() {
                LinkStatus::EnterCode { show, .. } => show,
                _ => String::new(),
            };
            self.inner.set_status(LinkStatus::EnterCode {
                show: show.clone(),
                wrong: true,
            });
            return Err(
                "That isn’t the code on the show computer. Check it and type it again.".to_owned(),
            );
        }
        self.inner
            .send(g, &FromSeat::Confirm { code })
            .map_err(|_| "The show computer can’t be reached.".to_owned())?;
        *lock(&self.inner.code) = None;
        if let LinkStatus::EnterCode { show, .. } = self.status() {
            self.inner.set_status(LinkStatus::Waiting { show });
        }
        Ok(())
    }

    /// Leave the show (the pairing is kept, so joining again needs no code).
    pub fn leave(&self) {
        let g = self.inner.generation.load(Ordering::SeqCst);
        let _ = self.inner.send(g, &FromSeat::Leave);
        self.inner.restart();
        *lock(&self.inner.doc) = None;
        self.inner.set_status(LinkStatus::Idle);
    }

    /// Change the show (an engine action as JSON). Waits for the show's answer.
    ///
    /// # Errors
    /// The show computer said no (and why), or can't be reached.
    pub fn action(&self, action: Value) -> Result<(), String> {
        self.request(|id| FromSeat::Action { id, action })
    }

    /// Recording, streaming or replay on the show computer.
    ///
    /// # Errors
    /// As for [`SeatLink::action`].
    pub fn command(&self, command: Value) -> Result<(), String> {
        self.request(|id| FromSeat::Command { id, command })
    }

    /// Move a PTZ camera (the show computer talks to it).
    ///
    /// # Errors
    /// As for [`SeatLink::action`].
    pub fn ptz(&self, source: &str, command: Value) -> Result<(), String> {
        let source = source.to_owned();
        self.request(|id| FromSeat::Ptz {
            id,
            source,
            command,
        })
    }

    /// The pictures and levels to receive (`program/live`, `next/live`, `source/<id>`, `meters`).
    pub fn watch(&self, keys: Vec<String>) {
        *lock(&self.inner.watch) = keys.clone();
        let g = self.inner.generation.load(Ordering::SeqCst);
        let _ = self.inner.send(g, &FromSeat::Watch { keys });
    }

    fn request(&self, make: impl FnOnce(u64) -> FromSeat) -> Result<(), String> {
        if !matches!(self.status(), LinkStatus::Connected { .. }) {
            return Err("Not connected to the show right now.".to_owned());
        }
        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::sync_channel(1);
        lock(&self.inner.answers).insert(id, tx);
        let g = self.inner.generation.load(Ordering::SeqCst);
        if self.inner.send(g, &make(id)).is_err() {
            lock(&self.inner.answers).remove(&id);
            return Err("The show computer can’t be reached.".to_owned());
        }
        let r = rx
            .recv_timeout(ANSWER)
            .unwrap_or_else(|_| Err("The show computer didn’t answer in time.".to_owned()));
        lock(&self.inner.answers).remove(&id);
        r
    }
}

impl Inner {
    /// Stop whatever link was running; a new one gets the returned number.
    fn restart(&self) -> u64 {
        let g = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(a) = lock(&self.active).take() {
            let _ = a.stream.shutdown(Shutdown::Both);
        }
        *lock(&self.code) = None;
        for (_, tx) in lock(&self.answers).drain() {
            let _ = tx.try_send(Err("The link to the show ended.".to_owned()));
        }
        g
    }

    fn current(&self, g: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == g
    }

    fn set_status(&self, s: LinkStatus) {
        {
            let mut cur = lock(&self.status);
            if *cur == s {
                return;
            }
            cur.clone_from(&s);
        }
        self.events.status(&s);
    }

    fn set_status_if(&self, g: u64, s: LinkStatus) {
        if self.current(g) {
            self.set_status(s);
        }
    }

    fn send(&self, g: u64, m: &FromSeat) -> io::Result<()> {
        let text = serde_json::to_vec(m).unwrap_or_default();
        let mut active = lock(&self.active);
        let a = active
            .as_mut()
            .filter(|a| a.generation == g)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "not connected"))?;
        let sealed = a
            .sealer
            .seal(&text)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "seal"))?;
        let r = wire::write_frame(&mut a.stream, &sealed);
        if r.is_err() {
            let _ = a.stream.shutdown(Shutdown::Both);
        }
        r
    }
}

fn connect(address: &str) -> io::Result<TcpStream> {
    let addr: SocketAddr = discovery::parse_address(address)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
    let s = TcpStream::connect_timeout(&addr, Duration::from_secs(3))?;
    s.set_nodelay(true)?;
    s.set_read_timeout(Some(Duration::from_secs(10)))?;
    s.set_write_timeout(Some(Duration::from_secs(3)))?;
    Ok(s)
}

fn read_plain(s: &mut TcpStream) -> io::Result<Plain> {
    let f = wire::read_frame(s, MAX_PLAIN)?;
    serde_json::from_slice(&f).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

fn send_plain(s: &mut TcpStream, m: &Plain) -> io::Result<()> {
    wire::write_frame(s, &serde_json::to_vec(m).unwrap_or_default())
}

fn unhex(t: &str) -> io::Result<Vec<u8>> {
    crypto::unhex(t).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "hex"))
}

fn problem(e: &io::Error) -> String {
    match e.kind() {
        io::ErrorKind::ConnectionRefused => {
            "The show computer isn’t letting computers join (or Lumora is closed there).".to_owned()
        }
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => {
            "The show computer isn’t answering.".to_owned()
        }
        io::ErrorKind::InvalidInput => e.to_string(),
        _ => "The network connection to the show computer dropped.".to_owned(),
    }
}

/// The link's thread: connect, pair or resume, then keep reconnecting.
fn run(inner: &Arc<Inner>, g: u64, mode: Mode) {
    let mut pairing = match mode {
        Mode::Pair { address, name } => {
            inner.set_status_if(
                g,
                LinkStatus::Connecting {
                    address: address.clone(),
                },
            );
            match pair_once(inner, g, &address, &name) {
                Ok(Some(p)) => p,
                Ok(None) => return,
                Err(End::Stop(reason) | End::Retry(reason)) => {
                    inner.set_status_if(g, LinkStatus::Ended { reason });
                    return;
                }
            }
        }
        Mode::Resume(p) => p,
    };
    let mut tries = 0u32;
    while inner.current(g) {
        if tries == 0 {
            inner.set_status_if(
                g,
                LinkStatus::Connecting {
                    address: pairing.address.clone(),
                },
            );
        }
        match resume_once(inner, g, &pairing) {
            Ok(connected) => {
                if connected {
                    tries = 0;
                }
            }
            Err(End::Stop(reason)) => {
                inner.set_status_if(g, LinkStatus::Ended { reason });
                return;
            }
            Err(End::Retry(problem)) => {
                // A link that was up and dropped starts counting again.
                tries = if matches!(*lock(&inner.status), LinkStatus::Connected { .. }) {
                    1
                } else {
                    tries + 1
                };
                inner.set_status_if(
                    g,
                    LinkStatus::Reconnecting {
                        show: pairing.show.clone(),
                        tries,
                        problem,
                    },
                );
            }
        }
        if !inner.current(g) {
            return;
        }
        // The show computer's address may have changed (a new network, DHCP).
        if tries > 0 && tries.is_multiple_of(3) {
            if let Some(found) = discovery::discover(Duration::from_millis(900))
                .into_iter()
                .find(|f| f.id == pairing.show_id)
            {
                if found.address != pairing.address {
                    pairing.address = found.address;
                    inner.events.paired(&pairing);
                }
            }
        }
        let wait = [250u64, 500, 1000, 2000, 3000]
            .get(tries as usize)
            .copied()
            .unwrap_or(4000);
        let until = Instant::now() + Duration::from_millis(wait);
        while Instant::now() < until && inner.current(g) {
            thread::sleep(Duration::from_millis(50));
        }
    }
}

/// Pair: `Ok(Some)` once approved and then disconnected (resume from here),
/// `Ok(None)` when the person left.
fn pair_once(
    inner: &Arc<Inner>,
    g: u64,
    address: &str,
    name: &str,
) -> Result<Option<Pairing>, End> {
    let mut s = connect(address).map_err(|e| End::Stop(problem(&e)))?;
    let mine =
        KeyPair::new().map_err(|_| End::Stop("This computer could not make a key.".to_owned()))?;
    let (public, nonce) = (mine.public, mine.nonce);
    let io_stop = |e: io::Error| End::Stop(problem(&e));
    send_plain(
        &mut s,
        &Plain::PairHello {
            v: VERSION,
            name: name.to_owned(),
            commit: crypto::hex(&mine.commitment()),
        },
    )
    .map_err(io_stop)?;
    let (show_key, show_nonce, show, show_id) = match read_plain(&mut s).map_err(io_stop)? {
        Plain::PairChallenge {
            key,
            nonce,
            show,
            show_id,
        } => (
            unhex(&key).map_err(io_stop)?,
            unhex(&nonce).map_err(io_stop)?,
            show,
            show_id,
        ),
        Plain::Refused { message, .. } => return Err(End::Stop(message)),
        _ => {
            return Err(End::Stop(
                "The show computer answered something unexpected.".to_owned(),
            ))
        }
    };
    send_plain(
        &mut s,
        &Plain::PairOpen {
            key: crypto::hex(&public),
            nonce: crypto::hex(&nonce),
        },
    )
    .map_err(io_stop)?;
    let t = Transcript {
        seat_key: &public,
        seat_nonce: &nonce,
        show_key: &show_key,
        show_nonce: &show_nonce,
    };
    let session = crypto::session(Side::Seat, mine, &t, None)
        .map_err(|_| End::Stop("The secure link failed.".to_owned()))?;
    let crypto::Session {
        sealer,
        opener,
        code,
    } = session;
    install(inner, g, &s, sealer).map_err(io_stop)?;
    *lock(&inner.code) = Some((g, code));
    inner.set_status_if(
        g,
        LinkStatus::EnterCode {
            show: show.clone(),
            wrong: false,
        },
    );
    let mut paired: Option<Pairing> = None;
    let ctx = PairCtx {
        address,
        name,
        show_id: &show_id,
    };
    let end = listen(
        inner,
        g,
        s,
        opener,
        (&show, &show_id),
        Some(&ctx),
        &mut paired,
    );
    match (end, paired) {
        (End::Stop(reason), _) if !reason.is_empty() => Err(End::Stop(reason)),
        (_, Some(p)) => Ok(Some(p)),
        (End::Retry(reason), None) => Err(End::Stop(if reason.is_empty() {
            "The show computer ended the request.".to_owned()
        } else {
            reason
        })),
        (End::Stop(_), None) => Ok(None),
    }
}

struct PairCtx<'a> {
    address: &'a str,
    name: &'a str,
    show_id: &'a str,
}

/// One connection with a kept pairing. `Ok(true)`: it connected (and later dropped).
fn resume_once(inner: &Arc<Inner>, g: u64, p: &Pairing) -> Result<bool, End> {
    let retry = |e: io::Error| End::Retry(problem(&e));
    let mut s = connect(&p.address).map_err(retry)?;
    let mine =
        KeyPair::new().map_err(|_| End::Stop("This computer could not make a key.".to_owned()))?;
    let (public, nonce) = (mine.public, mine.nonce);
    send_plain(
        &mut s,
        &Plain::ResumeHello {
            v: VERSION,
            name: p.name.clone(),
            seat: p.seat_id.clone(),
            key: crypto::hex(&public),
            nonce: crypto::hex(&nonce),
        },
    )
    .map_err(retry)?;
    let (show_key, show_nonce, show_id) = match read_plain(&mut s).map_err(retry)? {
        Plain::ResumeChallenge {
            key,
            nonce,
            show_id,
            ..
        } => (
            unhex(&key).map_err(retry)?,
            unhex(&nonce).map_err(retry)?,
            show_id,
        ),
        Plain::Refused { code, message } => {
            if code == "unknownSeat" {
                inner.events.forget(&p.show_id);
                return Err(End::Stop(message));
            }
            if code == "version" {
                return Err(End::Stop(message));
            }
            return Err(End::Retry(message));
        }
        _ => {
            return Err(End::Retry(
                "The show computer answered something unexpected.".to_owned(),
            ))
        }
    };
    if show_id != p.show_id {
        // Another show computer is at this address now.
        return Err(End::Retry(
            "A different show is at this address now. Looking for yours…".to_owned(),
        ));
    }
    let secret = unhex(&p.secret)
        .map_err(|_| End::Stop("This computer’s pairing is damaged. Join again.".to_owned()))?;
    let t = Transcript {
        seat_key: &public,
        seat_nonce: &nonce,
        show_key: &show_key,
        show_nonce: &show_nonce,
    };
    let session = crypto::session(Side::Seat, mine, &t, Some(&secret))
        .map_err(|_| End::Retry("The secure link failed.".to_owned()))?;
    let crypto::Session { sealer, opener, .. } = session;
    install(inner, g, &s, sealer).map_err(retry)?;
    // The first message proves this computer has the seat's secret.
    inner
        .send(
            g,
            &FromSeat::Ping {
                t: now_ms(),
                rtt: None,
            },
        )
        .map_err(retry)?;
    let mut none = None;
    match listen(inner, g, s, opener, (&p.show, &p.show_id), None, &mut none) {
        End::Retry(problem) => {
            if inner.current(g) {
                Err(End::Retry(problem))
            } else {
                Ok(true)
            }
        }
        End::Stop(reason) if reason.is_empty() => Ok(true),
        End::Stop(reason) => Err(End::Stop(reason)),
    }
}

fn install(inner: &Inner, g: u64, s: &TcpStream, sealer: Sealer) -> io::Result<()> {
    if !inner.current(g) {
        return Err(io::Error::new(io::ErrorKind::Interrupted, "left"));
    }
    *lock(&inner.active) = Some(Active {
        generation: g,
        stream: s.try_clone()?,
        sealer,
    });
    Ok(())
}

/// Read until the connection ends. `End::Stop("")`: the person left.
fn listen(
    inner: &Arc<Inner>,
    g: u64,
    mut s: TcpStream,
    mut opener: Opener,
    (show, show_id): (&str, &str),
    pairing: Option<&PairCtx<'_>>,
    paired: &mut Option<Pairing>,
) -> End {
    let _ = s.set_read_timeout(Some(SILENT));
    // Pings every second (the show answers, so silence means the link is gone).
    let pinger = {
        let inner = Arc::clone(inner);
        thread::Builder::new()
            .name("lumora-seat-ping".into())
            .spawn(move || {
                while inner.current(g) {
                    thread::sleep(PING);
                    let rtt = *lock(&inner.rtt);
                    if inner.send(g, &FromSeat::Ping { t: now_ms(), rtt }).is_err() {
                        break;
                    }
                }
            })
    };
    let mut seat_view: Option<SeatView> = None;
    let mut show_name = show.to_owned();
    let end = loop {
        if !inner.current(g) {
            break End::Stop(String::new());
        }
        let frame = match wire::read_frame(&mut s, MAX_FRAME) {
            Ok(f) => f,
            Err(e) => {
                break if inner.current(g) {
                    End::Retry(problem(&e))
                } else {
                    End::Stop(String::new())
                }
            }
        };
        let Ok(plain) = opener.open(&frame) else {
            break End::Retry("The secure link failed.".to_owned());
        };
        let Ok(m) = serde_json::from_slice::<ToSeat>(&plain) else {
            continue;
        };
        match m {
            ToSeat::Waiting => inner.set_status_if(
                g,
                LinkStatus::Waiting {
                    show: show_name.clone(),
                },
            ),
            ToSeat::Welcome {
                seat,
                show,
                show_id,
                secret,
            } => {
                show_name.clone_from(&show);
                if let (Some(secret), Some(ctx)) = (secret, pairing) {
                    let p = Pairing {
                        show_id: if show_id.is_empty() {
                            ctx.show_id.to_owned()
                        } else {
                            show_id
                        },
                        show: show.clone(),
                        address: ctx.address.to_owned(),
                        seat_id: seat.id.clone(),
                        secret,
                        name: ctx.name.to_owned(),
                    };
                    inner.events.paired(&p);
                    *paired = Some(p);
                }
                seat_view = Some(seat.clone());
                inner.set_status_if(
                    g,
                    LinkStatus::Connected {
                        show,
                        seat,
                        rtt_ms: *lock(&inner.rtt),
                    },
                );
                let keys = lock(&inner.watch).clone();
                if !keys.is_empty() {
                    let _ = inner.send(g, &FromSeat::Watch { keys });
                }
            }
            ToSeat::State { rev, doc } => {
                inner.events.document(&doc);
                *lock(&inner.doc) = Some((rev, doc));
            }
            ToSeat::Diff { base, rev, ops } => {
                let applied = {
                    let mut d = lock(&inner.doc);
                    match d.as_mut() {
                        Some((r, doc)) if *r == base => {
                            if sync::apply(doc, &ops).is_ok() {
                                *r = rev;
                                Some(doc.clone())
                            } else {
                                None
                            }
                        }
                        _ => None,
                    }
                };
                match applied {
                    Some(doc) => inner.events.document(&doc),
                    None => {
                        *lock(&inner.doc) = None;
                        let _ = inner.send(g, &FromSeat::Resync);
                    }
                }
            }
            ToSeat::Seat { seat } => {
                seat_view = Some(seat.clone());
                inner.set_status_if(
                    g,
                    LinkStatus::Connected {
                        show: show_name.clone(),
                        seat,
                        rtt_ms: *lock(&inner.rtt),
                    },
                );
            }
            ToSeat::Result { id, ok, error, .. } => {
                if let Some(tx) = lock(&inner.answers).remove(&id) {
                    let _ = tx.try_send(if ok {
                        Ok(())
                    } else {
                        Err(error.unwrap_or_else(|| "The show computer said no.".to_owned()))
                    });
                }
            }
            ToSeat::Preview { key, jpeg } => {
                if let Ok(bytes) = wire::unbase64(&jpeg) {
                    inner.events.picture(&key, &bytes);
                }
            }
            ToSeat::Meters { meters } => inner.events.meters(&meters),
            ToSeat::Pong { t } => {
                let rtt = u32::try_from(now_ms().saturating_sub(t)).unwrap_or(u32::MAX);
                let before = lock(&inner.rtt).replace(rtt);
                // Shown when it moves noticeably.
                if before.is_none_or(|b| b.abs_diff(rtt) > 5) {
                    if let Some(seat) = &seat_view {
                        inner.set_status_if(
                            g,
                            LinkStatus::Connected {
                                show: show_name.clone(),
                                seat: seat.clone(),
                                rtt_ms: Some(rtt),
                            },
                        );
                    }
                }
            }
            ToSeat::Bye { reason, forget } => {
                if forget {
                    let id = paired
                        .as_ref()
                        .map_or(show_id, |p| p.show_id.as_str())
                        .to_owned();
                    inner.events.forget(&id);
                    *paired = None;
                    break End::Stop(reason);
                }
                break End::Retry(reason);
            }
        }
    };
    {
        let mut a = lock(&inner.active);
        if a.as_ref().is_some_and(|a| a.generation == g) {
            if let Some(a) = a.take() {
                let _ = a.stream.shutdown(Shutdown::Both);
            }
        }
    }
    let _ = s.shutdown(Shutdown::Both);
    for (_, tx) in lock(&inner.answers).drain() {
        let _ = tx.try_send(Err("The link to the show dropped.".to_owned()));
    }
    *lock(&inner.rtt) = None;
    if let Ok(p) = pinger {
        let _ = p.join();
    }
    end
}
