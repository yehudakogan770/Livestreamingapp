//! The encoder feed: drawn frames of a screen, read back from the GPU, piped
//! raw into FFmpeg, which encodes them (NVENC, Quick Sync, AMF or x264, with
//! the arguments the app's `encode.rs` chooses) and hands back the encoded
//! stream in chunks. The app passes those chunks to the same recording and
//! streaming code the WebView's MediaRecorder feeds today (`capture.rs`), so
//! files, destinations, reconnects and failures all work as they do now.
//!
//! A frame that arrives while FFmpeg is still busy with older ones is dropped
//! (counted), never queued without end: timestamps come from the wall clock,
//! so a dropped frame is a repeated frame in the file, never a drift.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};

use serde::Serialize;

use crate::source::quiet;

/// How many frames may wait for FFmpeg before new ones are dropped.
const QUEUE: usize = 3;

/// How the feed is doing.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedStats {
    pub frames_in: u64,
    pub frames_dropped: u64,
    pub bytes_out: u64,
    /// FFmpeg's last words when it stopped by itself.
    pub error: Option<String>,
}

pub struct EncoderFeed {
    tx: Option<SyncSender<Vec<u8>>>,
    child: Arc<Mutex<Child>>,
    frames: Arc<AtomicU64>,
    dropped: Arc<AtomicU64>,
    bytes: Arc<AtomicU64>,
    error: Arc<Mutex<Option<String>>>,
    threads: Vec<JoinHandle<()>>,
    frame_len: usize,
}

/// FFmpeg's arguments for raw RGBA frames of `w` × `h` arriving on stdin
/// (timestamped by the wall clock), then `encode` (codec and rate), then
/// `container` (e.g. `-f matroska -`).
pub fn args(w: u32, h: u32, fps: u32, encode: &[String], container: &[String]) -> Vec<String> {
    let mut a: Vec<String> = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-use_wallclock_as_timestamps",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-s",
    ]
    .iter()
    .map(|s| (*s).to_owned())
    .collect();
    a.push(format!("{w}x{h}"));
    a.extend([
        "-framerate".to_owned(),
        fps.to_string(),
        "-i".to_owned(),
        "-".to_owned(),
    ]);
    a.extend([
        "-fps_mode".to_owned(),
        "cfr".to_owned(),
        "-r".to_owned(),
        fps.to_string(),
    ]);
    a.extend(encode.iter().cloned());
    a.extend(container.iter().cloned());
    a
}

impl EncoderFeed {
    /// Start FFmpeg. `on_chunk` gets the encoded stream as it comes out.
    ///
    /// # Errors
    /// FFmpeg could not start.
    pub fn start(
        ffmpeg: &Path,
        w: u32,
        h: u32,
        fps: u32,
        encode: &[String],
        container: &[String],
        mut on_chunk: Box<dyn FnMut(Vec<u8>) + Send>,
    ) -> Result<Self, String> {
        let mut child = quiet(ffmpeg)
            .args(args(w, h, fps, encode, container))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("FFmpeg could not start: {e}"))?;
        let mut stdin = child.stdin.take().ok_or("FFmpeg has no input.")?;
        let mut stdout = child.stdout.take().ok_or("FFmpeg has no output.")?;
        let mut stderr = child.stderr.take().ok_or("FFmpeg has no messages.")?;
        let (tx, rx) = sync_channel::<Vec<u8>>(QUEUE);
        let bytes = Arc::new(AtomicU64::new(0));
        let error = Arc::new(Mutex::new(None));
        let mut threads = Vec::new();
        threads.push(
            thread::Builder::new()
                .name("lumora-live-encode-in".into())
                .spawn(move || {
                    for f in rx {
                        if stdin.write_all(&f).is_err() {
                            break;
                        }
                    }
                    // Dropping stdin tells FFmpeg the picture ended.
                })
                .map_err(|e| e.to_string())?,
        );
        let b = Arc::clone(&bytes);
        threads.push(
            thread::Builder::new()
                .name("lumora-live-encode-out".into())
                .spawn(move || {
                    let mut buf = vec![0u8; 256 * 1024];
                    while let Ok(n) = stdout.read(&mut buf) {
                        if n == 0 {
                            break;
                        }
                        b.fetch_add(n as u64, Ordering::Relaxed);
                        on_chunk(buf[..n].to_vec());
                    }
                })
                .map_err(|e| e.to_string())?,
        );
        let e = Arc::clone(&error);
        threads.push(
            thread::Builder::new()
                .name("lumora-live-encode-log".into())
                .spawn(move || {
                    let mut text = String::new();
                    let _ = stderr.read_to_string(&mut text);
                    if let Some(last) = text.lines().rev().find(|l| !l.trim().is_empty()) {
                        *e.lock().unwrap_or_else(PoisonError::into_inner) = Some(last.to_owned());
                    }
                })
                .map_err(|e| e.to_string())?,
        );
        Ok(EncoderFeed {
            tx: Some(tx),
            child: Arc::new(Mutex::new(child)),
            frames: Arc::default(),
            dropped: Arc::default(),
            bytes,
            error,
            threads,
            frame_len: w as usize * h as usize * 4,
        })
    }

    /// One frame (RGBA, top row first). Returns false when it was dropped
    /// (FFmpeg busy) or FFmpeg has stopped.
    pub fn push(&self, frame: Vec<u8>) -> bool {
        if frame.len() != self.frame_len {
            return false;
        }
        self.frames.fetch_add(1, Ordering::Relaxed);
        let Some(tx) = &self.tx else { return false };
        match tx.try_send(frame) {
            Ok(()) => true,
            Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) => {
                self.dropped.fetch_add(1, Ordering::Relaxed);
                false
            }
        }
    }

    pub fn stats(&self) -> FeedStats {
        FeedStats {
            frames_in: self.frames.load(Ordering::Relaxed),
            frames_dropped: self.dropped.load(Ordering::Relaxed),
            bytes_out: self.bytes.load(Ordering::Relaxed),
            error: self
                .error
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone(),
        }
    }

    /// Whether FFmpeg is still running.
    pub fn alive(&self) -> bool {
        self.child
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .try_wait()
            .is_ok_and(|s| s.is_none())
    }

    /// End the picture and wait for FFmpeg to write the last of it.
    pub fn finish(mut self) -> FeedStats {
        self.tx = None;
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
        let _ = self
            .child
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .wait();
        self.stats()
    }
}

impl Drop for EncoderFeed {
    fn drop(&mut self) {
        if self.tx.take().is_some() {
            let _ = self
                .child
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_frames_in_encoded_stream_out() {
        let a = args(
            1280,
            720,
            30,
            &["-c:v".into(), "libx264".into()],
            &["-f".into(), "matroska".into(), "-".into()],
        );
        let s = a.join(" ");
        assert!(
            s.contains("-f rawvideo -pix_fmt rgba -s 1280x720 -framerate 30 -i -"),
            "{s}"
        );
        assert!(s.contains("-use_wallclock_as_timestamps 1"));
        assert!(s.ends_with("-c:v libx264 -f matroska -"), "{s}");
    }

    /// A real encode when FFmpeg is installed (skipped otherwise).
    #[test]
    fn encodes_with_ffmpeg_when_present() {
        let ffmpeg = std::path::PathBuf::from(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        if quiet(&ffmpeg).arg("-version").output().is_err() {
            eprintln!("no FFmpeg here; skipped");
            return;
        }
        let out = Arc::new(Mutex::new(Vec::<u8>::new()));
        let o = Arc::clone(&out);
        let feed = EncoderFeed::start(
            &ffmpeg,
            64,
            36,
            30,
            &["-c:v".into(), "mpeg4".into()],
            &["-f".into(), "matroska".into(), "-".into()],
            Box::new(move |c| o.lock().unwrap().extend(c)),
        )
        .expect("starts");
        for i in 0..10u8 {
            let mut sent = feed.push(vec![i * 20; 64 * 36 * 4]);
            let mut tries = 0;
            while !sent && tries < 100 {
                std::thread::sleep(std::time::Duration::from_millis(5));
                sent = feed.push(vec![i * 20; 64 * 36 * 4]);
                tries += 1;
            }
        }
        assert!(
            !feed.push(vec![0; 3]),
            "a frame of the wrong size is refused"
        );
        let stats = feed.finish();
        let bytes = out.lock().unwrap();
        assert!(bytes.len() > 100, "encoded output arrived ({stats:?})");
        // Matroska starts with the EBML magic number.
        assert_eq!(&bytes[..4], &[0x1a, 0x45, 0xdf, 0xa3]);
    }
}
