//! The commands the apps register (`titler_host::cmd::…` in their
//! `generate_handler!`). Kept in their own module: Tauri's command glue can't
//! be public at a crate's root.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

use super::{
    audio_args, autosave_path, base64, encode_args, find_ffmpeg, free_path, is_title, library_dir, list, mime,
    quiet, unbase64, write_atomic, Job, LibraryEntry, Renders, EXT, MAX_READ, WINDOW,
};

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
            .eval(format!(
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

/// Start a film: FFmpeg waits for `width` × `height` RGBA frames. `audio`:
/// the audio cues' sound as a base64 WAV (joined to the film), if any.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn titler_render_start(
    renders: State<'_, Renders>,
    path: String,
    width: u32,
    height: u32,
    fps: f64,
    format: String,
    audio: Option<String>,
) -> Result<u32, String> {
    if width == 0 || height == 0 || width > 8192 || height > 8192 || !(1.0..=240.0).contains(&fps) {
        return Err("That size or frame rate can't be rendered.".to_owned());
    }
    let ffmpeg = find_ffmpeg().ok_or_else(|| {
        "FFmpeg was not found. Reinstall Lumora Titler to put it back.".to_owned()
    })?;
    let (args, out) = encode_args(&format, Path::new(&path))?;
    let sound_args = audio_args(&format);
    let sound = match audio {
        Some(b64) if !sound_args.is_empty() => {
            let bytes = unbase64(&b64).ok_or_else(|| "The film's sound could not be read.".to_owned())?;
            let wav = out.with_extension("cues.wav");
            std::fs::write(&wav, bytes).map_err(|e| format!("The film's sound could not be written: {e}"))?;
            Some(wav)
        }
        _ => None,
    };
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
    ]);
    if let Some(wav) = &sound {
        cmd.arg("-i").arg(wav).args(&sound_args);
    }
    cmd.args(&args)
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
            sound,
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
        .map_err(|e| format!("FFmpeg stopped: {e}"));
    if let Some(wav) = &job.sound {
        let _ = std::fs::remove_file(wav);
    }
    let out = out?;
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
        if let Some(wav) = &job.sound {
            let _ = std::fs::remove_file(wav);
        }
        if !job.out.to_string_lossy().contains('%') {
            let _ = std::fs::remove_file(&job.out);
        }
    }
    Ok(())
}
