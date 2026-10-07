//! Video frames and the pool their pixels come from.
//!
//! A camera at 1080p60 makes 8 MB of pixels 60 times a second. Allocating
//! that afresh for every frame churns the allocator (and on Windows the page
//! faults show up as dropped frames), so buffers go back to a pool when the
//! last user drops them and the next frame reuses one.

use std::sync::{Arc, Mutex, PoisonError};

/// How the pixels are laid out (8 bits a channel, top row first, no padding).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PixelFormat {
    /// R, G, B, A (FFmpeg `rgba`, test patterns, overlays).
    Rgba8,
    /// B, G, R, A (Windows `ARGB32`).
    Bgra8,
    /// B, G, R and a byte to ignore (Windows `RGB32` from Media Foundation: opaque).
    Bgrx8,
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

/// Buffers waiting to be reused, by length.
#[derive(Default)]
struct PoolInner {
    free: Vec<Vec<u8>>,
    /// Buffers made since the pool started (for the statistics).
    allocated: u64,
}

/// A pool of pixel buffers. Cheap to clone (shared).
#[derive(Clone, Default)]
pub struct FramePool {
    inner: Arc<Mutex<PoolInner>>,
    /// Most buffers kept for reuse.
    keep: usize,
}

impl FramePool {
    /// A pool that keeps up to `keep` spare buffers.
    pub fn new(keep: usize) -> Self {
        FramePool {
            inner: Arc::default(),
            keep,
        }
    }

    /// A buffer of exactly `len` bytes (contents unspecified: the caller fills it).
    pub fn take(&self, len: usize) -> PooledBuf {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let buf = match inner.free.iter().position(|b| b.len() == len) {
            Some(i) => inner.free.swap_remove(i),
            None => {
                inner.allocated += 1;
                vec![0; len]
            }
        };
        PooledBuf {
            buf: Some(buf),
            pool: self.clone(),
        }
    }

    fn give_back(&self, buf: Vec<u8>) {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        if inner.free.len() < self.keep {
            inner.free.push(buf);
        }
    }

    /// How many buffers were ever made (a steady number means reuse works).
    pub fn allocated(&self) -> u64 {
        self.inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .allocated
    }
}

/// Pixels borrowed from a [`FramePool`]; they go back when dropped.
pub struct PooledBuf {
    buf: Option<Vec<u8>>,
    pool: FramePool,
}

impl PooledBuf {
    pub fn as_slice(&self) -> &[u8] {
        self.buf.as_deref().unwrap_or(&[])
    }
    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        self.buf.as_deref_mut().unwrap_or(&mut [])
    }
}

impl Drop for PooledBuf {
    fn drop(&mut self) {
        if let Some(b) = self.buf.take() {
            self.pool.give_back(b);
        }
    }
}

impl std::fmt::Debug for PooledBuf {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PooledBuf({} bytes)", self.as_slice().len())
    }
}

/// One picture from a source.
#[derive(Debug, Clone)]
pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    pub format: PixelFormat,
    /// Shared so the newest frame can be handed out without copying.
    pub data: Arc<PooledBuf>,
    /// Counts up by one for each new frame of this source.
    pub seq: u64,
}

impl VideoFrame {
    /// A frame of `width` × `height` filled by `fill` (row-major, 4 bytes a pixel).
    pub fn build(
        pool: &FramePool,
        width: u32,
        height: u32,
        format: PixelFormat,
        seq: u64,
        fill: impl FnOnce(&mut [u8]),
    ) -> Self {
        let mut buf = pool.take(format.frame_len(width, height));
        fill(buf.as_mut_slice());
        VideoFrame {
            width,
            height,
            format,
            data: Arc::new(buf),
            seq,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffers_are_reused_once_dropped() {
        let pool = FramePool::new(4);
        for i in 0..100 {
            let f = VideoFrame::build(&pool, 64, 36, PixelFormat::Rgba8, i, |px| px.fill(7));
            assert_eq!(f.data.as_slice().len(), 64 * 36 * 4);
        }
        assert_eq!(pool.allocated(), 1, "one buffer, reused a hundred times");
    }

    #[test]
    fn a_buffer_still_in_use_is_not_handed_out_twice() {
        let pool = FramePool::new(4);
        let a = pool.take(16);
        let b = pool.take(16);
        assert_eq!(pool.allocated(), 2);
        drop((a, b));
        let _c = pool.take(16);
        let _d = pool.take(32);
        assert_eq!(pool.allocated(), 3, "a different size is a new buffer");
    }
}
