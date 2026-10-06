//! Lumora Studio's native playback engine.
//!
//! The editor (TypeScript) keeps every editing decision: for each frame it
//! records the GPU passes its WebGL compositor would run and sends them here
//! ([`plan`]). This crate decodes the video with FFmpeg ([`decode`]), runs the
//! same programs on the GPU with wgpu ([`glsl`] translates the editor's own
//! shaders; [`gpu`] runs them), and shows each frame at its moment ([`clock`])
//! in a window placed exactly over the program monitor ([`engine`]).

pub mod blend;
pub mod clock;
pub mod decode;
pub mod engine;
pub mod glsl;
pub mod gpu;
pub mod plan;
#[cfg(windows)]
pub mod win;
pub mod yuv;

pub use wgpu;
