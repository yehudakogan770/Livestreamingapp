//! A camera's picture held back (Inputs → a camera → "Delay picture"), to
//! line up with sound that arrives later than the picture: the engine keeps
//! the camera's last frames and shows the one from that long ago (as the
//! Standard engine's `FrameDelay` does).

use std::collections::VecDeque;

use crate::frame::VideoFrame;

/// The most frames kept (four seconds at 60 frames a second).
const MOST: usize = 240;

#[derive(Default)]
pub struct DelayLine {
    frames: VecDeque<(u64, VideoFrame)>,
    last: Option<u64>,
}

impl DelayLine {
    /// The camera's newest frame, seen at `at` (ms); the same frame again is ignored.
    pub fn push(&mut self, at: u64, f: VideoFrame) {
        if self.last == Some(f.seq) {
            return;
        }
        self.last = Some(f.seq);
        self.frames.push_back((at, f));
        while self.frames.len() > MOST {
            self.frames.pop_front();
        }
    }

    /// The newest frame at least `delay` ms old at `now`; older ones are let go.
    pub fn get(&mut self, now: u64, delay: u64) -> Option<VideoFrame> {
        let cutoff = now.saturating_sub(delay);
        while self.frames.len() >= 2 && self.frames[1].0 <= cutoff {
            self.frames.pop_front();
        }
        self.frames
            .front()
            .filter(|(t, _)| *t <= cutoff)
            .map(|(_, f)| f.clone())
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{FramePool, PixelFormat};

    fn frame(pool: &FramePool, seq: u64) -> VideoFrame {
        VideoFrame::build(pool, 2, 2, PixelFormat::Rgba8, seq, |_| {})
    }

    #[test]
    fn shows_the_frame_from_that_long_ago() {
        let pool = FramePool::new(8);
        let mut d = DelayLine::default();
        for (i, t) in [0u64, 33, 66, 100, 133].into_iter().enumerate() {
            d.push(t, frame(&pool, i as u64));
        }
        // 100 ms held back at 133: the frame seen at 33.
        assert_eq!(d.get(133, 100).map(|f| f.seq), Some(1));
        // Nothing that old yet: nothing (the screen keeps what it had).
        let mut e = DelayLine::default();
        e.push(1000, frame(&pool, 9));
        assert!(e.get(1050, 100).is_none());
        assert_eq!(e.get(1100, 100).map(|f| f.seq), Some(9));
        // The same frame twice counts once; old frames are let go.
        e.push(1100, frame(&pool, 9));
        assert_eq!(e.len(), 1);
        assert_eq!(d.get(500, 100).map(|f| f.seq), Some(4));
        assert_eq!(d.len(), 1);
    }
}
