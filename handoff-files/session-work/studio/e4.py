root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:60])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/src-tauri/src/frames.rs', [
("use crate::formats::{plan, reader_args_with};","use crate::formats::{plan, reader_args_deep, reader_args_with};"),
("""    /// Start reading a file at `from` seconds, `rate` frames a second, at `width`×`height`.
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
    ) -> Result<u32, String> {""","""    /// Start reading a file at `from` seconds, `rate` frames a second, at
    /// `width`×`height`: RGBA, or with `deep` the signal kept as it is
    /// (HDR not tone-mapped) at 16 bits a channel.
    ///
    /// # Errors
    /// FFmpeg can't start, or the size is unreasonable.
    #[allow(clippy::too_many_arguments)]
    pub fn open(
        &self,
        ffmpeg: &Path,
        file: &Path,
        from: f64,
        rate: f64,
        width: u32,
        height: u32,
        deep: bool,
    ) -> Result<u32, String> {"""),
("""        let args = |decode: &[OsString]| {
            reader_args_with(""","""        let args = |decode: &[OsString]| {
            if deep {
                return reader_args_deep(file, &plan, from.max(0.0), rate, (width, height), decode);
            }
            reader_args_with("""),
("""            frame: frame_bytes(width, height),""","""            frame: frame_bytes(width, height) * if deep { 2 } else { 1 },"""),
("""            .open(Path::new("ffmpeg"), Path::new("x.mov"), 0.0, 30.0, 0, 10)""","""            .open(Path::new("ffmpeg"), Path::new("x.mov"), 0.0, 30.0, 0, 10, false)"""),
("""            .open(Path::new("ffmpeg"), Path::new("x.mov"), 0.0, 0.0, 10, 10)""","""            .open(Path::new("ffmpeg"), Path::new("x.mov"), 0.0, 0.0, 10, 10, false)"""),
("""        let id = r.open(&ffmpeg, &src, 1.0, 25.0, 160, 120).unwrap();""","""        let id = r.open(&ffmpeg, &src, 1.0, 25.0, 160, 120, false).unwrap();"""),
("""        assert!((24..=26).contains(&frames), "{frames}");
        r.close(id);""","""        assert!((24..=26).contains(&frames), "{frames}");
        r.close(id);
        // Deep: 16 bits a channel.
        let id = r.open(&ffmpeg, &src, 0.0, 25.0, 160, 120, true).unwrap();
        assert_eq!(r.next(id).unwrap().len(), 160 * 120 * 8);
        r.close(id);"""),
])

edit('editor/src-tauri/src/lib.rs', [
("""/// Start reading an original's frames through FFmpeg (RGBA, `width`×`height`, `rate` a second from `from` seconds).
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
    state
        .frames
        .open(&ffmpeg, Path::new(&path), from, rate, width, height)
}""","""/// Start reading an original's frames through FFmpeg (RGBA, `width`×`height`, `rate` a second from `from` seconds;
/// `deep`: the signal as it is, 16 bits a channel, for HDR films).
#[tauri::command]
async fn frames_open(
    state: State<'_, AppState>,
    path: String,
    from: f64,
    rate: f64,
    width: u32,
    height: u32,
    deep: Option<bool>,
) -> Result<u32, String> {
    let ffmpeg = state.ffmpeg()?;
    state.frames.open(
        &ffmpeg,
        Path::new(&path),
        from,
        rate,
        width,
        height,
        deep.unwrap_or(false),
    )
}

/// An HDR file's signal copy for watching it in an HDR sequence (made once; progress as `hdr-progress`).
#[tauri::command]
async fn hdr_copy(app: tauri::AppHandle, state: State<'_, AppState>, path: String, seconds: f64) -> Result<String, String> {
    let ffmpeg = state.ffmpeg()?;
    let cache = state.cache.join("hdr");
    tauri::async_runtime::spawn_blocking(move || {
        let p = path.clone();
        media::signal_copy(&ffmpeg, Path::new(&path), seconds, &cache, &move |done| {
            let _ = app.emit("hdr-progress", (p.clone(), done));
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|p| p.to_string_lossy().into_owned())
}"""),
("""            frames_close,""","""            frames_close,
            hdr_copy,"""),
])

edit('editor/src-tauri/src/media.rs', [
("""/// Get any file ready to edit. The original is never changed""","""/// An HDR file's signal copy (see `formats::signal_copy_args`), made once in `cache`.
///
/// # Errors
/// The file can't be read or the copy can't be made.
pub fn signal_copy(ffmpeg: &Path, file: &Path, seconds: f64, cache: &Path, progress: &dyn Fn(f64)) -> Result<PathBuf, String> {
    let meta = fs::metadata(file).map_err(|e| format!("{} was not found: {e}", file.display()))?;
    let stamp = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    let key = {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (file.to_string_lossy(), meta.len(), stamp, "signal-1").hash(&mut h);
        format!("{:016x}.mp4", h.finish())
    };
    let out = cache.join(&key);
    if out.is_file() {
        return Ok(out);
    }
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let info = probe(ffmpeg, file)?;
    let plan = crate::formats::plan(file, &info);
    let temp = cache.join(format!("{key}.making.mp4"));
    let args = crate::formats::signal_copy_args(file, &plan, &temp);
    run_with_progress(ffmpeg, &args, seconds, progress)?;
    fs::rename(&temp, &out).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Get any file ready to edit. The original is never changed"""),
])
