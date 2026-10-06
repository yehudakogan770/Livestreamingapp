//! When each frame is shown. The editor keeps the sound and the playhead; it
//! tells the engine where playing starts (and, now and then, where it is), and
//! sends the frames a little ahead. The engine's own clock then puts each frame
//! on screen at its moment, so a busy page never makes the picture stutter.

use std::collections::BTreeMap;

/// Where the playhead is at any moment (seconds on the engine's own clock).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Clock {
    /// The frame at `at`.
    pub frame: f64,
    pub at: f64,
    pub fps: f64,
    /// 1 is normal, negative is backwards, 0 is stopped.
    pub speed: f64,
}

impl Clock {
    pub fn stopped(frame: f64) -> Self {
        Self {
            frame,
            at: 0.0,
            fps: 30.0,
            speed: 0.0,
        }
    }

    pub fn playing(&self) -> bool {
        self.speed != 0.0
    }

    /// The frame (with its fraction) at a moment.
    pub fn frame_at(&self, now: f64) -> f64 {
        self.frame + (now - self.at) * self.fps * self.speed
    }

    /// The editor says where the playhead is: a big difference jumps there, a
    /// small one is taken up gently (a tenth at a time) so no frame repeats or skips.
    pub fn sync(&mut self, frame: f64, now: f64) {
        let mine = self.frame_at(now);
        let drift = frame - mine;
        let step = if drift.abs() > 1.5 {
            drift
        } else {
            drift * 0.1
        };
        self.frame = mine + step;
        self.at = now;
    }

    /// When a frame number comes up (forward or backward), or never.
    pub fn time_of(&self, frame: f64) -> Option<f64> {
        if !self.playing() {
            return None;
        }
        Some(self.at + (frame - self.frame) / (self.fps * self.speed))
    }
}

/// The frames sent ahead, waiting for their moment.
#[derive(Debug, Default)]
pub struct Queue<T> {
    frames: BTreeMap<i64, T>,
    /// The last frame shown.
    pub shown: Option<i64>,
    pub dropped: u64,
}

/// The most frames kept waiting.
pub const QUEUE_MAX: usize = 48;

impl<T> Queue<T> {
    pub fn new() -> Self {
        Self {
            frames: BTreeMap::new(),
            shown: None,
            dropped: 0,
        }
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }
    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }
    pub fn clear(&mut self) {
        self.frames.clear();
    }
    pub fn values(&self) -> impl Iterator<Item = &T> {
        self.frames.values()
    }

    /// Let go of frames far from `center` (the playhead jumped: they are for somewhere else).
    pub fn retain_near(&mut self, center: f64, radius: f64) {
        self.frames
            .retain(|k, _| (*k as f64 - center).abs() <= radius);
    }

    /// A frame for later (one already there is replaced: it was drawn again after an edit).
    pub fn push(&mut self, frame: i64, item: T) {
        self.frames.insert(frame, item);
        while self.frames.len() > QUEUE_MAX {
            self.frames.pop_first();
        }
    }

    /// The frame to show for the clock's frame `now` (moving in `dir`): the
    /// newest that has come up and isn't on screen already. Frames passed over
    /// count as dropped; ones behind are let go.
    pub fn take(&mut self, now: f64, dir: f64) -> Option<(i64, T)> {
        let target = now.floor() as i64;
        let pick = if dir >= 0.0 {
            self.frames.range(..=target).next_back().map(|(k, _)| *k)
        } else {
            self.frames.range(target..).next().map(|(k, _)| *k)
        }?;
        if self.shown == Some(pick) {
            return None;
        }
        // Everything passed over is gone.
        let passed: Vec<i64> = if dir >= 0.0 {
            self.frames.range(..pick).map(|(k, _)| *k).collect()
        } else {
            self.frames.range(pick + 1..).map(|(k, _)| *k).collect()
        };
        if let Some(last) = self.shown {
            let jump = (pick - last).unsigned_abs();
            if jump > 1 && jump < 1000 {
                self.dropped += jump - 1;
            }
        }
        for k in passed {
            self.frames.remove(&k);
        }
        let item = self.frames.remove(&pick)?;
        self.shown = Some(pick);
        Some((pick, item))
    }

    /// The next frame due after `now` (for how long to sleep).
    pub fn next_after(&self, now: f64, dir: f64) -> Option<i64> {
        let target = now.floor() as i64;
        if dir >= 0.0 {
            self.frames.range(target + 1..).next().map(|(k, _)| *k)
        } else {
            self.frames.range(..target).next_back().map(|(k, _)| *k)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_frames_along() {
        let c = Clock {
            frame: 100.0,
            at: 10.0,
            fps: 25.0,
            speed: 1.0,
        };
        assert!((c.frame_at(11.0) - 125.0).abs() < 1e-9);
        let back = Clock { speed: -2.0, ..c };
        assert!((back.frame_at(11.0) - 50.0).abs() < 1e-9);
        assert_eq!(c.time_of(150.0), Some(12.0));
        assert_eq!(Clock::stopped(3.0).time_of(4.0), None);
        assert!(!Clock::stopped(3.0).playing());
    }

    #[test]
    fn small_drift_is_taken_up_gently_and_big_jumps_at_once() {
        let mut c = Clock {
            frame: 0.0,
            at: 0.0,
            fps: 30.0,
            speed: 1.0,
        };
        c.sync(31.0, 1.0); // one frame ahead of the engine
        assert!((c.frame_at(1.0) - 30.1).abs() < 1e-9);
        c.sync(400.0, 2.0); // the editor jumped
        assert!((c.frame_at(2.0) - 400.0).abs() < 1e-9);
        // It keeps counting from there.
        assert!((c.frame_at(3.0) - 430.0).abs() < 1e-9);
    }

    #[test]
    fn shows_each_frame_at_its_moment() {
        let mut q = Queue::new();
        for f in 10..20 {
            q.push(f, f * 10);
        }
        assert_eq!(q.take(9.5, 1.0), None);
        assert_eq!(q.take(10.2, 1.0), Some((10, 100)));
        // Still frame 10's moment: nothing new.
        assert_eq!(q.take(10.9, 1.0), None);
        assert_eq!(q.take(11.0, 1.0), Some((11, 110)));
        assert_eq!(q.dropped, 0);
        // Late: 12 and 13 are passed over.
        assert_eq!(q.take(14.3, 1.0), Some((14, 140)));
        assert_eq!(q.dropped, 2);
        assert_eq!(q.len(), 5);
        assert_eq!(q.next_after(14.3, 1.0), Some(15));
    }

    #[test]
    fn plays_backwards_too() {
        let mut q = Queue::new();
        for f in 0..10 {
            q.push(f, ());
        }
        assert_eq!(q.take(8.7, -1.0).map(|x| x.0), Some(8));
        assert_eq!(q.take(7.9, -1.0).map(|x| x.0), Some(7));
        assert_eq!(q.take(4.1, -1.0).map(|x| x.0), Some(4));
        assert_eq!(q.dropped, 2);
        assert_eq!(q.next_after(4.1, -1.0), Some(3));
    }

    #[test]
    fn a_jump_lets_go_of_frames_for_elsewhere() {
        let mut q = Queue::new();
        for f in [5, 6, 7, 500, 501] {
            q.push(f, ());
        }
        q.retain_near(6.0, 30.0);
        assert_eq!(q.len(), 3);
        assert_eq!(q.take(7.0, 1.0).map(|x| x.0), Some(7));
    }

    #[test]
    fn keeps_a_bounded_queue_and_takes_the_newest_version() {
        let mut q = Queue::new();
        for f in 0..(QUEUE_MAX as i64 + 10) {
            q.push(f, 0);
        }
        assert_eq!(q.len(), QUEUE_MAX);
        q.push(20, 7);
        assert_eq!(q.take(20.0, 1.0), Some((20, 7)));
    }
}
