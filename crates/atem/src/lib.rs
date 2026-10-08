//! # Blackmagic ATEM switcher control
//!
//! ATEM switchers are controlled over UDP port 9910 with Blackmagic's own
//! protocol, the one ATEM Software Control uses. Blackmagic does not publish
//! it, but it is well known from open-source work (the MIT-licensed
//! `atem-connection`, `libqatemcontrol`). This is Lumora's own
//! implementation, written from that public knowledge.
//!
//! - [`packet`]: the 12-byte header every datagram starts with (flags,
//!   length, session, acknowledgements, packet numbers).
//! - [`command`]: the commands inside a packet, read ([`command::split`])
//!   and written ([`command::Command`]).
//! - [`state`]: the switcher's state as those commands describe it (model,
//!   inputs, program and preview, transition, fade to black, keyers,
//!   macros, tally).
//! - [`session`]: the reliable-delivery state machine (hello, acks,
//!   in-order delivery, resends, timeouts). It has no socket in it, so it
//!   can be tested against a fake switcher.
//! - [`client`]: a session on a real UDP socket, on its own thread, that
//!   reconnects by itself.

pub mod client;
pub mod command;
pub mod packet;
pub mod session;
pub mod state;

pub use client::{Client, Status};
pub use command::Command;
pub use state::{Input, SwitcherState, TransitionStyle};

/// The UDP port ATEM switchers listen on.
pub const PORT: u16 = 9910;
