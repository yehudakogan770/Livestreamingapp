//! Operator seats: two or more people run one show from separate computers.
//!
//! The **show computer** runs the show (cameras, outputs, recording) and
//! lets other computers on the venue network join as **seats**. Each seat
//! has a role chosen by the show operator (Director, Graphics, Audio,
//! Replay, Cameras or Custom), enforced here on the show computer for every
//! request (`role.rs`); the joining computer is never trusted.
//!
//! - `discovery.rs`: finding shows (mDNS `_lumora._tcp` and a UDP broadcast).
//! - `crypto.rs`: pairing with a 6-digit code, then an encrypted link.
//! - `wire.rs`: the messages.
//! - `sync.rs`: the whole show on joining, then only what changed.
//! - `server.rs`: the show computer's side.
//! - `client.rs`: the joining computer's side.
//!
//! The show never depends on a seat: a seat that drops, lags or misbehaves
//! is let go and nothing happens to the show.

pub mod client;
pub mod crypto;
pub mod discovery;
pub mod role;
pub mod server;
pub mod sync;
pub mod wire;

pub use client::{LinkEvents, LinkStatus, Pairing, SeatLink};
pub use discovery::{discover, FoundShow};
pub use role::{group_of, seat_may, seat_may_command, Group, Refusal, Role, SeatCommand};
pub use server::{computer_name, SeatBackend, SeatServer, SeatsStatus};
