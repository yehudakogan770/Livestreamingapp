//! AI mask results kept on the disk, one file per media file and kind of
//! mask, so they aren't worked out again next time. The editor packs them;
//! here they are only read and written. A changed media file gets a new name
//! (its size and time are in it), so old results are never used for it.

use std::fs;
use std::path::{Path, PathBuf};

use crate::media;

/// Where a media file's mattes of one kind ("person", "object") are kept.
pub fn file_for(cache: &Path, media: &str, kind: &str) -> PathBuf {
    let kind: String = kind
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(16)
        .collect();
    cache.join("mattes").join(media::cache_name(
        Path::new(media),
        &format!("{kind}.mattes"),
    ))
}

/// What was kept (nothing yet: empty).
pub fn read(cache: &Path, media: &str, kind: &str) -> Vec<u8> {
    fs::read(file_for(cache, media, kind)).unwrap_or_default()
}

/// Keep them (written whole, then put in place, so a half-written file is never read).
pub fn write(cache: &Path, media: &str, kind: &str, bytes: &[u8]) -> Result<(), String> {
    let path = file_for(cache, media, kind);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("part");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_and_reads_back() {
        let dir = std::env::temp_dir().join(format!("lumora-mattes-{}", std::process::id()));
        let media = dir.join("clip.mp4");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&media, b"video").unwrap();
        let m = media.to_string_lossy();
        assert!(read(&dir, &m, "person").is_empty());
        write(&dir, &m, "person", b"LMT1abc").unwrap();
        assert_eq!(read(&dir, &m, "person"), b"LMT1abc");
        // Each kind has its own file, and odd kinds can't reach outside the folder.
        assert!(read(&dir, &m, "object").is_empty());
        let odd = file_for(&dir, &m, "../../x");
        assert!(odd.starts_with(dir.join("mattes")));
        fs::remove_dir_all(&dir).unwrap();
    }
}
