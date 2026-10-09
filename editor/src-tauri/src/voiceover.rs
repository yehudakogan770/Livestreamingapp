//! Voiceovers recorded in Studio: the recording (made by the window's
//! microphone recorder) is kept in Documents/Lumora/Voiceovers, under a name
//! of its own, before it is imported like any other file.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// The folder recordings go in (made when needed).
fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("The Documents folder was not found ({e})."))?;
    let dir = docs.join("Lumora").join("Voiceovers");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    Ok(dir)
}

/// A file name from what the window asked for: letters, digits, spaces and
/// a few marks only, never a path.
pub fn safe_name(asked: &str) -> String {
    let cleaned: String = asked
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned
        .trim_matches(|c: char| c == '.' || c == ' ')
        .chars()
        .take(80)
        .collect::<String>();
    if trimmed.is_empty() {
        "Voiceover".to_owned()
    } else {
        trimmed
    }
}

/// A path in `dir` for `name.ext` that isn't taken yet ("name 2.ext", "name 3.ext"…).
pub fn free_path(dir: &Path, name: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{name}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..10_000)
        .map(|n| dir.join(format!("{name} {n}.{ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// Keep a recording (raw bytes; its name and type in the headers) and say where it is.
#[tauri::command]
pub fn voiceover_save(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Nothing was recorded.".into());
    };
    if bytes.is_empty() {
        return Err("Nothing was recorded.".into());
    }
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let name = safe_name(&header("x-name").unwrap_or_default());
    let ext = match header("x-type").as_deref() {
        Some(t) if t.contains("ogg") => "ogg",
        Some(t) if t.contains("mp4") => "m4a",
        _ => "webm",
    };
    let path = free_path(&folder(&app)?, &name, ext);
    std::fs::write(&path, bytes).map_err(|e| format!("The recording couldn’t be saved ({e})."))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_never_leave_the_folder() {
        assert_eq!(safe_name("Voiceover 01:00:10"), "Voiceover 01-00-10");
        assert_eq!(safe_name("../../evil"), "-..-evil");
        assert_eq!(safe_name("  "), "Voiceover");
        assert!(!safe_name("a/b\\c").contains(['/', '\\']));
    }

    #[test]
    fn takes_the_next_free_name() {
        let dir = std::env::temp_dir().join(format!("lumora-vo-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = free_path(&dir, "Take", "webm");
        std::fs::write(&a, b"x").unwrap();
        let b = free_path(&dir, "Take", "webm");
        assert_eq!(b.file_name().unwrap(), "Take 2.webm");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
