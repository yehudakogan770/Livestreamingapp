//! The header every ATEM datagram starts with.
//!
//! ```text
//!  0      1      2      3      4      5      6      7      8      9     10     11
//! +------+------+------+------+------+------+------+------+------+------+------+------+
//! |flags:5|len:11|  session    |  ack id     | resend from |  (unused)   | packet id   |
//! +------+------+------+------+------+------+------+------+------+------+------+------+
//! ```
//!
//! All numbers are big-endian. `len` counts the whole datagram, header
//! included (at most 2047 bytes). Packet numbers run from 1 to 32767 and
//! then start again at 0.

/// The header's length.
pub const HEADER: usize = 12;
/// The longest datagram the length field can describe.
pub const MAX_PACKET: usize = 0x07FF;
/// Packet numbers wrap here.
pub const ID_SPAN: u16 = 0x8000;

/// The sender wants this packet acknowledged (it carries commands or is a ping).
pub const ACK_REQUEST: u8 = 0x01;
/// Hello: opens a session (from the client), or answers one (from the switcher).
pub const HELLO: u8 = 0x02;
/// This packet is sent again.
pub const RETRANSMIT: u8 = 0x04;
/// Please send your packets again, starting with the number in "resend from".
pub const RESEND_REQUEST: u8 = 0x08;
/// This packet acknowledges the packet number in "ack id".
pub const ACK_REPLY: u8 = 0x10;

/// The switcher accepted the hello.
pub const HELLO_ACCEPTED: u8 = 0x02;

/// A datagram's header.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Header {
    pub flags: u8,
    /// The whole datagram's length, header included.
    pub length: u16,
    pub session: u16,
    pub ack_id: u16,
    pub resend_from: u16,
    pub packet_id: u16,
}

impl Header {
    /// Read a header (None: too short, or the length doesn't match).
    #[must_use]
    pub fn parse(b: &[u8]) -> Option<Header> {
        if b.len() < HEADER {
            return None;
        }
        let word = |i: usize| u16::from_be_bytes([b[i], b[i + 1]]);
        let first = word(0);
        let h = Header {
            flags: (first >> 11) as u8,
            length: first & 0x07FF,
            session: word(2),
            ack_id: word(4),
            resend_from: word(6),
            packet_id: word(10),
        };
        // A datagram longer than it says is cut to its length; a shorter one is broken.
        (usize::from(h.length) >= HEADER && usize::from(h.length) <= b.len()).then_some(h)
    }

    /// The 12 bytes.
    #[must_use]
    pub fn bytes(&self) -> [u8; HEADER] {
        let first = (u16::from(self.flags & 0x1F) << 11) | (self.length & 0x07FF);
        let mut out = [0u8; HEADER];
        out[0..2].copy_from_slice(&first.to_be_bytes());
        out[2..4].copy_from_slice(&self.session.to_be_bytes());
        out[4..6].copy_from_slice(&self.ack_id.to_be_bytes());
        out[6..8].copy_from_slice(&self.resend_from.to_be_bytes());
        out[10..12].copy_from_slice(&self.packet_id.to_be_bytes());
        out
    }

    #[must_use]
    pub fn has(&self, flag: u8) -> bool {
        self.flags & flag != 0
    }
}

/// The session number a client uses for its hello (the switcher gives the
/// real one in its answer).
pub const HELLO_SESSION: u16 = 0x53AB;

/// The hello a client opens a session with.
#[must_use]
pub fn hello() -> Vec<u8> {
    let mut p = Header {
        flags: HELLO,
        length: 20,
        session: HELLO_SESSION,
        ack_id: 0,
        resend_from: 0,
        packet_id: 0,
    }
    .bytes()
    .to_vec();
    // The switcher's own software sends 0x003a here.
    p[8..10].copy_from_slice(&0x003A_u16.to_be_bytes());
    // "Connect" and seven bytes of padding.
    p.extend_from_slice(&[0x01, 0, 0, 0, 0, 0, 0, 0]);
    p
}

/// What the switcher said to the hello (the payload's first byte).
#[must_use]
pub fn hello_answer(b: &[u8]) -> Option<u8> {
    b.get(HEADER).copied()
}

/// An acknowledgement of the switcher's packet `id`.
#[must_use]
pub fn ack(session: u16, id: u16) -> Vec<u8> {
    Header {
        flags: ACK_REPLY,
        length: HEADER as u16,
        session,
        ack_id: id,
        resend_from: 0,
        packet_id: 0,
    }
    .bytes()
    .to_vec()
}

/// A packet that needs an acknowledgement, carrying `payload` (commands).
#[must_use]
pub fn reliable(session: u16, id: u16, payload: &[u8]) -> Vec<u8> {
    let mut p = Header {
        flags: ACK_REQUEST,
        length: (HEADER + payload.len()) as u16,
        session,
        ack_id: 0,
        resend_from: 0,
        packet_id: id,
    }
    .bytes()
    .to_vec();
    p.extend_from_slice(payload);
    p
}

/// The same packet marked as sent again.
#[must_use]
pub fn as_retransmit(p: &[u8]) -> Vec<u8> {
    let mut out = p.to_vec();
    if !out.is_empty() {
        out[0] |= RETRANSMIT << 3;
    }
    out
}

/// The packet number after `id`.
#[must_use]
pub fn next_id(id: u16) -> u16 {
    (id + 1) % ID_SPAN
}

/// How far `b` is ahead of `a` (0 – 32767), packet numbers wrapping.
#[must_use]
pub fn distance(a: u16, b: u16) -> u16 {
    (b.wrapping_sub(a)) % ID_SPAN
}

/// `a` comes at or before `b` (within half the span, wrapping).
#[must_use]
pub fn at_or_before(a: u16, b: u16) -> bool {
    distance(a, b) < ID_SPAN / 2
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The hello as ATEM Software Control sends it (captured byte for byte).
    const HELLO_FIXTURE: [u8; 20] = [
        0x10, 0x14, 0x53, 0xAB, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3A, 0x00, 0x00, 0x01, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00,
    ];

    /// A switcher's answer to a hello: accepted, session 0x1A2B.
    const HELLO_REPLY_FIXTURE: [u8; 20] = [
        0x10, 0x14, 0x1A, 0x2B, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00,
    ];

    #[test]
    fn the_hello_is_byte_for_byte_what_the_switcher_expects() {
        assert_eq!(hello(), HELLO_FIXTURE);
        let h = Header::parse(&HELLO_FIXTURE).unwrap();
        assert_eq!((h.flags, h.length, h.session), (HELLO, 20, HELLO_SESSION));
    }

    #[test]
    fn a_hello_reply_is_read() {
        let h = Header::parse(&HELLO_REPLY_FIXTURE).unwrap();
        assert!(h.has(HELLO));
        assert_eq!(h.session, 0x1A2B);
        assert_eq!(hello_answer(&HELLO_REPLY_FIXTURE), Some(HELLO_ACCEPTED));
    }

    #[test]
    fn acks_and_reliable_packets_round_trip() {
        let a = ack(0x8123, 77);
        assert_eq!(a, [0x80, 0x0C, 0x81, 0x23, 0x00, 0x4D, 0, 0, 0, 0, 0, 0]);
        let h = Header::parse(&a).unwrap();
        assert!(h.has(ACK_REPLY) && !h.has(ACK_REQUEST));
        assert_eq!((h.ack_id, h.length), (77, 12));

        let p = reliable(0x8123, 5, &[1, 2, 3, 4]);
        assert_eq!(
            p,
            [0x08, 0x10, 0x81, 0x23, 0, 0, 0, 0, 0, 0, 0x00, 0x05, 1, 2, 3, 4]
        );
        let h = Header::parse(&p).unwrap();
        assert_eq!((h.flags, h.length, h.packet_id), (ACK_REQUEST, 16, 5));
        let r = as_retransmit(&p);
        assert!(Header::parse(&r).unwrap().has(RETRANSMIT));
        assert_eq!(&r[1..], &p[1..]);
    }

    #[test]
    fn broken_headers_are_refused() {
        assert!(Header::parse(&[0x08, 0x0C, 0, 0]).is_none(), "too short");
        // Says 20 bytes, has 12.
        assert!(Header::parse(&[0x08, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]).is_none());
        // Says 4 bytes: less than a header.
        assert!(Header::parse(&[0x08, 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]).is_none());
    }

    #[test]
    fn packet_numbers_wrap() {
        assert_eq!(next_id(32767), 0);
        assert_eq!(next_id(5), 6);
        assert_eq!(distance(32766, 1), 3);
        assert!(at_or_before(32766, 1));
        assert!(!at_or_before(1, 32766));
        assert!(at_or_before(7, 7));
    }
}
