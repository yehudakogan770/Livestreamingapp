//! Exporting a video made frame by frame in the control window (the 3D logo
//! maker). Each frame arrives as raw RGBA pixels and goes straight into
//! FFmpeg, which encodes MP4 (H.264), MOV (ProRes 4444, keeps transparency)
//! or WebM (VP9, keeps transparency).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    Mp4,
    Mov,
    Webm,
}

impl Format {
    pub fn extension(self) -> &'static str {
        match self {
            Format::Mp4 => "mp4",
            Format::Mov => "mov",
            Format::Webm => "webm",
        }
    }

    fn codec(self) -> &'static [&'static str] {
        match self {
            Format::Mp4 => &[
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                "18",
                "-preset",
                "medium",
                "-movflags",
                "+faststart",
            ],
            Format::Mov => &[
                "-c:v",
                "prores_ks",
                "-profile:v",
                "4444",
                "-pix_fmt",
                "yuva444p10le",
            ],
            Format::Webm => &[
                "-c:v",
                "libvpx-vp9",
                "-pix_fmt",
                "yuva420p",
                "-b:v",
                "0",
                "-crf",
                "28",
                "-deadline",
                "good",
                "-cpu-used",
                "4",
                "-row-mt",
                "1",
            ],
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub format: Format,
}

struct Job {
    child: Child,
    stdin: Option<ChildStdin>,
    frame_len: usize,
    path: PathBuf,
}

/// Videos being exported (usually one).
#[derive(Default)]
pub struct Exports {
    jobs: Mutex<HashMap<u64, Job>>,
    next: AtomicU64,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Exports {
    /// Start encoding. Returns the session to send frames to.
    ///
    /// # Errors
    /// No FFmpeg, a size that makes no sense, or FFmpeg would not start.
    pub fn start(&self, ffmpeg: Option<&Path>, s: &ExportSettings) -> Result<u64, String> {
        let ffmpeg = ffmpeg.ok_or(
            "Exporting video needs FFmpeg, which isn't installed on this computer.".to_owned(),
        )?;
        if !(16..=7680).contains(&s.width) || !(16..=7680).contains(&s.height) {
            return Err("That size can't be exported.".to_owned());
        }
        if !(1..=120).contains(&s.fps) {
            return Err("Frame rate must be 1 – 120.".to_owned());
        }
        let mut path = PathBuf::from(&s.path);
        if path.extension().and_then(|e| e.to_str()) != Some(s.format.extension()) {
            path.set_extension(s.format.extension());
        }
        let mut child = Command::new(ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y"])
            .args(["-f", "rawvideo", "-pix_fmt", "rgba"])
            .args(["-s", &format!("{}x{}", s.width, s.height)])
            .args(["-r", &s.fps.to_string(), "-i", "-"])
            .args(s.format.codec())
            .arg(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("FFmpeg would not start: {e}"))?;
        let stdin = child.stdin.take();
        let session = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        lock(&self.jobs).insert(
            session,
            Job {
                child,
                stdin,
                frame_len: s.width as usize * s.height as usize * 4,
                path,
            },
        );
        Ok(session)
    }

    /// One frame of raw RGBA pixels.
    ///
    /// # Errors
    /// Unknown session, the wrong number of bytes, or FFmpeg stopped.
    pub fn frame(&self, session: u64, bytes: &[u8]) -> Result<(), String> {
        let mut jobs = lock(&self.jobs);
        let job = jobs.get_mut(&session).ok_or("That export has stopped.")?;
        if bytes.len() != job.frame_len {
            return Err("A frame was the wrong size.".to_owned());
        }
        let ok = job
            .stdin
            .as_mut()
            .is_some_and(|w| w.write_all(bytes).is_ok());
        if ok {
            Ok(())
        } else {
            let mut job = jobs.remove(&session).expect("present");
            Err(finish_job(&mut job)
                .err()
                .unwrap_or_else(|| "FFmpeg stopped.".to_owned()))
        }
    }

    /// All frames sent: wait for the file. Returns its path.
    ///
    /// # Errors
    /// FFmpeg failed (the message says why).
    pub fn finish(&self, session: u64) -> Result<String, String> {
        let mut job = lock(&self.jobs)
            .remove(&session)
            .ok_or("That export has stopped.")?;
        finish_job(&mut job)?;
        Ok(job.path.to_string_lossy().into_owned())
    }

    /// Stop and throw the half-made file away.
    pub fn cancel(&self, session: u64) {
        if let Some(mut job) = lock(&self.jobs).remove(&session) {
            job.stdin = None;
            let _ = job.child.kill();
            let _ = job.child.wait();
            let _ = std::fs::remove_file(&job.path);
        }
    }
}

fn finish_job(job: &mut Job) -> Result<(), String> {
    job.stdin = None; // end of input: FFmpeg finishes the file
    let mut said = String::new();
    if let Some(mut err) = job.child.stderr.take() {
        let _ = err.read_to_string(&mut said);
    }
    let status = job.child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        let _ = std::fs::remove_file(&job.path);
        let line = said.lines().last().unwrap_or("unknown problem").to_owned();
        Err(format!("The video could not be made: {line}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lumora-export-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn probe(path: &str) -> String {
        let out = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_name,width,height,pix_fmt",
                "-of",
                "csv=p=0",
            ])
            .arg(path)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }

    #[test]
    fn frames_become_a_video_in_each_format() {
        let Some(ffmpeg) = crate::capture::find_ffmpeg() else {
            eprintln!("no ffmpeg: skipped");
            return;
        };
        let d = temp("formats");
        let ex = Exports::default();
        for (format, codec) in [
            (Format::Mp4, "h264"),
            (Format::Mov, "prores"),
            (Format::Webm, "vp9"),
        ] {
            let s = ExportSettings {
                path: d.join("logo").to_string_lossy().into_owned(),
                width: 64,
                height: 36,
                fps: 10,
                format,
            };
            let id = ex.start(Some(&ffmpeg), &s).unwrap();
            let mut frame = vec![0u8; 64 * 36 * 4];
            for i in 0..10u8 {
                for px in frame.chunks_mut(4) {
                    px.copy_from_slice(&[i * 20, 100, 200, 128]);
                }
                ex.frame(id, &frame).unwrap();
            }
            assert!(ex.frame(id, &[0; 10]).is_err(), "wrong size");
            let path = ex.finish(id).unwrap();
            assert!(path.ends_with(format.extension()));
            let info = probe(&path);
            assert!(info.starts_with(codec), "{format:?}: {info}");
            assert!(info.contains("64,36"), "{info}");
        }
    }

    #[test]
    fn a_cancelled_export_leaves_no_file() {
        let Some(ffmpeg) = crate::capture::find_ffmpeg() else {
            return;
        };
        let d = temp("cancel");
        let ex = Exports::default();
        let s = ExportSettings {
            path: d.join("gone.mp4").to_string_lossy().into_owned(),
            width: 64,
            height: 36,
            fps: 10,
            format: Format::Mp4,
        };
        let id = ex.start(Some(&ffmpeg), &s).unwrap();
        ex.frame(id, &vec![0u8; 64 * 36 * 4]).unwrap();
        ex.cancel(id);
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert!(!d.join("gone.mp4").exists());
        assert!(ex.finish(id).is_err());
    }

    #[test]
    fn no_ffmpeg_says_so() {
        let ex = Exports::default();
        let s = ExportSettings {
            path: "x".into(),
            width: 64,
            height: 36,
            fps: 10,
            format: Format::Mp4,
        };
        assert!(ex.start(None, &s).unwrap_err().contains("FFmpeg"));
    }
}
