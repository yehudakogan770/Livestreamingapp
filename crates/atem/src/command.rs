//! The commands inside a packet.
//!
//! A packet's payload is a run of blocks, each:
//!
//! ```text
//! u16 length (8 + data) · u16 (unused) · 4-letter name · data
//! ```
//!
//! The switcher sends its state as blocks (`PrgI` program input, `TlSr`
//! tally…); the client sends what to do the same way (`CPgI` change program
//! input, `DAut` auto transition…).

use serde::{Deserialize, Serialize};

/// One block: its name and data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block<'a> {
    pub name: [u8; 4],
    pub data: &'a [u8],
}

impl Block<'_> {
    /// The name as text (`PrgI`).
    #[must_use]
    pub fn name(&self) -> &str {
        std::str::from_utf8(&self.name).unwrap_or("????")
    }
}

/// The blocks in a payload. A block whose length doesn't fit ends the list
/// (the rest of the packet can't be trusted).
#[must_use]
pub fn split(payload: &[u8]) -> Vec<Block<'_>> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at + 8 <= payload.len() {
        let len = usize::from(u16::from_be_bytes([payload[at], payload[at + 1]]));
        if len < 8 || at + len > payload.len() {
            break;
        }
        let mut name = [0u8; 4];
        name.copy_from_slice(&payload[at + 4..at + 8]);
        out.push(Block {
            name,
            data: &payload[at + 8..at + len],
        });
        at += len;
    }
    out
}

/// One block, written.
#[must_use]
pub fn block(name: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let len = (8 + data.len()) as u16;
    let mut out = Vec::with_capacity(8 + data.len());
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(name);
    out.extend_from_slice(data);
    out
}

/// A keyer or fade to black: on, off, or the other way from now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OnOff {
    On,
    Off,
    Toggle,
}

/// Something to tell the switcher to do. `me` is the mix effect bus (0 for
/// the first; most switchers have one).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Command {
    /// Cut: preview and program swap at once.
    Cut { me: u8 },
    /// Auto: the transition from program to preview, at its rate.
    Auto { me: u8 },
    /// Put an input straight on program (a cut to it).
    Program { me: u8, input: u16 },
    /// Line an input up on preview.
    Preview { me: u8, input: u16 },
    /// The style of the next transition (0 mix, 1 dip, 2 wipe, 3 DVE, 4 stinger).
    TransitionStyle { me: u8, style: u8 },
    /// The mix transition's length, in frames (1 – 250).
    MixRate { me: u8, frames: u8 },
    /// Fade to black: on or off at its rate (it toggles).
    FadeToBlack { me: u8 },
    /// How long fade to black takes, in frames.
    FadeToBlackRate { me: u8, frames: u8 },
    /// A downstream keyer straight on or off air.
    DskOnAir { keyer: u8, on: bool },
    /// A downstream keyer on or off air at its rate.
    DskAuto { keyer: u8 },
    /// An upstream keyer on or off air.
    UskOnAir { me: u8, keyer: u8, on: bool },
    /// Run a macro (0 is the first).
    RunMacro { index: u16 },
    /// Stop the macro that is running.
    StopMacro,
    /// The transition's position by hand (0 – 10 000).
    TbarPosition { me: u8, position: u16 },
}

impl Command {
    /// The block that says it.
    #[must_use]
    pub fn encode(&self) -> Vec<u8> {
        let input = |me: u8, i: u16| {
            let b = i.to_be_bytes();
            [me, 0, b[0], b[1]]
        };
        match *self {
            Command::Cut { me } => block(b"DCut", &[me, 0, 0, 0]),
            Command::Auto { me } => block(b"DAut", &[me, 0, 0, 0]),
            Command::Program { me, input: i } => block(b"CPgI", &input(me, i)),
            Command::Preview { me, input: i } => block(b"CPvI", &input(me, i)),
            // Mask 1: only the style changes (the next transition's keyers stay).
            Command::TransitionStyle { me, style } => block(b"CTTp", &[1, me, style, 0]),
            Command::MixRate { me, frames } => block(b"CTMx", &[me, frames.max(1), 0, 0]),
            Command::FadeToBlack { me } => block(b"FtbA", &[me, 0x02, 0, 0]),
            Command::FadeToBlackRate { me, frames } => block(b"FtbC", &[1, me, frames.max(1), 0]),
            Command::DskOnAir { keyer, on } => block(b"CDsL", &[keyer, u8::from(on), 0, 0]),
            Command::DskAuto { keyer } => block(b"DDsA", &[keyer, 0, 0, 0]),
            Command::UskOnAir { me, keyer, on } => block(b"CKOn", &[me, keyer, u8::from(on), 0]),
            Command::RunMacro { index } => {
                let b = index.to_be_bytes();
                block(b"MAct", &[b[0], b[1], 0, 0])
            }
            Command::StopMacro => block(b"MAct", &[0xFF, 0xFF, 1, 0]),
            Command::TbarPosition { me, position } => {
                let b = position.min(10_000).to_be_bytes();
                block(b"CTPs", &[me, 0, b[0], b[1]])
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_are_split_and_a_broken_one_ends_the_list() {
        // PrgI (ME 0, input 3) then PrvI (ME 0, input 4, not live), as a switcher sends them.
        let payload = [
            0x00, 0x0C, 0x00, 0x00, b'P', b'r', b'g', b'I', 0x00, 0x00, 0x00, 0x03, //
            0x00, 0x10, 0x00, 0x00, b'P', b'r', b'v', b'I', 0x00, 0x00, 0x00, 0x04, 0x00, 0x00,
            0x00, 0x00, //
            0x00, 0x40, 0x00, 0x00, b'X', b'X', b'X', b'X', 1, // says 64 bytes, has 9
        ];
        let b = split(&payload);
        assert_eq!(b.len(), 2);
        assert_eq!(b[0].name(), "PrgI");
        assert_eq!(b[0].data, &[0, 0, 0, 3]);
        assert_eq!(b[1].name(), "PrvI");
        assert_eq!(b[1].data.len(), 8);
    }

    #[test]
    fn commands_are_written_byte_for_byte() {
        let cases: [(Command, &[u8]); 14] = [
            (
                Command::Cut { me: 0 },
                b"\x00\x0c\x00\x00DCut\x00\x00\x00\x00",
            ),
            (
                Command::Auto { me: 1 },
                b"\x00\x0c\x00\x00DAut\x01\x00\x00\x00",
            ),
            (
                Command::Program { me: 0, input: 2001 },
                b"\x00\x0c\x00\x00CPgI\x00\x00\x07\xd1",
            ),
            (
                Command::Preview { me: 0, input: 4 },
                b"\x00\x0c\x00\x00CPvI\x00\x00\x00\x04",
            ),
            (
                Command::TransitionStyle { me: 0, style: 1 },
                b"\x00\x0c\x00\x00CTTp\x01\x00\x01\x00",
            ),
            (
                Command::MixRate { me: 0, frames: 30 },
                b"\x00\x0c\x00\x00CTMx\x00\x1e\x00\x00",
            ),
            (
                Command::FadeToBlack { me: 0 },
                b"\x00\x0c\x00\x00FtbA\x00\x02\x00\x00",
            ),
            (
                Command::FadeToBlackRate { me: 0, frames: 25 },
                b"\x00\x0c\x00\x00FtbC\x01\x00\x19\x00",
            ),
            (
                Command::DskOnAir { keyer: 1, on: true },
                b"\x00\x0c\x00\x00CDsL\x01\x01\x00\x00",
            ),
            (
                Command::DskAuto { keyer: 0 },
                b"\x00\x0c\x00\x00DDsA\x00\x00\x00\x00",
            ),
            (
                Command::UskOnAir {
                    me: 0,
                    keyer: 2,
                    on: false,
                },
                b"\x00\x0c\x00\x00CKOn\x00\x02\x00\x00",
            ),
            (
                Command::RunMacro { index: 3 },
                b"\x00\x0c\x00\x00MAct\x00\x03\x00\x00",
            ),
            (Command::StopMacro, b"\x00\x0c\x00\x00MAct\xff\xff\x01\x00"),
            (
                Command::TbarPosition {
                    me: 0,
                    position: 20_000,
                },
                b"\x00\x0c\x00\x00CTPs\x00\x00\x27\x10",
            ),
        ];
        for (c, want) in cases {
            assert_eq!(c.encode(), want, "{c:?}");
            // And they read back as one block each.
            let enc = c.encode();
            let b = split(&enc);
            assert_eq!(b.len(), 1);
            assert_eq!(&b[0].name, &want[4..8]);
        }
    }

    #[test]
    fn commands_come_from_json() {
        let c: Command = serde_json::from_str(r#"{"type":"program","me":0,"input":3}"#).unwrap();
        assert_eq!(c, Command::Program { me: 0, input: 3 });
    }
}
