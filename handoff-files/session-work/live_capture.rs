/// Sound from the control window's sound engine (a mix tapped by an audio
/// worklet, `app/src/audio/engineTap.ts`): 16-bit stereo, the wall-clock
/// time of its first sample, its rate and its mix in the headers.
#[tauri::command]
pub fn live_engine_audio(request: tauri::ipc::Request<'_>, live: State<'_, Live>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned)
    };
    let mix = header("mix").ok_or("no mix")?;
    let at_ms: f64 = header("at").and_then(|v| v.parse().ok()).ok_or("no time")?;
    let rate: u32 = header("rate").and_then(|v| v.parse().ok()).ok_or("no rate")?;
    if bytes.len() % 4 != 0 || !(8_000..=192_000).contains(&rate) {
        return Err("not 16-bit stereo sound".to_owned());
    }
    live.audio.push(
        &mix,
        &PcmChunk {
            at_ms,
            rate,
            pcm: Arc::new(bytes.clone()),
        },
    );
    Ok(())
}

/// The mixes the engine's encoders are listening to (the control window taps only these).
#[tauri::command]
pub fn live_engine_audio_wanted(live: State<'_, Live>) -> Vec<String> {
    live.audio.wanted()
}

/// A recording, stream, vertical stream or NDI output the engine encodes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    pub kind: Kind,
    pub name: String,
    #[serde(default)]
    pub rehearse: bool,
    /// The picture sent (the engine draws the screen at its own size and scales it).
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// The 9:16 version.
    #[serde(default)]
    pub vertical: bool,
    /// The sound: `master` (the Stream mix) or `b` (the Recording mix).
    pub mix: String,
    /// The control window's sound rate.
    pub sample_rate: u32,
    /// Each camera to its own file (recordings), but these.
    #[serde(default)]
    pub iso: bool,
    #[serde(default)]
    pub iso_skip: Vec<String>,
    pub iso_kbps: Option<u32>,
}

/// A camera's own file, made by the engine from the camera's frames.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsoFile {
    pub id: u64,
    pub source_id: String,
    pub name: String,
    pub path: String,
}

/// What `live_engine_capture_start` started.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineCapture {
    pub running: crate::capture::Running,
    pub isos: Vec<IsoFile>,
}

/// ISO feeds are numbered apart from the sessions' own.
const ISO_FEEDS: u64 = 1 << 40;

/// An encoder feed from the engine into `on_chunk`, with sound from `audio` (when given).
fn engine_feed(
    ffmpeg: PathBuf,
    encode: Vec<String>,
    audio: Option<live_engine::encoder::AudioIn>,
    on_chunk: Box<dyn FnMut(Vec<u8>) + Send>,
    on_end: Option<live_engine::encoder::OnEnd>,
) -> MakeFeed {
    Box::new(move |shape| {
        EncoderFeed::start(
            &ffmpeg,
            FeedArgs {
                width: shape.width,
                height: shape.height,
                fps: shape.fps,
                pix_fmt: shape.pix_fmt,
                encode,
                container: ["-f", "matroska", "-"].map(str::to_owned).to_vec(),
                audio,
            },
            on_chunk,
            on_end,
        )
    })
}

/// Start a recording or stream whose picture (and each camera's ISO file)
/// the engine encodes, with the control window's sound mix — so the control
/// window opens no camera for it. The encoded stream goes to the same
/// recording and streaming sessions as the WebView's own encoder's would
/// (`capture.rs`): files, destinations, reconnects and backups are theirs.
#[tauri::command]
pub async fn live_engine_capture_start(
    request: CaptureRequest,
    live: State<'_, Live>,
    state: State<'_, crate::AppState>,
    app: AppHandle,
) -> Result<EngineCapture, String> {
    let runner = live
        .runner()
        .ok_or("The unified engine is not running (Settings → Engine).")?;
    let ffmpeg = live
        .ffmpeg
        .clone()
        .ok_or("FFmpeg is needed to record and stream with the unified engine.")?;
    let r = request;
    let settings = state.capture.settings();
    let mime = "video/x-matroska;codecs=avc1,opus";
    let running = state
        .capture
        .start_with(r.kind, mime, &r.name, r.rehearse)?;
    let session = running.session;
    let family = state.capture.engine_family();
    let fps = r.fps.clamp(1, 60);
    let kbps = running.source_kbps.unwrap_or(settings.video_kbps).max(500);
    let video = encode::video_args(&VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps },
        preset: settings.preset,
        fps,
        size: None,
    });
    let audio = live_engine::encoder::AudioIn {
        rate: r.sample_rate,
        encode: vec![
            "-c:a".to_owned(),
            "libopus".to_owned(),
            "-b:a".to_owned(),
            format!("{}k", settings.audio_kbps.clamp(64, 320)),
        ],
        chunks: live.audio.subscribe(&r.mix),
    };
    let kind = r.kind;
    let to = app.clone();
    let on_chunk = Box::new(move |chunk: Vec<u8>| {
        let _ = to.state::<crate::AppState>().capture.chunk(session, chunk);
    });
    let to = app.clone();
    let on_end: live_engine::encoder::OnEnd = Box::new(move |asked, said| {
        if asked {
            return;
        }
        let said = said.unwrap_or_else(|| "it stopped".to_owned());
        if family.hardware() && encode::encoder_failed(&said) {
            to.state::<crate::AppState>().capture.engine_hw_failed(family);
        }
        eprintln!("lumora: the engine's {kind:?} encoder stopped: {said}");
        let _ = to.emit(
            "live-engine-feed-lost",
            serde_json::json!({
                "kind": kind,
                "session": session,
                "message": format!("The unified engine's {} encoder stopped ({said}).", family.label()),
            }),
        );
    });
    let spec = FeedSpec {
        source: FeedSource::Screen {
            screen: ScreenId::Live,
            vertical: r.vertical,
        },
        width: r.width.clamp(16, 7680) & !1,
        height: r.height.clamp(16, 4320) & !1,
        fps,
    };
    let make = engine_feed(ffmpeg.clone(), video, Some(audio), on_chunk, Some(on_end));
    let started = {
        let runner = Arc::clone(&runner);
        tauri::async_runtime::spawn_blocking(move || runner.start_feed(session, spec, make))
            .await
            .map_err(|e| e.to_string())?
    };
    if let Err(e) = started {
        state.capture.stop(session);
        return Err(e);
    }
    state.capture.engine_source(
        kind,
        session,
        &format!("the unified engine ({})", family.label()),
    );
    // Each camera to its own file, from the engine's own frames of it.
    let mut isos = Vec::new();
    if kind == Kind::Record && r.iso {
        let show = crate::lock(&state).show().clone();
        let iso_kbps = r.iso_kbps.unwrap_or(settings.video_kbps.min(8000)).max(500);
        for cam in &show.sources {
            if !matches!(cam.kind, lumora_engine::SourceKind::Camera { .. })
                || r.iso_skip.iter().any(|s| s == cam.id.as_str())
            {
                continue;
            }
            let Ok((id, path)) = state
                .isos
                .start(&state.capture.folder(), &r.name, &cam.name, "mkv")
            else {
                continue;
            };
            let video = encode::video_args(&VideoEncode {
                family,
                codec: Codec::H264,
                rate: Rate::Cbr { kbps: iso_kbps },
                preset: settings.preset,
                fps: 30,
                size: None,
            });
            let to = app.clone();
            let on_chunk = Box::new(move |chunk: Vec<u8>| {
                let _ = to.state::<crate::AppState>().isos.chunk(id, &chunk);
            });
            let spec = FeedSpec {
                source: FeedSource::Input(cam.id.clone()),
                width: 0,
                height: 0,
                fps: 30,
            };
            let make = engine_feed(ffmpeg.clone(), video, None, on_chunk, None);
            if runner.start_feed(ISO_FEEDS + id, spec, make).is_ok() {
                isos.push(IsoFile {
                    id,
                    source_id: cam.id.to_string(),
                    name: cam.name.clone(),
                    path: path.to_string_lossy().into_owned(),
                });
            } else {
                state.isos.stop(id);
            }
        }
    }
    lock(&live.inner)
        .captures
        .insert(session, isos.iter().map(|i| i.id).collect());
    let running = state
        .capture
        .status()
        .running_session(session)
        .unwrap_or(running);
    Ok(EngineCapture { running, isos })
}

/// Stop a recording or stream the engine encodes: its encoder (and its
/// cameras' ISO files) write the last of it, then the session ends.
#[tauri::command]
pub async fn live_engine_capture_stop(
    session: u64,
    live: State<'_, Live>,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let isos = lock(&live.inner).captures.remove(&session).unwrap_or_default();
    if let Some(runner) = live.runner() {
        let r = Arc::clone(&runner);
        let ids = isos.clone();
        tauri::async_runtime::spawn_blocking(move || {
            // All at once: each waits for its own FFmpeg.
            let mut waits = vec![{
                let r = Arc::clone(&r);
                std::thread::spawn(move || r.stop_feed(session))
            }];
            for id in ids {
                let r = Arc::clone(&r);
                waits.push(std::thread::spawn(move || r.stop_feed(ISO_FEEDS + id)));
            }
            for w in waits {
                let _ = w.join();
            }
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    for id in isos {
        state.isos.stop(id);
    }
    state.capture.stop(session);
    Ok(())
}

/// Record `seconds` of the Live Screen through the engine's encoder feed
/// into the normal recording folder (picture only: a quick check of the
/// encoder; real recordings carry the sound, see `live_engine_capture_start`).
#[tauri::command]
pub async fn live_engine_test_record(
    seconds: Option<u32>,
    live: State<'_, Live>,
    state: State<'_, crate::AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let runner = live
        .runner()
        .ok_or("Turn on the unified engine first (Settings → Engine).")?;
    let ffmpeg = live
        .ffmpeg
        .clone()
        .ok_or("FFmpeg is needed for the engine's recording.")?;
    let settings = state.capture.settings();
    let family = state.capture.engine_family();
    let c = Config::default();
    let encode_args = encode::video_args(&VideoEncode {
        family,
        codec: Codec::H264,
        rate: Rate::Cbr { kbps: 12_000 },
        preset: settings.preset,
        fps: c.fps,
        size: None,
    });
    let mime = "video/x-matroska;codecs=avc1";
    let running = state
        .capture
        .start_with(Kind::Record, mime, "Engine test", false)?;
    let session = running.session;
    let on_chunk = Box::new(move |chunk: Vec<u8>| {
        let _ = app.state::<crate::AppState>().capture.chunk(session, chunk);
    });
    let spec = FeedSpec {
        source: FeedSource::Screen {
            screen: ScreenId::Live,
            vertical: false,
        },
        width: c.width,
        height: c.height,
        fps: c.fps,
    };
    let make = engine_feed(ffmpeg, encode_args, None, on_chunk, None);
    let secs = seconds.unwrap_or(10).clamp(1, 120);
    let r = Arc::clone(&runner);
    let stats = tauri::async_runtime::spawn_blocking(move || {
        r.start_feed(session, spec, make)?;
        std::thread::sleep(std::time::Duration::from_secs(u64::from(secs)));
        Ok::<_, String>(r.stop_feed(session))
    })
    .await
    .map_err(|e| e.to_string())?;
    state.capture.stop(session);
    let s = stats?.unwrap_or_default();
    Ok(format!(
        "Recorded {secs} s with {} ({} frames, {} late){}: {}",
        family.label(),
        s.frames_in,
        s.frames_dropped,
        s.error
            .map(|e| format!(", FFmpeg said: {e}"))
            .unwrap_or_default(),
        running.path.unwrap_or_default()
    ))
}
