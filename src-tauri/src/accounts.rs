//! Connected YouTube and Facebook accounts (see `crates/live-accounts` and
//! docs/LIVE_ACCOUNTS.md): signing in through the system browser, keeping
//! the long-lived token in Windows Credential Manager, and preparing the
//! connected destinations when Lumora goes live.
//!
//! The app registrations (a Google OAuth client of type "Desktop app" and a
//! Meta app ID) are not secrets. They come from the build
//! (`LUMORA_YT_CLIENT_ID`, `LUMORA_YT_CLIENT_SECRET`, `LUMORA_FB_APP_ID`, set
//! from the repository's Actions variables), or from `live-accounts.json` in
//! the app's data folder (for the owner's own testing). Without them, the
//! Connect buttons say the feature isn't set up yet.
//!
//! Tokens never reach logs, event files or the WebView: the WebView only sees
//! names, broadcasts and health.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use lumora_live_accounts::facebook::{self, Target};
use lumora_live_accounts::loopback::{finished_page, forward_fragment_page, Loopback, Reply};
use lumora_live_accounts::oauth::GoogleClient;
use lumora_live_accounts::service::{
    Accounts, AccountsInfo, Config, Failed, Pending, Provider, SessionView,
};
use lumora_live_accounts::youtube::{Broadcast, BroadcastSettings};
use lumora_live_accounts::{Http, Request, Response, Secrets};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::capture::CaptureSettings;
use crate::AppState;

/// How long the browser has to come back.
const SIGN_IN_WAIT: Duration = Duration::from_secs(5 * 60);
/// How often health and state are read while Lumora streams through an account
/// (a YouTube status read is 1 quota unit).
const TICK: Duration = Duration::from_secs(15);
const CONFIG_FILE: &str = "live-accounts.json";
const THUMBNAILS: &str = "thumbnails";

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A value from the build, the environment (for development) or the config file.
fn setting(file: &serde_json::Value, key: &str, built: Option<&str>, env: &str) -> Option<String> {
    file[key]
        .as_str()
        .map(str::to_owned)
        .or_else(|| std::env::var(env).ok())
        .or_else(|| built.map(str::to_owned))
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

/// The owner's app registrations.
fn config(dir: &Path) -> Config {
    let file: serde_json::Value = std::fs::read_to_string(dir.join(CONFIG_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let youtube = setting(
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
    });
    let facebook_app_id = setting(
        &file,
        "facebookAppId",
        option_env!("LUMORA_FB_APP_ID"),
        "LUMORA_FB_APP_ID",
    );
    Config {
        youtube,
        facebook_app_id,
    }
}

// ---- where tokens are kept ----

/// Windows Credential Manager ("Lumora live accounts" entries).
#[cfg(windows)]
struct Vault;

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

/// Elsewhere (development builds): kept until Lumora closes.
#[cfg(not(windows))]
#[derive(Default)]
struct Vault(Mutex<std::collections::HashMap<String, String>>);

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

/// HTTPS through the same client the updater uses. Called from plain threads
/// (never from inside an async task).
struct Net(reqwest::Client);

impl Net {
    fn new() -> Self {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        Net(reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("Lumora/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default())
    }
}

impl Http for Net {
    fn send(&self, r: &Request) -> Result<Response, String> {
        let method =
            reqwest::Method::from_bytes(r.method.as_str().as_bytes()).map_err(|e| e.to_string())?;
        let mut b = self.0.request(method, &r.url);
        for (k, v) in &r.headers {
            b = b.header(k.as_str(), v.as_str());
        }
        if !r.body.is_empty() || r.method != lumora_live_accounts::Method::Get {
            b = b.body(r.body.clone());
        }
        tauri::async_runtime::block_on(async move {
            // Errors without the address (it never holds a token, but keep logs short).
            let resp = b.send().await.map_err(|e| e.without_url().to_string())?;
            let status = resp.status().as_u16();
            let body = resp
                .bytes()
                .await
                .map_err(|e| e.without_url().to_string())?;
            Ok(Response::new(status, body.to_vec()))
        })
    }
}

// ---- state ----

pub struct LiveAccounts {
    accounts: Mutex<Accounts>,
    vault: Vault,
    net: Net,
    dir: PathBuf,
    /// A sign-in is waiting for the browser.
    connecting: AtomicBool,
    cancel: AtomicBool,
    /// The manual Facebook sign-in waiting for its pasted address.
    manual: Mutex<Option<Pending>>,
    ticking: Arc<AtomicBool>,
}

impl LiveAccounts {
    pub fn new(dir: &Path) -> Self {
        #[cfg(windows)]
        let vault = Vault;
        #[cfg(not(windows))]
        let vault = Vault::default();
        let accounts = Accounts::new(config(dir), &vault);
        LiveAccounts {
            accounts: Mutex::new(accounts),
            vault,
            net: Net::new(),
            dir: dir.to_path_buf(),
            connecting: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
            manual: Mutex::new(None),
            ticking: Arc::new(AtomicBool::new(false)),
        }
    }

    fn info(&self) -> AccountsInfo {
        lock(&self.accounts).info()
    }
}

/// Look up the connected names a little after start-up (off the main thread).
pub fn load_names(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(5));
        let la = app.state::<LiveAccounts>();
        lock(&la.accounts).load_names(&la.net, &la.vault, now());
    });
}

/// Run blocking work (network, waiting for the browser) off the async runtime.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&LiveAccounts) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<LiveAccounts>()))
        .await
        .map_err(|e| e.to_string())?
}

/// Open an address in the system browser.
fn open_browser(url: &str) -> Result<(), String> {
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

fn parse_provider(p: &str) -> Result<Provider, String> {
    match p {
        "youtube" => Ok(Provider::Youtube),
        "facebook" => Ok(Provider::Facebook),
        _ => Err(format!("unknown account type {p}")),
    }
}

// ---- commands ----

// Commands that wait for the accounts run off the main thread: a status read
// may be on its way to YouTube while they ask.

#[tauri::command]
pub async fn accounts_info(app: AppHandle) -> Result<AccountsInfo, String> {
    blocking(app, |la| Ok(la.info())).await
}

/// Sign in through the browser and wait for it to come back (up to 5 minutes).
#[tauri::command]
pub async fn accounts_connect(app: AppHandle, provider: String) -> Result<AccountsInfo, String> {
    let provider = parse_provider(&provider)?;
    blocking(app, move |la| {
        if la.connecting.swap(true, Ordering::SeqCst) {
            return Err(
                "A sign-in is already open in the browser. Finish it or cancel it first."
                    .to_owned(),
            );
        }
        la.cancel.store(false, Ordering::SeqCst);
        let result = connect(la, provider);
        la.connecting.store(false, Ordering::SeqCst);
        result.map(|()| la.info())
    })
    .await
}

fn connect(la: &LiveAccounts, provider: Provider) -> Result<(), String> {
    let (lb, redirect) = match provider {
        Provider::Youtube => {
            let lb = Loopback::bind(0)
                .map_err(|e| format!("Lumora couldn’t get ready for the sign-in ({e})."))?;
            let r = lb.redirect_uri("");
            (lb, r)
        }
        Provider::Facebook => {
            let lb = Loopback::bind(facebook::LOOPBACK_PORT).map_err(|_| {
                format!(
                    "Lumora couldn’t listen for Facebook’s answer (port {} is in use). Use “Connect \
                     by pasting the address” instead.",
                    facebook::LOOPBACK_PORT
                )
            })?;
            (lb, facebook::loopback_redirect())
        }
    };
    let (url, pending) = lock(&la.accounts)
        .begin(provider, &redirect)
        .map_err(|e| e.message)?;
    open_browser(&url)?;
    let done = finished_page(
        "Lumora is connected",
        &format!(
            "You can close this tab and go back to Lumora. ({} account)",
            provider.name()
        ),
    );
    let params = lb
        .wait(SIGN_IN_WAIT, &la.cancel, |path, q| match provider {
            Provider::Youtube
                if path == "/" && q.iter().any(|(k, _)| k == "code" || k == "error") =>
            {
                Reply::Done(done.clone())
            }
            Provider::Facebook if path == facebook::LOOPBACK_PATH => Reply::Page(
                forward_fragment_page(&format!("{}/done", facebook::LOOPBACK_PATH)),
            ),
            Provider::Facebook if path == format!("{}/done", facebook::LOOPBACK_PATH) => {
                Reply::Done(done.clone())
            }
            _ => Reply::NotFound,
        })
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::TimedOut => {
                "The sign-in took too long (5 minutes). Click Connect to try again.".to_owned()
            }
            std::io::ErrorKind::Interrupted => "The sign-in was canceled.".to_owned(),
            _ => format!("The sign-in didn’t come back ({e})."),
        })?;
    lock(&la.accounts)
        .complete(&la.net, &la.vault, &pending, &params, now())
        .map_err(|e| e.message)
}

/// Stop waiting for the browser.
#[tauri::command]
pub fn accounts_cancel(la: State<'_, LiveAccounts>) {
    la.cancel.store(true, Ordering::SeqCst);
}

/// Facebook's manual sign-in: opens the browser on Facebook's own finish page.
#[tauri::command]
pub async fn accounts_facebook_manual(app: AppHandle) -> Result<String, String> {
    blocking(app, |la| {
        let (url, pending) = lock(&la.accounts)
            .begin(Provider::Facebook, facebook::MANUAL_REDIRECT)
            .map_err(|e| e.message)?;
        *lock(&la.manual) = Some(pending);
        let _ = open_browser(&url);
        Ok(url)
    })
    .await
}

/// …and the address that page ended on, pasted back.
#[tauri::command]
pub async fn accounts_facebook_paste(
    app: AppHandle,
    address: String,
) -> Result<AccountsInfo, String> {
    blocking(app, move |la| {
        let pending = lock(&la.manual)
            .take()
            .ok_or("Click “Connect by pasting the address” first.")?;
        let params = facebook::params_from_address(&address);
        lock(&la.accounts)
            .complete(&la.net, &la.vault, &pending, &params, now())
            .map_err(|e| e.message)?;
        Ok(la.info())
    })
    .await
}

#[tauri::command]
pub async fn accounts_disconnect(app: AppHandle, provider: String) -> Result<AccountsInfo, String> {
    let provider = parse_provider(&provider)?;
    blocking(app, move |la| {
        lock(&la.accounts).disconnect(provider, &la.net, &la.vault);
        Ok(la.info())
    })
    .await
}

#[tauri::command]
pub async fn accounts_youtube_broadcasts(app: AppHandle) -> Result<Vec<Broadcast>, String> {
    blocking(app, |la| {
        lock(&la.accounts)
            .youtube_broadcasts(&la.net, &la.vault, now())
            .map_err(|e| e.message)
    })
    .await
}

#[tauri::command]
pub async fn accounts_youtube_create(
    app: AppHandle,
    settings: BroadcastSettings,
) -> Result<Broadcast, String> {
    blocking(app, move |la| {
        lock(&la.accounts)
            .youtube_create(&la.net, &la.vault, &settings, now())
            .map_err(|e| e.message)
    })
    .await
}

/// Upload a picture file as a broadcast's thumbnail.
#[tauri::command]
pub async fn accounts_youtube_thumbnail(
    app: AppHandle,
    broadcast_id: String,
    path: String,
) -> Result<(), String> {
    blocking(app, move |la| {
        let bytes =
            std::fs::read(&path).map_err(|e| format!("The picture couldn’t be read ({e})."))?;
        lock(&la.accounts)
            .youtube_thumbnail(&la.net, &la.vault, &broadcast_id, bytes, now())
            .map_err(|e| e.message)
    })
    .await
}

/// Keep a picture of the Live Screen (the body, a JPEG) to use as a thumbnail.
#[tauri::command]
pub fn accounts_save_thumbnail(
    request: tauri::ipc::Request<'_>,
    la: State<'_, LiveAccounts>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected bytes".to_owned());
    };
    let ext = match lumora_live_accounts::youtube::image_type(bytes) {
        Some("image/png") => "png",
        Some(_) => "jpg",
        None => return Err("A thumbnail must be a JPG or PNG picture.".to_owned()),
    };
    let dir = la.dir.join(THUMBNAILS);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("live-screen-{}.{ext}", now()));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn accounts_facebook_targets(app: AppHandle) -> Result<Vec<Target>, String> {
    blocking(app, |la| {
        lock(&la.accounts)
            .facebook_targets(&la.net, now())
            .map_err(|e| e.message)
    })
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareReport {
    /// How many connected destinations are ready.
    pub ready: usize,
    pub failed: Vec<Failed>,
}

/// The connected destinations, enabled ones only.
fn linked(settings: &CaptureSettings) -> Vec<(String, lumora_live_accounts::service::AccountLink)> {
    settings
        .destinations
        .iter()
        .filter(|d| d.enabled)
        .filter_map(|d| d.account.clone().map(|a| (d.id.clone(), a)))
        .collect()
}

/// Lumora is about to go live: each connected destination gets its broadcast
/// (or live video) and its address and key, written into the destinations.
#[tauri::command]
pub async fn accounts_prepare(app: AppHandle) -> Result<PrepareReport, String> {
    let handle = app.clone();
    let ticker = app.clone();
    let report = blocking(app, move |la| {
        let state = handle.state::<AppState>();
        let mut settings = state.capture.settings();
        let links = linked(&settings);
        if links.is_empty() {
            return Ok(PrepareReport {
                ready: 0,
                failed: Vec::new(),
            });
        }
        let (ready, failed) = lock(&la.accounts).prepare(&la.net, &la.vault, &links, now());
        for d in &mut settings.destinations {
            if let Some(p) = ready.iter().find(|p| p.dest_id == d.id) {
                d.url.clone_from(&p.server);
                d.key.clone_from(&p.key);
                d.backup_url.clone_from(&p.backup_server);
            } else if failed.iter().any(|f| f.dest_id == d.id) {
                // Not ready: left out of this stream (the others carry on).
                d.url.clear();
                d.key.clear();
                d.backup_url.clear();
            }
        }
        state.capture.set_settings(settings);
        Ok(PrepareReport {
            ready: ready.len(),
            failed,
        })
    })
    .await?;
    if report.ready > 0 {
        start_ticking(&ticker);
    }
    Ok(report)
}

/// Read health and move broadcasts on while anything runs through an account.
fn start_ticking(app: &AppHandle) {
    let la = app.state::<LiveAccounts>();
    if la.ticking.swap(true, Ordering::SeqCst) {
        return;
    }
    let ticking = Arc::clone(&la.ticking);
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            // A first look soon after the stream starts, then every 15 seconds.
            std::thread::sleep(Duration::from_secs(5));
            let la = app.state::<LiveAccounts>();
            let mut accounts = lock(&la.accounts);
            if !accounts.running() {
                break;
            }
            accounts.tick(&la.net, &la.vault, now());
            drop(accounts);
            std::thread::sleep(TICK - Duration::from_secs(5));
        }
        ticking.store(false, Ordering::SeqCst);
    });
}

/// The operator stopped the stream: complete the broadcasts and end the live videos.
#[tauri::command]
pub async fn accounts_finish(app: AppHandle) -> Result<Vec<Failed>, String> {
    let handle = app.clone();
    blocking(app, move |la| {
        let failed = lock(&la.accounts).finish(&la.net, &la.vault, now());
        // A Facebook stream key works only once: forget it.
        let state = handle.state::<AppState>();
        let mut settings = state.capture.settings();
        let mut changed = false;
        for d in &mut settings.destinations {
            if matches!(
                d.account,
                Some(lumora_live_accounts::service::AccountLink::Facebook(_))
            ) && !d.key.is_empty()
            {
                d.url.clear();
                d.key.clear();
                changed = true;
            }
        }
        if changed {
            state.capture.set_settings(settings);
        }
        Ok(failed)
    })
    .await
}

/// How each connected destination is doing.
#[tauri::command]
pub async fn accounts_sessions(app: AppHandle) -> Result<Vec<SessionView>, String> {
    blocking(app, |la| Ok(lock(&la.accounts).sessions())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_config_file_wins_and_blank_means_not_set_up() {
        let dir = std::env::temp_dir().join(format!("lumora-accounts-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(CONFIG_FILE),
            r#"{"youtubeClientId":" 123.apps.googleusercontent.com ","facebookAppId":""}"#,
        )
        .unwrap();
        let c = config(&dir);
        assert_eq!(
            c.youtube.unwrap().client_id,
            "123.apps.googleusercontent.com"
        );
        if option_env!("LUMORA_FB_APP_ID").is_none() && std::env::var("LUMORA_FB_APP_ID").is_err() {
            assert_eq!(c.facebook_app_id, None);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
