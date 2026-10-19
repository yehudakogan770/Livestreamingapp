@@@
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    mode: Mode,
}
===
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    mode: Mode,
    options: EngineOptions,
}

/// Settings → Engine: the unified engine's graphics card, and how each
/// output window shows (see `crates/live-engine/src/adapters.rs` and HDR in
/// `present.rs`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineOptions {
    /// The graphics card's key; None: the high-performance one (automatic).
    pub adapter: Option<String>,
    /// Outputs (`live`, `back`, `monitor`, `multiview`) presented by the card
    /// their display hangs off (the engine copies the picture across).
    pub own_card: Vec<String>,
    /// Outputs shown in HDR10 when their display shows HDR.
    pub hdr: Vec<String>,
    /// SDR white in HDR outputs, in nits.
    pub sdr_white: u32,
}

impl Default for EngineOptions {
    fn default() -> Self {
        EngineOptions {
            adapter: None,
            own_card: Vec::new(),
            hdr: Vec::new(),
            sdr_white: live_engine::gpu::SDR_WHITE_NITS,
        }
    }
}

impl EngineOptions {
    /// How output `name`'s window is placed: on `display`, with `title`.
    fn placement(&self, name: &str, display: Option<(i32, i32, u32, u32)>, title: String) -> Placement {
        Placement {
            display,
            title,
            own_card: self.own_card.iter().any(|o| o == name),
            hdr_white: self
                .hdr
                .iter()
                .any(|o| o == name)
                .then_some(self.sdr_white.clamp(80, 1000)),
        }
    }
}
@@@
#[derive(Default)]
struct Inner {
    mode: Mode,
===
#[derive(Default)]
struct Inner {
    mode: Mode,
    options: EngineOptions,
@@@
    pub stats: Option<Stats>,
    /// The engine shows the Live and Back Screens in its own windows here (Windows).
    pub native_outputs: bool,
}
===
    pub stats: Option<Stats>,
    /// The engine shows the Live and Back Screens in its own windows here (Windows).
    pub native_outputs: bool,
    pub options: EngineOptions,
}
@@@
            inner: Mutex::new(Inner {
                mode: saved.mode,
                ..Inner::default()
            }),
===
            inner: Mutex::new(Inner {
                mode: saved.mode,
                options: saved.options,
                ..Inner::default()
            }),
@@@
        match Runner::start(Config::default(), Box::new(factory)) {
===
        let config = Config {
            adapter: inner.options.adapter.clone(),
            ..Config::default()
        };
        match Runner::start(config, Box::new(factory)) {
@@@
        r.set_multiview(Some(Placement {
            display,
            title: "Lumora — Multiview".to_owned(),
        }))?;
===
        let placement = lock(&self.inner).options.placement(
            "multiview",
            display,
            "Lumora — Multiview".to_owned(),
        );
        r.set_multiview(Some(placement))?;
@@@
            stats: inner.runner.as_ref().map(|r| r.stats()),
            native_outputs: cfg!(windows),
        }
===
            stats: inner.runner.as_ref().map(|r| r.stats()),
            native_outputs: cfg!(windows),
            options: inner.options.clone(),
        }
@@@
    fn placement(app: &AppHandle, show: &Show, screen: ScreenId) -> Placement {
===
    fn placement(&self, app: &AppHandle, show: &Show, screen: ScreenId) -> Placement {
@@@
        Placement {
            display,
            title: format!("Lumora — {} output", screen.label()),
        }
===
        lock(&self.inner).options.placement(
            live_engine::engine::screen_name(screen),
            display,
            format!("Lumora — {} output", screen.label()),
        )
@@@
        r.set_output(screen, Some(Self::placement(app, show, screen)))?;
===
        r.set_output(screen, Some(self.placement(app, show, screen)))?;
@@@
    let show = crate::lock(&state).show().clone();
    let data = serde_json::to_string_pretty(&Saved { mode }).map_err(|e| e.to_string())?;
    write_file_atomic(&live.file, &data).map_err(|e| e.to_string())?;
===
    let show = crate::lock(&state).show().clone();
    let options = lock(&live.inner).options.clone();
    let data =
        serde_json::to_string_pretty(&Saved { mode, options }).map_err(|e| e.to_string())?;
    write_file_atomic(&live.file, &data).map_err(|e| e.to_string())?;
@@@
/// Changed graphics from a screen's overlay renderer (the wire format in
===
/// Settings → Engine's graphics card and output choices. A new graphics card
/// starts the engine again on it (its windows reopen there; not while
/// recording or streaming); the outputs' choices apply at once.
#[tauri::command]
pub fn live_engine_set_options(
    options: EngineOptions,
    live: State<'_, Live>,
    state: State<'_, crate::AppState>,
    app: AppHandle,
) -> Result<Info, String> {
    let before = lock(&live.inner).options.clone();
    if before == options {
        return Ok(live.info());
    }
    let new_card = before.adapter != options.adapter;
    if new_card && live.runner().is_some() {
        let st = state.capture.status();
        if st.recording.is_some()
            || st.streaming.is_some()
            || st.vertical.is_some()
            || st.ndi.is_some()
            || lock(&live.inner).replay.is_some()
        {
            return Err(
                "Stop recording, streaming, NDI and instant replay before changing the graphics card."
                    .to_owned(),
            );
        }
    }
    let mode = live.mode();
    let data = serde_json::to_string_pretty(&Saved {
        mode,
        options: options.clone(),
    })
    .map_err(|e| e.to_string())?;
    write_file_atomic(&live.file, &data).map_err(|e| e.to_string())?;
    lock(&live.inner).options = options;
    let show = crate::lock(&state).show().clone();
    let screens = live.open_screens();
    let multiview = live.multiview_open();
    if new_card && live.runner().is_some() {
        // The engine again, on the other card: its windows reopen there and
        // the graphics and person masks are sent again.
        let old = {
            let mut inner = lock(&live.inner);
            inner.native.clear();
            inner.multiview = None;
            inner.runner.take()
        };
        drop(old);
        live.start(&show);
        if let Some(r) = live.runner() {
            r.shared
                .graphics_lost
                .store(true, std::sync::atomic::Ordering::SeqCst);
            r.shared
                .vision_lost
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
    for s in screens {
        if let Err(e) = live.open_output(&app, &show, s) {
            eprintln!("lumora: unified output {s:?}: {e}");
        }
    }
    if multiview {
        let _ = live.open_multiview(&app, &show);
    }
    notify(&app);
    sync_renderers(&app);
    let info = live.info();
    let _ = app.emit("live-engine-changed", &info);
    Ok(info)
}

/// Changed graphics from a screen's overlay renderer (the wire format in
