//! The audience page on the internet: a free Cloudflare quick tunnel (no
//! account) gives a public https address that leads to the audience-only
//! server on this computer. Phones anywhere (mobile data, another Wi-Fi) can
//! vote, ask, enter raffles, pledge and send messages. Only the audience page
//! goes through it; the operator's remote stays on the local network.
//!
//! The `cloudflared` program is fetched once, the first time it is switched
//! on (with Windows' own `curl`), and kept with Lumora's files.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;

#[cfg(windows)]
const PROGRAM: &str = "cloudflared.exe";
#[cfg(not(windows))]
const PROGRAM: &str = "cloudflared";

#[cfg(windows)]
const DOWNLOAD: &str =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
#[cfg(not(windows))]
const DOWNLOAD: &str =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Where the internet link is at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    #[default]
    Off,
    /// Fetching the tunnel program (the first time only).
    Getting,
    /// Asking Cloudflare for an address.
    Starting,
    On,
    /// Could not connect; trying again.
    Retrying,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelState {
    pub phase: Phase,
    /// The public address (https://….trycloudflare.com).
    pub url: Option<String>,
    pub error: Option<String>,
}

type Notify = Arc<dyn Fn() + Send + Sync>;

#[derive(Default)]
pub struct Tunnel {
    state: Mutex<TunnelState>,
    child: Mutex<Option<Child>>,
    /// Bumped on every start and stop: an older run sees it and gives up.
    run: AtomicU64,
}

/// The public address in a line cloudflared prints, if any.
fn address_in(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let rest = &line[start..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '|' || c == '"')
        .unwrap_or(rest.len());
    let url = &rest[..end];
    let host = &url["https://".len()..];
    (host.ends_with(".trycloudflare.com") && host != "api.trycloudflare.com")
        .then(|| url.trim_end_matches('/').to_owned())
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window pops up.
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// The tunnel program: kept with Lumora's files, or already installed.
fn program(dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = dir.map(|d| d.join("tools").join(PROGRAM)) {
        if p.is_file() {
            return Some(p);
        }
    }
    hidden(Command::new(PROGRAM).arg("--version"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .filter(std::process::ExitStatus::success)
        .map(|_| PathBuf::from(PROGRAM))
}

/// Fetch the tunnel program into Lumora's files.
fn fetch(dir: &Path) -> Result<PathBuf, String> {
    let tools = dir.join("tools");
    std::fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
    let target = tools.join(PROGRAM);
    let part = tools.join(format!("{PROGRAM}.part"));
    let ok = hidden(Command::new("curl").args(["-fsSL", "--retry", "2", "-o"]))
        .arg(&part)
        .arg(DOWNLOAD)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "this computer cannot download (curl is missing)".to_owned())?
        .success();
    let big = std::fs::metadata(&part).is_ok_and(|m| m.len() > 5_000_000);
    if !ok || !big {
        let _ = std::fs::remove_file(&part);
        return Err(
            "could not download the link program — is this computer on the internet?".into(),
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755));
    }
    std::fs::rename(&part, &target).map_err(|e| e.to_string())?;
    Ok(target)
}

impl Tunnel {
    pub fn state(&self) -> TunnelState {
        lock(&self.state).clone()
    }

    fn set(&self, run: u64, state: TunnelState, notify: &Notify) {
        if self.run.load(Ordering::SeqCst) != run {
            return;
        }
        *lock(&self.state) = state;
        notify();
    }

    /// Open a public address to `port` on this computer (keeps trying until stopped).
    pub fn start(self: &Arc<Self>, dir: Option<PathBuf>, port: u16, notify: Notify) {
        self.stop();
        let run = self.run.fetch_add(1, Ordering::SeqCst) + 1;
        let me = Arc::clone(self);
        std::thread::Builder::new()
            .name("lumora-tunnel".into())
            .spawn(move || me.keep_open(run, dir.as_deref(), port, &notify))
            .ok();
    }

    fn keep_open(&self, run: u64, dir: Option<&Path>, port: u16, notify: &Notify) {
        let live = || self.run.load(Ordering::SeqCst) == run;
        let state =
            |phase, url: Option<String>, error: Option<String>| TunnelState { phase, url, error };
        let exe = match program(dir) {
            Some(p) => p,
            None => {
                self.set(run, state(Phase::Getting, None, None), notify);
                match dir
                    .ok_or_else(|| "nowhere to keep it".to_owned())
                    .and_then(fetch)
                {
                    Ok(p) => p,
                    Err(e) => {
                        self.set(run, state(Phase::Off, None, Some(e)), notify);
                        return;
                    }
                }
            }
        };
        let mut wait = Duration::from_secs(3);
        while live() {
            self.set(run, state(Phase::Starting, None, None), notify);
            let spawned = hidden(Command::new(&exe).args([
                "tunnel",
                "--no-autoupdate",
                "--url",
                &format!("http://127.0.0.1:{port}"),
            ]))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn();
            let mut child = match spawned {
                Ok(c) => c,
                Err(e) => {
                    self.set(
                        run,
                        state(
                            Phase::Off,
                            None,
                            Some(format!("the link program would not start: {e}")),
                        ),
                        notify,
                    );
                    return;
                }
            };
            let err = child.stderr.take();
            *lock(&self.child) = Some(child);
            if !live() {
                break;
            }
            let mut last = String::new();
            if let Some(err) = err {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    if let Some(url) = address_in(&line) {
                        wait = Duration::from_secs(3);
                        self.set(run, state(Phase::On, Some(url), None), notify);
                    } else if line.contains("ERR") {
                        last = line;
                    }
                }
            }
            // It stopped (no internet, or Cloudflare dropped it): try again.
            if let Some(mut c) = lock(&self.child).take() {
                let _ = c.kill();
                let _ = c.wait();
            }
            if !live() {
                break;
            }
            let why = last
                .split_once("ERR")
                .map_or("the internet connection dropped", |(_, r)| r.trim())
                .chars()
                .take(160)
                .collect::<String>();
            self.set(run, state(Phase::Retrying, None, Some(why)), notify);
            std::thread::sleep(wait);
            wait = (wait * 2).min(Duration::from_secs(30));
        }
    }

    pub fn stop(&self) {
        self.run.fetch_add(1, Ordering::SeqCst);
        if let Some(mut c) = lock(&self.child).take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        *lock(&self.state) = TunnelState::default();
    }
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_public_address() {
        let line = "2025-01-01T00:00:00Z INF |  https://sunny-river-bold-cats.trycloudflare.com                              |";
        assert_eq!(
            address_in(line).as_deref(),
            Some("https://sunny-river-bold-cats.trycloudflare.com")
        );
        assert_eq!(
            address_in("INF Requesting new quick Tunnel on trycloudflare.com..."),
            None
        );
        assert_eq!(
            address_in("ERR https://api.trycloudflare.com/tunnel failed"),
            None
        );
        assert_eq!(
            address_in("INF see https://developers.cloudflare.com/x"),
            None
        );
    }
}
