@@@
    /// NV12 (cameras: Media Foundation's own format): the Y plane, then the U
    /// and V of each 2 × 2 block side by side. 12 bits a pixel; even sizes.
    Nv12,
}

impl PixelFormat {
    /// Bytes of a `w` × `h` frame.
    pub const fn frame_len(self, w: u32, h: u32) -> usize {
        let px = w as usize * h as usize;
        match self {
            PixelFormat::Nv12 => px * 3 / 2,
            _ => px * 4,
        }
    }
}
===
    /// NV12 (cameras: Media Foundation's own format): the Y plane, then the U
    /// and V of each 2 × 2 block side by side. 12 bits a pixel; even sizes.
    Nv12,
    /// HDR video files: 10-bit BT.2020 RGB in 32-bit little-endian words, R
    /// in the low bits (FFmpeg `x2bgr10le`), PQ or HLG (see [`crate::hdr`]).
    Rgb10(Hdr),
    /// HDR cameras: P010 (as NV12 with 16-bit samples, 10 bits at the top),
    /// BT.2020, PQ or HLG.
    P010(Hdr),
}

impl PixelFormat {
    /// Bytes of a `w` × `h` frame.
    pub const fn frame_len(self, w: u32, h: u32) -> usize {
        let px = w as usize * h as usize;
        match self {
            PixelFormat::Nv12 => px * 3 / 2,
            PixelFormat::P010(_) => px * 3,
            _ => px * 4,
        }
    }

    /// The transfer function of an HDR picture (None: SDR).
    pub const fn hdr(self) -> Option<Hdr> {
        match self {
            PixelFormat::Rgb10(h) | PixelFormat::P010(h) => Some(h),
            _ => None,
        }
    }
}
@@@
use std::sync::{Arc, Mutex, PoisonError};
===
use std::sync::{Arc, Mutex, PoisonError};

pub use crate::hdr::Hdr;
