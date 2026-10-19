def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/src-tauri/src/lib.rs', [
("""mod export;
mod library;
mod media;
mod speech;""","""mod export;
mod formats;
mod frames;
mod library;
mod media;
mod speech;"""),
("""    exports: export::Exports,
}""","""    exports: export::Exports,
    /// Originals read by FFmpeg for making the film.
    frames: frames::Readers,
}"""),
("""#[tauri::command]
async fn strip(""","""/// What a file is and whether a copy will be made (quick: nothing is made).
#[tauri::command]
async fn probe_media(state: State<'_, AppState>, path: String) -> Result<media::Prepared, String> {
    let ffmpeg = state.ffmpeg()?;
    tauri::async_runtime::spawn_blocking(move || media::look(&ffmpeg, Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

/// A lighter copy of a heavy file for smooth playback (progress as `proxy-progress`: [path, 0–1]).
#[tauri::command]
async fn make_proxy(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> Result<String, String> {
    let ffmpeg = state.ffmpeg()?;
    let cache = state.cache.join("proxies");
    tauri::async_runtime::spawn_blocking(move || {
        let p = path.clone();
        media::playback_proxy(&ffmpeg, Path::new(&path), &cache, &move |done| {
            let _ = app.emit("proxy-progress", (p.clone(), done));
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Start reading an original's frames through FFmpeg (RGBA, `width`×`height`, `rate` a second from `from` seconds).
#[tauri::command]
async fn frames_open(
    state: State<'_, AppState>,
    path: String,
    from: f64,
    rate: f64,
    width: u32,
    height: u32,
) -> Result<u32, String> {
    let ffmpeg = state.ffmpeg()?;
    state.frames.open(&ffmpeg, Path::new(&path), from, rate, width, height)
}

/// The next frame of a reader (empty at the end).
#[tauri::command]
async fn frames_next(state: State<'_, AppState>, id: u32) -> Result<tauri::ipc::Response, String> {
    state.frames.next(id).map(tauri::ipc::Response::new)
}

#[tauri::command]
fn frames_close(state: State<'_, AppState>, id: u32) {
    state.frames.close(id);
}

#[tauri::command]
async fn strip("""),
("""                cache,
                exports: export::Exports::default(),
            });""","""                cache,
                exports: export::Exports::default(),
                frames: frames::Readers::default(),
            });"""),
("""            import_media,
            strip,""","""            import_media,
            probe_media,
            make_proxy,
            frames_open,
            frames_next,
            frames_close,
            strip,"""),
])
print('ok')
