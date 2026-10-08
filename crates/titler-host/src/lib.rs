//! Lumora Titler's files for the apps that open it. Lumora, Lumora Studio
//! and the Lumora Titler desktop app all register these commands (and manage
//! [`Renders`]), so a title saved in one is in the others' library:
//!
//! - the title library: `.lumtitle` files in Documents/Lumora/Titles;
//! - opening and saving `.lumtitle` files anywhere the person chooses;
//! - pictures, videos and fonts read in as data URLs (packed into a title);
//! - the kept copy of the title being edited (crash recovery);
//! - the Titler window (Lumora and Studio open the designer in its own window);
//! - rendering to a film: frames from the designer piped into FFmpeg
//!   (ProRes 4444 with alpha, WebM VP9 with alpha, MP4, PNG sequence).

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// A title file's extension.
pub const EXT: &str = "lumtitle";
/// The largest file read (titles carry their pictures and fonts).
const MAX_READ: u64 = 96 * 1024 * 1024;
/// The Titler window's label (one per app).
pub const WINDOW: &str = "titler";

/// The shared library folder: Documents/Lumora/Titles (made if missing).
pub fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("The Documents folder was not found ({e})."))?;
    let dir = docs.join("Lumora").join("Titles");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    Ok(dir)
}

/// A title in the library.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub path: String,
    pub name: String,
    pub category: String,
    /// Milliseconds since 1970.
    pub modified: f64,
}

fn is_title(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(EXT))
}

fn modified_ms(p: &Path) -> f64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// What the library holds, newest first.
pub fn list(dir: &Path) -> Vec<LibraryEntry> {
    let mut out: Vec<LibraryEntry> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| is_title(p))
        .filter_map(|p| {
            let text = std::fs::read_to_string(&p).ok()?;
            let v: serde_json::Value = serde_json::from_str(&text).ok()?;
            let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_owned();
            let name = s("name");
            Some(LibraryEntry {
                name: if name.is_empty() {
                    p.file_stem()?.to_string_lossy().into_owned()
                } else {
                    name
                },
                category: s("category"),
                modified: v
                    .get("modified")
                    .and_then(serde_json::Value::as_f64)
                    .unwrap_or_else(|| modified_ms(&p)),
                path: p.to_string_lossy().into_owned(),
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified.total_cmp(&a.modified));
    out
}

/// A file name from a title's name (no characters Windows refuses).
pub fn safe_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| {
            if "\\/:*?\"<>|".contains(c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean: String = clean.chars().take(80).collect();
    if clean.is_empty() {
        "Title".to_owned()
    } else {
        clean
    }
}

/// Write through a new file first, so a crash never leaves half a title.
pub fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let temp = path.with_extension("saving");
    std::fs::write(&temp, text).map_err(|e| format!("Could not save: {e}"))?;
    std::fs::rename(&temp, path).map_err(|e| format!("Could not save: {e}"))
}

/// A free path for a new title in `dir` ("Name.lumtitle", "Name 2.lumtitle"…).
pub fn free_path(dir: &Path, name: &str) -> PathBuf {
    let base = safe_name(name);
    let mut p = dir.join(format!("{base}.{EXT}"));
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{base} {n}.{EXT}"));
        n += 1;
    }
    p
}

#[tauri::command]
pub fn titler_library_dir(app: AppHandle) -> Result<String, String> {
    library_dir(&app).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn titler_library_list(app: AppHandle) -> Result<Vec<LibraryEntry>, String> {
    Ok(list(&library_dir(&app)?))
}

/// Read a title file (or a JSON file).
#[tauri::command]
pub fn titler_read(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let ok = is_title(p)
        || p.extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    if !ok {
        return Err("Only .lumtitle files can be opened here.".to_owned());
    }
    let len = std::fs::metadata(p)
        .map_err(|_| "The file is not there.".to_owned())?
        .len();
    if len > MAX_READ {
        return Err("The file is too big.".to_owned());
    }
    std::fs::read_to_string(p).map_err(|e| format!("Could not open it: {e}"))
}

/// Save a title: to `path`, or as a new file in the library. Returns where it went.
#[tauri::command]
pub fn titler_write(
    app: AppHandle,
    path: Option<String>,
    name: String,
    text: String,
) -> Result<String, String> {
    let target = match path {
        Some(p) if !p.is_empty() => {
            let mut p = PathBuf::from(p);
            if !is_title(&p) {
                p.set_extension(EXT);
            }
            p
        }
        _ => free_path(&library_dir(&app)?, &name),
    };
    write_atomic(&target, &text)?;
    Ok(target.to_string_lossy().into_owned())
}

/// Remove a title from the library (only files in the library folder).
#[tauri::command]
pub fn titler_remove(app: AppHandle, path: String) -> Result<(), String> {
    let dir = library_dir(&app)?;
    let p = PathBuf::from(&path);
    let inside = p
        .canonicalize()
        .ok()
        .zip(dir.canonicalize().ok())
        .is_some_and(|(f, d)| f.starts_with(d));
    if !inside || !is_title(&p) {
        return Err("Only titles in the library can be removed here.".to_owned());
    }
    std::fs::remove_file(p).map_err(|e| format!("Could not remove it: {e}"))
}

fn mime(p: &Path) -> &'static str {
    match p
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webm") => "video/webm",
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("m4a") => "audio/mp4",
        Some("ogg") => "audio/ogg",
        _ => "application/octet-stream",
    }
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 (with padding).
pub fn base64(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            B64[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// A picture, video, sound or font as a data URL (to pack it into a title).
#[tauri::command]
pub fn titler_data_url(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let len = std::fs::metadata(p)
        .map_err(|_| "The file is not there.".to_owned())?
        .len();
    if len > MAX_READ {
        return Err("The file is too big to put inside a title (over 96 MB).".to_owned());
    }
    let bytes = std::fs::read(p).map_err(|e| format!("Could not read it: {e}"))?;
    Ok(format!("data:{};base64,{}", mime(p), base64(&bytes)))
}

fn autosave_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No folder for the app's data ({e})."))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let key: String = key
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(40)
        .collect();
    Ok(dir.join(format!("titler-autosave-{key}.json")))
}

/// Keep (or, with no text, drop) the copy of the title being edited.
#[tauri::command]
pub fn titler_autosave(app: AppHandle, key: String, text: Option<String>) -> Result<(), String> {
    let p = autosave_path(&app, &key)?;
    match text {
        Some(t) => write_atomic(&p, &t),
        None => {
            let _ = std::fs::remove_file(p);
            Ok(())
        }
    }
}

#[tauri::command]
pub fn titler_recover(app: AppHandle, key: String) -> Option<String> {
    std::fs::read_to_string(autosave_path(&app, &key).ok()?).ok()
}

/// Open the Titler window (or bring it forward), loading the app's page
/// with `?titler=<query>` so it shows the designer.
#[tauri::command]
pub fn titler_open_window(app: AppHandle, query: String) -> Result<(), String> {
    let q: String = query
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || "-_".contains(*c))
        .take(80)
        .collect();
    if let Some(w) = app.get_webview_window(WINDOW) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return w
            .eval(&format!(
                "window.dispatchEvent(new CustomEvent('titler-open', {{ detail: {q:?} }}))"
            ))
            .map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(
        &app,
        WINDOW,
        WebviewUrl::App(format!("index.html?titler={q}").into()),
    )
    .title("Lumora Titler")
    .inner_size(1440.0, 900.0)
    .min_inner_size(1100.0, 680.0)
    .background_color(tauri::webview::Color(20, 20, 19, 255))
    .center()
    .build()
    .map(|_| ())
    .map_err(|e| format!("The Titler window could not open: {e}"))
}

// ---- rendering to a film with FFmpeg ----

struct Job {
    child: Child,
    stdin: Option<ChildStdin>,
    out: PathBuf,
    frame_bytes: usize,
}

/// Films being made (each app manages one of these).
#[derive(Default)]
pub struct Renders {
    jobs: Mutex<HashMap<u32, Job>>,
    next: Mutex<u32>,
}

/// FFmpeg next to the app, or on the computer.
pub fn find_ffmpeg() -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let beside = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(exe)))
        .filter(|p| p.is_file());
    beside.or_else(|| {
        quiet(Path::new(exe))
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
            .then(|| PathBuf::from(exe))
    })
}

fn quiet(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// FFmpeg's arguments for a film of raw RGBA frames: what goes after the input.
pub fn encode_args(format: &str, out: &Path) -> Result<(Vec<String>, PathBuf), String> {
    let s = |v: &[&str]| v.iter().map(|x| (*x).to_owned()).collect::<Vec<_>>();
    let with = |ext: &str| out.with_extension(ext);
    Ok(match format {
        "prores4444" => (
            s(&[
                "-c:v",
                "prores_ks",
                "-profile:v",
                "4444",
                "-pix_fmt",
                "yuva444p10le",
                "-alpha_bits",
                "16",
                "-vendor",
                "apl0",
            ]),
            with("mov"),
        ),
        "webm-alpha" => (
            s(&[
                "-c:v",
                "libvpx-vp9",
                "-pix_fmt",
                "yuva420p",
                "-b:v",
                "0",
                "-crf",
                "24",
                "-row-mt",
                "1",
                "-auto-alt-ref",
                "0",
            ]),
            with("webm"),
        ),
        "mp4" => (
            s(&[
                "-vf",
                "premultiply=inplace=1",
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
            ]),
            with("mp4"),
        ),
        "png-sequence" => {
            // A folder of numbered pictures.
            let dir = out.with_extension("");
            std::fs::create_dir_all(&dir).map_err(|e| format!("Could not make the folder: {e}"))?;
            let stem = dir
                .file_name()
                .map_or_else(|| "frame".to_owned(), |n| n.to_string_lossy().into_owned());
            (
                s(&["-c:v", "png", "-pix_fmt", "rgba"]),
                dir.join(format!("{stem}_%05d.png")),
            )
        }
        _ => return Err(format!("Lumora Titler can't make {format} films.")),
    })
}

/// Start a film: FFmpeg waits for `width` × `height` RGBA frames.
#[tauri::command]
pub fn titler_render_start(
    renders: State<'_, Renders>,
    path: String,
    width: u32,
    height: u32,
    fps: f64,
    format: String,
) -> Result<u32, String> {
    if width == 0 || height == 0 || width > 8192 || height > 8192 || !(1.0..=240.0).contains(&fps) {
        return Err("That size or frame rate can't be rendered.".to_owned());
    }
    let ffmpeg = find_ffmpeg().ok_or_else(|| {
        "FFmpeg was not found. Reinstall Lumora Titler to put it back.".to_owned()
    })?;
    let (args, out) = encode_args(&format, Path::new(&path))?;
    let mut cmd = quiet(&ffmpeg);
    cmd.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
    ])
    .args([
        "-s",
        &format!("{width}x{height}"),
        "-r",
        &format!("{fps}"),
        "-i",
        "-",
    ])
    .args(&args)
    .arg(&out)
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("FFmpeg could not start: {e}"))?;
    let stdin = child.stdin.take();
    let mut next = renders.next.lock().map_err(|e| e.to_string())?;
    *next = next.wrapping_add(1);
    let id = *next;
    renders.jobs.lock().map_err(|e| e.to_string())?.insert(
        id,
        Job {
            child,
            stdin,
            out,
            frame_bytes: width as usize * height as usize * 4,
        },
    );
    Ok(id)
}

/// One frame (the request's body: raw RGBA; the `x-job` header says which film).
#[tauri::command]
pub fn titler_render_frame(
    renders: State<'_, Renders>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let id: u32 = request
        .headers()
        .get("x-job")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| "Which film is this frame for?".to_owned())?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("A frame must be sent as raw bytes.".to_owned());
    };
    let mut jobs = renders.jobs.lock().map_err(|e| e.to_string())?;
    let job = jobs
        .get_mut(&id)
        .ok_or_else(|| "That film is no longer being made.".to_owned())?;
    if bytes.len() != job.frame_bytes {
        return Err("A frame of the wrong size.".to_owned());
    }
    job.stdin
        .as_mut()
        .ok_or_else(|| "The film is finished.".to_owned())?
        .write_all(bytes)
        .map_err(|e| format!("FFmpeg stopped: {e}"))
}

/// Finish a film; returns where it is.
#[tauri::command]
pub fn titler_render_finish(renders: State<'_, Renders>, id: u32) -> Result<String, String> {
    let mut job = renders
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
        .ok_or_else(|| "That film is no longer being made.".to_owned())?;
    drop(job.stdin.take());
    let out = job
        .child
        .wait_with_output()
        .map_err(|e| format!("FFmpeg stopped: {e}"))?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "FFmpeg could not make the film: {}",
            msg.lines().last().unwrap_or("unknown error")
        ));
    }
    Ok(job.out.to_string_lossy().into_owned())
}

/// Stop a film and remove what was written.
#[tauri::command]
pub fn titler_render_cancel(renders: State<'_, Renders>, id: u32) -> Result<(), String> {
    if let Some(mut job) = renders.jobs.lock().map_err(|e| e.to_string())?.remove(&id) {
        drop(job.stdin.take());
        let _ = job.child.kill();
        let _ = job.child.wait();
        if !job.out.to_string_lossy().contains('%') {
            let _ = std::fs::remove_file(&job.out);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn names_are_safe_and_new_titles_never_overwrite() {
        assert_eq!(safe_name("  A/B: c?  "), "A B c");
        assert_eq!(safe_name(""), "Title");
        let dir = std::env::temp_dir().join(format!("titler-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = free_path(&dir, "Name");
        write_atomic(
            &a,
            "{\"name\":\"Name\",\"category\":\"Bugs\",\"modified\":5}",
        )
        .unwrap();
        let b = free_path(&dir, "Name");
        assert_ne!(a, b);
        assert!(b.to_string_lossy().ends_with("Name 2.lumtitle"));
        let l = list(&dir);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].category, "Bugs");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn every_film_format_has_arguments() {
        for f in ["prores4444", "webm-alpha", "mp4"] {
            let (args, out) = encode_args(f, Path::new("/tmp/x.any")).unwrap();
            assert!(!args.is_empty());
            assert_ne!(out.extension().unwrap(), "any");
        }
        assert!(encode_args("gif", Path::new("x")).is_err());
    }
}
