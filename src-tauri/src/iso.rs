//! ISO recording: while the Live Screen is recorded, each camera and each
//! microphone is also recorded to its own file (for editing afterwards), next
//! to the recording in a folder of its own. Also the chapter list, and the
//! event file (`.lumora`) the editing program opens: every file, when it
//! started, and what was on air when.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// A plain file name (never a path) without characters Windows refuses.
#[must_use]
pub fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if "\\/:*?\"<>|".contains(c) || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();
    let s = s
        .trim()
        .trim_matches('.')
        .chars()
        .take(80)
        .collect::<String>();
    if s.is_empty() {
        "Camera".to_owned()
    } else {
        s
    }
}

#[derive(Default)]
pub struct Isos {
    files: Mutex<HashMap<u64, BufWriter<File>>>,
    next: AtomicU64,
}

impl Isos {
    /// Start a camera's (or microphone's) file in
    /// `folder/<recording> — event files/<name>.<ext>`.
    ///
    /// # Errors
    /// The folder or file can't be made.
    pub fn start(
        &self,
        folder: &Path,
        recording: &str,
        camera: &str,
        ext: &str,
    ) -> Result<(u64, PathBuf), String> {
        let dir = folder.join(format!("{} — event files", safe_name(recording)));
        fs::create_dir_all(&dir).map_err(|e| format!("Could not make the cameras folder: {e}"))?;
        let ext = if ext == "mkv" { "mkv" } else { "webm" };
        let base = safe_name(camera);
        let path = std::iter::once(dir.join(format!("{base}.{ext}")))
            .chain((2..).map(|n| dir.join(format!("{base} ({n}).{ext}"))))
            .find(|p| !p.exists())
            .unwrap_or_else(|| dir.join(format!("{base}.{ext}")));
        let file =
            File::create(&path).map_err(|e| format!("Could not start the camera file: {e}"))?;
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        lock(&self.files).insert(id, BufWriter::with_capacity(1 << 20, file));
        Ok((id, path))
    }

    /// More of a camera's recording.
    ///
    /// # Errors
    /// The file stopped, or the disk is full.
    pub fn chunk(&self, id: u64, bytes: &[u8]) -> Result<(), String> {
        let mut files = lock(&self.files);
        let f = files.get_mut(&id).ok_or("not recording")?;
        f.write_all(bytes)
            .map_err(|e| format!("The camera file could not be written: {e}"))
    }

    pub fn stop(&self, id: u64) {
        if let Some(mut f) = lock(&self.files).remove(&id) {
            let _ = f.flush();
        }
    }
}

/// Save the event file (`<recording>.lumora`, JSON) next to the recording.
///
/// # Errors
/// The file can't be written.
pub fn save_event(folder: &Path, recording: &str, json: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!("{}.lumora", safe_name(recording)));
    fs::write(&path, json).map_err(|e| format!("Could not save the event file: {e}"))?;
    Ok(path)
}

/// Save the chapter list next to the recording.
///
/// # Errors
/// The file can't be written.
pub fn save_chapters(folder: &Path, recording: &str, text: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!("{} — chapters.txt", safe_name(recording)));
    fs::write(&path, text).map_err(|e| format!("Could not save the chapters: {e}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_camera_gets_its_own_file() {
        let dir = std::env::temp_dir().join(format!("lumora-iso-{}", std::process::id()));
        let isos = Isos::default();
        let (a, pa) = isos.start(&dir, "Wedding: part 1", "Cam/1", "mkv").unwrap();
        let (b, pb) = isos
            .start(&dir, "Wedding: part 1", "Cam/1", "webm")
            .unwrap();
        assert_ne!(a, b);
        isos.chunk(a, b"abc").unwrap();
        isos.stop(a);
        assert!(isos.chunk(a, b"x").is_err());
        assert_eq!(fs::read(&pa).unwrap(), b"abc");
        assert!(pa.ends_with("Wedding- part 1 — event files/Cam-1.mkv"));
        assert!(pb.ends_with("Cam-1.webm"));
        isos.stop(b);
        let ch = save_chapters(&dir, "Wedding", "0:00 Opening\n").unwrap();
        assert_eq!(fs::read_to_string(ch).unwrap(), "0:00 Opening\n");
        let ev = save_event(&dir, "Wedding", "{}").unwrap();
        assert!(ev.ends_with("Wedding.lumora"));
        let _ = fs::remove_dir_all(dir);
    }
}
