W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('src-tauri/src/live.rs', [
("""    /// Recordings and streams the engine encodes, with their ISO files.
    captures: std::collections::HashMap<u64, Vec<u64>>,
}""","""    /// Recordings and streams the engine encodes, with their ISO files.
    captures: std::collections::HashMap<u64, Vec<u64>>,
    /// The engine shows the multiview in its own window (on this display: None, a window).
    multiview: Option<Option<String>>,
}"""),
("""    /// The show changed.
    pub fn sync(&self, show: &Show) {
        if let Some(r) = self.runner() {
            r.set_show(show.clone());
        }
    }""","""    /// The show changed.
    pub fn sync(&self, show: &Show) {
        if let Some(r) = self.runner() {
            r.set_show(show.clone());
        }
    }

    /// The show changed: the engine's multiview follows a new display choice.
    pub fn place_multiview(&self, app: &AppHandle, show: &Show) {
        let moved = lock(&self.inner)
            .multiview
            .as_ref()
            .is_some_and(|d| *d != show.settings.multiview.display);
        if moved {
            let _ = self.open_multiview(app, show);
        }
    }

    /// Open (or move) the multiview in the engine's own window, drawn from
    /// the same frames as the screens. False: not the engine's to show
    /// (Standard mode, not on Windows).
    ///
    /// # Errors
    /// The window could not be made.
    pub fn open_multiview(&self, app: &AppHandle, show: &Show) -> Result<bool, String> {
        let Some(r) = self.runner().filter(|_| cfg!(windows)) else {
            return Ok(false);
        };
        let wanted = show.settings.multiview.display.clone();
        let display = wanted
            .as_deref()
            .and_then(|id| {
                crate::outputs::displays(app)
                    .into_iter()
                    .find(|d| d.id == id)
            })
            .map(|d| (d.x, d.y, d.width, d.height));
        r.set_multiview(Some(Placement {
            display,
            title: "Lumora — Multiview".to_owned(),
        }))?;
        lock(&self.inner).multiview = Some(wanted);
        notify(app);
        Ok(true)
    }

    /// Close the engine's multiview. False: it wasn't open.
    pub fn close_multiview(&self, app: &AppHandle) -> bool {
        let was = lock(&self.inner).multiview.take().is_some();
        if was {
            if let Some(r) = self.runner() {
                let _ = r.set_multiview(None);
            }
            notify(app);
        }
        was
    }

    /// The engine shows the multiview now.
    pub fn multiview_open(&self) -> bool {
        lock(&self.inner).multiview.is_some()
    }"""),
# mode switch: unified -> move webview multiview to engine; standard -> reopen as webview
("""            // The Live and Back windows become the engine's.
            for s in crate::outputs::open_screens(&app) {""","""            // The multiview and the Live and Back windows become the engine's.
            if app.get_webview_window(crate::outputs::MULTIVIEW).is_some() && live.runner().is_some() {
                let _ = crate::outputs::close_multiview(&app);
                if !matches!(live.open_multiview(&app, &show), Ok(true)) {
                    let _ = crate::outputs::open_multiview(&app, &show);
                }
            }
            for s in crate::outputs::open_screens(&app) {"""),
("""            let reopen = live.open_screens();
            let runner = {
                let mut inner = lock(&live.inner);
                inner.mode = Mode::Standard;
                inner.native.clear();
                inner.error = None;
                inner.runner.take()
            };""","""            let reopen = live.open_screens();
            let multiview = live.multiview_open();
            let runner = {
                let mut inner = lock(&live.inner);
                inner.mode = Mode::Standard;
                inner.native.clear();
                inner.multiview = None;
                inner.error = None;
                inner.runner.take()
            };"""),
("""            for s in reopen {
                let _ = crate::outputs::open(&app, &show, s);
            }""","""            for s in reopen {
                let _ = crate::outputs::open(&app, &show, s);
            }
            if multiview {
                let _ = crate::outputs::open_multiview(&app, &show);
            }"""),
("""/// The mixes the engine's encoders are listening to""","""/// The engine's multiview layout while it shows the multiview (for its
/// words, drawn by the Live Screen's overlay renderer); None otherwise.
#[tauri::command]
pub fn live_engine_multiview_layout(live: State<'_, Live>) -> Option<live_engine::multiview::Layout> {
    if !live.multiview_open() {
        return None;
    }
    live.runner()?.multiview_layout()
}

/// The mixes the engine's encoders are listening to"""),
])
edit('src-tauri/src/lib.rs', [
("""fn open_multiview(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let show = lock(&state).show().clone();
    outputs::open_multiview(&app, &show).map_err(|e| e.to_string())
}""","""fn open_multiview(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    let show = lock(&state).show().clone();
    // Settings → Engine → Unified (beta): the engine shows it in its own window.
    if app.state::<live::Live>().open_multiview(&app, &show)? {
        return Ok(());
    }
    outputs::open_multiview(&app, &show).map_err(|e| e.to_string())
}"""),
("""fn close_multiview(app: tauri::AppHandle) -> Result<(), String> {
    outputs::close_multiview(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn multiview_open(app: tauri::AppHandle) -> bool {
    app.get_webview_window(outputs::MULTIVIEW).is_some()
}""","""fn close_multiview(app: tauri::AppHandle) -> Result<(), String> {
    if app.state::<live::Live>().close_multiview(&app) {
        return Ok(());
    }
    outputs::close_multiview(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn multiview_open(app: tauri::AppHandle) -> bool {
    app.get_webview_window(outputs::MULTIVIEW).is_some()
        || app.state::<live::Live>().multiview_open()
}"""),
("""    if let Some(live) = app.try_state::<live::Live>() {
        live.sync(&snapshot.show);
    }""","""    if let Some(live) = app.try_state::<live::Live>() {
        live.sync(&snapshot.show);
        live.place_multiview(app, &snapshot.show);
    }"""),
("""            live::live_engine_probe
""","""            live::live_engine_probe,
            live::live_engine_multiview_layout
"""),
])
