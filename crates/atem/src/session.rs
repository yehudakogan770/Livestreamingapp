//! Reliable delivery over UDP, as ATEM switchers do it.
//!
//! 1. The client sends a hello; the switcher answers with a hello of its own
//!    (accepted, or full) and the session number to use.
//! 2. The client acknowledges, and the switcher sends its whole state in
//!    numbered packets, each to be acknowledged; then a packet whenever
//!    something changes, and empty ones (pings) in between.
//! 3. Packets are taken strictly in order: one that comes early (a packet
//!    before it was lost) is left unacknowledged, so the switcher sends the
//!    missing ones again; one that comes twice is acknowledged again and
//!    not read twice.
//! 4. The client's own commands go in numbered packets too, sent again
//!    every so often until the switcher acknowledges them. The switcher may
//!    ask for packets again from a number; if they are gone, the session
//!    starts over.
//! 5. Nothing heard for a while, or a packet never acknowledged: the
//!    session is lost and the client starts over with a hello.
//!
//! No sockets here: the caller hands in what arrived and the time, and gets
//! back what to send, what the switcher said, and whether the session is
//! lost. That makes every rule testable against a fake switcher.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use crate::packet::{self, Header};

/// No hello answer for this long: send the hello again.
pub const HELLO_RETRY: Duration = Duration::from_millis(1000);
/// Hellos sent without an answer before giving up (the client waits and tries again).
pub const HELLO_TRIES: u32 = 3;
/// Nothing heard from the switcher for this long: the session is lost.
pub const SILENCE: Duration = Duration::from_millis(3000);
/// A command packet not acknowledged for this long is sent again.
pub const RESEND_AFTER: Duration = Duration::from_millis(200);
/// Sent this many times without an acknowledgement: the session is lost.
pub const MAX_TRIES: u32 = 10;
/// Most command packets waiting for acknowledgements.
pub const MAX_IN_FLIGHT: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Not started, or lost.
    Idle,
    /// The hello is out.
    Hello { since: Instant, tries: u32 },
    /// The switcher accepted.
    Open,
}

#[derive(Debug, Clone)]
struct Flight {
    id: u16,
    bytes: Vec<u8>,
    sent_at: Instant,
    tries: u32,
}

/// What happened, for the caller.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Output {
    /// Datagrams to send to the switcher, in order.
    pub send: Vec<Vec<u8>>,
    /// The payloads of the switcher's packets, in order (each a run of command blocks).
    pub payloads: Vec<Vec<u8>>,
    /// The switcher just accepted the session.
    pub opened: bool,
    /// The session is over, and why (in words for the operator).
    pub lost: Option<String>,
}

/// Counts, for the status panel and the tests.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    pub received: u64,
    pub duplicates: u64,
    pub early: u64,
    pub resent: u64,
}

pub struct Session {
    phase: Phase,
    session: u16,
    next_id: u16,
    last_in: Option<u16>,
    in_flight: VecDeque<Flight>,
    last_heard: Instant,
    pub counts: Counts,
}

impl Session {
    #[must_use]
    pub fn new(now: Instant) -> Self {
        Session {
            phase: Phase::Idle,
            session: packet::HELLO_SESSION,
            next_id: 1,
            last_in: None,
            in_flight: VecDeque::new(),
            last_heard: now,
            counts: Counts::default(),
        }
    }

    #[must_use]
    pub fn phase(&self) -> Phase {
        self.phase
    }

    #[must_use]
    pub fn is_open(&self) -> bool {
        self.phase == Phase::Open
    }

    /// Command packets not yet acknowledged.
    #[must_use]
    pub fn waiting(&self) -> usize {
        self.in_flight.len()
    }

    /// Start (or start over): the hello to send.
    pub fn start(&mut self, now: Instant) -> Vec<u8> {
        *self = Session {
            counts: self.counts,
            ..Session::new(now)
        };
        self.phase = Phase::Hello {
            since: now,
            tries: 1,
        };
        packet::hello()
    }

    fn lose(&mut self, why: &str, out: &mut Output) {
        self.phase = Phase::Idle;
        self.in_flight.clear();
        out.lost = Some(why.to_owned());
    }

    /// A datagram from the switcher.
    pub fn receive(&mut self, bytes: &[u8], now: Instant) -> Output {
        let mut out = Output::default();
        let Some(h) = Header::parse(bytes) else {
            return out;
        };
        let body = &bytes[packet::HEADER..usize::from(h.length)];
        if self.phase == Phase::Idle {
            return out;
        }
        self.last_heard = now;
        if h.has(packet::HELLO) {
            if matches!(self.phase, Phase::Hello { .. }) {
                if body.first() == Some(&packet::HELLO_ACCEPTED) {
                    self.session = h.session;
                    self.phase = Phase::Open;
                    out.opened = true;
                    out.send.push(packet::ack(self.session, h.packet_id));
                } else {
                    self.lose(
                        "The switcher has as many connections as it takes. Close ATEM Software Control on another computer, or another program using it.",
                        &mut out,
                    );
                }
            }
            return out;
        }
        if self.phase != Phase::Open {
            return out;
        }
        // The switcher numbers the session itself once open.
        self.session = h.session;
        if h.has(packet::ACK_REPLY) {
            while self
                .in_flight
                .front()
                .is_some_and(|f| packet::at_or_before(f.id, h.ack_id))
            {
                self.in_flight.pop_front();
            }
        }
        if h.has(packet::RESEND_REQUEST) {
            let from = h.resend_from;
            match self.in_flight.iter().position(|f| f.id == from) {
                Some(i) => {
                    for f in self.in_flight.iter_mut().skip(i) {
                        f.sent_at = now;
                        f.tries += 1;
                        self.counts.resent += 1;
                        out.send.push(packet::as_retransmit(&f.bytes));
                    }
                }
                None if self.next_id == from => {}
                None => {
                    self.lose(
                        "The switcher asked for commands again that Lumora no longer has. Connecting again…",
                        &mut out,
                    );
                    return out;
                }
            }
        }
        if h.has(packet::ACK_REQUEST) {
            let id = h.packet_id;
            let expected = self.last_in.map(packet::next_id);
            match expected {
                Some(e) if id != e => {
                    if packet::at_or_before(id, self.last_in.unwrap_or(id)) {
                        // Already read: the acknowledgement was lost. Say it again.
                        self.counts.duplicates += 1;
                        out.send.push(packet::ack(self.session, id));
                    } else {
                        // Early: one before it is missing. Wait for it to be sent again.
                        self.counts.early += 1;
                    }
                }
                _ => {
                    self.last_in = Some(id);
                    self.counts.received += 1;
                    out.send.push(packet::ack(self.session, id));
                    if !body.is_empty() {
                        out.payloads.push(body.to_vec());
                    }
                }
            }
        }
        out
    }

    /// Send command blocks (`payload`): the datagram, or None when the
    /// session isn't open (or too many are waiting already).
    pub fn send(&mut self, payload: &[u8], now: Instant) -> Option<Vec<u8>> {
        if self.phase != Phase::Open
            || self.in_flight.len() >= MAX_IN_FLIGHT
            || packet::HEADER + payload.len() > packet::MAX_PACKET
        {
            return None;
        }
        let id = self.next_id;
        self.next_id = packet::next_id(id);
        let bytes = packet::reliable(self.session, id, payload);
        self.in_flight.push_back(Flight {
            id,
            bytes: bytes.clone(),
            sent_at: now,
            tries: 1,
        });
        Some(bytes)
    }

    /// Time passes: hellos and commands sent again, silence noticed.
    pub fn tick(&mut self, now: Instant) -> Output {
        let mut out = Output::default();
        match self.phase {
            Phase::Idle => {}
            Phase::Hello { since, tries } => {
                if now.duration_since(since) >= HELLO_RETRY {
                    if tries >= HELLO_TRIES {
                        self.lose(
                            "The switcher doesn't answer. Check its address (on the switcher: Settings → Network, or ATEM Setup), and that this computer is on the same network.",
                            &mut out,
                        );
                    } else {
                        self.phase = Phase::Hello {
                            since: now,
                            tries: tries + 1,
                        };
                        out.send.push(packet::hello());
                    }
                }
            }
            Phase::Open => {
                if now.duration_since(self.last_heard) >= SILENCE {
                    self.lose(
                        "The switcher stopped answering (unplugged, switched off, or the network dropped). Connecting again…",
                        &mut out,
                    );
                    return out;
                }
                let mut gave_up = false;
                for f in &mut self.in_flight {
                    if now.duration_since(f.sent_at) >= RESEND_AFTER {
                        if f.tries >= MAX_TRIES {
                            gave_up = true;
                            break;
                        }
                        f.tries += 1;
                        f.sent_at = now;
                        self.counts.resent += 1;
                        out.send.push(packet::as_retransmit(&f.bytes));
                    }
                }
                if gave_up {
                    out.send.clear();
                    self.lose(
                        "The switcher didn't take a command after several tries. Connecting again…",
                        &mut out,
                    );
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packet::{ACK_REPLY, ACK_REQUEST, HELLO, RESEND_REQUEST};

    /// What a switcher sends: header fields and a payload.
    fn from_switcher(
        flags: u8,
        session: u16,
        ack: u16,
        resend: u16,
        id: u16,
        body: &[u8],
    ) -> Vec<u8> {
        let mut p = Header {
            flags,
            length: (packet::HEADER + body.len()) as u16,
            session,
            ack_id: ack,
            resend_from: resend,
            packet_id: id,
        }
        .bytes()
        .to_vec();
        p.extend_from_slice(body);
        p
    }

    fn open(now: Instant) -> Session {
        let mut s = Session::new(now);
        let hello = s.start(now);
        assert_eq!(hello, packet::hello());
        let out = s.receive(
            &from_switcher(HELLO, 0x0B1C, 0, 0, 0, &[2, 0, 0, 0, 0, 0, 0, 0]),
            now,
        );
        assert!(out.opened);
        assert_eq!(out.send, vec![packet::ack(0x0B1C, 0)]);
        assert!(s.is_open());
        s
    }

    #[test]
    fn a_session_opens_and_state_packets_are_acknowledged_in_order() {
        let t = Instant::now();
        let mut s = open(t);
        let p1 = from_switcher(
            ACK_REQUEST,
            0x8B1C,
            0,
            0,
            1,
            b"\x00\x0c\x00\x00PrgI\x00\x00\x00\x01",
        );
        let out = s.receive(&p1, t);
        assert_eq!(
            out.send,
            vec![packet::ack(0x8B1C, 1)],
            "acked with the new session number"
        );
        assert_eq!(out.payloads.len(), 1);
        // Packet 3 before 2: not read, not acknowledged.
        let p3 = from_switcher(
            ACK_REQUEST,
            0x8B1C,
            0,
            0,
            3,
            b"\x00\x0c\x00\x00PrgI\x00\x00\x00\x03",
        );
        let out = s.receive(&p3, t);
        assert!(out.send.is_empty() && out.payloads.is_empty());
        // 2 arrives, then 3 again (the switcher sends it again): both read, in order.
        let p2 = from_switcher(
            ACK_REQUEST,
            0x8B1C,
            0,
            0,
            2,
            b"\x00\x0c\x00\x00PrgI\x00\x00\x00\x02",
        );
        assert_eq!(s.receive(&p2, t).payloads.len(), 1);
        let again = s.receive(&p3, t);
        assert_eq!(again.payloads.len(), 1);
        assert_eq!(again.send, vec![packet::ack(0x8B1C, 3)]);
        // 2 a second time: acknowledged again, not read again.
        let dup = s.receive(&p2, t);
        assert!(dup.payloads.is_empty());
        assert_eq!(dup.send, vec![packet::ack(0x8B1C, 2)]);
        assert_eq!(s.counts.duplicates, 1);
        assert_eq!(s.counts.early, 1);
        // A ping (no payload) is acknowledged.
        let ping = from_switcher(ACK_REQUEST, 0x8B1C, 0, 0, 4, &[]);
        let out = s.receive(&ping, t);
        assert_eq!(out.send, vec![packet::ack(0x8B1C, 4)]);
        assert!(out.payloads.is_empty());
    }

    #[test]
    fn a_full_switcher_refuses() {
        let t = Instant::now();
        let mut s = Session::new(t);
        s.start(t);
        let out = s.receive(
            &from_switcher(HELLO, 0x0B1C, 0, 0, 0, &[3, 0, 0, 0, 0, 0, 0, 0]),
            t,
        );
        assert!(out.lost.unwrap().contains("as many connections"));
        assert_eq!(s.phase(), Phase::Idle);
    }

    #[test]
    fn hellos_are_sent_again_then_given_up() {
        let t = Instant::now();
        let mut s = Session::new(t);
        s.start(t);
        assert!(s.tick(t + Duration::from_millis(500)).send.is_empty());
        let out = s.tick(t + HELLO_RETRY);
        assert_eq!(out.send, vec![packet::hello()]);
        let out = s.tick(t + HELLO_RETRY * 2);
        assert_eq!(out.send.len(), 1);
        let out = s.tick(t + HELLO_RETRY * 3);
        assert!(out.lost.unwrap().contains("doesn't answer"));
    }

    #[test]
    fn commands_are_sent_again_until_acknowledged() {
        let t = Instant::now();
        let mut s = open(t);
        let p = s.send(b"\x00\x0c\x00\x00DCut\x00\x00\x00\x00", t).unwrap();
        let h = Header::parse(&p).unwrap();
        assert_eq!((h.flags, h.packet_id, h.session), (ACK_REQUEST, 1, 0x0B1C));
        let p2 = s.send(b"\x00\x0c\x00\x00DAut\x00\x00\x00\x00", t).unwrap();
        assert_eq!(Header::parse(&p2).unwrap().packet_id, 2);
        // Not acknowledged in time: both sent again, marked as such.
        let later = t + RESEND_AFTER;
        let out = s.tick(later);
        assert_eq!(out.send.len(), 2);
        assert!(Header::parse(&out.send[0]).unwrap().has(packet::RETRANSMIT));
        // The switcher acknowledges 2 (and so 1 before it).
        s.receive(&from_switcher(ACK_REPLY, 0x8B1C, 2, 0, 0, &[]), later);
        assert_eq!(s.waiting(), 0);
        assert!(s.tick(later + RESEND_AFTER * 2).send.is_empty());
    }

    #[test]
    fn a_command_never_acknowledged_loses_the_session() {
        let mut t = Instant::now();
        let mut s = open(t);
        s.send(b"\x00\x0c\x00\x00DCut\x00\x00\x00\x00", t).unwrap();
        let mut lost = None;
        for _ in 0..MAX_TRIES + 1 {
            t += RESEND_AFTER;
            // Keep the switcher "talking" so silence isn't the reason.
            s.receive(&from_switcher(ACK_REPLY, 0x8B1C, 0x7FFF, 0, 0, &[]), t);
            let out = s.tick(t);
            if out.lost.is_some() {
                lost = out.lost;
                break;
            }
        }
        assert!(lost.unwrap().contains("several tries"));
    }

    #[test]
    fn the_switcher_can_ask_for_commands_again() {
        let t = Instant::now();
        let mut s = open(t);
        for _ in 0..3 {
            s.send(b"\x00\x0c\x00\x00DCut\x00\x00\x00\x00", t).unwrap();
        }
        let out = s.receive(&from_switcher(RESEND_REQUEST, 0x8B1C, 0, 2, 0, &[]), t);
        let ids: Vec<u16> = out
            .send
            .iter()
            .map(|p| Header::parse(p).unwrap().packet_id)
            .collect();
        assert_eq!(ids, vec![2, 3]);
        // Asking for one long gone: start over.
        s.receive(&from_switcher(ACK_REPLY, 0x8B1C, 3, 0, 0, &[]), t);
        let out = s.receive(&from_switcher(RESEND_REQUEST, 0x8B1C, 0, 1, 0, &[]), t);
        assert!(out.lost.is_some());
    }

    #[test]
    fn silence_loses_the_session() {
        let t = Instant::now();
        let mut s = open(t);
        assert!(s.tick(t + SILENCE / 2).lost.is_none());
        assert!(s.tick(t + SILENCE).lost.is_some());
        assert!(s.send(b"x", t).is_none(), "nothing sent once lost");
    }

    #[test]
    fn packet_numbers_wrap_around() {
        let t = Instant::now();
        let mut s = open(t);
        let mut id = 32766u16;
        for _ in 0..4 {
            let out = s.receive(&from_switcher(ACK_REQUEST, 0x8B1C, 0, 0, id, &[]), t);
            assert_eq!(out.send, vec![packet::ack(0x8B1C, id)], "id {id}");
            id = packet::next_id(id);
        }
        assert_eq!(s.counts.received, 4);
    }
}
