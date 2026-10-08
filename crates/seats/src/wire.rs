//! What goes over the network between a seat and the show computer.
//!
//! TCP, each message a 4-byte length (big-endian) and then the message. The
//! first few messages (the key exchange) are plain JSON; everything after is
//! JSON sealed with the connection's keys (see `crypto.rs`).

use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::role::{Refusal, Role};
use crate::sync::Op;

/// The protocol's version (both computers must speak the same one).
pub const VERSION: u32 = 1;
/// The usual port for seats (TCP), and for finding shows by broadcast (UDP).
pub const DEFAULT_PORT: u16 = 8097;
/// Longest message: a whole show with long scripts and many slides.
pub const MAX_FRAME: usize = 32 << 20;
/// Longest message before the link is encrypted.
pub const MAX_PLAIN: usize = 4096;

/// # Errors
/// The connection failed.
pub fn write_frame(w: &mut impl Write, data: &[u8]) -> io::Result<()> {
    let len = u32::try_from(data.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "too long"))?;
    let mut buf = Vec::with_capacity(data.len() + 4);
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(data);
    w.write_all(&buf)?;
    w.flush()
}

/// # Errors
/// The connection failed or the message is longer than `max`.
pub fn read_frame(r: &mut impl Read, max: usize) -> io::Result<Vec<u8>> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len)?;
    let len = u32::from_be_bytes(len) as usize;
    if len > max {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "message too long",
        ));
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)?;
    Ok(buf)
}

/// The key exchange (not encrypted; nothing secret in it).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Plain {
    /// Seat → show: "I'd like to join" (first time).
    PairHello {
        v: u32,
        name: String,
        commit: String,
    },
    /// Show → seat.
    PairChallenge {
        key: String,
        nonce: String,
        show: String,
        show_id: String,
    },
    /// Seat → show: the values it committed to.
    PairOpen { key: String, nonce: String },
    /// Seat → show: "I'm back" (an approved seat).
    ResumeHello {
        v: u32,
        name: String,
        seat: String,
        key: String,
        nonce: String,
    },
    /// Show → seat.
    ResumeChallenge {
        key: String,
        nonce: String,
        show: String,
        show_id: String,
    },
    /// Show → seat: no (and why), then the connection closes.
    Refused { code: String, message: String },
}

/// A seat as the seat itself sees it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatView {
    pub id: String,
    pub name: String,
    pub role: Role,
    pub locked: bool,
}

/// Show → seat (encrypted).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ToSeat {
    /// Pairing: the code was right; waiting for the show operator.
    Waiting,
    /// In. `secret` (hex) is sent once, when the seat is first approved.
    Welcome {
        seat: SeatView,
        show: String,
        show_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        secret: Option<String>,
    },
    /// The whole document (see `sync::document`).
    State {
        rev: u64,
        doc: Value,
    },
    /// What changed since `base`.
    Diff {
        base: u64,
        rev: u64,
        ops: Vec<Op>,
    },
    /// The seat's role or lock changed.
    Seat {
        seat: SeatView,
    },
    /// The answer to a request.
    Result {
        id: u64,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        refusal: Option<Refusal>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// A small picture of a screen or input (JPEG, Base64).
    Preview {
        key: String,
        jpeg: String,
    },
    /// The mixer's levels (as the show computer's control window sends them).
    Meters {
        meters: Value,
    },
    Pong {
        t: u64,
    },
    /// The show operator removed this seat (`forget`: it has to pair again),
    /// or the show computer stopped letting seats join.
    Bye {
        reason: String,
        #[serde(default)]
        forget: bool,
    },
}

/// Seat → show (encrypted).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FromSeat {
    /// Pairing: the code the person typed (already checked by the seat).
    Confirm { code: String },
    /// Change the show (`action` as the engine takes it).
    Action { id: u64, action: Value },
    /// Recording / streaming / replay (see `role::SeatCommand`).
    Command { id: u64, command: Value },
    /// Move a PTZ camera (`source`: its input; `command` as the app's PTZ control takes it).
    Ptz {
        id: u64,
        source: String,
        command: Value,
    },
    /// `rtt`: the last round trip, in milliseconds (shown to the operator).
    Ping {
        t: u64,
        #[serde(default)]
        rtt: Option<u32>,
    },
    /// The pictures this seat wants (`program/live`, `next/live`, `source/<id>`, `meters`).
    Watch { keys: Vec<String> },
    /// This copy missed a change: send the whole document.
    Resync,
    /// The person left the show.
    Leave,
}

/// The text is not Base64.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NotBase64;

/// Base64 (standard, with padding).
#[must_use]
pub fn base64(data: &[u8]) -> String {
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

/// # Errors
/// Not Base64.
pub fn unbase64(text: &str) -> Result<Vec<u8>, NotBase64> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let (mut acc, mut bits) = (0u32, 0u32);
    for b in text.bytes() {
        let v = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return Err(NotBase64),
        };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip_and_long_ones_are_refused() {
        let mut buf = Vec::new();
        write_frame(&mut buf, b"hello").unwrap();
        write_frame(&mut buf, b"").unwrap();
        let mut r = &buf[..];
        assert_eq!(read_frame(&mut r, 100).unwrap(), b"hello");
        assert_eq!(read_frame(&mut r, 100).unwrap(), b"");
        let mut big = Vec::new();
        write_frame(&mut big, &[0; 200]).unwrap();
        assert!(read_frame(&mut &big[..], 100).is_err());
    }

    #[test]
    fn messages_look_as_documented() {
        let m = serde_json::to_value(FromSeat::Action {
            id: 3,
            action: serde_json::json!({"type": "take", "screen": "live"}),
        })
        .unwrap();
        assert_eq!(m["type"], "action");
        assert_eq!(m["action"]["type"], "take");
        let w = serde_json::to_value(Plain::PairChallenge {
            key: "k".into(),
            nonce: "n".into(),
            show: "Gala".into(),
            show_id: "x".into(),
        })
        .unwrap();
        assert_eq!(w["type"], "pairChallenge");
        assert_eq!(w["showId"], "x");
    }

    #[test]
    fn base64_round_trips() {
        for n in 0..20u8 {
            let data: Vec<u8> = (0..n).map(|i| i.wrapping_mul(37)).collect();
            assert_eq!(unbase64(&base64(&data)).unwrap(), data);
        }
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"M"), "TQ==");
        assert!(unbase64("**").is_err());
    }
}
