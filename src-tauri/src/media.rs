//! The app's own copies of the files an event uses.
//!
//! When a video, picture or logo is imported it is copied into `media/` in
//! the app's data folder, and the show uses the copy: deleting or moving
//! the original never breaks the event. A keeper also runs in the
//! background and brings in any file the show still uses from elsewhere
//! (events made before this, a library item, an event file opened from a
//! USB stick) while the original is still there.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// One copy at a time (the keeper and an import may want the same file).
static COPYING: Mutex<()> = Mutex::new(());

pub struct Media {
    /// The app's data folder; anything inside it is already kept.
    root: PathBuf,
}

impl Media {
    pub fn new(root: &Path) -> Media {
        Media {
            root: root.to_path_buf(),
        }
    }

    pub fn folder(&self) -> PathBuf {
        self.root.join("media")
    }

    /// Already one of the app's own files.
    pub fn is_kept(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }

    /// The app's copy of a file: made now if needed, or the same file
    /// imported before (same name and size) is reused.
    ///
    /// # Errors
    /// The file can't be read, or the disk is full.
    pub fn keep(&self, src: &Path) -> io::Result<PathBuf> {
        if self.is_kept(src) {
            return Ok(src.to_path_buf());
        }
        let _one = COPYING
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let meta = fs::metadata(src)?;
        if !meta.is_file() {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a file"));
        }
        let dir = self.folder();
        fs::create_dir_all(&dir)?;
        let name = src
            .file_name()
            .map_or_else(|| "file".to_owned(), |n| n.to_string_lossy().into_owned());
        let (stem, ext) = match name.rsplit_once('.') {
            Some((s, e)) if !s.is_empty() => (s.to_owned(), format!(".{e}")),
            _ => (name.clone(), String::new()),
        };
        for n in 1..10_000 {
            let candidate = if n == 1 {
                dir.join(&name)
            } else {
                dir.join(format!("{stem} ({n}){ext}"))
            };
            match fs::metadata(&candidate) {
                Ok(m) if m.len() == meta.len() => return Ok(candidate),
                Ok(_) => {}
                Err(_) => {
                    // Copy under a temporary name, then rename: never a half file.
                    let part = dir.join(format!(".{stem}.{n}.part"));
                    fs::copy(src, &part).inspect_err(|_| {
                        let _ = fs::remove_file(&part);
                    })?;
                    fs::rename(&part, &candidate)?;
                    return Ok(candidate);
                }
            }
        }
        Err(io::Error::other("too many files with this name"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lumora-media-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn an_imported_file_survives_the_original_being_deleted() {
        let d = temp("survive");
        let app = d.join("app");
        let original = d.join("Desktop").join("intro.mp4");
        fs::create_dir_all(original.parent().unwrap()).unwrap();
        fs::write(&original, b"video bytes").unwrap();
        let media = Media::new(&app);
        let kept = media.keep(&original).unwrap();
        assert!(media.is_kept(&kept));
        assert_eq!(kept.file_name().unwrap(), "intro.mp4");
        fs::remove_file(&original).unwrap();
        assert_eq!(fs::read(&kept).unwrap(), b"video bytes");
        // A kept file is kept as it is.
        assert_eq!(media.keep(&kept).unwrap(), kept);
    }

    #[test]
    fn the_same_file_is_copied_once_and_a_different_one_never_overwrites() {
        let d = temp("names");
        let media = Media::new(&d.join("app"));
        let a = d.join("a").join("logo.png");
        let b = d.join("b").join("logo.png");
        for (p, bytes) in [(&a, &b"one"[..]), (&b, &b"other"[..])] {
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, bytes).unwrap();
        }
        let ka = media.keep(&a).unwrap();
        assert_eq!(media.keep(&a).unwrap(), ka, "imported twice: one copy");
        let kb = media.keep(&b).unwrap();
        assert_ne!(ka, kb);
        assert_eq!(kb.file_name().unwrap(), "logo (2).png");
        assert_eq!(fs::read(&ka).unwrap(), b"one");
        assert_eq!(fs::read(&kb).unwrap(), b"other");
    }

    #[test]
    fn a_missing_file_is_an_error() {
        let d = temp("missing");
        assert!(Media::new(&d.join("app"))
            .keep(&d.join("nope.mp4"))
            .is_err());
    }
}
