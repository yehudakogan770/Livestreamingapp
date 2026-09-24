//! # Lumora engine
//!
//! The engine owns the show — every source, what is on each screen, the
//! transition, blank and panic state — and is the only thing allowed to change
//! it. Windows, remotes and cues all send [`Action`]s; the engine checks each
//! one, applies it, and everyone receives the new [`Show`].
//!
//! Design rules (see `docs/ARCHITECTURE.md`):
//! - One source of truth: nothing else keeps its own copy of show state.
//! - An invalid action is refused with a clear [`ActionError`] and changes nothing.
//! - Time is passed in, never read, so behaviour is reproducible and testable.

pub mod action;
pub mod engine;
pub mod model;
pub mod persist;
pub mod timing;

pub use action::{Action, ActionError, NewSource, SourcePatch};
pub use engine::{Engine, Outcome};
pub use model::*;
pub use timing::{in_transition, source_ended, source_position, transition_progress};
