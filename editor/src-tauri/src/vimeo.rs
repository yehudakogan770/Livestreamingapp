//! Publishing to Vimeo from Lumora Studio: the account owner pastes a
//! personal access token once (made on developer.vimeo.com, with Upload,
//! Edit and Private access), and finished films go up a piece at a time,
//! carrying on after a dropped connection, with their captions. The token is
//! kept in Windows Credential Manager, never shown to the window again.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use lumora_live_accounts::upload::Sent;
use lumora_live_accounts::vimeo::{self, VimeoDetails, VIMEO_SECRET};
use lumora_live_accounts::{AccountError, Http, Secrets};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::youtube::{lock, Publish};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VimeoInfo {
    connected: bool,
    name: String,
}

fn info(p: &Publish) -> VimeoInfo {
    let Some(token) = p.vault.get(VIMEO_SECRET).filter(|t| !t.is_empty()) else {
        return VimeoInfo {
            connected: false,
            name: String::new(),
        };
    };
    let name = p
        .net
        .send(&vimeo::me().bearer(&token))
        .ok()
        .and_then(|r| vimeo::parse_me(&r).ok())
        .unwrap_or_default();
    VimeoInfo {
        connected: true,
        name,
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

#[tauri::command]
pub async fn vimeo_info(app: AppHandle) -> Result<VimeoInfo, String> {
    blocking(app, |p| Ok(info(p))).await
}

/// Check a pasted token with Vimeo, and keep it.
#[tauri::command]
pub async fn vimeo_connect(app: AppHandle, token: String) -> Result<VimeoInfo, String> {
    blocking(app, move |p| {
        let token = token.trim().to_owned();
        if token.is_empty()
            || token.len() > 200
            || !token.chars().all(|c| c.is_ascii_alphanumeric())
        {
            return Err(
                "That doesn’t look like a Vimeo access token (letters and digits only).".to_owned(),
            );
        }
        let resp = p
            .net
            .send(&vimeo::me().bearer(&token))
            .map_err(|e| format!("Studio couldn’t reach Vimeo ({e})."))?;
        vimeo::parse_me(&resp).map_err(|e| e.message)?;
        p.vault.set(VIMEO_SECRET, &token)?;
        Ok(info(p))
    })
    .await
}

#[tauri::command]
pub async fn vimeo_disconnect(app: AppHandle) -> Result<VimeoInfo, String> {
    blocking(app, |p| {
        p.vault.delete(VIMEO_SECRET);
        Ok(info(p))
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextTrack {
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
    url: String,
    notes: Vec<String>,
}

/// Upload a film (then its captions), telling the page how far it has got.
#[tauri::command]
pub async fn vimeo_upload(
    app: AppHandle,
    job: String,
    path: String,
    details: VimeoDetails,
    captions: Option<TextTrack>,
) -> Result<Published, String> {
    if details.title.trim().is_empty() {
        return Err("Give the video a title.".to_owned());
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
            captions.as_ref(),
            &stop,
        );
        lock(&p.stops).remove(&job);
        result.map_err(|e| e.message)
    })
    .await
}

fn publish(
    p: &Publish,
    app: &AppHandle,
    job: &str,
    path: &Path,
    details: &VimeoDetails,
    captions: Option<&TextTrack>,
    stop: &AtomicBool,
) -> Result<Published, AccountError> {
    let token = p
        .vault
        .get(VIMEO_SECRET)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AccountError::reconnect("Connect a Vimeo account first."))?;
    let mut file = std::fs::File::open(path)
        .map_err(|e| AccountError::new(format!("The exported file couldn’t be opened ({e}).")))?;
    let total = file
        .metadata()
        .map_err(|e| AccountError::new(format!("The exported file couldn’t be read ({e}).")))?
        .len();
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
    let resp = p
        .net
        .send(&vimeo::create(details, total).bearer(&token))
        .map_err(|e| {
            AccountError::new(format!(
                "Studio couldn’t reach Vimeo ({e}). Check the internet connection."
            ))
        })?;
    let made = vimeo::parse_create(&resp)?;
    vimeo::send_file(
        &p.net,
        &made.upload_link,
        &mut file,
        total,
        vimeo::CHUNK,
        stop,
        &|s| std::thread::sleep(Duration::from_secs(s)),
        &mut |s: Sent| say("uploading", s.bytes),
    )?;
    say("finishing", total);
    let mut notes = Vec::new();
    if let Some(c) = captions {
        let added = (|| -> Result<(), String> {
            let text = std::fs::read(&c.path)
                .map_err(|e| format!("the captions file couldn’t be read ({e})"))?;
            let r = p
                .net
                .send(&vimeo::add_text_track(&made.uri, &c.language, &c.name).bearer(&token))?;
            if !r.ok() {
                return Err(vimeo::error(&r).message);
            }
            let v = r.json();
            let link = v["link"].as_str().unwrap_or_default();
            let uri = v["uri"].as_str().unwrap_or_default();
            let put = p.net.send(&vimeo::put_text_track(link, text))?;
            if !put.ok() {
                return Err(vimeo::error(&put).message);
            }
            let _ = p.net.send(&vimeo::activate_text_track(uri).bearer(&token));
            Ok(())
        })();
        if let Err(e) = added {
            notes.push(format!("The captions weren’t added: {e}"));
        }
    }
    say("done", total);
    Ok(Published {
        url: made.link,
        notes,
    })
}

/// Open a published video's page (only a vimeo.com address is taken).
#[tauri::command]
pub fn vimeo_open(url: String) -> Result<(), String> {
    let ok = url.strip_prefix("https://vimeo.com/").is_some_and(|rest| {
        !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '/')
    });
    if !ok {
        return Err("That isn’t a Vimeo video.".to_owned());
    }
    crate::youtube::open_browser(&url)
}
