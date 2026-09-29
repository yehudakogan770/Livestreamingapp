//! Web page inputs.
//!
//! Each web page input is open in its own page window (it can be clicked on
//! and typed into there). On Windows that window is captured with the
//! Windows Graphics Capture API, like a camera; each frame is encoded (JPEG,
//! or PNG when the page is see-through) and served on this computer only
//! (127.0.0.1), where every screen and the recorder pick it up:
//!
//! - `/stream/<id>`: a live picture for an `<img>` (multipart, like MJPEG);
//! - `/frame/<id>?after=<n>`: the next frame after number `n` (the recorder).
//!
//! Elsewhere (no capture) the screens show the page directly instead.

use std::collections::HashMap;
use std::io::Write;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use lumora_engine::browser::BrowserInput;
use lumora_engine::{Show, SourceKind};
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

// ---------------------------------------------------------------------------
// Frames

#[derive(Clone)]
pub struct Frame {
    pub n: u64,
    pub bytes: Arc<Vec<u8>>,
    pub mime: &'static str,
}

/// The latest frame of every page, and a way to wait for the next one.
#[derive(Default)]
pub struct Frames {
    latest: Mutex<HashMap<String, Frame>>,
    changed: Condvar,
}

impl Frames {
    pub fn put(&self, id: &str, bytes: Vec<u8>, mime: &'static str) {
        let mut all = lock(&self.latest);
        let n = all.get(id).map_or(1, |f| f.n + 1);
        all.insert(
            id.to_owned(),
            Frame {
                n,
                bytes: Arc::new(bytes),
                mime,
            },
        );
        self.changed.notify_all();
    }

    pub fn remove(&self, id: &str) {
        lock(&self.latest).remove(id);
        self.changed.notify_all();
    }

    /// The first frame newer than `after`, waiting up to `wait` for it.
    pub fn next(&self, id: &str, after: u64, wait: Duration) -> Option<Frame> {
        let deadline = Instant::now() + wait;
        let mut all = lock(&self.latest);
        loop {
            if let Some(f) = all.get(id).filter(|f| f.n > after) {
                return Some(f.clone());
            }
            let left = deadline.checked_duration_since(Instant::now())?;
            all = self
                .changed
                .wait_timeout(all, left)
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .0;
        }
    }
}

/// Encode a frame of RGBA pixels: JPEG normally, PNG when see-through.
#[cfg_attr(not(windows), allow(dead_code))] // only Windows captures pages
pub fn encode(
    rgba: &[u8],
    width: u32,
    height: u32,
    transparent: bool,
) -> Option<(Vec<u8>, &'static str)> {
    let (w, h) = (u16::try_from(width).ok()?, u16::try_from(height).ok()?);
    if rgba.len() < width as usize * height as usize * 4 {
        return None;
    }
    let mut out = Vec::with_capacity(width as usize * height as usize / 4);
    if transparent {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut writer = enc.write_header().ok()?;
        writer
            .write_image_data(&rgba[..width as usize * height as usize * 4])
            .ok()?;
        writer.finish().ok()?;
        Some((out, "image/png"))
    } else {
        jpeg_encoder::Encoder::new(&mut out, 85)
            .encode(rgba, w, h, jpeg_encoder::ColorType::Rgba)
            .ok()?;
        Some((out, "image/jpeg"))
    }
}

// ---------------------------------------------------------------------------
// The frame server (this computer only)

pub struct FrameServer {
    pub port: u16,
}

impl FrameServer {
    pub fn start(frames: Arc<Frames>) -> Option<FrameServer> {
        let server = tiny_http::Server::http("127.0.0.1:0").ok()?;
        let port = server.server_addr().to_ip()?.port();
        thread::spawn(move || {
            for request in server.incoming_requests() {
                let frames = Arc::clone(&frames);
                thread::spawn(move || serve(&frames, request));
            }
        });
        Some(FrameServer { port })
    }
}

fn header(name: &str, value: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn serve(frames: &Frames, request: tiny_http::Request) {
    let url = request.url().to_owned();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    if let Some(id) = path.strip_prefix("/frame/") {
        let after = query
            .split('&')
            .find_map(|kv| kv.strip_prefix("after="))
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let response = match frames.next(id, after, Duration::from_secs(2)) {
            Some(f) => tiny_http::Response::from_data(f.bytes.to_vec())
                .with_header(header("Content-Type", f.mime))
                .with_header(header("X-Frame", &f.n.to_string())),
            None => tiny_http::Response::from_data(Vec::new()).with_status_code(204),
        };
        let _ = request.respond(
            response
                .with_header(header("Access-Control-Allow-Origin", "*"))
                .with_header(header("Access-Control-Expose-Headers", "X-Frame"))
                .with_header(header("Cache-Control", "no-store")),
        );
    } else if let Some(id) = path.strip_prefix("/stream/") {
        let id = id.to_owned();
        let mut w = request.into_writer();
        let head = "HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=lumoraframe\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        if w.write_all(head.as_bytes()).is_err() {
            return;
        }
        let mut last = 0;
        loop {
            let Some(f) = frames.next(&id, last, Duration::from_secs(5)) else {
                // Nothing new for a while: keep the connection alive only while the page exists.
                if lock(&frames.latest).contains_key(&id) {
                    continue;
                }
                return;
            };
            last = f.n;
            let part = format!(
                "--lumoraframe\r\nContent-Type: {}\r\nContent-Length: {}\r\n\r\n",
                f.mime,
                f.bytes.len()
            );
            if w.write_all(part.as_bytes()).is_err()
                || w.write_all(&f.bytes).is_err()
                || w.write_all(b"\r\n").is_err()
                || w.flush().is_err()
            {
                return;
            }
        }
    } else {
        let _ =
            request.respond(tiny_http::Response::from_string("not found").with_status_code(404));
    }
}

// ---------------------------------------------------------------------------
// The page windows

/// A window label for a page (labels allow only a few characters).
pub fn label(id: &str) -> String {
    let safe: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("page-{safe}")
}

struct Page {
    name: String,
    input: BrowserInput,
    refreshed: Instant,
    capture: Option<capture::Capture>,
}

/// What the screens need to know to show web pages.
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInfo {
    /// Where the frames are served (None: no server).
    pub port: Option<u16>,
    /// Pages are captured (Windows); otherwise the screens show them directly.
    pub captured: bool,
}

pub struct Browsers {
    tx: Mutex<Sender<Show>>,
    pub info: BrowserInfo,
    /// Shared with stream inputs: they serve their pictures the same way.
    pub frames: Arc<Frames>,
}

impl Browsers {
    pub fn new(app: AppHandle) -> Browsers {
        let frames = Arc::new(Frames::default());
        let server = FrameServer::start(Arc::clone(&frames));
        let (tx, rx) = mpsc::channel();
        let f2 = Arc::clone(&frames);
        thread::spawn(move || manage(&app, &rx, &f2));
        Browsers {
            tx: Mutex::new(tx),
            frames,
            info: BrowserInfo {
                port: server.map(|s| s.port),
                captured: cfg!(windows),
            },
        }
    }

    /// The show changed: open, change or close page windows to match.
    pub fn sync(&self, show: &Show) {
        let _ = lock(&self.tx).send(show.clone());
    }
}

/// Runs on its own thread: windows are made and changed here, never while a
/// command is waiting on the main thread.
fn manage(app: &AppHandle, rx: &Receiver<Show>, frames: &Arc<Frames>) {
    let mut pages: HashMap<String, Page> = HashMap::new();
    loop {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(mut show) => {
                // Only the newest version matters.
                while let Ok(newer) = rx.try_recv() {
                    show = newer;
                }
                apply(app, &mut pages, &show, frames);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        // Auto refresh.
        for (id, p) in &mut pages {
            let every = u64::from(p.input.refresh_min) * 60;
            if every > 0 && p.refreshed.elapsed().as_secs() >= every {
                p.refreshed = Instant::now();
                if let Some(w) = app.get_webview_window(&label(id)) {
                    let _ = w.eval("location.reload()");
                }
            }
        }
    }
}

fn apply(app: &AppHandle, pages: &mut HashMap<String, Page>, show: &Show, frames: &Arc<Frames>) {
    let wanted: HashMap<String, (&str, &BrowserInput)> = show
        .sources
        .iter()
        .filter_map(|s| match &s.kind {
            SourceKind::Browser(b) if b.url != BrowserInput::default().url => {
                Some((s.id.as_str().to_owned(), (s.name.as_str(), &**b)))
            }
            _ => None,
        })
        .collect();
    // Gone: close.
    let gone: Vec<String> = pages
        .keys()
        .filter(|id| !wanted.contains_key(*id))
        .cloned()
        .collect();
    for id in gone {
        if let Some(mut p) = pages.remove(&id) {
            if let Some(c) = p.capture.take() {
                c.stop();
            }
        }
        frames.remove(&id);
        if let Some(w) = app.get_webview_window(&label(&id)) {
            let _ = w.destroy();
        }
    }
    for (id, (name, input)) in wanted {
        let open = pages.get(&id);
        let recreate = open.is_none_or(|p| p.input.transparent != input.transparent)
            || app.get_webview_window(&label(&id)).is_none();
        if recreate {
            if let Some(mut p) = pages.remove(&id) {
                if let Some(c) = p.capture.take() {
                    c.stop();
                }
            }
            if let Some(w) = app.get_webview_window(&label(&id)) {
                let _ = w.destroy();
            }
            match open_page(app, &id, name, input, frames) {
                Ok(capture) => {
                    pages.insert(
                        id.clone(),
                        Page {
                            name: name.to_owned(),
                            input: input.clone(),
                            refreshed: Instant::now(),
                            capture,
                        },
                    );
                }
                Err(e) => eprintln!("lumora: web page {id} could not open: {e}"),
            }
            continue;
        }
        let Some(p) = pages.get_mut(&id) else {
            continue;
        };
        let Some(w) = app.get_webview_window(&label(&id)) else {
            continue;
        };
        if p.input.url != input.url {
            if let Ok(u) = input.url.parse() {
                let _ = w.navigate(u);
            }
        }
        if (p.input.width, p.input.height) != (input.width, input.height) {
            let _ = w.set_size(tauri::PhysicalSize::new(input.width, input.height));
        }
        if p.input.zoom != input.zoom {
            let _ = w.set_zoom(f64::from(input.zoom) / 100.0);
        }
        if p.input.view_only != input.view_only {
            let _ = w.set_ignore_cursor_events(input.view_only);
        }
        if p.input.reload != input.reload {
            let _ = w.eval("location.reload()");
            p.refreshed = Instant::now();
        }
        if p.name != name {
            let _ = w.set_title(&format!("Lumora web page — {name}"));
            name.clone_into(&mut p.name);
        }
        p.input = input.clone();
    }
}

fn open_page(
    app: &AppHandle,
    id: &str,
    name: &str,
    input: &BrowserInput,
    frames: &Arc<Frames>,
) -> Result<Option<capture::Capture>, String> {
    let url = input.url.parse().map_err(|e| format!("{e}"))?;
    let w = WebviewWindowBuilder::new(app, label(id), WebviewUrl::External(url))
        .title(format!("Lumora web page — {name}"))
        .decorations(false)
        .resizable(false)
        .skip_taskbar(false)
        .focused(false)
        .always_on_bottom(true)
        .transparent(input.transparent)
        .inner_size(f64::from(input.width), f64::from(input.height))
        .build()
        .map_err(|e| e.to_string())?;
    // Exactly the chosen size in pixels, whatever the screen's scaling.
    let _ = w.set_size(tauri::PhysicalSize::new(input.width, input.height));
    let _ = w.set_zoom(f64::from(input.zoom) / 100.0);
    let _ = w.set_ignore_cursor_events(input.view_only);
    // Hand the keyboard back to the control window.
    if let Some(control) = app.get_webview_window("control") {
        let _ = control.set_focus();
    }
    Ok(capture::start(
        &w,
        id,
        input.transparent,
        Arc::clone(frames),
    ))
}

/// Bring a page window to the front to click on it, or send it back.
pub fn show_page(app: &AppHandle, id: &str, front: bool) -> Result<(), String> {
    let w = app
        .get_webview_window(&label(id))
        .ok_or("That web page isn't open.")?;
    w.set_always_on_bottom(!front).map_err(|e| e.to_string())?;
    if front {
        w.set_always_on_top(true).map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    } else {
        w.set_always_on_top(false).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Back, forward or reload in a page window.
pub fn navigate(app: &AppHandle, id: &str, how: &str) -> Result<(), String> {
    let w = app
        .get_webview_window(&label(id))
        .ok_or("That web page isn't open.")?;
    let js = match how {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        _ => return Err("unknown".to_owned()),
    };
    w.eval(js).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Capture

#[cfg(windows)]
mod capture {
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    };
    use windows_capture::window::Window;

    use super::{encode, Frames};

    type Flags = (String, bool, Arc<Frames>);
    type Error = Box<dyn std::error::Error + Send + Sync>;

    struct Handler {
        id: String,
        transparent: bool,
        frames: Arc<Frames>,
        last: Option<Instant>,
        scratch: Vec<u8>,
    }

    impl GraphicsCaptureApiHandler for Handler {
        type Flags = Flags;
        type Error = Error;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            let (id, transparent, frames) = ctx.flags;
            Ok(Handler {
                id,
                transparent,
                frames,
                last: None,
                scratch: Vec::new(),
            })
        }

        fn on_frame_arrived(
            &mut self,
            frame: &mut Frame,
            _control: InternalCaptureControl,
        ) -> Result<(), Self::Error> {
            // About 30 frames a second is plenty for a web page.
            if self
                .last
                .is_some_and(|t| t.elapsed() < Duration::from_millis(30))
            {
                return Ok(());
            }
            self.last = Some(Instant::now());
            let buffer = frame.buffer()?;
            let (w, h) = (buffer.width(), buffer.height());
            let pixels = buffer.as_nopadding_buffer(&mut self.scratch);
            if let Some((bytes, mime)) = encode(pixels, w, h, self.transparent) {
                self.frames.put(&self.id, bytes, mime);
            }
            Ok(())
        }
    }

    pub struct Capture(CaptureControl<Handler, Error>);

    impl Capture {
        pub fn stop(self) {
            let _ = self.0.stop();
        }
    }

    pub fn start(
        w: &tauri::WebviewWindow,
        id: &str,
        transparent: bool,
        frames: Arc<Frames>,
    ) -> Option<Capture> {
        let hwnd = w.hwnd().ok()?;
        let settings = Settings::new(
            Window::from_raw_hwnd(hwnd.0),
            CursorCaptureSettings::WithoutCursor,
            DrawBorderSettings::WithoutBorder,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Custom(Duration::from_millis(30)),
            DirtyRegionSettings::Default,
            ColorFormat::Rgba8,
            (id.to_owned(), transparent, frames),
        );
        match Handler::start_free_threaded(settings) {
            Ok(c) => Some(Capture(c)),
            Err(e) => {
                eprintln!("lumora: web page capture failed: {e:?}");
                None
            }
        }
    }
}

#[cfg(not(windows))]
mod capture {
    use std::sync::Arc;

    use super::Frames;

    /// No window capture here: the screens show the page directly.
    pub struct Capture;

    impl Capture {
        pub fn stop(self) {}
    }

    pub fn start(
        _w: &tauri::WebviewWindow,
        _id: &str,
        _transparent: bool,
        _frames: Arc<Frames>,
    ) -> Option<Capture> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_are_encoded_as_jpeg_or_png() {
        let rgba = vec![200u8; 64 * 36 * 4];
        let (jpg, mime) = encode(&rgba, 64, 36, false).unwrap();
        assert_eq!(mime, "image/jpeg");
        assert_eq!(&jpg[..2], &[0xFF, 0xD8]);
        let (png, mime) = encode(&rgba, 64, 36, true).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(&png[1..4], b"PNG");
        assert!(
            encode(&rgba[..10], 64, 36, false).is_none(),
            "too few pixels"
        );
    }

    #[test]
    fn the_server_hands_out_the_next_frame_and_streams() {
        let frames = Arc::new(Frames::default());
        let server = FrameServer::start(Arc::clone(&frames)).unwrap();
        frames.put("a", vec![1, 2, 3], "image/jpeg");
        let get = |path: &str| {
            let mut s = std::net::TcpStream::connect(("127.0.0.1", server.port)).unwrap();
            s.set_read_timeout(Some(Duration::from_secs(4))).unwrap();
            write!(s, "GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            // Read until the headers are in (a read may be cut short or interrupted).
            let mut got = Vec::new();
            let mut buf = vec![0; 4096];
            while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                match std::io::Read::read(&mut s, &mut buf) {
                    Ok(0) => break,
                    Ok(n) => got.extend_from_slice(&buf[..n]),
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(e) => panic!("{e}"),
                }
            }
            String::from_utf8_lossy(&got).into_owned()
        };
        let r = get("/frame/a?after=0");
        assert!(r.starts_with("HTTP/1.1 200"), "{r}");
        assert!(r.contains("X-Frame: 1") || r.contains("x-frame: 1"), "{r}");
        assert!(r.contains("Access-Control-Allow-Origin: *"), "{r}");
        // Nothing newer: after waiting, an empty answer.
        let r = get("/frame/a?after=1");
        assert!(r.starts_with("HTTP/1.1 204"), "{r}");
        let r = get("/stream/a");
        assert!(r.contains("multipart/x-mixed-replace"), "{r}");
    }

    #[test]
    fn waiting_ends_when_a_new_frame_arrives() {
        let frames = Arc::new(Frames::default());
        let f2 = Arc::clone(&frames);
        let t = thread::spawn(move || f2.next("p", 0, Duration::from_secs(3)).map(|f| f.n));
        thread::sleep(Duration::from_millis(100));
        frames.put("p", vec![0], "image/jpeg");
        assert_eq!(t.join().unwrap(), Some(1));
    }

    #[test]
    fn labels_are_safe() {
        assert_eq!(label("src-a1:b"), "page-src-a1_b");
    }
}
