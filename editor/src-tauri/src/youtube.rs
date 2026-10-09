//! Publishing to YouTube from Lumora Studio: connect the channel once (the
//! system browser signs in and comes back to this computer), then upload a
//! finished film with its title, description, chapters, thumbnail and
//! captions. The upload is resumable: it goes a piece at a time and carries
//! on after the connection drops (see `crates/live-accounts/src/upload.rs`).
//!
//! The app registration is Lumora's (`LUMORA_YT_CLIENT_ID` and
//! `LUMORA_YT_CLIENT_SECRET` from the build, or `live-accounts.json` in the
//! app's data folder), and the channel's long-lived token is kept in the same
//! Windows Credential Manager entry as Lumora's, so a channel connected in
//! either app works in both. Tokens never reach the WebView.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use lumora_live_accounts::loopback::{finished_page, Loopback, Reply};
use lumora_live_accounts::oauth::{GoogleClient, TokenKeeper};
use lumora_live_accounts::service::{Accounts, Config, Provider, YOUTUBE_SECRET};
use lumora_live_accounts::upload::{self, Sent, VideoDetails};
use lumora_live_accounts::youtube;
use lumora_live_accounts::{AccountError, Http, Request, Response, Secrets};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const SIGN_IN_WAIT: Duration = Duration::from_secs(5 * 60);
const CONFIG_FILE: &str = "live-accounts.json";

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn setting(file: &serde_json::Value, key: &str, built: Option<&str>, env: &str) -> Option<String> {
    file[key]
        .as_str()
        .map(str::to_owned)
        .or_else(|| std::env::var(env).ok())
        .or_else(|| built.map(str::to_owned))
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

/// The owner's Google app registration (the same one Lumora uses).
fn client(dir: &Path) -> Option<GoogleClient> {
    let file: serde_json::Value = std::fs::read_to_string(dir.join(CONFIG_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    setting(
        &file,
        "youtubeClientId",
        option_env!("LUMORA_YT_CLIENT_ID"),
        "LUMORA_YT_CLIENT_ID",
    )
    .map(|client_id| GoogleClient {
        client_id,
        client_secret: setting(
            &file,
            "youtubeClientSecret",
            option_env!("LUMORA_YT_CLIENT_SECRET"),
            "LUMORA_YT_CLIENT_SECRET",
        ),
    })
}

// ---- where the token is kept ----

/// Windows Credential Manager, the entry Lumora uses too.
#[cfg(windows)]
pub(crate) struct Vault;

#[cfg(windows)]
impl Vault {
    fn entry(name: &str) -> Option<keyring::Entry> {
        keyring::Entry::new("Lumora live accounts", name).ok()
    }
}

#[cfg(windows)]
impl Secrets for Vault {
    fn get(&self, name: &str) -> Option<String> {
        Self::entry(name)?.get_password().ok()
    }
    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        Self::entry(name)
            .ok_or("Credential Manager isn't available")?
            .set_password(value)
            .map_err(|e| e.to_string())
    }
    fn delete(&self, name: &str) {
        if let Some(e) = Self::entry(name) {
            let _ = e.delete_credential();
        }
    }
}

/// Elsewhere (development builds): kept until Studio closes.
#[cfg(not(windows))]
#[derive(Default)]
pub(crate) struct Vault(Mutex<HashMap<String, String>>);

#[cfg(not(windows))]
impl Secrets for Vault {
    fn get(&self, name: &str) -> Option<String> {
        lock(&self.0).get(name).cloned()
    }
    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        lock(&self.0).insert(name.to_owned(), value.to_owned());
        Ok(())
    }
    fn delete(&self, name: &str) {
        lock(&self.0).remove(name);
    }
}

// ---- the network ----

/// HTTPS, keeping the answer's headers (an upload needs `Location` and `Range`).
pub(crate) struct Net {
    client: reqwest::Client,
}

impl Net {
    fn new() -> Self {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        Net {
            client: reqwest::Client::builder()
                // A piece of a film on a slow connection takes a while.
                .timeout(Duration::from_secs(10 * 60))
                .connect_timeout(Duration::from_secs(30))
                .user_agent(concat!("LumoraStudio/", env!("CARGO_PKG_VERSION")))
                .build()
                .unwrap_or_default(),
        }
    }
}

impl Http for Net {
    fn send(&self, r: &Request) -> Result<Response, String> {
        let method =
            reqwest::Method::from_bytes(r.method.as_str().as_bytes()).map_err(|e| e.to_string())?;
        let mut b = self.client.request(method, &r.url);
        for (k, v) in &r.headers {
            b = b.header(k.as_str(), v.as_str());
        }
        if !r.body.is_empty() || r.method != lumora_live_accounts::Method::Get {
            b = b.body(r.body.clone());
        }
        tauri::async_runtime::block_on(async move {
            let resp = b.send().await.map_err(|e| e.without_url().to_string())?;
            let status = resp.status().as_u16();
            let headers: Vec<(String, String)> = resp
                .headers()
                .iter()
                .filter(|(k, _)| matches!(k.as_str(), "location" | "range" | "upload-offset"))
                .map(|(k, v)| {
                    (
                        k.as_str().to_owned(),
                        v.to_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect();
            let body = resp
                .bytes()
                .await
                .map_err(|e| e.without_url().to_string())?;
            let mut out = Response::new(status, body.to_vec());
            out.headers = headers;
            Ok(out)
        })
    }
}

// ---- state ----

pub struct Publish {
    dir: PathBuf,
    pub(crate) vault: Vault,
    pub(crate) net: Net,
    connecting: AtomicBool,
    cancel: AtomicBool,
    /// Uploads that are running, by job: set to stop one.
    pub(crate) stops: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Publish {
    pub fn new(dir: &Path) -> Self {
        #[cfg(windows)]
        let vault = Vault;
        #[cfg(not(windows))]
        let vault = Vault::default();
        Publish {
            dir: dir.to_path_buf(),
            vault,
            net: Net::new(),
            connecting: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
            stops: Mutex::new(HashMap::new()),
        }
    }

    fn client(&self) -> Option<GoogleClient> {
        client(&self.dir)
    }

    /// A working access token.
    fn token(&self) -> Result<String, AccountError> {
        let c = self.client().ok_or_else(not_set_up)?;
        let refresh = self
            .vault
            .get(YOUTUBE_SECRET)
            .filter(|r| !r.is_empty())
            .ok_or_else(|| AccountError::reconnect("Connect a YouTube channel first."))?;
        let mut keeper = TokenKeeper::new(c, refresh);
        let token = keeper.access(&self.net, now())?;
        if keeper.take_rotated() {
            let _ = self.vault.set(YOUTUBE_SECRET, keeper.refresh_token());
        }
        Ok(token)
    }
}

fn not_set_up() -> AccountError {
    AccountError::new(
        "Publishing to YouTube isn’t set up in this copy of Lumora Studio yet: the person who set \
         up Lumora needs to add the Google app registration (see docs/LIVE_ACCOUNTS.md). Until \
         then, export the film and upload it at studio.youtube.com.",
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeInfo {
    set_up: bool,
    connected: bool,
    channel: String,
}

fn info(p: &Publish) -> YoutubeInfo {
    let set_up = p.client().is_some();
    let connected = set_up && p.vault.get(YOUTUBE_SECRET).is_some_and(|r| !r.is_empty());
    let channel = if connected {
        p.token()
            .ok()
            .and_then(|t| p.net.send(&youtube::channel().bearer(&t)).ok())
            .and_then(|r| youtube::parse_channel(&r).ok())
            .map(|c| c.title)
            .unwrap_or_default()
    } else {
        String::new()
    };
    YoutubeInfo {
        set_up,
        connected,
        channel,
    }
}

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Publish) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<Publish>()))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("The browser couldn’t be opened ({e})."))
}

// ---- commands ----

#[tauri::command]
pub async fn youtube_info(app: AppHandle) -> Result<YoutubeInfo, String> {
    blocking(app, |p| Ok(info(p))).await
}

/// Sign in through the browser and wait for it to come back (up to 5 minutes).
#[tauri::command]
pub async fn youtube_connect(app: AppHandle) -> Result<YoutubeInfo, String> {
    blocking(app, |p| {
        let c = p.client().ok_or_else(|| not_set_up().message)?;
        if p.connecting.swap(true, Ordering::SeqCst) {
            return Err(
                "A sign-in is already open in the browser. Finish it or cancel it first."
                    .to_owned(),
            );
        }
        p.cancel.store(false, Ordering::SeqCst);
        let result = connect(p, c);
        p.connecting.store(false, Ordering::SeqCst);
        result.map(|()| info(p))
    })
    .await
}

fn connect(p: &Publish, c: GoogleClient) -> Result<(), String> {
    let mut accounts = Accounts::new(
        Config {
            youtube: Some(c),
            facebook_app_id: None,
        },
        &p.vault,
    );
    let lb = Loopback::bind(0)
        .map_err(|e| format!("Studio couldn’t get ready for the sign-in ({e})."))?;
    let redirect = lb.redirect_uri("");
    let (url, pending) = accounts
        .begin(Provider::Youtube, &redirect)
        .map_err(|e| e.message)?;
    open_browser(&url)?;
    let done = finished_page(
        "Lumora Studio is connected",
        "You can close this tab and go back to Lumora Studio.",
    );
    let params = lb
        .wait(SIGN_IN_WAIT, &p.cancel, |path, q| {
            if path == "/" && q.iter().any(|(k, _)| k == "code" || k == "error") {
                Reply::Done(done.clone())
            } else {
                Reply::NotFound
            }
        })
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::TimedOut => {
                "The sign-in took too long (5 minutes). Click Connect to try again.".to_owned()
            }
            std::io::ErrorKind::Interrupted => "The sign-in was canceled.".to_owned(),
            _ => format!("The sign-in didn’t come back ({e})."),
        })?;
    accounts
        .complete(&p.net, &p.vault, &pending, &params, now())
        .map_err(|e| e.message)
}

#[tauri::command]
pub fn youtube_cancel(app: AppHandle) {
    app.state::<Publish>().cancel.store(true, Ordering::SeqCst);
}

/// Forget the channel on this computer (Lumora's connection too: they share it).
#[tauri::command]
pub async fn youtube_disconnect(app: AppHandle) -> Result<YoutubeInfo, String> {
    blocking(app, |p| {
        if let Some(r) = p.vault.get(YOUTUBE_SECRET) {
            let _ = p.net.send(&lumora_live_accounts::oauth::revoke(&r));
        }
        p.vault.delete(YOUTUBE_SECRET);
        Ok(info(p))
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionFile {
    path: String,
    language: String,
    name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    job: String,
    stage: &'static str,
    bytes: u64,
    total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Published {
    id: String,
    url: String,
    /// Things that didn't work but don't stop the video (thumbnail, captions).
    notes: Vec<String>,
}

/// Upload a film (and then its thumbnail and captions), telling the page how far it has got.
#[tauri::command]
pub async fn youtube_upload(
    app: AppHandle,
    job: String,
    path: String,
    details: VideoDetails,
    thumbnail: Option<String>,
    captions: Option<CaptionFile>,
) -> Result<Published, String> {
    if let Some(problem) = upload::check_details(&details) {
        return Err(problem);
    }
    let emitter = app.clone();
    blocking(app, move |p| {
        let stop = Arc::new(AtomicBool::new(false));
        lock(&p.stops).insert(job.clone(), stop.clone());
        let result = publish(
            p,
            &emitter,
            &job,
            Path::new(&path),
            &details,
            thumbnail.as_deref(),
            captions.as_ref(),
            &stop,
        );
        lock(&p.stops).remove(&job);
        result.map_err(|e| e.message)
    })
    .await
}

#[allow(clippy::too_many_arguments)]
fn publish(
    p: &Publish,
    app: &AppHandle,
    job: &str,
    path: &Path,
    details: &VideoDetails,
    thumbnail: Option<&str>,
    captions: Option<&CaptionFile>,
    stop: &AtomicBool,
) -> Result<Published, AccountError> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| AccountError::new(format!("The exported file couldn’t be opened ({e}).")))?;
    let total = file
        .metadata()
        .map_err(|e| AccountError::new(format!("The exported file couldn’t be read ({e}).")))?
        .len();
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        _ => "video/mp4",
    };
    let say = |stage: &'static str, bytes: u64| {
        let _ = app.emit(
            "youtube-upload",
            Progress {
                job: job.to_owned(),
                stage,
                bytes,
                total,
            },
        );
    };
    say("starting", 0);
    let token = p.token()?;
    let resp = p
        .net
        .send(&upload::start(details, total, mime).bearer(&token))
        .map_err(|e| {
            AccountError::new(format!(
                "Studio couldn’t reach YouTube ({e}). Check the internet connection."
            ))
        })?;
    let session = upload::session(&resp)?;
    let id = upload::send_file(
        &p.net,
        &session,
        &mut file,
        total,
        upload::CHUNK,
        stop,
        &|s| std::thread::sleep(Duration::from_secs(s)),
        &mut |s: Sent| say("uploading", s.bytes),
    )?;
    say("finishing", total);
    let mut notes = Vec::new();
    // The token may have run out during a long upload.
    let token = p.token()?;
    if let Some(t) = thumbnail {
        match std::fs::read(t) {
            Ok(bytes) if bytes.len() <= youtube::THUMBNAIL_MAX => {
                let mime = youtube::image_type(&bytes).unwrap_or("image/jpeg");
                match p
                    .net
                    .send(&youtube::set_thumbnail(&id, mime, bytes).bearer(&token))
                {
                    Ok(r) if r.ok() => {}
                    Ok(r) => notes.push(format!(
                        "The thumbnail wasn’t set: {}",
                        youtube::api_error(&r).message
                    )),
                    Err(e) => notes.push(format!("The thumbnail wasn’t set ({e}).")),
                }
            }
            Ok(_) => notes.push("The thumbnail is bigger than 2 MB, so it wasn’t set.".to_owned()),
            Err(e) => notes.push(format!("The thumbnail couldn’t be read ({e}).")),
        }
    }
    if let Some(c) = captions {
        match std::fs::read(&c.path) {
            Ok(srt) => match p
                .net
                .send(&upload::add_captions(&id, &c.language, &c.name, &srt).bearer(&token))
            {
                Ok(r) if r.ok() => {}
                Ok(r) => notes.push(format!(
                    "The captions weren’t added: {}",
                    youtube::api_error(&r).message
                )),
                Err(e) => notes.push(format!("The captions weren’t added ({e}).")),
            },
            Err(e) => notes.push(format!("The captions file couldn’t be read ({e}).")),
        }
    }
    say("done", total);
    Ok(Published {
        url: upload::watch_url(&id),
        id,
        notes,
    })
}

/// Stop an upload (YouTube keeps nothing of it).
#[tauri::command]
pub fn youtube_stop(app: AppHandle, job: String) {
    if let Some(s) = lock(&app.state::<Publish>().stops).get(&job) {
        s.store(true, Ordering::SeqCst);
    }
}

/// Open a published video in the browser (only a YouTube video id is taken).
#[tauri::command]
pub fn youtube_watch(id: String) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 20
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("That isn’t a YouTube video.".to_owned());
    }
    open_browser(&upload::watch_url(&id))
}
