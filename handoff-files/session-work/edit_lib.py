import sys
p = sys.argv[1]
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)


rep("mod frames;\n", "mod frames;\nmod hwaccel;\n")
rep("mod mattes;\nmod media;\n", "mod mattes;\nmod media;\nmod rendercache;\n")
rep('''/// A lighter copy of a heavy file for smooth playback (progress as `proxy-progress`: [path, 0–1]).
#[tauri::command]
async fn make_proxy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
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
}''', '''/// A lighter copy of a heavy file for smooth playback (progress as `proxy-progress`: [path, 0–1]).
/// Several are made side by side, each with `threads` of FFmpeg's; the graphics
/// card's encoder is used when one works (`hardware`, on by default).
#[tauri::command]
async fn make_proxy(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
    threads: Option<u32>,
    hardware: Option<bool>,
) -> Result<String, String> {
    let ffmpeg = state.ffmpeg()?;
    let cache = state.cache.join("proxies");
    let enc = Arc::clone(&state.encoders);
    tauri::async_runtime::spawn_blocking(move || {
        let p = path.clone();
        let encoder = if hardware.unwrap_or(true) {
            rendercache::hardware_h264(&enc.available(&ffmpeg))
        } else {
            None
        };
        let how = formats::CopyEncoding {
            encoder,
            threads: threads.map(|t| t.clamp(1, 64)),
            decode: Vec::new(),
        };
        media::playback_proxy_with(
            &ffmpeg,
            Path::new(&path),
            &cache,
            &move |done| {
                let _ = app.emit("proxy-progress", (p.clone(), done));
            },
            &how,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}''')
rep('''            delivery::recovery_remove,
        ])''', '''            delivery::recovery_remove,
            rendercache::rcache_folder,
            rendercache::rcache_list,
            rendercache::rcache_open,
            rendercache::rcache_finish,
            rendercache::rcache_abort,
            rendercache::rcache_trim,
            rendercache::rcache_clear,
            rendercache::hwaccel_status,
            rendercache::hwaccel_set,
        ])''')
open(p, 'w').write(s)
