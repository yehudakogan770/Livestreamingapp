//! A session with a switcher on a real UDP socket, on its own thread. It
//! connects, keeps the switcher's state, sends commands, and when the
//! switcher goes away (unplugged, restarted, the network dropped) it keeps
//! trying again by itself until it is back.

use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::command::{split, Command};
use crate::session::Session;
use crate::state::SwitcherState;

/// How the connection is doing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state", content = "detail")]
pub enum Status {
    /// Saying hello (or waiting to try again).
    Connecting,
    /// Connected; the switcher's whole state has arrived.
    Connected,
    /// Lost or refused, in words for the operator; trying again.
    Retrying(String),
}

/// Called (on the client's thread) when the status or the state changes.
pub type OnChange = Arc<dyn Fn() + Send + Sync>;

struct Shared {
    status: Mutex<Status>,
    state: Mutex<SwitcherState>,
    on_change: Option<OnChange>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Shared {
    fn changed(&self) {
        if let Some(f) = &self.on_change {
            f();
        }
    }
    fn set_status(&self, s: Status) {
        let changed = {
            let mut now = lock(&self.status);
            let changed = *now != s;
            *now = s;
            changed
        };
        if changed {
            self.changed();
        }
    }
}

/// A connection to one switcher.
pub struct Client {
    shared: Arc<Shared>,
    tx: Sender<Vec<Command>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    address: SocketAddr,
}

/// The switcher's address from what the operator typed ("192.168.10.240",
/// "atem.local", or with a port).
///
/// # Errors
/// The name can't be found.
pub fn resolve(host: &str) -> Result<SocketAddr, String> {
    let h = host.trim();
    if h.is_empty() {
        return Err("Type the switcher's IP address.".to_owned());
    }
    let found = if h.contains(':') && h.parse::<std::net::Ipv6Addr>().is_err() {
        h.to_socket_addrs()
    } else {
        (h, crate::PORT).to_socket_addrs()
    };
    found
        .map_err(|e| format!("Can't find “{h}”: {e}"))?
        .find(SocketAddr::is_ipv4)
        .ok_or_else(|| format!("Can't find “{h}” on the network."))
}

impl Client {
    /// Connect to the switcher at `address` and keep connected until dropped.
    /// `on_change` is told whenever the status or the state changes.
    ///
    /// # Errors
    /// No UDP socket could be opened.
    pub fn connect(address: SocketAddr, on_change: Option<OnChange>) -> Result<Client, String> {
        let socket = UdpSocket::bind(("0.0.0.0", 0)).map_err(|e| e.to_string())?;
        socket
            .set_read_timeout(Some(Duration::from_millis(20)))
            .map_err(|e| e.to_string())?;
        let shared = Arc::new(Shared {
            status: Mutex::new(Status::Connecting),
            state: Mutex::new(SwitcherState::default()),
            on_change,
        });
        let (tx, rx) = channel();
        let stop = Arc::new(AtomicBool::new(false));
        let (sh, st) = (Arc::clone(&shared), Arc::clone(&stop));
        let thread = thread::Builder::new()
            .name("lumora-atem".into())
            .spawn(move || run(&socket, address, &sh, &rx, &st))
            .map_err(|e| e.to_string())?;
        Ok(Client {
            shared,
            tx,
            stop,
            thread: Some(thread),
            address,
        })
    }

    #[must_use]
    pub fn address(&self) -> SocketAddr {
        self.address
    }

    #[must_use]
    pub fn status(&self) -> Status {
        lock(&self.shared.status).clone()
    }

    /// The switcher's state as last heard (empty until connected).
    #[must_use]
    pub fn state(&self) -> SwitcherState {
        lock(&self.shared.state).clone()
    }

    /// Send commands (in one packet).
    ///
    /// # Errors
    /// Not connected.
    pub fn send(&self, commands: Vec<Command>) -> Result<(), String> {
        if self.status() != Status::Connected {
            return Err("The ATEM switcher isn't connected.".to_owned());
        }
        self.tx
            .send(commands)
            .map_err(|_| "The ATEM connection stopped.".to_owned())
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Waits between tries, growing to this.
const MAX_BACKOFF: Duration = Duration::from_secs(5);

fn run(
    socket: &UdpSocket,
    to: SocketAddr,
    shared: &Shared,
    rx: &Receiver<Vec<Command>>,
    stop: &AtomicBool,
) {
    let mut session = Session::new(Instant::now());
    let mut buf = [0u8; 2048];
    let mut backoff = Duration::from_millis(500);
    let send = |b: &[u8]| {
        let _ = socket.send_to(b, to);
    };
    'outer: while !stop.load(Ordering::SeqCst) {
        send(&session.start(Instant::now()));
        let mut complete = false;
        loop {
            if stop.load(Ordering::SeqCst) {
                break 'outer;
            }
            let mut out = match socket.recv_from(&mut buf) {
                Ok((n, from)) if from.ip() == to.ip() => session.receive(&buf[..n], Instant::now()),
                _ => session.tick(Instant::now()),
            };
            for p in &out.send {
                send(p);
            }
            if out.opened {
                backoff = Duration::from_millis(500);
                *lock(&shared.state) = SwitcherState::default();
            }
            let mut changed = false;
            for payload in &out.payloads {
                let mut state = lock(&shared.state);
                for b in split(payload) {
                    changed |= state.apply(&b);
                }
                if state.complete && !complete {
                    complete = true;
                }
            }
            if complete && lock(&shared.status).clone() != Status::Connected {
                shared.set_status(Status::Connected);
            } else if changed {
                shared.changed();
            }
            // Commands to send (only once the session is open).
            while let Ok(cmds) = rx.try_recv() {
                let payload: Vec<u8> = cmds.iter().flat_map(Command::encode).collect();
                if let Some(p) = session.send(&payload, Instant::now()) {
                    send(&p);
                }
            }
            if out.lost.is_none() {
                // Resends and silence are checked even while packets keep coming.
                let tick = session.tick(Instant::now());
                for p in &tick.send {
                    send(p);
                }
                out.lost = tick.lost;
            }
            if let Some(why) = out.lost {
                shared.set_status(Status::Retrying(why));
                break;
            }
        }
        // Wait before trying again, in small steps so stopping is quick.
        let until = Instant::now() + backoff;
        while Instant::now() < until {
            if stop.load(Ordering::SeqCst) {
                break 'outer;
            }
            thread::sleep(Duration::from_millis(50));
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
        // Commands asked for while away are dropped (they'd be stale).
        while rx.try_recv().is_ok() {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::block;
    use crate::packet::{self, Header, ACK_REPLY, ACK_REQUEST, HELLO};
    use std::sync::atomic::AtomicUsize;

    /// A fake switcher on this computer: answers the hello, sends a small
    /// state (dropping its second packet the first time, so it must be
    /// sent again), acknowledges commands and reports what it was told.
    struct Fake {
        socket: UdpSocket,
        addr: SocketAddr,
    }

    impl Fake {
        fn new() -> Fake {
            let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
            socket
                .set_read_timeout(Some(Duration::from_millis(50)))
                .unwrap();
            let addr = socket.local_addr().unwrap();
            Fake { socket, addr }
        }

        fn recv(&self, until: Instant) -> Option<(Vec<u8>, SocketAddr)> {
            let mut buf = [0u8; 2048];
            while Instant::now() < until {
                if let Ok((n, from)) = self.socket.recv_from(&mut buf) {
                    return Some((buf[..n].to_vec(), from));
                }
            }
            None
        }

        fn packet(flags: u8, session: u16, ack: u16, id: u16, body: &[u8]) -> Vec<u8> {
            let mut p = Header {
                flags,
                length: (packet::HEADER + body.len()) as u16,
                session,
                ack_id: ack,
                resend_from: 0,
                packet_id: id,
            }
            .bytes()
            .to_vec();
            p.extend_from_slice(body);
            p
        }
    }

    fn wait_for(what: impl Fn() -> bool) {
        let until = Instant::now() + Duration::from_secs(5);
        while !what() && Instant::now() < until {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(what(), "timed out");
    }

    #[test]
    fn connects_to_a_fake_switcher_reads_its_state_and_sends_a_cut() {
        let fake = Fake::new();
        let changes = Arc::new(AtomicUsize::new(0));
        let c2 = Arc::clone(&changes);
        let client = Client::connect(
            fake.addr,
            Some(Arc::new(move || {
                c2.fetch_add(1, Ordering::SeqCst);
            })),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        // The hello.
        let (hello, peer) = fake.recv(deadline).expect("hello");
        assert_eq!(hello, packet::hello());
        fake.socket
            .send_to(
                &Fake::packet(HELLO, 0x0042, 0, 0, &[2, 0, 0, 0, 0, 0, 0, 0]),
                peer,
            )
            .unwrap();
        let (ack, _) = fake.recv(deadline).expect("ack of the hello");
        assert!(Header::parse(&ack).unwrap().has(ACK_REPLY));
        // The state, in two packets; the second is "lost" the first time.
        let mut p1 = block(b"_pin", b"ATEM Mini\0\0\0");
        p1.extend(block(b"PrgI", &[0, 0, 0, 1]));
        let mut p2 = block(b"PrvI", &[0, 0, 0, 2, 0, 0, 0, 0]);
        p2.extend(block(b"InCm", &[1, 0, 0, 0]));
        let s = 0x8042;
        fake.socket
            .send_to(&Fake::packet(ACK_REQUEST, s, 0, 1, &p1), peer)
            .unwrap();
        let (a1, _) = fake.recv(deadline).expect("ack 1");
        assert_eq!(a1, packet::ack(s, 1));
        // 3 (a ping) before 2: the client must not acknowledge it.
        fake.socket
            .send_to(&Fake::packet(ACK_REQUEST, s, 0, 3, &[]), peer)
            .unwrap();
        assert!(
            fake.recv(Instant::now() + Duration::from_millis(150))
                .is_none(),
            "an early packet is not acknowledged"
        );
        fake.socket
            .send_to(&Fake::packet(ACK_REQUEST, s, 0, 2, &p2), peer)
            .unwrap();
        let (a2, _) = fake.recv(deadline).expect("ack 2");
        assert_eq!(a2, packet::ack(s, 2));
        wait_for(|| client.status() == Status::Connected);
        let st = client.state();
        assert_eq!(st.model, "ATEM Mini");
        assert_eq!((st.me0().program, st.me0().preview), (1, 2));
        assert!(changes.load(Ordering::SeqCst) >= 1);

        // A cut: sent, not acknowledged at first, so sent again.
        client.send(vec![Command::Cut { me: 0 }]).unwrap();
        let (cmd, _) = fake.recv(deadline).expect("the cut");
        let h = Header::parse(&cmd).unwrap();
        assert!(h.has(ACK_REQUEST));
        assert_eq!(&cmd[packet::HEADER..], &Command::Cut { me: 0 }.encode()[..]);
        let (again, _) = fake.recv(deadline).expect("sent again");
        let h2 = Header::parse(&again).unwrap();
        assert!(h2.has(packet::RETRANSMIT));
        assert_eq!(h2.packet_id, h.packet_id);
        fake.socket
            .send_to(&Fake::packet(ACK_REPLY, s, h.packet_id, 0, &[]), peer)
            .unwrap();
        // The switcher tells of the change.
        let mut p4 = block(b"PrgI", &[0, 0, 0, 2]);
        p4.extend(block(b"PrvI", &[0, 0, 0, 1, 0, 0, 0, 0]));
        // Packet 3 was never read: send it now, then 4.
        fake.socket
            .send_to(&Fake::packet(ACK_REQUEST, s, 0, 3, &[]), peer)
            .unwrap();
        fake.socket
            .send_to(&Fake::packet(ACK_REQUEST, s, 0, 4, &p4), peer)
            .unwrap();
        wait_for(|| client.state().me0().program == 2);
        drop(client);
    }

    #[test]
    fn a_silent_switcher_is_retried() {
        let fake = Fake::new();
        let client = Client::connect(fake.addr, None).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let (_, peer) = fake.recv(deadline).expect("hello");
        fake.socket
            .send_to(
                &Fake::packet(HELLO, 7, 0, 0, &[2, 0, 0, 0, 0, 0, 0, 0]),
                peer,
            )
            .unwrap();
        // Then nothing: after the silence limit the client says why and says hello again.
        wait_for(|| matches!(client.status(), Status::Retrying(_)));
        loop {
            let (p, _) = fake.recv(deadline).expect("a new hello");
            if p == packet::hello() {
                break;
            }
        }
        assert!(client.send(vec![Command::Cut { me: 0 }]).is_err());
    }

    #[test]
    fn addresses_are_resolved() {
        assert_eq!(
            resolve("192.168.10.240").unwrap(),
            "192.168.10.240:9910".parse().unwrap()
        );
        assert_eq!(
            resolve(" 10.0.0.5:9911 ").unwrap(),
            "10.0.0.5:9911".parse().unwrap()
        );
        assert!(resolve("").is_err());
    }
}
