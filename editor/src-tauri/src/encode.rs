//! Delivery encoding: the editor draws each frame and hands its pixels to
//! FFmpeg, which encodes them with any codec it has (H.265, ProRes, DNxHR,
//! PNG, GIF, or the graphics card's own encoder). Also finds out which
//! encoders work on this computer (NVENC, Quick Sync, AMF need the hardware,
//! not just FFmpeg's support for them).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::export::{explain, fill};
use crate::media::quiet;

/// Encoders Lumora Studio knows how to drive.
pub const KNOWN: &[&str] = &[
    "libx264",
    "libx265",
    "h264_nvenc",
    "hevc_nvenc",
    "h264_qsv",
    "hevc_qsv",
    "h264_amf",
    "hevc_amf",
    "h264_videotoolbox",
    "hevc_videotoolbox",
    "prores_ks",
    "dnxhd",
    "png",
    "gif",
    "aac",
    "libmp3lame",
    "pcm_s16le",
    "pcm_s24le",
    "mov_text",
];

/// A graphics card's (or the processor's media engine's) encoder.
#[must_use]
pub fn is_hardware(name: &str) -> bool {
    ["_nvenc", "_qsv", "_amf", "_videotoolbox"]
        .iter()
        .any(|s| name.ends_with(s))
}

/// The encoders in `ffmpeg -encoders` output that Lumora Studio knows.
#[must_use]
pub fn parse_encoders(said: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut started = false;
    for line in said.lines() {
        let t = line.trim();
        if t.starts_with("------") {
            started = true;
            continue;
        }
        if !started {
            continue;
        }
        let mut parts = t.split_whitespace();
        let (Some(flags), Some(name)) = (parts.next(), parts.next()) else {
            continue;
        };
        // Flags look like "V....D" / "A....." / "S.....".
        if flags.len() != 6 || !flags.starts_with(['V', 'A', 'S']) {
            continue;
        }
        if KNOWN.contains(&name) && !out.iter().any(|n| n == name) {
            out.push(name.to_owned());
        }
    }
    out
}

/// Encode a few frames with an encoder: does it really work here?
fn works(ffmpeg: &Path, name: &str) -> bool {
    let pix = if name.ends_with("_qsv") || name.ends_with("_amf") || name.ends_with("_videotoolbox")
    {
        "nv12"
    } else {
        "yuv420p"
    };
    let Ok(mut child) = quiet(ffmpeg)
        .args([
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x240:r=30",
            "-frames:v",
            "3",
            "-pix_fmt",
            pix,
            "-c:v",
            name,
            "-f",
            "null",
            "-",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let until = Instant::now() + Duration::from_secs(12);
    loop {
        match child.try_wait() {
            Ok(Some(s)) => return s.success(),
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(40)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

/// The encoders that work on this computer (hardware ones are tried for real, side by side).
#[must_use]
pub fn available(ffmpeg: &Path) -> Vec<String> {
    let said = quiet(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .stderr(Stdio::null())
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let listed = parse_encoders(&said);
    let checks: Vec<(String, Option<JoinHandle<bool>>)> = listed
        .into_iter()
        .map(|n| {
            if is_hardware(&n) {
                let ff = ffmpeg.to_path_buf();
                let name = n.clone();
                (n, Some(std::thread::spawn(move || works(&ff, &name))))
            } else {
                (n, None)
            }
        })
        .collect();
    checks
        .into_iter()
        .filter_map(|(n, h)| match h {
            None => Some(n),
            Some(h) => h.join().unwrap_or(false).then_some(n),
        })
        .collect()
}

struct Enc {
    child: Child,
    stdin: Option<ChildStdin>,
    said: Option<JoinHandle<String>>,
    frame_bytes: usize,
}

impl Enc {
    /// Close the input and wait for FFmpeg to finish the file.
    fn finish(&mut self) -> Result<(), String> {
        drop(self.stdin.take());
        let status = self.child.wait();
        let said = self
            .said
            .take()
            .and_then(|h| h.join().ok())
            .unwrap_or_default();
        match status {
            Ok(s) if s.success() => Ok(()),
            _ => Err(explain(&said)),
        }
    }
}

impl Drop for Enc {
    fn drop(&mut self) {
        if self.stdin.is_some() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

/// Open encoders, by number.
#[derive(Default)]
pub struct Encoders {
    open: Mutex<HashMap<u32, Arc<Mutex<Enc>>>>,
    next: AtomicU32,
    /// The encoders that work here (found once).
    found: Mutex<Option<Vec<String>>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Encoders {
    /// Encoders that work on this computer (found the first time, then remembered).
    pub fn available(&self, ffmpeg: &Path) -> Vec<String> {
        if let Some(v) = lock(&self.found).as_ref() {
            return v.clone();
        }
        let v = available(ffmpeg);
        *lock(&self.found) = Some(v.clone());
        v
    }

    /// Start FFmpeg reading raw frames from its input (`args` say how; `{tmp}` and `{out}` are filled in).
    ///
    /// # Errors
    /// FFmpeg can't start, or the frame size is unreasonable.
    pub fn open(
        &self,
        ffmpeg: &Path,
        args: &[String],
        tmp: &Path,
        out: &Path,
        frame_bytes: usize,
    ) -> Result<u32, String> {
        if frame_bytes == 0 || frame_bytes > 8192 * 8192 * 8 {
            return Err("That frame size can't be encoded.".into());
        }
        let filled: Vec<String> = args.iter().map(|a| fill(a, tmp, out)).collect();
        let mut child = quiet(ffmpeg)
            .args(["-hide_banner", "-y", "-loglevel", "error"])
            .args(&filled)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("FFmpeg could not start: {e}"))?;
        let stdin = child.stdin.take();
        let stderr = child.stderr.take();
        let said = std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(mut e) = stderr {
                let _ = e.read_to_string(&mut s);
            }
            s
        });
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        lock(&self.open).insert(
            id,
            Arc::new(Mutex::new(Enc {
                child,
                stdin,
                said: Some(said),
                frame_bytes,
            })),
        );
        Ok(id)
    }

    fn get(&self, id: u32) -> Result<Arc<Mutex<Enc>>, String> {
        lock(&self.open)
            .get(&id)
            .cloned()
            .ok_or_else(|| "That encoder is closed.".to_owned())
    }

    /// Hand FFmpeg one frame.
    ///
    /// # Errors
    /// The frame is the wrong size, or FFmpeg stopped (its reason is given).
    pub fn frame(&self, id: u32, bytes: &[u8]) -> Result<(), String> {
        let enc = self.get(id)?;
        let mut e = lock(&enc);
        if bytes.len() != e.frame_bytes {
            return Err(format!(
                "A frame of {} bytes was sent; {} were expected.",
                bytes.len(),
                e.frame_bytes
            ));
        }
        let wrote = e
            .stdin
            .as_mut()
            .ok_or("The encoder is finished.")?
            .write_all(bytes);
        if wrote.is_err() {
            // FFmpeg stopped: say why.
            let why = e.finish().err().unwrap_or_else(|| "FFmpeg stopped.".into());
            drop(e);
            lock(&self.open).remove(&id);
            return Err(why);
        }
        Ok(())
    }

    /// No more frames: wait for the file to be finished.
    ///
    /// # Errors
    /// FFmpeg could not finish the file.
    pub fn close(&self, id: u32) -> Result<(), String> {
        let enc = lock(&self.open)
            .remove(&id)
            .ok_or("That encoder is closed.")?;
        let mut e = lock(&enc);
        e.finish()
    }

    /// Stop without finishing (the file is left half made).
    pub fn abort(&self, id: u32) {
        let enc = lock(&self.open).remove(&id);
        if let Some(enc) = enc {
            let mut e = lock(&enc);
            let _ = e.child.kill();
            drop(e.stdin.take());
            let _ = e.child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = "Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V....D h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video acceleration) (codec h264)
 V....D hevc_amf             AMD AMF HEVC encoder (codec hevc)
 VFS..D prores_ks            Apple ProRes (iCodec Pro) (codec prores)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 A....D aac                  AAC (Advanced Audio Coding)
 S..... mov_text             3GPP Timed Text subtitle
";

    #[test]
    fn reads_the_encoder_list() {
        let found = parse_encoders(LIST);
        assert_eq!(
            found,
            vec![
                "libx264",
                "h264_nvenc",
                "h264_qsv",
                "hevc_amf",
                "prores_ks",
                "aac",
                "mov_text"
            ]
        );
        // The legend above the line is not an encoder list.
        assert!(!found.iter().any(|n| n == "="));
        assert!(parse_encoders("nothing here").is_empty());
    }

    #[test]
    fn knows_hardware_encoders() {
        assert!(is_hardware("hevc_nvenc"));
        assert!(is_hardware("h264_qsv"));
        assert!(is_hardware("h264_amf"));
        assert!(is_hardware("hevc_videotoolbox"));
        assert!(!is_hardware("libx264"));
        assert!(!is_hardware("prores_ks"));
    }

    #[test]
    fn refuses_unreasonable_frames() {
        let e = Encoders::default();
        let r = e.open(
            Path::new("ffmpeg"),
            &[],
            Path::new("/w"),
            Path::new("/o"),
            0,
        );
        assert!(r.is_err());
        assert!(e.frame(7, &[0; 4]).is_err());
        assert!(e.close(7).is_err());
    }
}
