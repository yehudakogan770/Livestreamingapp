//! Frames of an original the editor can't decode itself (ProRes, DNxHR,
//! 10-bit, HDR…), read by FFmpeg and handed over one at a time, so the film is
//! made from the original rather than from its edit-friendly copy.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::{Child, ChildStdout, Stdio};
use std::sync::Mutex;

use crate::formats::{plan, reader_args};
use crate::media::{probe, quiet};

struct Reader {
    child: Child,
    out: ChildStdout,
    frame: usize,
}

impl Drop for Reader {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Open frame readers, by number.
#[derive(Default)]
pub struct Readers {
    open: Mutex<HashMap<u32, Reader>>,
    next: Mutex<u32>,
}

/// The size of one RGBA frame.
#[must_use]
pub fn frame_bytes(width: u32, height: u32) -> usize {
    width as usize * height as usize * 4
}

impl Readers {
    /// Start reading a file at `from` seconds, `rate` frames a second, at `width`×`height`.
    ///
    /// # Errors
    /// FFmpeg can't start, or the size is unreasonable.
    pub fn open(
        &self,
        ffmpeg: &Path,
        file: &Path,
        from: f64,
        rate: f64,
        width: u32,
        height: u32,
    ) -> Result<u32, String> {
        if width == 0
            || height == 0
            || width > 8192
            || height > 8192
            || !(rate > 0.0 && rate <= 240.0)
        {
            return Err("That frame size can't be read.".into());
        }
        let info = probe(ffmpeg, file)?;
        let plan = plan(file, &info);
        let mut child = quiet(ffmpeg)
            .args(reader_args(
                file,
                &plan,
                from.max(0.0),
                rate,
                width,
                height,
                plan.tone_map,
            ))
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("FFmpeg could not start: {e}"))?;
        let out = child.stdout.take().ok_or("FFmpeg gave no frames.")?;
        let reader = Reader {
            child,
            out,
            frame: frame_bytes(width, height),
        };
        let id = {
            let mut n = self.next.lock().map_err(|e| e.to_string())?;
            *n += 1;
            *n
        };
        self.open
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, reader);
        Ok(id)
    }

    /// The next frame (empty at the end of the file).
    ///
    /// # Errors
    /// The reader isn't open.
    pub fn next(&self, id: u32) -> Result<Vec<u8>, String> {
        // Taken out while reading, so other readers aren't held up.
        let mut r = self
            .open
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id)
            .ok_or("That reader is closed.")?;
        let mut buf = vec![0u8; r.frame];
        let got = read_full(&mut r.out, &mut buf);
        if got == buf.len() {
            self.open.lock().map_err(|e| e.to_string())?.insert(id, r);
            Ok(buf)
        } else {
            Ok(Vec::new())
        }
    }

    pub fn close(&self, id: u32) {
        if let Ok(mut open) = self.open.lock() {
            open.remove(&id);
        }
    }
}

/// Read until the buffer is full or the stream ends; how much was read.
fn read_full(r: &mut impl Read, buf: &mut [u8]) -> usize {
    let mut got = 0;
    while got < buf.len() {
        match r.read(&mut buf[got..]) {
            Ok(0) | Err(_) => break,
            Ok(n) => got += n,
        }
    }
    got
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::find_ffmpeg;

    #[test]
    fn whole_frames_only() {
        let data = [7u8; 10];
        let mut buf = [0u8; 4];
        let mut r = &data[..];
        assert_eq!(read_full(&mut r, &mut buf), 4);
        let mut short = &data[..3];
        assert_eq!(read_full(&mut short, &mut buf), 3);
        assert_eq!(frame_bytes(1920, 1080), 8_294_400);
    }

    #[test]
    fn refuses_silly_sizes() {
        let r = Readers::default();
        assert!(r
            .open(Path::new("ffmpeg"), Path::new("x.mov"), 0.0, 30.0, 0, 10)
            .is_err());
        assert!(r
            .open(Path::new("ffmpeg"), Path::new("x.mov"), 0.0, 0.0, 10, 10)
            .is_err());
        assert!(r.next(99).is_err());
    }

    /// Needs FFmpeg: `cargo test -p lumora-edit -- --ignored`.
    #[test]
    #[ignore = "needs FFmpeg"]
    fn reads_frames_of_a_10_bit_file() {
        let Some(ffmpeg) = find_ffmpeg() else { return };
        let dir = std::env::temp_dir().join(format!("lumora-frames-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("ten.mov");
        let ok = quiet(&ffmpeg)
            .args([
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=s=320x240:r=25:d=2",
            ])
            .args([
                "-c:v",
                "prores_ks",
                "-profile:v",
                "3",
                "-pix_fmt",
                "yuv422p10le",
            ])
            .arg(&src)
            .status()
            .unwrap();
        assert!(ok.success());
        let r = Readers::default();
        let id = r.open(&ffmpeg, &src, 1.0, 25.0, 160, 120).unwrap();
        let mut frames = 0;
        loop {
            let f = r.next(id).unwrap();
            if f.is_empty() {
                break;
            }
            assert_eq!(f.len(), 160 * 120 * 4);
            frames += 1;
        }
        assert!((24..=26).contains(&frames), "{frames}");
        r.close(id);
        let _ = std::fs::remove_dir_all(dir);
    }
}
