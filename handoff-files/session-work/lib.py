p='src/lib.rs'
s=open(p).read()
def rep(a,b):
    global s
    assert a in s, a
    s=s.replace(a,b,1)
rep("""mod media;
""","""mod media;
mod speech;
""")
rep("""/// A work folder for making a film, next to where it will be saved.""","""/// A speech model for transcribing, downloaded the first time (progress as
/// `speech-progress`: [name, 0–1]). Lumora's own copy is used when it has one.
#[tauri::command]
async fn speech_model(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let ours = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let lumora = ours.parent().map(|d| d.join("app.lumora.desktop"));
    tauri::async_runtime::spawn_blocking(move || {
        let n = name.clone();
        speech::model(&ours, lumora.as_deref(), &name, &move |done| {
            let _ = app.emit("speech-progress", (n.clone(), done));
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|p| p.to_string_lossy().into_owned())
}

/// A stretch of a file's sound for the speech model (16 kHz mono floats).
#[tauri::command]
async fn speech_audio(
    state: State<'_, AppState>,
    path: String,
    from: f64,
    seconds: f64,
) -> Result<tauri::ipc::Response, String> {
    let ffmpeg = state.ffmpeg()?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        speech::audio(&ffmpeg, Path::new(&path), from, seconds)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// A work folder for making a film, next to where it will be saved.""")
rep("""            peaks,
            export_folder,""","""            peaks,
            speech_model,
            speech_audio,
            export_folder,""")
open(p,'w').write(s)
