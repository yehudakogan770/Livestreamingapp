//! # Lumora unified live engine (beta)
//!
//! One engine for every picture Lumora puts out (see `docs/ENGINE.md`):
//!
//! - each input (camera, video file, picture) is opened **once**, on its own
//!   thread ([`source`]), whatever shows it;
//! - every screen (Live, Back, Monitor, and the Next previews) is drawn
//!   **once** a frame on the GPU ([`gpu`]) from a pure description of what it
//!   shows ([`scene`], built from the show with the same transition maths as
//!   the web screens: [`mix`]);
//! - the drawn screens go to every destination from there: native windows on
//!   the assigned displays ([`present`], Windows), the recording / stream
//!   encoder ([`encoder`]), and small previews for the control window
//!   ([`engine`]).
//!
//! Graphics (titles, countdowns, scoreboards…) stay drawn by web code: a
//! hidden web overlay renderer per screen draws them into transparent planes
//! and sends what changed ([`overlay`]); the engine draws them in their place.
//!
//! Selected in Settings → Engine; the Standard engine (every window draws its
//! own copy in its WebView) stays the default.

pub mod audio;
pub mod encoder;
pub mod engine;
pub mod feeds;
pub mod frame;
pub mod gpu;
pub mod mix;
pub mod overlay;
pub mod present;
pub mod scene;
pub mod source;

#[cfg(windows)]
pub mod mf;

pub use wgpu;
