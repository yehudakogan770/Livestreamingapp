//! Finding shows on the venue network, with no internet and no setup.
//!
//! Two ways, both answered by the show computer while it lets seats join:
//! - mDNS / Bonjour: the show is `_lumora._tcp.local` (what Windows, macOS
//!   and network tools understand).
//! - A UDP broadcast on the seats port (`LUMORA-SEATS?`), for networks that
//!   block multicast.
//!
//! If neither gets through (some guest Wi-Fi keeps computers apart), the
//! person types the show computer's address instead.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::wire;

pub const SERVICE: &str = "_lumora._tcp.local";
const MDNS_GROUP: Ipv4Addr = Ipv4Addr::new(224, 0, 0, 251);
const MDNS_PORT: u16 = 5353;
const ASK: &[u8] = b"LUMORA-SEATS?1";
const TYPE_A: u16 = 1;
const TYPE_PTR: u16 = 12;
const TYPE_TXT: u16 = 16;
const TYPE_SRV: u16 = 33;
const TYPE_ANY: u16 = 255;

/// What a show computer says about itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowInfo {
    pub id: String,
    pub name: String,
    pub port: u16,
}

/// A show found on the network.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundShow {
    pub id: String,
    pub name: String,
    /// `192.168.1.20:8097`
    pub address: String,
}

/// This computer's network addresses (IPv4, private networks first).
#[must_use]
pub fn local_ips() -> Vec<IpAddr> {
    let mut ips: Vec<IpAddr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .map(|i| i.ip())
        .filter(|ip| matches!(ip, IpAddr::V4(v4) if !v4.is_link_local() && !v4.is_unspecified() && !v4.is_loopback()))
        .collect();
    ips.sort_by_key(|ip| (!matches!(ip, IpAddr::V4(v4) if v4.is_private()), *ip));
    ips.dedup();
    ips
}

fn broadcasts() -> Vec<Ipv4Addr> {
    let mut out = vec![Ipv4Addr::BROADCAST];
    for i in if_addrs::get_if_addrs().unwrap_or_default() {
        if let if_addrs::IfAddr::V4(v4) = &i.addr {
            if let Some(b) = v4.broadcast.filter(|_| !v4.ip.is_loopback()) {
                out.push(b);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

// ---------------------------------------------------------------------------
// DNS messages (just what mDNS service discovery needs)

fn put_name(out: &mut Vec<u8>, name: &str) {
    for label in name.trim_end_matches('.').split('.') {
        let l = &label.as_bytes()[..label.len().min(63)];
        out.push(l.len() as u8);
        out.extend_from_slice(l);
    }
    out.push(0);
}

fn read_name(b: &[u8], mut at: usize) -> Option<(String, usize)> {
    let mut labels: Vec<String> = Vec::new();
    let mut end = None;
    for _ in 0..64 {
        let len = *b.get(at)? as usize;
        if len == 0 {
            return Some((labels.join("."), end.unwrap_or(at + 1)));
        }
        if len & 0xC0 == 0xC0 {
            let ptr = ((len & 0x3F) << 8) | *b.get(at + 1)? as usize;
            if end.is_none() {
                end = Some(at + 2);
            }
            at = ptr;
            continue;
        }
        labels.push(String::from_utf8_lossy(b.get(at + 1..at + 1 + len)?).into_owned());
        at += 1 + len;
    }
    None
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*b.get(at)?, *b.get(at + 1)?]))
}

/// A question for the shows on the network.
#[must_use]
pub fn query() -> Vec<u8> {
    let mut q = vec![0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    put_name(&mut q, SERVICE);
    q.extend_from_slice(&TYPE_PTR.to_be_bytes());
    // Class IN, "answer me directly" (QU).
    q.extend_from_slice(&0x8001u16.to_be_bytes());
    q
}

/// Does this message ask for Lumora shows? (Its id, and the question to repeat.)
#[must_use]
pub fn asks_for_shows(b: &[u8]) -> Option<(u16, Vec<u8>)> {
    let id = u16_at(b, 0)?;
    let flags = u16_at(b, 2)?;
    if flags & 0x8000 != 0 {
        return None; // an answer, not a question
    }
    let questions = u16_at(b, 4)?;
    let mut at = 12;
    for _ in 0..questions.min(16) {
        let start = at;
        let (name, next) = read_name(b, at)?;
        let kind = u16_at(b, next)?;
        at = next + 4;
        if name.eq_ignore_ascii_case(SERVICE) && (kind == TYPE_PTR || kind == TYPE_ANY) {
            let mut q = Vec::new();
            put_name(&mut q, SERVICE);
            q.extend_from_slice(&b[next..next + 2]);
            q.extend_from_slice(&1u16.to_be_bytes());
            let _ = start;
            return Some((id, q));
        }
    }
    None
}

fn record(out: &mut Vec<u8>, name: &str, kind: u16, class: u16, ttl: u32, data: &[u8]) {
    put_name(out, name);
    out.extend_from_slice(&kind.to_be_bytes());
    out.extend_from_slice(&class.to_be_bytes());
    out.extend_from_slice(&ttl.to_be_bytes());
    out.extend_from_slice(&(data.len() as u16).to_be_bytes());
    out.extend_from_slice(data);
}

fn host_label(id: &str) -> String {
    format!(
        "lumora-{}",
        id.chars()
            .filter(char::is_ascii_alphanumeric)
            .take(16)
            .collect::<String>()
    )
}

/// The answer: where the show is, its name and id.
#[must_use]
pub fn answer(id: u16, question: Option<&[u8]>, info: &ShowInfo, ips: &[Ipv4Addr]) -> Vec<u8> {
    let instance = format!("{}.{SERVICE}", host_label(&info.id));
    let host = format!("{}.local", host_label(&info.id));
    let mut out = Vec::new();
    out.extend_from_slice(&id.to_be_bytes());
    out.extend_from_slice(&0x8400u16.to_be_bytes());
    out.extend_from_slice(&u16::from(question.is_some()).to_be_bytes());
    out.extend_from_slice(&(3 + ips.len() as u16).to_be_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    if let Some(q) = question {
        out.extend_from_slice(q);
    }
    let mut ptr = Vec::new();
    put_name(&mut ptr, &instance);
    record(&mut out, SERVICE, TYPE_PTR, 1, 120, &ptr);
    let mut srv = vec![0, 0, 0, 0];
    srv.extend_from_slice(&info.port.to_be_bytes());
    put_name(&mut srv, &host);
    record(&mut out, &instance, TYPE_SRV, 0x8001, 120, &srv);
    let mut txt = Vec::new();
    for kv in [
        format!("v={}", wire::VERSION),
        format!("id={}", info.id),
        format!("name={}", info.name),
    ] {
        let kv = &kv.as_bytes()[..kv.len().min(255)];
        txt.push(kv.len() as u8);
        txt.extend_from_slice(kv);
    }
    record(&mut out, &instance, TYPE_TXT, 0x8001, 120, &txt);
    for ip in ips {
        record(&mut out, &host, TYPE_A, 0x8001, 120, &ip.octets());
    }
    out
}

/// The shows in an mDNS answer (`from`: who sent it, if it names no address).
#[must_use]
pub fn shows_in(b: &[u8], from: IpAddr) -> Vec<FoundShow> {
    let mut found = Vec::new();
    let Some(flags) = u16_at(b, 2) else {
        return found;
    };
    if flags & 0x8000 == 0 {
        return found;
    }
    let (Some(qd), Some(an), Some(ns), Some(ar)) =
        (u16_at(b, 4), u16_at(b, 6), u16_at(b, 8), u16_at(b, 10))
    else {
        return found;
    };
    let mut at = 12;
    for _ in 0..qd {
        let Some((_, next)) = read_name(b, at) else {
            return found;
        };
        at = next + 4;
    }
    let mut ptrs = Vec::new();
    let mut srv: HashMap<String, (u16, String)> = HashMap::new();
    let mut txt: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut a: HashMap<String, Vec<Ipv4Addr>> = HashMap::new();
    for _ in 0..(u32::from(an) + u32::from(ns) + u32::from(ar)).min(64) {
        let Some((name, next)) = read_name(b, at) else {
            break;
        };
        let (Some(kind), Some(len)) = (u16_at(b, next), u16_at(b, next + 8)) else {
            break;
        };
        let data_at = next + 10;
        let Some(data) = b.get(data_at..data_at + len as usize) else {
            break;
        };
        let name = name.to_ascii_lowercase();
        match kind {
            TYPE_PTR if name == SERVICE => {
                if let Some((target, _)) = read_name(b, data_at) {
                    ptrs.push(target.to_ascii_lowercase());
                }
            }
            TYPE_SRV if data.len() > 6 => {
                if let Some((target, _)) = read_name(b, data_at + 6) {
                    srv.insert(
                        name,
                        (
                            u16::from_be_bytes([data[4], data[5]]),
                            target.to_ascii_lowercase(),
                        ),
                    );
                }
            }
            TYPE_TXT => {
                let mut kv = HashMap::new();
                let mut i = 0;
                while i < data.len() {
                    let l = data[i] as usize;
                    let s = String::from_utf8_lossy(data.get(i + 1..i + 1 + l).unwrap_or_default());
                    if let Some((k, v)) = s.split_once('=') {
                        kv.insert(k.to_owned(), v.to_owned());
                    }
                    i += 1 + l;
                }
                txt.insert(name, kv);
            }
            TYPE_A if data.len() == 4 => {
                a.entry(name)
                    .or_default()
                    .push(Ipv4Addr::new(data[0], data[1], data[2], data[3]));
            }
            _ => {}
        }
        at = data_at + len as usize;
    }
    for p in ptrs {
        let (Some((port, host)), Some(kv)) = (srv.get(&p), txt.get(&p)) else {
            continue;
        };
        let Some(id) = kv.get("id") else { continue };
        // Prefer the address the answer came from, if the show has it.
        let ips = a.get(host).cloned().unwrap_or_default();
        let ip = match from {
            IpAddr::V4(v4) if ips.is_empty() || ips.contains(&v4) => IpAddr::V4(v4),
            _ => ips.first().map_or(from, |v4| IpAddr::V4(*v4)),
        };
        found.push(FoundShow {
            id: id.clone(),
            name: kv.get("name").cloned().unwrap_or_else(|| id.clone()),
            address: SocketAddr::new(ip, *port).to_string(),
        });
    }
    found
}

// ---------------------------------------------------------------------------
// The show computer's side

/// Answers "is there a show?" while seats may join. Stops when dropped.
pub struct Announcer {
    stop: Arc<AtomicBool>,
}

impl Drop for Announcer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

type InfoFn = Arc<dyn Fn() -> ShowInfo + Send + Sync>;

impl Announcer {
    /// Answer broadcasts on `port` (UDP) and mDNS. `None` if neither could start.
    pub fn start(port: u16, info: InfoFn) -> Option<Announcer> {
        let stop = Arc::new(AtomicBool::new(false));
        let mut any = false;
        if let Ok(sock) = UdpSocket::bind(("0.0.0.0", port)) {
            let _ = sock.set_read_timeout(Some(Duration::from_millis(500)));
            let (stop, info) = (Arc::clone(&stop), Arc::clone(&info));
            any |= thread::Builder::new()
                .name("lumora-seats-find".into())
                .spawn(move || broadcast_loop(&sock, &stop, &info))
                .is_ok();
        }
        if let Some(sock) = mdns_socket() {
            let (stop, info) = (Arc::clone(&stop), Arc::clone(&info));
            any |= thread::Builder::new()
                .name("lumora-seats-mdns".into())
                .spawn(move || mdns_loop(&sock, &stop, &info))
                .is_ok();
        }
        any.then_some(Announcer { stop })
    }
}

fn broadcast_loop(sock: &UdpSocket, stop: &AtomicBool, info: &InfoFn) {
    let mut buf = [0u8; 512];
    let mut answered: HashMap<IpAddr, Instant> = HashMap::new();
    while !stop.load(Ordering::SeqCst) {
        let Ok((n, from)) = sock.recv_from(&mut buf) else {
            continue;
        };
        if &buf[..n] != ASK {
            continue;
        }
        // At most a few answers a second to any one computer.
        answered.retain(|_, at| at.elapsed() < Duration::from_millis(250));
        if answered.insert(from.ip(), Instant::now()).is_some() {
            continue;
        }
        if let Ok(text) = serde_json::to_vec(&info()) {
            let _ = sock.send_to(&text, from);
        }
    }
}

fn mdns_socket() -> Option<UdpSocket> {
    use socket2::{Domain, Protocol, Socket, Type};
    let s = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP)).ok()?;
    s.set_reuse_address(true).ok()?;
    #[cfg(unix)]
    let _ = s.set_reuse_port(true);
    s.bind(&SocketAddr::from((Ipv4Addr::UNSPECIFIED, MDNS_PORT)).into())
        .ok()?;
    let mut joined = s
        .join_multicast_v4(&MDNS_GROUP, &Ipv4Addr::UNSPECIFIED)
        .is_ok();
    for ip in local_ips() {
        if let IpAddr::V4(v4) = ip {
            joined |= s.join_multicast_v4(&MDNS_GROUP, &v4).is_ok();
        }
    }
    if !joined {
        return None;
    }
    let _ = s.set_multicast_loop_v4(true);
    let _ = s.set_read_timeout(Some(Duration::from_millis(500)));
    Some(s.into())
}

fn mdns_loop(sock: &UdpSocket, stop: &AtomicBool, info: &InfoFn) {
    let mut buf = [0u8; 1500];
    while !stop.load(Ordering::SeqCst) {
        let Ok((n, from)) = sock.recv_from(&mut buf) else {
            continue;
        };
        let Some((id, question)) = asks_for_shows(&buf[..n]) else {
            continue;
        };
        let ips: Vec<Ipv4Addr> = local_ips()
            .into_iter()
            .filter_map(|ip| match ip {
                IpAddr::V4(v4) => Some(v4),
                IpAddr::V6(_) => None,
            })
            .collect();
        let info = info();
        if from.port() == MDNS_PORT {
            // A full mDNS client: answer the group.
            let a = answer(0, None, &info, &ips);
            let _ = sock.send_to(&a, SocketAddrV4::new(MDNS_GROUP, MDNS_PORT));
        } else {
            // A simple question from any port: answer it directly.
            let a = answer(id, Some(&question), &info, &ips);
            let _ = sock.send_to(&a, from);
        }
    }
}

// ---------------------------------------------------------------------------
// The joining computer's side

/// Look for shows for `wait`. Never fails: no network means none found.
#[must_use]
pub fn discover(wait: Duration) -> Vec<FoundShow> {
    let Ok(sock) = UdpSocket::bind(("0.0.0.0", 0)) else {
        return Vec::new();
    };
    let _ = sock.set_broadcast(true);
    let _ = sock.set_read_timeout(Some(Duration::from_millis(100)));
    let send = |sock: &UdpSocket| {
        for b in broadcasts() {
            let _ = sock.send_to(ASK, SocketAddrV4::new(b, wire::DEFAULT_PORT));
        }
        let _ = sock.send_to(&query(), SocketAddrV4::new(MDNS_GROUP, MDNS_PORT));
        // This computer may be the show computer too.
        let _ = sock.send_to(
            ASK,
            SocketAddrV4::new(Ipv4Addr::LOCALHOST, wire::DEFAULT_PORT),
        );
    };
    send(&sock);
    let start = Instant::now();
    let mut asked_again = false;
    let mut found: Vec<FoundShow> = Vec::new();
    let mut buf = [0u8; 1500];
    while start.elapsed() < wait {
        if !asked_again && start.elapsed() > wait / 3 {
            // Once more, in case the first went missing on busy Wi-Fi.
            send(&sock);
            asked_again = true;
        }
        let Ok((n, from)) = sock.recv_from(&mut buf) else {
            continue;
        };
        let got = if buf[0] == b'{' {
            serde_json::from_slice::<ShowInfo>(&buf[..n])
                .map(|i| {
                    vec![FoundShow {
                        address: SocketAddr::new(from.ip(), i.port).to_string(),
                        id: i.id,
                        name: i.name,
                    }]
                })
                .unwrap_or_default()
        } else {
            shows_in(&buf[..n], from.ip())
        };
        for s in got {
            match found.iter_mut().find(|f| f.id == s.id) {
                // Prefer a network address over this computer's own.
                Some(f) if f.address.starts_with("127.") => *f = s,
                Some(_) => {}
                None => found.push(s),
            }
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// `192.168.1.20` or `192.168.1.20:8097` → an address to connect to.
///
/// # Errors
/// Not an address.
pub fn parse_address(typed: &str) -> Result<SocketAddr, String> {
    let t = typed
        .trim()
        .trim_start_matches("http://")
        .trim_end_matches('/');
    if let Ok(a) = t.parse::<SocketAddr>() {
        return Ok(a);
    }
    if let Ok(ip) = t.parse::<IpAddr>() {
        return Ok(SocketAddr::new(ip, wire::DEFAULT_PORT));
    }
    use std::net::ToSocketAddrs;
    let with_port = if t.contains(':') {
        t.to_owned()
    } else {
        format!("{t}:{}", wire::DEFAULT_PORT)
    };
    with_port
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.find(SocketAddr::is_ipv4))
        .ok_or_else(|| format!("“{}” isn’t an address Lumora can find. Type the show computer’s address, like 192.168.1.20.", typed.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info() -> ShowInfo {
        ShowInfo {
            id: "a1b2c3d4".into(),
            name: "Spring Gala (FOH-PC)".into(),
            port: 8097,
        }
    }

    #[test]
    fn a_query_is_recognised_and_answered_with_where_the_show_is() {
        let q = query();
        let (id, question) = asks_for_shows(&q).expect("asks");
        assert_eq!(id, 0);
        let a = answer(
            id,
            Some(&question),
            &info(),
            &[Ipv4Addr::new(192, 168, 1, 20)],
        );
        assert!(asks_for_shows(&a).is_none(), "an answer is not a question");
        let found = shows_in(&a, IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20)));
        assert_eq!(
            found,
            vec![FoundShow {
                id: "a1b2c3d4".into(),
                name: "Spring Gala (FOH-PC)".into(),
                address: "192.168.1.20:8097".into(),
            }]
        );
        // Without the asker's address in the answer, the show's own one is used.
        let found = shows_in(&a, IpAddr::V4(Ipv4Addr::new(10, 0, 0, 9)));
        assert_eq!(found[0].address, "192.168.1.20:8097");
    }

    #[test]
    fn other_services_and_garbage_are_ignored() {
        let mut q = vec![0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
        put_name(&mut q, "_printer._tcp.local");
        q.extend_from_slice(&[0, 12, 0, 1]);
        assert!(asks_for_shows(&q).is_none());
        assert!(asks_for_shows(&[1, 2, 3]).is_none());
        assert!(shows_in(&[0xff; 40], IpAddr::V4(Ipv4Addr::LOCALHOST)).is_empty());
        // A pointer loop does not hang.
        let looped = vec![0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0xC0, 12, 0, 12, 0, 1];
        assert!(asks_for_shows(&looped).is_none());
    }

    #[test]
    fn compressed_names_are_read() {
        // "local" at 12, then "x" + pointer to it.
        let b = [0u8; 12]
            .iter()
            .copied()
            .chain([5, b'l', b'o', b'c', b'a', b'l', 0, 1, b'x', 0xC0, 12])
            .collect::<Vec<u8>>();
        assert_eq!(read_name(&b, 19), Some(("x.local".to_owned(), 23)));
    }

    #[test]
    fn typed_addresses() {
        assert_eq!(
            parse_address("192.168.1.20").unwrap().to_string(),
            "192.168.1.20:8097"
        );
        assert_eq!(
            parse_address(" 10.0.0.5:9000 ").unwrap().to_string(),
            "10.0.0.5:9000"
        );
        assert_eq!(
            parse_address("http://10.0.0.5:9000/").unwrap().to_string(),
            "10.0.0.5:9000"
        );
        assert!(parse_address("not an address at all").is_err());
    }
}
