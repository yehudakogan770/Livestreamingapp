//! The control API, for pro control gear: Bitfocus Companion (Stream Deck,
//! X-keys, Loupedeck), tally lights, show-control systems and scripts.
//!
//! - HTTP on its own port: `GET /api/do/take?screen=live`, `GET /api/tally`,
//!   `GET /api/tally/3` (`program`, `preview` or `off`), `GET /api/state`.
//! - A WebSocket at `/api/ws` on the same port: send commands as JSON
//!   (`{"cmd":"take","screen":"live","id":"1"}`), get the tally and what is
//!   running pushed the moment they change.
//! - OSC over UDP: `/lumora/take`, `/lumora/preview 3`, `/lumora/overlay 2 1`.
//!
//! Everything but OSC needs the token (`Authorization: Bearer …`,
//! `X-Lumora-Token: …` or `?token=…`). OSC has no way to carry one, so by
//! default it only listens to this computer (where Companion usually runs).
//! The commands are the same as the phone remote's (`control.rs`); see
//! docs/API.md.

use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Shutdown, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use lumora_engine::action::Action;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::control::{self, Target};
use crate::remote::AppCommand;
use crate::store::write_file_atomic;

/// The HTTP and WebSocket port (vMix uses 8088, Companion 8000).
pub const DEFAULT_PORT: u16 = 8095;
/// The OSC port.
pub const DEFAULT_OSC_PORT: u16 = 8096;
const FILE: &str = "control-api.json";
/// Longest request head and body.
const MAX_HEAD: usize = 16 * 1024;
const MAX_BODY: usize = 64 * 1024;
/// Longest WebSocket message.
const MAX_MESSAGE: u64 = 64 * 1024;
/// Messages waiting for one WebSocket client; one this far behind is let go.
const CLIENT_QUEUE: usize = 64;
/// How often a WebSocket client is pinged (and a dead one noticed).
const PING: Duration = Duration::from_secs(15);
const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What the API needs from the app.
pub trait ApiBackend: Send + Sync + 'static {
    /// The show as JSON (`None`: still starting).
    fn show(&self) -> Option<Value>;
    /// Change the show.
    ///
    /// # Errors
    /// Why the engine refused.
    fn apply(&self, action: Action) -> Result<(), String>;
    /// Pass a recording / stream / replay request to the control window.
    ///
    /// # Errors
    /// The control window can't be reached.
    fn app_command(&self, command: AppCommand) -> Result<(), String>;
}

/// The settings, remembered between starts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ApiConfig {
    /// HTTP and WebSocket on.
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    /// OSC on.
    pub osc: bool,
    pub osc_port: u16,
    /// OSC only from this computer.
    pub osc_local_only: bool,
}

impl Default for ApiConfig {
    fn default() -> Self {
        ApiConfig {
            enabled: false,
            port: DEFAULT_PORT,
            token: new_token(),
            osc: false,
            osc_port: DEFAULT_OSC_PORT,
            osc_local_only: true,
        }
    }
}

impl ApiConfig {
    fn cleaned(mut self) -> Self {
        if self.token.len() < 16 || !self.token.bytes().all(|b| b.is_ascii_alphanumeric()) {
            self.token = new_token();
        }
        if self.port < 1024 {
            self.port = DEFAULT_PORT;
        }
        if self.osc_port < 1024 {
            self.osc_port = DEFAULT_OSC_PORT;
        }
        self
    }
}

/// How the API is doing, for the settings.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStatus {
    #[serde(flatten)]
    pub config: ApiConfig,
    /// HTTP and WebSocket are listening.
    pub running: bool,
    pub osc_running: bool,
    /// WebSocket clients connected now (Companion, tally boxes…).
    pub clients: usize,
    /// Where other computers reach it (`http://192.168.1.20:8095`).
    pub addresses: Vec<String>,
    /// Why it could not start.
    pub error: Option<String>,
}

/// A new random token (32 letters and digits).
#[must_use]
pub fn new_token() -> String {
    let mut out = String::with_capacity(32);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    while out.len() < 32 {
        // Each RandomState is keyed from the operating system's random numbers.
        let mut h = RandomState::new().build_hasher();
        h.write_u128(nanos);
        h.write_usize(out.len());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out.truncate(32);
    out
}

/// The token a request carries: `Authorization: Bearer …`, `X-Lumora-Token`,
/// or `token=` in the address.
pub fn token_from<'a>(
    headers: impl Iterator<Item = (&'a str, &'a str)>,
    query: &str,
) -> Option<String> {
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("x-lumora-token") {
            return Some(value.trim().to_owned());
        }
        if name.eq_ignore_ascii_case("authorization") {
            let v = value.trim();
            if v.len() > 7 && v[..7].eq_ignore_ascii_case("bearer ") {
                return Some(v[7..].trim().to_owned());
            }
        }
    }
    control::parse_query(query)
        .into_iter()
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v)
}

/// Equal, taking the same time whichever character differs.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

// ---------------------------------------------------------------------------
// SHA-1 and Base64, for the WebSocket handshake only (RFC 6455 asks for them).

fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [
        0x6745_2301,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];
    let mut msg = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for (i, word) in chunk.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let t = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e]) {
            *x = x.wrapping_add(y);
        }
    }
    let mut out = [0u8; 20];
    for (i, x) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&x.to_be_bytes());
    }
    out
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (u32::from(c[0]) << 16)
            | (u32::from(*c.get(1).unwrap_or(&0)) << 8)
            | u32::from(*c.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= c.len() {
                out.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// The `Sec-WebSocket-Accept` answer to a client's key.
#[must_use]
pub fn ws_accept(key: &str) -> String {
    base64(&sha1(format!("{}{WS_GUID}", key.trim()).as_bytes()))
}

// ---------------------------------------------------------------------------
// WebSocket frames

/// A frame to send.
#[derive(Debug, Clone, PartialEq)]
enum Out {
    Text(String),
    Pong(Vec<u8>),
    Ping,
    Close,
}

fn frame(opcode: u8, payload: &[u8]) -> Vec<u8> {
    let mut f = vec![0x80 | opcode];
    let n = payload.len();
    if n < 126 {
        f.push(n as u8);
    } else if n <= 0xFFFF {
        f.push(126);
        f.extend_from_slice(&(n as u16).to_be_bytes());
    } else {
        f.push(127);
        f.extend_from_slice(&(n as u64).to_be_bytes());
    }
    f.extend_from_slice(payload);
    f
}

fn encode(out: &Out) -> Vec<u8> {
    match out {
        Out::Text(t) => frame(0x1, t.as_bytes()),
        Out::Pong(p) => frame(0xA, p),
        Out::Ping => frame(0x9, b""),
        Out::Close => frame(0x8, &1000u16.to_be_bytes()),
    }
}

/// One frame from a client: (fin, opcode, payload unmasked).
fn read_frame(r: &mut impl Read) -> std::io::Result<(bool, u8, Vec<u8>)> {
    let mut head = [0u8; 2];
    r.read_exact(&mut head)?;
    let fin = head[0] & 0x80 != 0;
    let opcode = head[0] & 0x0F;
    let masked = head[1] & 0x80 != 0;
    let mut len = u64::from(head[1] & 0x7F);
    if len == 126 {
        let mut b = [0u8; 2];
        r.read_exact(&mut b)?;
        len = u64::from(u16::from_be_bytes(b));
    } else if len == 127 {
        let mut b = [0u8; 8];
        r.read_exact(&mut b)?;
        len = u64::from_be_bytes(b);
    }
    if len > MAX_MESSAGE {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "too long",
        ));
    }
    let mut mask = [0u8; 4];
    if masked {
        r.read_exact(&mut mask)?;
    }
    let mut payload = vec![0u8; usize::try_from(len).unwrap_or(0)];
    r.read_exact(&mut payload)?;
    if masked {
        for (i, b) in payload.iter_mut().enumerate() {
            *b ^= mask[i % 4];
        }
    }
    Ok((fin, opcode, payload))
}

// ---------------------------------------------------------------------------
// OSC

/// One OSC argument.
#[derive(Debug, Clone, PartialEq)]
pub enum OscArg {
    Int(i32),
    Float(f32),
    Str(String),
    Bool(bool),
}

impl OscArg {
    fn text(&self) -> String {
        match self {
            OscArg::Int(i) => i.to_string(),
            OscArg::Float(f) if f.fract() == 0.0 && f.abs() < 1e9 => format!("{f:.0}"),
            OscArg::Float(f) => f.to_string(),
            OscArg::Str(s) => s.clone(),
            OscArg::Bool(b) => if *b { "on" } else { "off" }.to_owned(),
        }
    }
}

fn osc_string(b: &[u8], at: &mut usize) -> Option<String> {
    let rest = b.get(*at..)?;
    let end = rest.iter().position(|&c| c == 0)?;
    let s = std::str::from_utf8(&rest[..end]).ok()?.to_owned();
    *at += (end + 4) & !3;
    Some(s)
}

fn osc_u32(b: &[u8], at: &mut usize) -> Option<[u8; 4]> {
    let v = b.get(*at..*at + 4)?;
    *at += 4;
    Some([v[0], v[1], v[2], v[3]])
}

/// The messages in an OSC packet (bundles are opened, up to a few levels).
#[must_use]
pub fn parse_osc(b: &[u8]) -> Vec<(String, Vec<OscArg>)> {
    let mut out = Vec::new();
    parse_osc_into(b, &mut out, 0);
    out
}

fn parse_osc_into(b: &[u8], out: &mut Vec<(String, Vec<OscArg>)>, depth: u8) {
    if depth > 4 || out.len() > 64 {
        return;
    }
    if b.starts_with(b"#bundle\0") {
        let mut at = 16; // "#bundle\0" and the time tag
        while let Some(size) = osc_u32(b, &mut at) {
            let size = u32::from_be_bytes(size) as usize;
            let Some(el) = b.get(at..at + size) else {
                return;
            };
            parse_osc_into(el, out, depth + 1);
            at += size;
        }
        return;
    }
    let mut at = 0;
    let Some(address) = osc_string(b, &mut at) else {
        return;
    };
    if !address.starts_with('/') {
        return;
    }
    let tags = if b.get(at) == Some(&b',') {
        osc_string(b, &mut at).unwrap_or_default()
    } else {
        String::new()
    };
    let mut args = Vec::new();
    for t in tags.chars().skip(1) {
        let arg = match t {
            'i' => osc_u32(b, &mut at).map(|v| OscArg::Int(i32::from_be_bytes(v))),
            'f' => osc_u32(b, &mut at).map(|v| OscArg::Float(f32::from_be_bytes(v))),
            's' | 'S' => osc_string(b, &mut at).map(OscArg::Str),
            'T' => Some(OscArg::Bool(true)),
            'F' => Some(OscArg::Bool(false)),
            'N' | 'I' => continue,
            _ => None,
        };
        match arg {
            Some(a) => args.push(a),
            None => break,
        }
    }
    out.push((address, args));
}

/// The command an OSC message stands for: `/lumora/<command>` with values
/// as further address parts or arguments. `key=value` strings are named;
/// other values fill the command's main parameter, then `state`.
#[must_use]
pub fn osc_command(address: &str, args: &[OscArg]) -> Option<(String, Vec<(String, String)>)> {
    let mut parts = address.trim_matches('/').split('/');
    if !parts.next()?.eq_ignore_ascii_case("lumora") {
        return None;
    }
    let cmd = parts.next().filter(|c| !c.is_empty())?.to_ascii_lowercase();
    let mut values: Vec<String> = parts
        .map(|p| control::parse_query(&format!("x={p}"))[0].1.clone())
        .collect();
    let mut pairs = Vec::new();
    for a in args {
        let t = a.text();
        match t.split_once('=') {
            Some((k, v)) if !k.is_empty() && !k.contains(' ') => {
                pairs.push((k.to_owned(), v.to_owned()))
            }
            _ => values.push(t),
        }
    }
    let main = control::main_key(&cmd);
    let mut keys = [main, if main == "state" { "screen" } else { "state" }].into_iter();
    for v in values {
        if let Some(k) = keys.next() {
            if !pairs.iter().any(|(pk, _)| pk == k) {
                pairs.push((k.to_owned(), v));
            }
        }
    }
    Some((cmd, pairs))
}

// ---------------------------------------------------------------------------
// The server

struct Client {
    id: u64,
    tx: SyncSender<Out>,
    stream: TcpStream,
}

struct Inner {
    backend: Box<dyn ApiBackend>,
    token: Mutex<String>,
    app_state: Mutex<Value>,
    /// The show as last seen (kept only while WebSocket clients listen).
    show: Mutex<Option<Value>>,
    last_tally: Mutex<String>,
    clients: Mutex<Vec<Client>>,
    next_client: AtomicU64,
    /// Wrong tokens per address, so guessing is slow.
    guesses: Mutex<HashMap<IpAddr, (u32, Instant)>>,
}

impl Target for Inner {
    fn show(&self) -> Option<Value> {
        self.backend.show()
    }
    fn app_state(&self) -> Value {
        lock(&self.app_state).clone()
    }
    fn apply(&self, action: Action) -> Result<(), String> {
        self.backend.apply(action)
    }
    fn app_command(&self, command: AppCommand) -> Result<(), String> {
        self.backend.app_command(command)
    }
}

impl Inner {
    fn tally(&self, show: &Value) -> Value {
        control::tally(show, &lock(&self.app_state))
    }

    fn state(&self, show: &Value) -> Value {
        json!({"type": "state", "tally": self.tally(show), "app": *lock(&self.app_state)})
    }

    fn send_all(&self, text: &str) {
        lock(&self.clients).retain(|c| {
            let ok = c.tx.try_send(Out::Text(text.to_owned())).is_ok();
            if !ok {
                let _ = c.stream.shutdown(Shutdown::Both);
            }
            ok
        });
    }

    /// Tell clients the tally if it changed.
    fn push_tally(&self) {
        let Some(show) = lock(&self.show).clone() else {
            return;
        };
        let tally = self.tally(&show);
        let text = json!({"type": "tally", "tally": tally}).to_string();
        {
            let mut last = lock(&self.last_tally);
            if *last == text {
                return;
            }
            last.clone_from(&text);
        }
        self.send_all(&text);
    }

    fn token_ok(&self, given: Option<&str>) -> bool {
        let token = lock(&self.token).clone();
        given.is_some_and(|g| token.len() >= 16 && same(g.as_bytes(), token.as_bytes()))
    }

    /// 401 or 429 for a wrong token, slowly; `None` when it is right.
    fn check(&self, ip: IpAddr, given: Option<&str>) -> Option<u16> {
        let now = Instant::now();
        if let Some(&(wrong, last)) = lock(&self.guesses).get(&ip) {
            if wrong >= 5 && now.duration_since(last) < Duration::from_secs(30) {
                return Some(429);
            }
        }
        if self.token_ok(given) {
            lock(&self.guesses).remove(&ip);
            return None;
        }
        {
            let mut g = lock(&self.guesses);
            g.retain(|_, (_, last)| now.duration_since(*last) < Duration::from_secs(600));
            let e = g.entry(ip).or_insert((0, now));
            *e = (e.0.saturating_add(1), now);
        }
        thread::sleep(Duration::from_millis(300));
        Some(401)
    }
}

struct Running {
    stop: Arc<AtomicBool>,
    port: u16,
}

struct OscRunning {
    stop: Arc<AtomicBool>,
}

/// The control API. Create one with [`Api::new`]; it starts by itself if it
/// was on last time.
pub struct Api {
    dir: Option<PathBuf>,
    config: Mutex<ApiConfig>,
    inner: Arc<Inner>,
    running: Mutex<Option<Running>>,
    osc: Mutex<Option<OscRunning>>,
    error: Mutex<Option<String>>,
}

impl Api {
    /// `dir`: where the settings are kept (`None`: not saved, for tests).
    pub fn new(dir: Option<&Path>, backend: impl ApiBackend) -> Api {
        let config = dir
            .and_then(|d| std::fs::read_to_string(d.join(FILE)).ok())
            .and_then(|t| serde_json::from_str::<ApiConfig>(&t).ok())
            .unwrap_or_default()
            .cleaned();
        let api = Api {
            dir: dir.map(Path::to_path_buf),
            inner: Arc::new(Inner {
                backend: Box::new(backend),
                token: Mutex::new(config.token.clone()),
                app_state: Mutex::new(json!({})),
                show: Mutex::new(None),
                last_tally: Mutex::new(String::new()),
                clients: Mutex::new(Vec::new()),
                next_client: AtomicU64::new(1),
                guesses: Mutex::new(HashMap::new()),
            }),
            config: Mutex::new(config),
            running: Mutex::new(None),
            osc: Mutex::new(None),
            error: Mutex::new(None),
        };
        api.save();
        api.apply_config();
        api
    }

    pub fn token(&self) -> String {
        lock(&self.config).token.clone()
    }

    pub fn status(&self) -> ApiStatus {
        let config = lock(&self.config).clone();
        let running = lock(&self.running).as_ref().map(|r| r.port);
        ApiStatus {
            running: running.is_some(),
            osc_running: lock(&self.osc).is_some(),
            clients: lock(&self.inner.clients).len(),
            addresses: running.map(addresses).unwrap_or_default(),
            error: lock(&self.error).clone(),
            config,
        }
    }

    /// Change the settings (the token is kept; see [`Api::new_token`]).
    pub fn set(&self, mut config: ApiConfig) -> ApiStatus {
        config.token = self.token();
        let config = config.cleaned();
        let before = std::mem::replace(&mut *lock(&self.config), config);
        self.save();
        let now = lock(&self.config).clone();
        if before.port != now.port || before.enabled != now.enabled {
            self.stop_http();
        }
        if before.osc_port != now.osc_port
            || before.osc != now.osc
            || before.osc_local_only != now.osc_local_only
        {
            self.stop_osc();
        }
        self.apply_config();
        self.status()
    }

    /// A new token: everything using the old one must be given the new one.
    pub fn new_token(&self) -> ApiStatus {
        let t = new_token();
        lock(&self.config).token.clone_from(&t);
        *lock(&self.inner.token) = t;
        self.save();
        // Connected clients used the old token.
        for c in lock(&self.inner.clients).drain(..) {
            let _ = c.stream.shutdown(Shutdown::Both);
        }
        self.status()
    }

    /// The show changed: clients hear about the tally if it changed.
    pub fn show_changed(&self, show: &lumora_engine::Show) {
        if lock(&self.inner.clients).is_empty() {
            *lock(&self.inner.show) = None;
            return;
        }
        let Ok(v) = serde_json::to_value(show) else {
            return;
        };
        *lock(&self.inner.show) = Some(v);
        self.inner.push_tally();
    }

    /// What the control window says is running (recording, stream…).
    pub fn set_app_state(&self, state: &Value) {
        if !state.is_object() {
            return;
        }
        {
            let mut cur = lock(&self.inner.app_state);
            if *cur == *state {
                return;
            }
            cur.clone_from(state);
        }
        if lock(&self.inner.clients).is_empty() {
            return;
        }
        self.inner
            .send_all(&json!({"type": "app", "app": state}).to_string());
        self.inner.push_tally();
    }

    fn save(&self) {
        let Some(dir) = &self.dir else { return };
        if let Ok(text) = serde_json::to_string_pretty(&*lock(&self.config)) {
            let _ = write_file_atomic(&dir.join(FILE), &text);
        }
    }

    fn apply_config(&self) {
        let c = lock(&self.config).clone();
        *lock(&self.error) = None;
        if c.enabled {
            self.start_http(c.port);
        }
        if c.osc {
            self.start_osc(c.osc_port, c.osc_local_only);
        }
    }

    fn start_http(&self, port: u16) {
        let mut running = lock(&self.running);
        if running.is_some() {
            return;
        }
        match TcpListener::bind(("0.0.0.0", port)) {
            Ok(listener) => {
                let port = listener.local_addr().map_or(port, |a| a.port());
                let stop = Arc::new(AtomicBool::new(false));
                let (inner, flag) = (Arc::clone(&self.inner), Arc::clone(&stop));
                thread::Builder::new()
                    .name("lumora-api".into())
                    .spawn(move || accept(&listener, &inner, &flag))
                    .ok();
                eprintln!("lumora: control API listening on port {port}");
                *running = Some(Running { stop, port });
            }
            Err(e) => {
                *lock(&self.error) = Some(format!(
                    "The control API could not use port {port} ({e}). Another program may be using it; choose another port."
                ));
            }
        }
    }

    fn stop_http(&self) {
        let Some(r) = lock(&self.running).take() else {
            return;
        };
        r.stop.store(true, Ordering::SeqCst);
        // Wake the listener so it sees it should stop.
        let _ = TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], r.port)),
            Duration::from_millis(300),
        );
        for c in lock(&self.inner.clients).drain(..) {
            let _ = c.tx.try_send(Out::Close);
            let _ = c.stream.shutdown(Shutdown::Both);
        }
    }

    fn start_osc(&self, port: u16, local_only: bool) {
        let mut osc = lock(&self.osc);
        if osc.is_some() {
            return;
        }
        let ip: IpAddr = if local_only {
            [127, 0, 0, 1].into()
        } else {
            [0, 0, 0, 0].into()
        };
        match UdpSocket::bind((ip, port)) {
            Ok(sock) => {
                let _ = sock.set_read_timeout(Some(Duration::from_millis(300)));
                let stop = Arc::new(AtomicBool::new(false));
                let (inner, flag) = (Arc::clone(&self.inner), Arc::clone(&stop));
                thread::Builder::new()
                    .name("lumora-osc".into())
                    .spawn(move || osc_loop(&sock, &inner, &flag, local_only))
                    .ok();
                eprintln!("lumora: OSC listening on UDP port {port}");
                *osc = Some(OscRunning { stop });
            }
            Err(e) => {
                let mut err = lock(&self.error);
                let msg = format!("OSC could not use UDP port {port} ({e}). Choose another port.");
                *err = Some(err.take().map_or(msg.clone(), |x| format!("{x} {msg}")));
            }
        }
    }

    fn stop_osc(&self) {
        if let Some(o) = lock(&self.osc).take() {
            o.stop.store(true, Ordering::SeqCst);
        }
    }
}

impl Drop for Api {
    fn drop(&mut self) {
        self.stop_http();
        self.stop_osc();
    }
}

/// Where other computers on the network reach the API.
fn addresses(port: u16) -> Vec<String> {
    let mut ips: Vec<IpAddr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .map(|i| i.ip())
        .filter(|ip| matches!(ip, IpAddr::V4(v4) if !v4.is_link_local() && !v4.is_unspecified()))
        .collect();
    ips.sort_by_key(|ip| {
        (
            ip.is_loopback(),
            !matches!(ip, IpAddr::V4(v4) if v4.is_private()),
            *ip,
        )
    });
    ips.dedup();
    ips.into_iter()
        .map(|ip| format!("http://{ip}:{port}"))
        .collect()
}

fn accept(listener: &TcpListener, inner: &Arc<Inner>, stop: &Arc<AtomicBool>) {
    for conn in listener.incoming() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok(stream) = conn else { continue };
        let inner = Arc::clone(inner);
        let _ = thread::Builder::new()
            .name("lumora-api-request".into())
            .spawn(move || {
                let _ = handle(stream, &inner);
            });
    }
}

/// A parsed request.
struct Req {
    method: String,
    path: String,
    query: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Req {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

fn read_request(stream: &TcpStream) -> std::io::Result<Req> {
    let mut r = BufReader::new(stream.take((MAX_HEAD + MAX_BODY) as u64));
    let mut line = String::new();
    r.read_line(&mut line)?;
    let mut it = line.split_whitespace();
    let (method, target) = (
        it.next().unwrap_or("").to_owned(),
        it.next().unwrap_or("/").to_owned(),
    );
    let mut headers = Vec::new();
    let mut size = line.len();
    loop {
        let mut h = String::new();
        if r.read_line(&mut h)? == 0 {
            break;
        }
        size += h.len();
        if size > MAX_HEAD {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "head too long",
            ));
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.push((k.trim().to_owned(), v.trim().to_owned()));
        }
    }
    let len = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse::<usize>().ok())
        .unwrap_or(0)
        .min(MAX_BODY);
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)?;
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    Ok(Req {
        method,
        path: path.to_owned(),
        query: query.to_owned(),
        headers,
        body,
    })
}

fn respond(
    mut stream: &TcpStream,
    status: u16,
    content_type: &str,
    body: &str,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        429 => "Too Many Requests",
        _ => "Service Unavailable",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\n\
         Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Authorization, X-Lumora-Token, Content-Type\r\n\
         Connection: close\r\n\r\n{body}",
        body.len()
    )?;
    stream.flush()
}

fn json_reply(stream: &TcpStream, status: u16, body: &Value) -> std::io::Result<()> {
    respond(
        stream,
        status,
        "application/json; charset=utf-8",
        &body.to_string(),
    )
}

/// The command's values: the address's query, plus a JSON object or form body.
fn pairs(req: &Req) -> Vec<(String, String)> {
    let mut q = control::parse_query(&req.query);
    q.retain(|(k, _)| k != "token");
    if req.body.is_empty() {
        return q;
    }
    let text = String::from_utf8_lossy(&req.body);
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => q.extend(m.into_iter().map(|(k, v)| (k, plain(&v)))),
        Ok(_) => {}
        Err(_) => q.extend(control::parse_query(text.trim())),
    }
    q
}

fn plain(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(b) => if *b { "on" } else { "off" }.to_owned(),
        other => other.to_string(),
    }
}

fn handle(stream: TcpStream, inner: &Arc<Inner>) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let ip = stream
        .peer_addr()
        .map_or(IpAddr::from([0, 0, 0, 0]), |a| a.ip());
    let req = read_request(&stream)?;
    if req.method == "OPTIONS" {
        return respond(&stream, 204, "text/plain", "");
    }
    // Open to all: says what this is, so a control panel can find it.
    if req.path == "/" || req.path == "/api" || req.path == "/api/version" {
        return json_reply(
            &stream,
            200,
            &json!({"app": "Lumora", "api": 1, "version": env!("CARGO_PKG_VERSION"), "docs": "docs/API.md"}),
        );
    }
    let given = token_from(
        req.headers.iter().map(|(k, v)| (k.as_str(), v.as_str())),
        &req.query,
    );
    if let Some(status) = inner.check(ip, given.as_deref()) {
        let code = if status == 429 {
            "tooManyTries"
        } else {
            "wrongToken"
        };
        return json_reply(&stream, status, &json!({"ok": false, "code": code}));
    }
    let path = req.path.trim_end_matches('/');
    if path == "/api/ws"
        || req
            .header("upgrade")
            .is_some_and(|u| u.eq_ignore_ascii_case("websocket"))
    {
        return websocket(stream, &req, inner);
    }
    if !matches!(req.method.as_str(), "GET" | "POST") {
        return json_reply(&stream, 405, &json!({"ok": false, "code": "wrongMethod"}));
    }
    if path == "/api/commands" {
        let list: Vec<Value> = control::COMMANDS
            .iter()
            .map(|(c, args)| json!({"command": c, "takes": args}))
            .collect();
        return json_reply(&stream, 200, &Value::Array(list));
    }
    let Some(show) = inner.backend.show() else {
        return json_reply(&stream, 503, &json!({"ok": false, "code": "starting"}));
    };
    if path == "/api/tally" {
        return json_reply(&stream, 200, &inner.tally(&show));
    }
    if let Some(n) = path.strip_prefix("/api/tally/") {
        let tally = inner.tally(&show);
        return match n
            .parse::<usize>()
            .ok()
            .and_then(|n| control::tally_word(&tally, n))
        {
            Some(w) => respond(&stream, 200, "text/plain; charset=utf-8", w),
            None => respond(&stream, 404, "text/plain; charset=utf-8", "no such input"),
        };
    }
    if path == "/api/state" {
        return json_reply(&stream, 200, &inner.state(&show));
    }
    if path == "/api/macros" {
        let list: Vec<Value> = show["macros"]
            .as_array()
            .map(|a| {
                a.iter()
                    .enumerate()
                    .map(|(i, m)| json!({"number": i + 1, "id": m["id"], "name": m["name"], "hotkey": m["hotkey"]}))
                    .collect()
            })
            .unwrap_or_default();
        return json_reply(&stream, 200, &Value::Array(list));
    }
    if let Some(cmd) = path.strip_prefix("/api/do/") {
        return match control::run(&**inner, cmd, &pairs(&req)) {
            Ok(()) => json_reply(&stream, 200, &json!({"ok": true})),
            Err(e) => json_reply(&stream, 400, &json!({"ok": false, "error": e})),
        };
    }
    json_reply(&stream, 404, &json!({"ok": false, "code": "notFound"}))
}

/// Answer one WebSocket message.
fn ws_message(inner: &Inner, text: &str) -> Value {
    let text = text.trim();
    // `{"cmd":"take","screen":"live","id":"7"}`, or plain `take?screen=live`.
    let (cmd, q, id) = match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(mut m)) => {
            let id = m.remove("id").unwrap_or(Value::Null);
            let cmd = m
                .remove("cmd")
                .or_else(|| m.remove("command"))
                .or_else(|| m.remove("action"))
                .map(|v| plain(&v))
                .unwrap_or_default();
            (
                cmd,
                m.into_iter().map(|(k, v)| (k, plain(&v))).collect(),
                id,
            )
        }
        _ => {
            let (c, q) = text.split_once('?').unwrap_or((text, ""));
            (c.to_owned(), control::parse_query(q), Value::Null)
        }
    };
    let cmd = cmd.trim().trim_start_matches("/api/do/").to_owned();
    match cmd.as_str() {
        "" => {
            json!({"type": "result", "id": id, "ok": false, "error": "say which command: {\"cmd\": \"take\"}"})
        }
        "tally" | "state" => match inner.backend.show() {
            Some(show) => {
                let mut s = inner.state(&show);
                s["id"] = id;
                s
            }
            None => json!({"type": "result", "id": id, "ok": false, "error": "starting"}),
        },
        "ping" => json!({"type": "pong", "id": id}),
        _ => match control::run(inner, &cmd, &q) {
            Ok(()) => json!({"type": "result", "id": id, "ok": true}),
            Err(e) => json!({"type": "result", "id": id, "ok": false, "error": e}),
        },
    }
}

fn websocket(stream: TcpStream, req: &Req, inner: &Arc<Inner>) -> std::io::Result<()> {
    let Some(key) = req.header("sec-websocket-key") else {
        return json_reply(&stream, 400, &json!({"ok": false, "code": "notAWebSocket"}));
    };
    let mut w = stream.try_clone()?;
    write!(
        w,
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
        ws_accept(key)
    )?;
    w.flush()?;
    stream.set_read_timeout(None)?;
    let (tx, rx) = mpsc::sync_channel::<Out>(CLIENT_QUEUE);
    let id = inner.next_client.fetch_add(1, Ordering::SeqCst);
    // Hello, and the state right now.
    let show = inner.backend.show();
    if let Some(show) = &show {
        *lock(&inner.show) = Some(show.clone());
    }
    let hello =
        json!({"type": "hello", "app": "Lumora", "api": 1, "version": env!("CARGO_PKG_VERSION")});
    let _ = tx.try_send(Out::Text(hello.to_string()));
    if let Some(show) = &show {
        let _ = tx.try_send(Out::Text(inner.state(show).to_string()));
    }
    lock(&inner.clients).push(Client {
        id,
        tx: tx.clone(),
        stream: stream.try_clone()?,
    });
    // The writer: sends what is queued, and pings now and then.
    let writer = thread::Builder::new()
        .name("lumora-api-ws".into())
        .spawn(move || {
            loop {
                let out = match rx.recv_timeout(PING) {
                    Ok(o) => o,
                    Err(RecvTimeoutError::Timeout) => Out::Ping,
                    Err(RecvTimeoutError::Disconnected) => break,
                };
                let close = out == Out::Close;
                if w.write_all(&encode(&out)).and_then(|()| w.flush()).is_err() || close {
                    break;
                }
            }
            let _ = w.shutdown(Shutdown::Both);
        })?;
    let mut r = BufReader::new(stream.try_clone()?);
    let mut message: Vec<u8> = Vec::new();
    while let Ok((fin, opcode, payload)) = read_frame(&mut r) {
        match opcode {
            0x0..=0x2 => {
                if message.len() + payload.len() > MAX_MESSAGE as usize {
                    break;
                }
                message.extend_from_slice(&payload);
                if fin {
                    let reply = ws_message(inner, &String::from_utf8_lossy(&message));
                    message.clear();
                    if tx.try_send(Out::Text(reply.to_string())).is_err() {
                        break;
                    }
                }
            }
            0x8 => {
                let _ = tx.try_send(Out::Close);
                break;
            }
            0x9 => {
                let _ = tx.try_send(Out::Pong(payload));
            }
            _ => {}
        }
    }
    lock(&inner.clients).retain(|c| c.id != id);
    drop(tx);
    let _ = stream.shutdown(Shutdown::Both);
    let _ = writer.join();
    Ok(())
}

fn osc_loop(sock: &UdpSocket, inner: &Arc<Inner>, stop: &Arc<AtomicBool>, local_only: bool) {
    let mut buf = [0u8; 4096];
    while !stop.load(Ordering::SeqCst) {
        let Ok((n, from)) = sock.recv_from(&mut buf) else {
            continue;
        };
        if local_only && !from.ip().is_loopback() {
            continue;
        }
        for (address, args) in parse_osc(&buf[..n]) {
            let Some((cmd, q)) = osc_command(&address, &args) else {
                continue;
            };
            if let Err(e) = control::run(&**inner, &cmd, &q) {
                eprintln!("lumora: OSC {address}: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};

    #[test]
    fn sha1_and_base64_match_the_standards() {
        let hex: String = sha1(b"abc").iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, "a9993e364706816aba3e25717850c26c9cd0d89d");
        let long: String = sha1(&[b'a'; 1000])
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(long, "291e9a6c66994949b57ba5e650361e98fc36b1ba");
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
        // RFC 6455's own example.
        assert_eq!(
            ws_accept("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn frames_go_both_ways() {
        let long = "x".repeat(300);
        for text in ["hi", long.as_str()] {
            // A client's frame is masked.
            let mut f = frame(0x1, text.as_bytes());
            let at = if text.len() < 126 { 2 } else { 4 };
            f[1] |= 0x80;
            let mask = [1u8, 2, 3, 4];
            let payload: Vec<u8> = f[at..]
                .iter()
                .enumerate()
                .map(|(i, b)| b ^ mask[i % 4])
                .collect();
            f.truncate(at);
            f.extend_from_slice(&mask);
            f.extend_from_slice(&payload);
            let (fin, op, got) = read_frame(&mut f.as_slice()).unwrap();
            assert!(fin);
            assert_eq!(op, 1);
            assert_eq!(got, text.as_bytes());
        }
        let mut big = frame(0x1, b"");
        big[1] = 127;
        big.extend_from_slice(&(MAX_MESSAGE + 1).to_be_bytes());
        assert!(read_frame(&mut big.as_slice()).is_err());
    }

    fn osc_packet(address: &str, args: &[OscArg]) -> Vec<u8> {
        fn pad(b: &mut Vec<u8>, s: &str) {
            b.extend_from_slice(s.as_bytes());
            b.push(0);
            while !b.len().is_multiple_of(4) {
                b.push(0);
            }
        }
        let mut b = Vec::new();
        pad(&mut b, address);
        let mut tags = ",".to_owned();
        let mut data = Vec::new();
        for a in args {
            match a {
                OscArg::Int(i) => {
                    tags.push('i');
                    data.extend_from_slice(&i.to_be_bytes());
                }
                OscArg::Float(f) => {
                    tags.push('f');
                    data.extend_from_slice(&f.to_be_bytes());
                }
                OscArg::Str(s) => {
                    tags.push('s');
                    pad(&mut data, s);
                }
                OscArg::Bool(v) => tags.push(if *v { 'T' } else { 'F' }),
            }
        }
        pad(&mut b, &tags);
        b.extend_from_slice(&data);
        b
    }

    #[test]
    fn osc_messages_and_bundles_are_read() {
        let p = osc_packet("/lumora/preview", &[OscArg::Int(3)]);
        assert_eq!(
            parse_osc(&p),
            vec![("/lumora/preview".to_owned(), vec![OscArg::Int(3)])]
        );
        let q = osc_packet(
            "/lumora/take",
            &[OscArg::Str("screen=back".into()), OscArg::Float(0.5)],
        );
        let mut bundle = b"#bundle\0".to_vec();
        bundle.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 1]);
        for el in [&p, &q] {
            bundle.extend_from_slice(&u32::try_from(el.len()).unwrap().to_be_bytes());
            bundle.extend_from_slice(el);
        }
        let all = parse_osc(&bundle);
        assert_eq!(all.len(), 2);
        assert_eq!(all[1].1[1], OscArg::Float(0.5));
        assert!(parse_osc(b"junk").is_empty());
        assert!(parse_osc(&[]).is_empty());
    }

    #[test]
    fn osc_messages_become_commands() {
        let c = |a: &str, args: &[OscArg]| osc_command(a, args);
        assert_eq!(
            c("/lumora/preview", &[OscArg::Int(3)]),
            Some(("preview".into(), vec![("input".into(), "3".into())]))
        );
        assert_eq!(
            c("/lumora/preview/2", &[]),
            Some(("preview".into(), vec![("input".into(), "2".into())]))
        );
        assert_eq!(
            c("/lumora/overlay", &[OscArg::Int(2), OscArg::Bool(true)]),
            Some((
                "overlay".into(),
                vec![
                    ("channel".into(), "2".into()),
                    ("state".into(), "on".into())
                ]
            ))
        );
        assert_eq!(
            c("/lumora/macro", &[OscArg::Str("Start show".into())]),
            Some(("macro".into(), vec![("name".into(), "Start show".into())]))
        );
        assert_eq!(
            c("/lumora/take", &[OscArg::Str("screen=back".into())]),
            Some(("take".into(), vec![("screen".into(), "back".into())]))
        );
        assert_eq!(
            c("/lumora/record", &[OscArg::Float(1.0)]).unwrap().1,
            vec![("state".into(), "1".into())]
        );
        assert_eq!(c("/other/take", &[]), None);
        assert_eq!(c("/lumora", &[]), None);
    }

    #[test]
    fn tokens_come_from_headers_or_the_address() {
        let h = [("Authorization", "Bearer abc"), ("Other", "x")];
        assert_eq!(token_from(h.into_iter(), ""), Some("abc".into()));
        assert_eq!(
            token_from([("x-lumora-token", " t1 ")].into_iter(), ""),
            Some("t1".into())
        );
        assert_eq!(
            token_from(std::iter::empty(), "a=1&token=zz"),
            Some("zz".into())
        );
        assert_eq!(token_from(std::iter::empty(), "a=1"), None);
        let t = new_token();
        assert_eq!(t.len(), 32);
        assert!(t.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_ne!(t, new_token());
    }

    // ---- the server, end to end ----

    struct Fake {
        show: Mutex<Value>,
        applied: Mutex<Vec<Value>>,
        app: Mutex<Vec<AppCommand>>,
    }

    impl ApiBackend for Arc<Fake> {
        fn show(&self) -> Option<Value> {
            Some(lock(&self.show).clone())
        }
        fn apply(&self, action: Action) -> Result<(), String> {
            let v = serde_json::to_value(&action).unwrap();
            if v["type"] == "setPreview" {
                lock(&self.show)["screens"]["live"]["preview"] = v["sourceId"].clone();
            }
            lock(&self.applied).push(v);
            Ok(())
        }
        fn app_command(&self, command: AppCommand) -> Result<(), String> {
            lock(&self.app).push(command);
            Ok(())
        }
    }

    fn fake() -> Arc<Fake> {
        Arc::new(Fake {
            show: Mutex::new(json!({
                "sources": [
                    {"id": "a", "name": "Camera 1", "kind": {"type": "camera"}},
                    {"id": "b", "name": "Camera 2", "kind": {"type": "camera"}},
                ],
                "screens": {"live": {"program": "a", "preview": null, "blank": false}, "back": {"program": null, "preview": null, "blank": false}},
                "overlays": [{"on": false}, {"on": false}, {"on": false}, {"on": false}],
                "transition": {"kind": "fade", "durationMs": 500},
                "presets": [],
                "macros": [{"id": "m1", "name": "Start show", "steps": [], "hotkey": ""}],
                "panic": false,
            })),
            applied: Mutex::new(Vec::new()),
            app: Mutex::new(Vec::new()),
        })
    }

    fn free_port() -> u16 {
        TcpListener::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    fn api_on(f: &Arc<Fake>, osc_port: Option<u16>) -> (Api, u16) {
        let port = free_port();
        let api = Api::new(None, Arc::clone(f));
        let st = api.set(ApiConfig {
            enabled: true,
            port,
            osc: osc_port.is_some(),
            osc_port: osc_port.unwrap_or(DEFAULT_OSC_PORT),
            ..ApiConfig::default()
        });
        assert!(st.running, "{:?}", st.error);
        (api, port)
    }

    fn http(port: u16, target: &str, token: Option<&str>) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let auth = token
            .map(|t| format!("Authorization: Bearer {t}\r\n"))
            .unwrap_or_default();
        write!(s, "GET {target} HTTP/1.1\r\nHost: x\r\n{auth}\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        let status = out[9..12].parse().unwrap();
        let body = out
            .split_once("\r\n\r\n")
            .map(|(_, b)| b.to_owned())
            .unwrap_or_default();
        (status, body)
    }

    #[test]
    fn port_zero_falls_back_to_the_usual_port() {
        let c = ApiConfig {
            port: 0,
            token: "short".into(),
            ..ApiConfig::default()
        }
        .cleaned();
        assert_eq!(c.port, DEFAULT_PORT);
        assert_eq!(c.token.len(), 32);
    }

    #[test]
    fn http_needs_the_token_and_runs_commands() {
        let f = fake();
        let (api, port) = api_on(&f, None);
        let token = api.token();
        assert_eq!(http(port, "/api/version", None).0, 200);
        assert_eq!(http(port, "/api/tally", None).0, 401);
        assert_eq!(
            http(port, "/api/tally", Some("wrong-token-wrong-token")).0,
            401
        );
        let (code, body) = http(port, "/api/tally", Some(&token));
        assert_eq!(code, 200);
        assert!(body.contains("\"programName\":\"Camera 1\""));
        assert_eq!(http(port, "/api/tally/1", Some(&token)).1, "program");
        assert_eq!(http(port, "/api/tally/2", Some(&token)).1, "off");
        assert_eq!(http(port, "/api/tally/9", Some(&token)).0, 404);
        assert_eq!(
            http(
                port,
                &format!("/api/do/preview?input=2&token={token}"),
                None
            )
            .0,
            200
        );
        assert_eq!(lock(&f.applied)[0]["type"], json!("setPreview"));
        assert_eq!(http(port, "/api/do/record?state=on", Some(&token)).0, 200);
        assert_eq!(lock(&f.app)[0], AppCommand::Record { on: true });
        let (code, body) = http(port, "/api/do/dance", Some(&token));
        assert_eq!(code, 400);
        assert!(body.contains("unknown command"));
        assert!(http(port, "/api/macros", Some(&token))
            .1
            .contains("Start show"));
        drop(api);
    }

    fn ws_send(s: &mut TcpStream, text: &str) {
        let mut f = frame(0x1, text.as_bytes());
        let at = if text.len() < 126 { 2 } else { 4 };
        f[1] |= 0x80;
        let payload = f.split_off(at);
        f.extend_from_slice(&[0, 0, 0, 0]);
        f.extend_from_slice(&payload);
        s.write_all(&f).unwrap();
    }

    fn ws_read(r: &mut impl Read) -> Value {
        loop {
            let (_, op, p) = read_frame(r).unwrap();
            if op == 1 {
                return serde_json::from_slice(&p).unwrap();
            }
        }
    }

    #[test]
    fn websocket_clients_send_commands_and_hear_the_tally() {
        let f = fake();
        let (api, port) = api_on(&f, None);
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        write!(
            s,
            "GET /api/ws?token={} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
            api.token()
        )
        .unwrap();
        let mut r = BufReader::new(s.try_clone().unwrap());
        let mut line = String::new();
        r.read_line(&mut line).unwrap();
        assert!(line.starts_with("HTTP/1.1 101"));
        loop {
            line.clear();
            r.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        assert_eq!(ws_read(&mut r)["type"], json!("hello"));
        let state = ws_read(&mut r);
        assert_eq!(state["tally"]["live"]["program"], json!(1));
        ws_send(&mut s, r#"{"cmd":"preview","input":2,"id":"q1"}"#);
        let reply = ws_read(&mut r);
        assert_eq!((&reply["id"], &reply["ok"]), (&json!("q1"), &json!(true)));
        // The engine changed: the client hears the new tally by itself.
        *lock(&api.inner.show) = Some(lock(&f.show).clone());
        api.inner.push_tally();
        let t = ws_read(&mut r);
        assert_eq!(t["type"], json!("tally"));
        assert_eq!(t["tally"]["inputs"][1]["preview"], json!(true));
        api.set_app_state(&json!({"recording": true}));
        assert_eq!(ws_read(&mut r)["app"]["recording"], json!(true));
        assert_eq!(api.status().clients, 1);
        drop(api);
    }

    #[test]
    fn osc_from_this_computer_runs_commands() {
        let f = fake();
        let osc_port = UdpSocket::bind(("127.0.0.1", 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let (api, _) = api_on(&f, Some(osc_port));
        assert!(api.status().osc_running, "{:?}", api.status().error);
        let sock = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        sock.send_to(
            &osc_packet("/lumora/macro", &[OscArg::Int(1)]),
            ("127.0.0.1", osc_port),
        )
        .unwrap();
        let until = Instant::now() + Duration::from_secs(3);
        while lock(&f.applied).is_empty() && Instant::now() < until {
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(lock(&f.applied)[0], json!({"type": "runMacro", "id": "m1"}));
        drop(api);
    }
}
