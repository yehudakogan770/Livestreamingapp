import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ae2e4fb2496ef2830')
p = 'src-tauri/src/browser.rs'
s = open(p).read()


def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (s.count(old), old[:90])
    s = s.replace(old, new)


rep("""//! - `/stream/<id>`: a live picture for an `<img>` (multipart, like MJPEG);
//! - `/frame/<id>?after=<n>`: the next frame after number `n` (the recorder).
//!""", """//! - `/stream/<id>`: a live picture for an `<img>` (multipart, like MJPEG);
//! - `/frame/<id>?after=<n>`: the next frame after number `n` (the recorder).
//!
//! Every address needs `k=<key>`, a secret only Lumora's own windows are
//! told (`browser_info`), so no other program or web page on this computer can
//! watch the pages or listen to them; and each page window may send its sound
//! only to its own input (`t=<its own key>`).
//!
//! Page windows show pages from the web, so they may only ever show web
//! pages (http and https): never one of Lumora's own addresses or files,
//! which could reach Lumora's commands. Nothing is downloaded from them.
//!""")
rep("""#[derive(Default)]
pub struct Sounds {
    listeners: Mutex<HashMap<String, Vec<Feed>>>,
}""", """#[derive(Default)]
pub struct Sounds {
    listeners: Mutex<HashMap<String, Vec<Feed>>>,
    /// Each page window's own key for sending its sound.
    inlets: Mutex<HashMap<String, String>>,
}""")
rep("""    pub fn remove(&self, id: &str) {
        lock(&self.listeners).remove(id);
    }
}""", """    pub fn remove(&self, id: &str) {
        lock(&self.listeners).remove(id);
    }

    /// The key a page window sends its sound with (made the first time).
    pub fn inlet(&self, id: &str) -> String {
        lock(&self.inlets)
            .entry(id.to_owned())
            .or_insert_with(secret)
            .clone()
    }

    fn may_send(&self, id: &str, key: &str) -> bool {
        lock(&self.inlets)
            .get(id)
            .is_some_and(|k| same(k.as_bytes(), key.as_bytes()))
    }
}

/// A new random secret (128 bits, as hex).
pub fn secret() -> String {
    use std::hash::{BuildHasher, Hasher};
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    (0..2u64)
        .map(|i| {
            // Each RandomState is keyed from the operating system's randomness.
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u64(i);
            h.write_u128(nanos);
            h.write_u32(std::process::id());
            format!("{:016x}", h.finish())
        })
        .collect()
}

/// Equal, taking the same time whichever character differs.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

/// One value from an address's `?a=1&b=2` part.
fn query_value<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query.split('&').find_map(|kv| {
        kv.split_once('=')
            .filter(|(k, _)| *k == name)
            .map(|(_, v)| v)
    })
}

/// May a page window go to this address? Only web pages: never Lumora's own
/// pages or files (`tauri:`, `asset:`, `ipc:`, `file:`, `*.localhost`
/// addresses on Windows), which could reach Lumora's commands.
pub fn page_may_show(url: &tauri::Url) -> bool {
    let web = matches!(url.scheme(), "http" | "https");
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let ours = host.ends_with(".localhost") || host == "tauri.localhost";
    web && !ours
}""")
rep("""pub struct FrameServer {
    pub port: u16,
}

impl FrameServer {
    pub fn start(frames: Arc<Frames>, sounds: Arc<Sounds>) -> Option<FrameServer> {
        let server = tiny_http::Server::http("127.0.0.1:0").ok()?;
        let port = server.server_addr().to_ip()?.port();
        thread::spawn(move || {
            for request in server.incoming_requests() {
                let frames = Arc::clone(&frames);
                let sounds = Arc::clone(&sounds);
                thread::spawn(move || serve(&frames, &sounds, request));
            }
        });
        Some(FrameServer { port })
    }
}""", """pub struct FrameServer {
    pub port: u16,
    /// Asked for on every address (see the top of this file).
    pub key: String,
}

impl FrameServer {
    pub fn start(frames: Arc<Frames>, sounds: Arc<Sounds>) -> Option<FrameServer> {
        let server = tiny_http::Server::http("127.0.0.1:0").ok()?;
        let port = server.server_addr().to_ip()?.port();
        let key = secret();
        let k = Arc::new(key.clone());
        thread::spawn(move || {
            for request in server.incoming_requests() {
                let frames = Arc::clone(&frames);
                let sounds = Arc::clone(&sounds);
                let k = Arc::clone(&k);
                thread::spawn(move || serve(&frames, &sounds, &k, request));
            }
        });
        Some(FrameServer { port, key })
    }
}""")
rep("""fn serve(frames: &Frames, sounds: &Sounds, request: tiny_http::Request) {
    let url = request.url().to_owned();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let method = request.method().clone();""", """fn serve(frames: &Frames, sounds: &Sounds, key: &str, request: tiny_http::Request) {
    let url = request.url().to_owned();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let method = request.method().clone();
    // Everything but a page's own sound needs the key.
    let keyed = query_value(query, "k").is_some_and(|k| same(k.as_bytes(), key.as_bytes()));
    if !keyed && !path.starts_with("/audio-in/") {
        let _ = request
            .respond(tiny_http::Response::from_string("not allowed").with_status_code(403));
        return;
    }""")
rep("""        if method == tiny_http::Method::Post {
            let mut request = request;""", """        let id = percent_decode(&id);
        if method == tiny_http::Method::Post && !sounds.may_send(&id, query_value(query, "t").unwrap_or_default()) {
            let _ = request.respond(cors(
                tiny_http::Response::from_data(Vec::new()).with_status_code(403),
            ));
        } else if method == tiny_http::Method::Post {
            let mut request = request;""")
rep("""            body.truncate(body.len() - body.len() % 4);
            let id = percent_decode(&id);
            if !body.is_empty() {""", """            body.truncate(body.len() - body.len() % 4);
            if !body.is_empty() {""")
rep("""#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInfo {
    /// Where the frames are served (None: no server).
    pub port: Option<u16>,""", """#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInfo {
    /// Where the frames are served (None: no server).
    pub port: Option<u16>,
    /// The key the server asks for (only Lumora's own windows are told).
    pub key: String,""")
rep("""        let port = server.as_ref().map(|s| s.port);
        thread::spawn(move || manage(&app, &rx, &f2, port));""", """        let port = server.as_ref().map(|s| s.port);
        let s2 = Arc::clone(&sounds);
        thread::spawn(move || manage(&app, &rx, &f2, &s2, port));""")
rep("""            info: BrowserInfo {
                port: server.map(|s| s.port),""", """            info: BrowserInfo {
                port: server.as_ref().map(|s| s.port),
                key: server.map(|s| s.key).unwrap_or_default(),""")
rep("""fn manage(app: &AppHandle, rx: &Receiver<Show>, frames: &Arc<Frames>, port: Option<u16>) {""",
    """fn manage(
    app: &AppHandle,
    rx: &Receiver<Show>,
    frames: &Arc<Frames>,
    sounds: &Arc<Sounds>,
    port: Option<u16>,
) {""")
rep("""                apply(app, &mut pages, &show, frames, port);""", """                apply(app, &mut pages, &show, frames, sounds, port);""")
rep("""    show: &Show,
    frames: &Arc<Frames>,
    port: Option<u16>,
) {
    let wanted""", """    show: &Show,
    frames: &Arc<Frames>,
    sounds: &Arc<Sounds>,
    port: Option<u16>,
) {
    let wanted""")
rep("""            match open_page(app, &id, name, input, frames, port) {""", """            let inlet = sounds.inlet(&id);
            match open_page(app, &id, name, input, frames, port.map(|p| (p, inlet.as_str()))) {""")
rep("""    frames: &Arc<Frames>,
    port: Option<u16>,
) -> Result<Option<capture::Capture>, String> {
    let url = input.url.parse().map_err(|e| format!("{e}"))?;
    let w = WebviewWindowBuilder::new(app, label(id), WebviewUrl::External(url))
        .additional_browser_args(crate::BROWSER_ARGS)
        .initialization_script(sound_script(port, id))""", """    frames: &Arc<Frames>,
    sound: Option<(u16, &str)>,
) -> Result<Option<capture::Capture>, String> {
    let url: tauri::Url = input.url.parse().map_err(|e| format!("{e}"))?;
    if !page_may_show(&url) {
        return Err("only web pages (http or https) can be shown".to_owned());
    }
    let w = WebviewWindowBuilder::new(app, label(id), WebviewUrl::External(url))
        .additional_browser_args(crate::BROWSER_ARGS)
        .initialization_script(sound_script(sound, id))
        // A page (or a link on it) may only lead to other web pages.
        .on_navigation(page_may_show)
        // Nothing is downloaded from a page window.
        .on_download(|_, _| false)""")
rep("""fn sound_script(port: Option<u16>, id: &str) -> String {
    let Some(port) = port else {
        return String::new();
    };
    SOUND_SCRIPT
        .replace("__PORT__", &port.to_string())
        .replace("__ID__", &serde_json::to_string(id).unwrap_or_default())
}""", """fn sound_script(sound: Option<(u16, &str)>, id: &str) -> String {
    let Some((port, key)) = sound else {
        return String::new();
    };
    SOUND_SCRIPT
        .replace("__PORT__", &port.to_string())
        .replace("__ID__", &serde_json::to_string(id).unwrap_or_default())
        .replace("__KEY__", &serde_json::to_string(key).unwrap_or_default())
}""")
# tests
rep("""        let rx = sounds.listen("page 1");
        let post = |method: &str, body: &[u8]| {
            let mut s = std::net::TcpStream::connect(("127.0.0.1", server.port)).unwrap();
            write!(
                s,
                "{method} /audio-in/page%201 HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: {}\\r\\nConnection: close\\r\\n\\r\\n",
                body.len()
            )
            .unwrap();""", """        let rx = sounds.listen("page 1");
        let inlet = sounds.inlet("page 1");
        let post_to = |method: &str, query: &str, body: &[u8]| {
            let mut s = std::net::TcpStream::connect(("127.0.0.1", server.port)).unwrap();
            write!(
                s,
                "{method} /audio-in/page%201{query} HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: {}\\r\\nConnection: close\\r\\n\\r\\n",
                body.len()
            )
            .unwrap();""")
rep("""        let asked = post("OPTIONS", b"");
        assert!(asked.contains("Access-Control-Allow-Private-Network: true"));
        post("POST", &[1, 2, 3, 4, 5, 6]);
        let chunk = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(&chunk[..], &[1, 2, 3, 4], "whole stereo samples only");""", """        let asked = post_to("OPTIONS", "", b"");
        assert!(asked.contains("Access-Control-Allow-Private-Network: true"));
        // Without its own key (another page, or any web page), refused.
        assert!(post_to("POST", "", &[9, 9, 9, 9]).starts_with("HTTP/1.1 403"));
        assert!(post_to("POST", "?t=guess", &[9, 9, 9, 9]).starts_with("HTTP/1.1 403"));
        post_to("POST", &format!("?t={inlet}"), &[1, 2, 3, 4, 5, 6]);
        let chunk = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(&chunk[..], &[1, 2, 3, 4], "whole stereo samples only");""")
rep("""        let r = get("/frame/a?after=0");
        assert!(r.starts_with("HTTP/1.1 200"), "{r}");""", """        // Without the key: nothing (other programs and web pages can't watch).
        assert!(get("/frame/a?after=0").starts_with("HTTP/1.1 403"));
        assert!(get("/stream/a?k=wrong").starts_with("HTTP/1.1 403"));
        let k = &server.key;
        let r = get(&format!("/frame/a?k={k}&after=0"));
        assert!(r.starts_with("HTTP/1.1 200"), "{r}");""")
rep("""        let r = get("/frame/a?after=1");
        assert!(r.starts_with("HTTP/1.1 204"), "{r}");
        let r = get("/stream/a");""", """        let r = get(&format!("/frame/a?after=1&k={k}"));
        assert!(r.starts_with("HTTP/1.1 204"), "{r}");
        let r = get(&format!("/stream/a?k={k}"));""")
rep("""    #[test]
    fn waiting_ends_when_a_new_frame_arrives() {""", """    #[test]
    fn page_windows_show_only_web_pages() {
        let ok = |u: &str| page_may_show(&u.parse().unwrap());
        assert!(ok("https://example.com/page"));
        assert!(ok("http://192.168.1.20:8080/"));
        assert!(ok("http://localhost:3000/overlay"));
        assert!(!ok("http://asset.localhost/C:/Users/x/Downloads/evil.html"));
        assert!(!ok("https://tauri.localhost/"));
        assert!(!ok("http://ipc.localhost/plugin"));
        assert!(!ok("asset://localhost/etc/passwd"));
        assert!(!ok("tauri://localhost/index.html"));
        assert!(!ok("file:///C:/evil.html"));
        assert!(!ok("javascript:alert(1)"));
        assert_eq!(secret().len(), 32);
        assert_ne!(secret(), secret());
    }

    #[test]
    fn waiting_ends_when_a_new_frame_arrives() {""")
open(p, 'w').write(s)

p = 'src-tauri/src/page_sound.js'
s = open(p).read()
old = "  const url = 'http://127.0.0.1:__PORT__/audio-in/' + encodeURIComponent(__ID__);"
assert old in s
s = s.replace(old, "  const url = 'http://127.0.0.1:__PORT__/audio-in/' + encodeURIComponent(__ID__) + '?t=' + encodeURIComponent(__KEY__);")
open(p, 'w').write(s)

p = 'src-tauri/src/lib.rs'
s = open(p).read()
old = """fn browser_info(state: State<'_, AppState>) -> browser::BrowserInfo {
    state.browsers.info
}"""
assert old in s
s = s.replace(old, """fn browser_info(state: State<'_, AppState>) -> browser::BrowserInfo {
    state.browsers.info.clone()
}""")
open(p, 'w').write(s)
