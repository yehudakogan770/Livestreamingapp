//! The encrypted link between a seat and the show computer.
//!
//! **Pairing** (first time): an X25519 key exchange with a commitment, then
//! a 6-digit code read off the show computer's screen and typed on the
//! joining computer (a "short authentication string").
//!
//! 1. seat → show: `commit = SHA-256(seat key ‖ seat nonce)`
//! 2. show → seat: show key, show nonce
//! 3. seat → show: seat key, seat nonce (the show checks the commitment)
//! 4. both: the shared secret and every value above give the session keys
//!    and the code. The show computer shows the code; the person at the seat
//!    types it, the seat checks it itself, and only then sends it (encrypted)
//!    so the show knows a person who can see its screen is at that seat.
//!
//! Someone in the middle has to commit to their key before they see the
//! show's nonce, so their two codes match by chance one time in a million,
//! and a wrong code ends the attempt (and repeated wrong codes lock the
//! address out for a while).
//!
//! **Reconnecting** (after approval): the show gives the seat a 32-byte seat
//! secret, kept on both computers. Each connection makes fresh X25519 keys
//! and mixes the seat secret in, so only those two computers can read it
//! (each side proves itself by the other decrypting its first message).
//!
//! Messages are sealed with ChaCha20-Poly1305 and numbered, so nothing can
//! be read, changed, replayed or reordered on the way.

use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305};
use ring::agreement::{self, EphemeralPrivateKey, UnparsedPublicKey, X25519};
use ring::digest::{self, SHA256};
use ring::hkdf::{Salt, HKDF_SHA256};
use ring::rand::{SecureRandom, SystemRandom};

/// Something went wrong with the keys or a message did not open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CryptoError;

impl std::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the secure link failed")
    }
}

impl std::error::Error for CryptoError {}

/// Random bytes from the operating system.
#[must_use]
pub fn random<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    // The system's random source does not fail on any supported system.
    SystemRandom::new().fill(&mut out).expect("random numbers");
    out
}

#[must_use]
pub fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
}

/// # Errors
/// Not even-length hex.
pub fn unhex(text: &str) -> Result<Vec<u8>, CryptoError> {
    let t = text.as_bytes();
    if !t.len().is_multiple_of(2) {
        return Err(CryptoError);
    }
    t.chunks(2)
        .map(|c| {
            std::str::from_utf8(c)
                .ok()
                .and_then(|s| u8::from_str_radix(s, 16).ok())
                .ok_or(CryptoError)
        })
        .collect()
}

/// Equal, taking the same time whichever byte differs.
#[must_use]
pub fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

/// This side's fresh key pair for one connection.
pub struct KeyPair {
    private: EphemeralPrivateKey,
    pub public: [u8; 32],
    pub nonce: [u8; 32],
}

impl KeyPair {
    /// # Errors
    /// The system could not make a key.
    pub fn new() -> Result<KeyPair, CryptoError> {
        let rng = SystemRandom::new();
        let private = EphemeralPrivateKey::generate(&X25519, &rng).map_err(|_| CryptoError)?;
        let public = private.compute_public_key().map_err(|_| CryptoError)?;
        let public: [u8; 32] = public.as_ref().try_into().map_err(|_| CryptoError)?;
        Ok(KeyPair {
            private,
            public,
            nonce: random(),
        })
    }

    /// What the seat sends first when pairing.
    #[must_use]
    pub fn commitment(&self) -> [u8; 32] {
        commitment(&self.public, &self.nonce)
    }
}

/// `SHA-256(key ‖ nonce)`.
#[must_use]
pub fn commitment(public: &[u8], nonce: &[u8]) -> [u8; 32] {
    let mut ctx = digest::Context::new(&SHA256);
    ctx.update(b"lumora-seat-commit-v1");
    ctx.update(public);
    ctx.update(nonce);
    ctx.finish().as_ref().try_into().unwrap_or([0; 32])
}

/// Which end of the link this is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Seat,
    Show,
}

/// Seals what this side sends.
pub struct Sealer {
    key: LessSafeKey,
    n: u64,
}

/// Opens what the other side sends.
pub struct Opener {
    key: LessSafeKey,
    n: u64,
}

fn nonce(n: u64) -> Nonce {
    let mut b = [0u8; 12];
    b[4..].copy_from_slice(&n.to_be_bytes());
    Nonce::assume_unique_for_key(b)
}

impl Sealer {
    /// # Errors
    /// The message is too long to seal.
    pub fn seal(&mut self, plain: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let mut buf = plain.to_vec();
        self.key
            .seal_in_place_append_tag(nonce(self.n), Aad::empty(), &mut buf)
            .map_err(|_| CryptoError)?;
        self.n += 1;
        Ok(buf)
    }
}

impl Opener {
    /// # Errors
    /// Changed on the way, out of order, or sealed with another key.
    pub fn open(&mut self, sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let mut buf = sealed.to_vec();
        let len = self
            .key
            .open_in_place(nonce(self.n), Aad::empty(), &mut buf)
            .map_err(|_| CryptoError)?
            .len();
        buf.truncate(len);
        self.n += 1;
        Ok(buf)
    }
}

/// The keys for one connection, and the pairing code.
pub struct Session {
    pub sealer: Sealer,
    pub opener: Opener,
    /// The 6-digit code (pairing only; it is derived either way).
    pub code: String,
}

/// The public values both ends agree on.
pub struct Transcript<'a> {
    pub seat_key: &'a [u8],
    pub seat_nonce: &'a [u8],
    pub show_key: &'a [u8],
    pub show_nonce: &'a [u8],
}

fn key(bytes: &[u8; 32]) -> Result<LessSafeKey, CryptoError> {
    Ok(LessSafeKey::new(
        UnboundKey::new(&CHACHA20_POLY1305, bytes).map_err(|_| CryptoError)?,
    ))
}

/// Make this connection's keys. `seat_secret`: `None` when pairing, the
/// seat's secret when reconnecting.
///
/// # Errors
/// The other side's key is not a valid key.
pub fn session(
    side: Side,
    mine: KeyPair,
    t: &Transcript<'_>,
    seat_secret: Option<&[u8]>,
) -> Result<Session, CryptoError> {
    let peer = match side {
        Side::Seat => t.show_key,
        Side::Show => t.seat_key,
    };
    let shared =
        agreement::agree_ephemeral(mine.private, &UnparsedPublicKey::new(&X25519, peer), |k| {
            k.to_vec()
        })
        .map_err(|_| CryptoError)?;
    let mut ctx = digest::Context::new(&SHA256);
    ctx.update(if seat_secret.is_some() {
        b"lumora-seat-resume-v1"
    } else {
        b"lumora-seat-pair-v1\0\0"
    });
    for part in [t.seat_key, t.seat_nonce, t.show_key, t.show_nonce] {
        ctx.update(part);
    }
    let transcript = ctx.finish();
    let mut ikm = shared;
    if let Some(s) = seat_secret {
        ikm.extend_from_slice(s);
    }
    let prk = Salt::new(HKDF_SHA256, transcript.as_ref()).extract(&ikm);
    let expand = |label: &[u8]| -> Result<[u8; 32], CryptoError> {
        let mut out = [0u8; 32];
        prk.expand(&[label], HKDF_SHA256)
            .map_err(|_| CryptoError)?
            .fill(&mut out)
            .map_err(|_| CryptoError)?;
        Ok(out)
    };
    let to_show = expand(b"seat to show")?;
    let to_seat = expand(b"show to seat")?;
    let code_bytes = expand(b"pairing code")?;
    let mut n = [0u8; 8];
    n.copy_from_slice(&code_bytes[..8]);
    let code = format!("{:06}", u64::from_be_bytes(n) % 1_000_000);
    let (send, recv) = match side {
        Side::Seat => (to_show, to_seat),
        Side::Show => (to_seat, to_show),
    };
    Ok(Session {
        sealer: Sealer {
            key: key(&send)?,
            n: 0,
        },
        opener: Opener {
            key: key(&recv)?,
            n: 0,
        },
        code,
    })
}

/// The code as typed (spaces and dashes left out), if it is 6 digits.
#[must_use]
pub fn clean_code(typed: &str) -> Option<String> {
    let digits: String = typed
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    (digits.len() == 6 && digits.bytes().all(|b| b.is_ascii_digit())).then_some(digits)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair(secret_seat: Option<&[u8]>, secret_show: Option<&[u8]>) -> (Session, Session) {
        let seat = KeyPair::new().unwrap();
        let show = KeyPair::new().unwrap();
        let (sk, sn, hk, hn) = (seat.public, seat.nonce, show.public, show.nonce);
        let t = Transcript {
            seat_key: &sk,
            seat_nonce: &sn,
            show_key: &hk,
            show_nonce: &hn,
        };
        (
            session(Side::Seat, seat, &t, secret_seat).unwrap(),
            session(Side::Show, show, &t, secret_show).unwrap(),
        )
    }

    #[test]
    fn both_ends_get_the_same_code_and_can_talk() {
        let (mut seat, mut show) = pair(None, None);
        assert_eq!(seat.code, show.code);
        assert_eq!(seat.code.len(), 6);
        let m = seat.sealer.seal(b"take").unwrap();
        assert_ne!(&m[..4], b"take");
        assert_eq!(show.opener.open(&m).unwrap(), b"take");
        let r = show.sealer.seal(b"ok").unwrap();
        assert_eq!(seat.opener.open(&r).unwrap(), b"ok");
    }

    #[test]
    fn a_changed_replayed_or_reordered_message_does_not_open() {
        let (mut seat, mut show) = pair(None, None);
        let a = seat.sealer.seal(b"one").unwrap();
        let b = seat.sealer.seal(b"two").unwrap();
        // Out of order.
        assert!(show.opener.open(&b).is_err());
        let (mut seat, mut show) = pair(None, None);
        let mut a2 = seat.sealer.seal(b"one").unwrap();
        a2[0] ^= 1;
        assert!(show.opener.open(&a2).is_err());
        let _ = a;
        // Replayed.
        let (mut seat, mut show) = pair(None, None);
        let m = seat.sealer.seal(b"one").unwrap();
        assert!(show.opener.open(&m).is_ok());
        assert!(show.opener.open(&m).is_err());
    }

    #[test]
    fn reconnecting_needs_the_seat_secret() {
        let secret = random::<32>();
        let (mut seat, mut show) = pair(Some(&secret), Some(&secret));
        let m = seat.sealer.seal(b"hello").unwrap();
        assert_eq!(show.opener.open(&m).unwrap(), b"hello");
        let other = random::<32>();
        let (mut seat, mut show) = pair(Some(&other), Some(&secret));
        let m = seat.sealer.seal(b"hello").unwrap();
        assert!(show.opener.open(&m).is_err());
    }

    #[test]
    fn commitments_and_codes() {
        let k = KeyPair::new().unwrap();
        assert_eq!(k.commitment(), commitment(&k.public, &k.nonce));
        assert_ne!(k.commitment(), commitment(&k.public, &[0; 32]));
        assert_eq!(clean_code("123 456").as_deref(), Some("123456"));
        assert_eq!(clean_code("123-456").as_deref(), Some("123456"));
        assert_eq!(clean_code("12345"), None);
        assert_eq!(clean_code("12345a"), None);
        assert_eq!(unhex(&hex(&[0, 255, 16])).unwrap(), vec![0, 255, 16]);
        assert!(unhex("abc").is_err());
        assert!(same(b"abc", b"abc") && !same(b"abc", b"abd") && !same(b"ab", b"abc"));
    }
}
