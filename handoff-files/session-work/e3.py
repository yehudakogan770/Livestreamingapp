W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'src-tauri/src/live.rs'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep("""//! - the Live and Back Screens' output windows are the engine's own native
//!   windows (the Monitor, all words, stays a WebView window for now);""","""//! - the Live and Back Screens' output windows are the engine's own native
//!   windows (the Monitor, all words, stays a WebView window for now);
//! - each engine screen's graphics (titles, lower thirds, countdowns…) are
//!   drawn by a hidden overlay renderer window (`overlay-live`,
//!   `overlay-back`: `app/src/engine/overlayRenderer.ts`) that sends what
//!   changed (`live_engine_graphics`);""")
rep("""use tauri::{AppHandle, Emitter, Manager, State};""","""use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};""")
rep("""/// What the Engine settings show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub mode: Mode,
    pub running: bool,""","""/// The size and rate every engine screen is drawn at.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Size {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

/// What the Engine settings show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub mode: Mode,
    pub running: bool,
    /// The engine's screens (for the overlay renderers); None when it isn't running.
    pub size: Option<Size>,""")
rep("""        Info {
            mode: inner.mode,
            running: inner.runner.is_some(),""","""        let c = Config::default();
        Info {
            mode: inner.mode,
            running: inner.runner.is_some(),
            size: inner.runner.as_ref().map(|_| Size {
                width: c.width,
                height: c.height,
                fps: c.fps,
            }),""")
# overlay windows helpers after the native_screen fn
rep("""impl Live {
    pub fn new(""","""/// The hidden graphics renderer window of a screen.
pub fn renderer_label(screen: ScreenId) -> &'static str {
    match screen {
        ScreenId::Back => "overlay-back",
        _ => "overlay-live",
    }
}

/// The overlay renderers' web view runs its own browser process (its own data
/// folder) so it can be told never to slow down while hidden: a hidden page's
/// timers and drawing are otherwise throttled.
const RENDERER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \\
--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling \\
--disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

/// Open (or close) the screens' overlay renderers: the Live Screen's while
/// the engine runs (the recording and stream need its graphics too), the
/// Back Screen's while the engine shows it.
pub fn sync_renderers(app: &AppHandle) {
    let Some(live) = app.try_state::<Live>() else {
        return;
    };
    let (running, native) = {
        let inner = lock(&live.inner);
        (inner.runner.is_some(), inner.native.clone())
    };
    for screen in [ScreenId::Live, ScreenId::Back] {
        let wanted = running && (screen == ScreenId::Live || native.contains(&screen));
        let label = renderer_label(screen);
        let open = app.get_webview_window(label);
        match (wanted, open) {
            (true, None) => {
                let mut b = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
                    .title(format!("Lumora — {} graphics", screen.label()))
                    .visible(false)
                    .focused(false)
                    .skip_taskbar(true)
                    .inner_size(320.0, 180.0)
                    .additional_browser_args(RENDERER_ARGS);
                if let Ok(dir) = app.path().app_local_data_dir() {
                    b = b.data_directory(dir.join("overlay-webview"));
                }
                if let Err(e) = b.build() {
                    eprintln!("lumora: the {screen:?} graphics renderer could not start: {e}");
                }
            }
            (false, Some(w)) => {
                let _ = w.close();
            }
            _ => {}
        }
    }
}

impl Live {
    pub fn new(""")
# open_output: after notify(app) call sync_renderers
rep("""            if !inner.native.contains(&screen) {
                inner.native.push(screen);
            }
        }
        notify(app);
        Ok(true)""","""            if !inner.native.contains(&screen) {
                inner.native.push(screen);
            }
        }
        notify(app);
        sync_renderers(app);
        Ok(true)""")
rep("""            if let Some(r) = self.runner() {
                let _ = r.set_output(screen, None);
            }
            notify(app);
        }
        was""","""            if let Some(r) = self.runner() {
                let _ = r.set_output(screen, None);
            }
            notify(app);
            sync_renderers(app);
        }
        was""")
rep("""    let show = crate::lock(&state).show().clone();
    l.start(&show);
}""","""    let show = crate::lock(&state).show().clone();
    l.start(&show);
    sync_renderers(app);
}""")
rep("""    notify(&app);
    let info = live.info();
    let _ = app.emit("live-engine-changed", &info);
    Ok(info)""","""    notify(&app);
    sync_renderers(&app);
    let info = live.info();
    let _ = app.emit("live-engine-changed", &info);
    Ok(info)""")
rep("""/// A preview tile as JPEG""","""/// Changed graphics from a screen's overlay renderer (the wire format in
/// `crates/live-engine/src/overlay.rs`); checked before the engine takes it.
#[tauri::command]
pub fn live_engine_graphics(
    request: tauri::ipc::Request<'_>,
    live: State<'_, Live>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let r = live
        .runner()
        .ok_or("The unified engine is not running.")?;
    r.graphics(bytes.clone())
}

/// A preview tile as JPEG""")
open(p,'w').write(s)

p=W+'src-tauri/src/lib.rs'
s=open(p).read()
s=s.replace("""            live::live_engine_test_record""","""            live::live_engine_test_record,
            live::live_engine_graphics""",1)
open(p,'w').write(s)
