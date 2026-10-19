//! Lumora Photo, the desktop app: the editor (the same web app as
//! docs/photo, built into dist-photo) with real files, the system's dialogs,
//! Send To into the folders Lumora, Lumora Studio and Lumora Titler share
//! (Documents/Lumora/Pictures and Documents/Lumora/Titles), and recovery
//! copies of open documents.

use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

/// Files Lumora Photo opens when double-clicked or dropped on its icon.
const OPENS: &[&str] = &[
    "lumphoto", "psd", "psb", "png", "jpg", "jpeg", "webp", "tif", "tiff", "gif", "bmp", "dng",
    "svg", "avif", "heic",
];
/// The largest file read (a big layered document).
const MAX_READ: u64 = 4 * 1024 * 1024 * 1024;

/// The picture Lumora Photo was opened with.
#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args().skip(1).find(|a| {
        Path::new(a)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| OPENS.iter().any(|x| x.eq_ignore_ascii_case(e)))
    })
}

/// `%XX` escapes back to text (header values are sent encoded).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or_else(|| format!("Missing {name}."))
}

fn body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err("Expected the file's bytes.".to_owned()),
    }
}

/// Write through a temporary file so a failed save never leaves half a file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    }
    let tmp = path.with_extension("lumora-saving");
    std::fs::write(&tmp, bytes).map_err(|e| format!("Could not save {}: {e}", path.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save {}: {e}", path.display())
    })
}

#[tauri::command]
fn photo_read(path: String) -> Result<Response, String> {
    let p = Path::new(&path);
    let len = std::fs::metadata(p)
        .map_err(|_| "The file is not there.".to_owned())?
        .len();
    if len > MAX_READ {
        return Err("The file is too big to open.".to_owned());
    }
    let bytes = std::fs::read(p).map_err(|e| format!("Could not read it: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn photo_write(request: Request<'_>) -> Result<(), String> {
    let path = header(&request, "x-path")?;
    write_atomic(Path::new(&path), body(&request)?)
}

/// A file name without characters Windows refuses.
fn safe_name(name: &str) -> String {
    let n: String = name
        .chars()
        .map(|c| {
            if "\\/:*?\"<>|".contains(c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let n = n.trim().trim_matches('.').to_owned();
    if n.is_empty() {
        "Picture".to_owned()
    } else {
        n.chars().take(120).collect()
    }
}

/// `name` in `dir`, numbered if one is there already.
fn unique(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_owned(), format!(".{e}")),
        None => (name.to_owned(), String::new()),
    };
    (2..10_000)
        .map(|n| dir.join(format!("{stem} {n}{ext}")))
        .find(|p| !p.exists())
        .unwrap_or(p)
}

/// Send To: a picture into Documents/Lumora/Pictures, a title into Documents/Lumora/Titles.
#[tauri::command]
fn photo_send_to_family(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let kind = header(&request, "x-kind")?;
    let name = safe_name(&header(&request, "x-name")?);
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("The Documents folder was not found ({e})."))?;
    let dir = docs.join("Lumora").join(if kind == "titles" {
        "Titles"
    } else {
        "Pictures"
    });
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    let path = unique(&dir, &name);
    write_atomic(&path, body(&request)?)?;
    Ok(path.display().to_string())
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recovery");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn recovery_file(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let k: String = key
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if k.is_empty() {
        return Err("No key.".to_owned());
    }
    Ok(recovery_dir(app)?.join(format!("{k}.lumphoto")))
}

/// Keep a recovery copy of an open document.
#[tauri::command]
fn photo_autosave(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let key = header(&request, "x-key")?;
    write_atomic(&recovery_file(&app, &key)?, body(&request)?)
}

#[tauri::command]
fn photo_autosave_clear(app: AppHandle, key: String) -> Result<(), String> {
    let _ = std::fs::remove_file(recovery_file(&app, &key)?);
    Ok(())
}

#[tauri::command]
fn photo_recover_list(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = recovery_dir(&app)?;
    let mut keys: Vec<String> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            (p.extension().and_then(|x| x.to_str()) == Some("lumphoto"))
                .then(|| p.file_stem()?.to_str().map(str::to_owned))
                .flatten()
        })
        .collect();
    keys.sort();
    Ok(keys)
}

#[tauri::command]
fn photo_recover_read(app: AppHandle, key: String) -> Result<Response, String> {
    let bytes = std::fs::read(recovery_file(&app, &key)?).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // A crash leaves a note for an (opt-in) error report next time.
            if let Ok(dir) = app.path().app_data_dir() {
                lumora_crash::install(dir, app.package_info().version.to_string());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initial_file,
            photo_read,
            photo_write,
            photo_send_to_family,
            photo_autosave,
            photo_autosave_clear,
            photo_recover_list,
            photo_recover_read,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lumora Photo");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_headers() {
        assert_eq!(
            percent_decode("C%3A%5CUsers%5Cann%5Cpic%201.psd"),
            "C:\\Users\\ann\\pic 1.psd"
        );
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("100%"), "100%");
    }

    #[test]
    fn cleans_names() {
        assert_eq!(safe_name("a/b:c?.png"), "a b c .png");
        assert_eq!(safe_name("..."), "Picture");
    }
}
