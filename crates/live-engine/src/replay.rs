//! Instant replay from the engine's own frames.
//!
//! While replay is on, an encoder feed of the Live Screen (the engine's
//! picture, the Stream mix's sound) is encoded with the hardware encoder the
//! recordings use and cut by FFmpeg's segment muxer into short **pieces**
//! on disk, each starting on a whole picture (a key frame is forced at each
//! cut). Only the last minute is kept: older pieces are deleted as new ones
//! come (a ring). Taking a replay finishes the piece being written (waits
//! for its cut, at most [`PIECE_S`] seconds), picks the pieces that cover
//! the last seconds asked for and copies them out; the app lines them up as
//! a playlist video, which the engine plays as one of its own inputs (at the
//! replay's speed: slow motion is paced by the engine, see
//! [`crate::source::Clip`]). Nothing is drawn or encoded in a WebView.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Length of each piece (seconds), as the WebView's replay buffer.
pub const PIECE_S: u32 = 3;
/// How much is kept.
pub const KEEP_MS: u64 = 60_000;
/// FFmpeg's list of the pieces it has finished.
pub const LIST: &str = "pieces.csv";

/// The output side of FFmpeg's arguments: pieces of `piece_s` seconds into `dir`.
pub fn container_args(dir: &Path, piece_s: u32) -> Vec<String> {
    vec![
        "-f".into(),
        "segment".into(),
        "-segment_time".into(),
        piece_s.max(1).to_string(),
        "-segment_format".into(),
        "matroska".into(),
        "-reset_timestamps".into(),
        "1".into(),
        "-segment_list".into(),
        dir.join(LIST).to_string_lossy().into_owned(),
        "-segment_list_type".into(),
        "csv".into(),
        "-y".into(),
        dir.join("piece-%05d.mkv").to_string_lossy().into_owned(),
    ]
}

/// A key frame at every cut, so each piece starts on a whole picture (with
/// the video encoder's arguments).
pub fn keyframe_args(piece_s: u32) -> Vec<String> {
    vec![
        "-force_key_frames".into(),
        format!("expr:gte(t,n_forced*{})", piece_s.max(1)),
    ]
}

/// A finished piece: its file and when it was (ms on the wall clock).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Piece {
    pub path: PathBuf,
    pub start_ms: u64,
    pub end_ms: u64,
}

impl Piece {
    pub fn duration_s(&self) -> f64 {
        self.end_ms.saturating_sub(self.start_ms) as f64 / 1000.0
    }
}

/// FFmpeg's CSV list (`file,start,end` in seconds from the feed's start) as pieces; `t0_ms` is that start.
pub fn parse_list(text: &str, dir: &Path, t0_ms: u64) -> Vec<Piece> {
    text.lines()
        .filter_map(|l| {
            let mut it = l.trim().rsplitn(3, ',');
            let end: f64 = it.next()?.trim().parse().ok()?;
            let start: f64 = it.next()?.trim().parse().ok()?;
            let name = it.next()?.trim().trim_matches('"');
            // Only a plain file name of the ring, never a path.
            if name.is_empty()
                || name.contains(['/', '\\'])
                || !(start.is_finite() && end.is_finite())
            {
                return None;
            }
            Some(Piece {
                path: dir.join(name),
                start_ms: t0_ms + (start.max(0.0) * 1000.0) as u64,
                end_ms: t0_ms + (end.max(0.0) * 1000.0) as u64,
            })
        })
        .collect()
}

/// The pieces covering the last `ms` before `now`, oldest first (`piecesFor`).
pub fn covering(pieces: &[Piece], ms: u64, now: u64) -> Vec<Piece> {
    let from = now.saturating_sub(ms);
    pieces.iter().filter(|p| p.end_ms > from).cloned().collect()
}

/// The pieces on disk while replay is on.
#[derive(Debug)]
pub struct Ring {
    pub dir: PathBuf,
    /// When the feed's first frame was (ms on the wall clock).
    pub t0_ms: u64,
    pub piece_s: u32,
}

impl Ring {
    /// A ring in `dir`, emptied of anything left from before.
    ///
    /// # Errors
    /// The folder could not be made.
    pub fn new(dir: &Path, piece_s: u32) -> std::io::Result<Ring> {
        if dir.exists() {
            for e in std::fs::read_dir(dir)?.flatten() {
                let _ = std::fs::remove_file(e.path());
            }
        }
        std::fs::create_dir_all(dir)?;
        Ok(Ring {
            dir: dir.to_owned(),
            t0_ms: 0,
            piece_s: piece_s.max(1),
        })
    }

    /// The pieces FFmpeg has finished (and that are still there).
    pub fn pieces(&self) -> Vec<Piece> {
        let text = std::fs::read_to_string(self.dir.join(LIST)).unwrap_or_default();
        parse_list(&text, &self.dir, self.t0_ms)
            .into_iter()
            .filter(|p| p.path.exists())
            .collect()
    }

    /// Delete the pieces older than [`KEEP_MS`]; how many went.
    pub fn prune(&self, now: u64) -> usize {
        let from = now.saturating_sub(KEEP_MS);
        let old: Vec<Piece> = self
            .pieces()
            .into_iter()
            .filter(|p| p.end_ms <= from)
            .collect();
        old.iter()
            .filter(|p| std::fs::remove_file(&p.path).is_ok())
            .count()
    }

    /// The last `ms` before `now`: waits (at most `wait`) for the piece being
    /// written to be finished, so the replay ends at `now`, then the pieces that cover it.
    pub fn take(&self, ms: u64, now: u64, wait: Duration) -> Vec<Piece> {
        let deadline = Instant::now() + wait;
        loop {
            let pieces = self.pieces();
            // Within a frame or so of `now` counts as finished.
            let done = pieces.last().is_some_and(|p| p.end_ms + 100 >= now);
            if done || Instant::now() >= deadline {
                return covering(&pieces, ms, now);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

/// Copy `pieces` out of the ring into `to` as `<prefix>-<n>.mkv` (they
/// outlive the ring: the replay plays them); the copies and their lengths.
///
/// # Errors
/// A piece could not be copied.
pub fn copy_out(pieces: &[Piece], to: &Path, prefix: &str) -> std::io::Result<Vec<(PathBuf, f64)>> {
    std::fs::create_dir_all(to)?;
    let safe: String = prefix
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    pieces
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let dest = to.join(format!("{safe}-{}.mkv", i + 1));
            std::fs::copy(&p.path, &dest)?;
            Ok((dest, p.duration_s()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffmpegs_list_becomes_pieces_on_the_wall_clock() {
        let dir = Path::new("/ring");
        let list = "piece-00000.mkv,0.000000,3.000000\npiece-00001.mkv,3.000000,6.033333\n../evil.mkv,6,9\nbad line\n";
        let p = parse_list(list, dir, 10_000);
        assert_eq!(
            p,
            vec![
                Piece {
                    path: dir.join("piece-00000.mkv"),
                    start_ms: 10_000,
                    end_ms: 13_000
                },
                Piece {
                    path: dir.join("piece-00001.mkv"),
                    start_ms: 13_000,
                    end_ms: 16_033
                },
            ]
        );
        assert!((p[1].duration_s() - 3.033).abs() < 1e-9);
        // The last 4 s before 16 s: both pieces; the last 2 s: only the second.
        assert_eq!(covering(&p, 4000, 16_000).len(), 2);
        assert_eq!(covering(&p, 2000, 16_000).len(), 1);
    }

    #[test]
    fn the_segment_muxer_is_asked_for_whole_pictures_at_each_cut() {
        let a = container_args(Path::new("ring"), 3).join(" ");
        assert!(a.starts_with("-f segment -segment_time 3 -segment_format matroska"));
        assert!(a.contains("-segment_list_type csv"));
        assert!(a.ends_with("piece-%05d.mkv"), "{a}");
        assert_eq!(
            keyframe_args(3),
            vec!["-force_key_frames", "expr:gte(t,n_forced*3)"]
        );
    }

    #[test]
    fn old_pieces_go_and_a_take_copies_the_last_seconds_out() {
        let base = std::env::temp_dir().join(format!("lumora-ring-{}", std::process::id()));
        let dir = base.join("ring");
        let mut ring = Ring::new(&dir, 3).unwrap();
        ring.t0_ms = 1_000_000;
        let mut list = String::new();
        for i in 0..30u64 {
            let name = format!("piece-{i:05}.mkv");
            std::fs::write(dir.join(&name), [i as u8]).unwrap();
            list.push_str(&format!("{name},{}.0,{}.0\n", i * 3, (i + 1) * 3));
        }
        std::fs::write(dir.join(LIST), list).unwrap();
        let now = 1_000_000 + 90_000;
        // A minute is kept: the first ten pieces (0 – 30 s) go.
        assert_eq!(ring.prune(now), 10);
        assert_eq!(ring.pieces().len(), 20);
        // The last 5 s (the last piece finished at `now`): two pieces.
        let took = ring.take(5000, now, Duration::from_millis(10));
        assert_eq!(took.len(), 2);
        let out = copy_out(&took, &base.join("replays"), "replay-x/1").unwrap();
        assert_eq!(out.len(), 2);
        assert!(out[0].0.ends_with("replay-x_1-1.mkv"));
        assert_eq!(std::fs::read(&out[1].0).unwrap(), vec![29]);
        // A new ring starts empty.
        let ring = Ring::new(&dir, 3).unwrap();
        assert!(ring.pieces().is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }
}
