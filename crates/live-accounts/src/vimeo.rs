//! Uploading a finished film to Vimeo (Lumora Studio), with a personal access
//! token the account owner makes on developer.vimeo.com (no app to register).
//! The upload uses tus, Vimeo's resumable protocol: the video is made, then
//! the file is sent a piece at a time, and after a dropped connection Studio
//! asks how much arrived and goes on from there. Captions follow as a text
//! track. <https://developer.vimeo.com/api/upload/videos>
//!
//! As in the rest of this crate, requests are built as data and sent through
//! the `Http` the app passes in.

use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::upload::Sent;
use crate::{AccountError, Http, Method, Request, Response};

pub const API: &str = "https://api.vimeo.com";
const ACCEPT: &str = "application/vnd.vimeo.*+json;version=3.4";
/// Where the token is kept.
pub const VIMEO_SECRET: &str = "vimeo-token";
/// How much is sent at a time.
pub const CHUNK: usize = 16 * 1024 * 1024;

fn with_accept(mut r: Request) -> Request {
    r.headers.push(("Accept".to_owned(), ACCEPT.to_owned()));
    r
}

/// Who the token belongs to.
#[must_use]
pub fn me() -> Request {
    with_accept(Request::get(format!("{API}/me")))
}

/// The account's name, from the answer to `me`.
///
/// # Errors
/// The token was refused, in words.
pub fn parse_me(resp: &Response) -> Result<String, AccountError> {
    if !resp.ok() {
        return Err(error(resp));
    }
    Ok(resp.json()["name"].as_str().unwrap_or("Vimeo").to_owned())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Who {
    /// Anyone.
    Anybody,
    /// Anyone with the link.
    Unlisted,
    /// Only the owner.
    #[default]
    Nobody,
}

impl Who {
    fn as_str(self) -> &'static str {
        match self {
            Who::Anybody => "anybody",
            Who::Unlisted => "unlisted",
            Who::Nobody => "nobody",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VimeoDetails {
    pub title: String,
    pub description: String,
    pub who: Who,
}

/// Make the video, ready to receive `size` bytes by tus.
#[must_use]
pub fn create(d: &VimeoDetails, size: u64) -> Request {
    with_accept(Request::json(
        Method::Post,
        format!("{API}/me/videos"),
        &json!({
            "upload": { "approach": "tus", "size": size.to_string() },
            "name": d.title.trim(),
            "description": d.description,
            "privacy": { "view": d.who.as_str() },
        }),
    ))
}

/// What `create` gave: where to send the file, the video's API address and its page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Made {
    pub upload_link: String,
    pub uri: String,
    pub link: String,
}

/// # Errors
/// Vimeo refused (in words), or answered without an upload address.
pub fn parse_create(resp: &Response) -> Result<Made, AccountError> {
    if !resp.ok() {
        return Err(error(resp));
    }
    let v = resp.json();
    let upload_link = v["upload"]["upload_link"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    if upload_link.is_empty() {
        return Err(AccountError::new(
            "Vimeo didn’t start the upload. Try again.",
        ));
    }
    Ok(Made {
        upload_link,
        uri: v["uri"].as_str().unwrap_or_default().to_owned(),
        link: v["link"].as_str().unwrap_or_default().to_owned(),
    })
}

/// One piece of the file, from `offset`.
#[must_use]
pub fn piece(upload_link: &str, data: Vec<u8>, offset: u64) -> Request {
    Request {
        method: Method::Patch,
        url: upload_link.to_owned(),
        headers: vec![
            ("Tus-Resumable".to_owned(), "1.0.0".to_owned()),
            ("Upload-Offset".to_owned(), offset.to_string()),
            (
                "Content-Type".to_owned(),
                "application/offset+octet-stream".to_owned(),
            ),
        ],
        body: data,
    }
}

/// Ask how much has arrived.
#[must_use]
pub fn ask(upload_link: &str) -> Request {
    Request {
        method: Method::Head,
        url: upload_link.to_owned(),
        headers: vec![("Tus-Resumable".to_owned(), "1.0.0".to_owned())],
        body: Vec::new(),
    }
}

/// How much has arrived, from the answer to a piece or a question.
///
/// # Errors
/// Vimeo refused, in words.
pub fn offset(resp: &Response) -> Result<u64, AccountError> {
    if !resp.ok() {
        return Err(error(resp));
    }
    resp.header("Upload-Offset")
        .and_then(|v| v.trim().parse().ok())
        .ok_or_else(|| {
            AccountError::new("Vimeo didn’t say how much of the file arrived. Try again.")
        })
}

/// Send a whole file: a piece at a time; after a dropped connection, ask how
/// much arrived and go on from there (up to six times in a row).
///
/// # Errors
/// Stopped, Vimeo refused, or the connection never came back, in words.
#[allow(clippy::too_many_arguments)]
pub fn send_file<R: Read + Seek>(
    http: &dyn Http,
    upload_link: &str,
    file: &mut R,
    total: u64,
    chunk: usize,
    stop: &AtomicBool,
    wait: &dyn Fn(u64),
    progress: &mut dyn FnMut(Sent),
) -> Result<(), AccountError> {
    let mut at = 0u64;
    let mut tries = 0u32;
    let mut buf = vec![0u8; chunk.max(1)];
    while at < total {
        if stop.load(Ordering::SeqCst) {
            return Err(AccountError::new("The upload was stopped."));
        }
        file.seek(SeekFrom::Start(at))
            .map_err(|e| AccountError::new(format!("The file couldn’t be read ({e}).")))?;
        let want = usize::try_from((total - at).min(chunk as u64)).unwrap_or(chunk);
        let mut got = 0;
        while got < want {
            let n = file
                .read(&mut buf[got..want])
                .map_err(|e| AccountError::new(format!("The file couldn’t be read ({e}).")))?;
            if n == 0 {
                break;
            }
            got += n;
        }
        if got == 0 {
            return Err(AccountError::new(
                "The file got shorter while it was being uploaded. Export it again.",
            ));
        }
        match http.send(&piece(upload_link, buf[..got].to_vec(), at)) {
            Ok(resp) if resp.ok() => {
                tries = 0;
                at = offset(&resp)?;
                progress(Sent { bytes: at, total });
            }
            Ok(resp) if resp.status < 500 && resp.status != 409 && resp.status != 429 => {
                return Err(error(&resp))
            }
            _ => {
                tries += 1;
                if tries > crate::upload::RETRIES {
                    return Err(AccountError::new(
                        "The connection to Vimeo kept dropping, so the upload stopped. Try again later.",
                    ));
                }
                wait(2u64.pow(tries.min(6)));
                if let Ok(resp) = http.send(&ask(upload_link)) {
                    if let Ok(n) = offset(&resp) {
                        at = n;
                    }
                }
            }
        }
    }
    Ok(())
}

/// A captions track on a video (its API address): Vimeo answers with where to put the file.
#[must_use]
pub fn add_text_track(video_uri: &str, language: &str, name: &str) -> Request {
    with_accept(Request::json(
        Method::Post,
        format!("{API}{video_uri}/texttracks"),
        &json!({ "type": "captions", "language": language, "name": name }),
    ))
}

/// The captions file itself, to where `add_text_track` said.
#[must_use]
pub fn put_text_track(link: &str, vtt_or_srt: Vec<u8>) -> Request {
    Request {
        method: Method::Put,
        url: link.to_owned(),
        headers: vec![("Content-Type".to_owned(), "text/plain".to_owned())],
        body: vtt_or_srt,
    }
}

/// Turn a captions track on (so viewers can choose it).
#[must_use]
pub fn activate_text_track(track_uri: &str) -> Request {
    with_accept(Request::json(
        Method::Patch,
        format!("{API}{track_uri}"),
        &json!({ "active": true }),
    ))
}

/// A Vimeo error answer, in words.
#[must_use]
pub fn error(resp: &Response) -> AccountError {
    let v = resp.json();
    let said = v["error"].as_str().unwrap_or_default();
    match resp.status {
        401 => AccountError::reconnect(
            "Vimeo didn’t accept the access token. Make a new one (with Upload, Edit and Private access) and connect again.",
        ),
        403 => AccountError::new(if said.is_empty() {
            "Vimeo refused: the token needs Upload and Edit access, and the account must be allowed to upload."
        } else {
            said
        }),
        429 => AccountError::new("Vimeo is getting too many requests. Wait a minute and try again."),
        s if s >= 500 => AccountError::new("Vimeo is having trouble right now. Try again in a minute."),
        _ => AccountError::new(if said.is_empty() {
            format!("Vimeo refused the request (error {}).", resp.status)
        } else {
            format!("Vimeo said: {said}")
        }),
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::io::Cursor;

    use super::*;

    #[test]
    fn makes_the_video_and_reads_where_to_send_it() {
        let r = create(
            &VimeoDetails {
                title: " Spring Gala ".into(),
                description: "Our night".into(),
                who: Who::Unlisted,
            },
            1234,
        );
        assert_eq!(r.method, Method::Post);
        assert!(r.url.ends_with("/me/videos"));
        assert_eq!(r.header("Accept"), Some(ACCEPT));
        let b = r.body_json();
        assert_eq!(b["upload"]["approach"], "tus");
        assert_eq!(b["upload"]["size"], "1234");
        assert_eq!(b["name"], "Spring Gala");
        assert_eq!(b["privacy"]["view"], "unlisted");
        let made = parse_create(&Response::new(
            200,
            br#"{"uri":"/videos/42","link":"https://vimeo.com/42","upload":{"upload_link":"https://files.tus/42"}}"#.to_vec(),
        ))
        .unwrap();
        assert_eq!(made.uri, "/videos/42");
        assert_eq!(made.link, "https://vimeo.com/42");
        assert!(
            parse_create(&Response::new(401, Vec::new()))
                .unwrap_err()
                .reconnect
        );
        assert_eq!(
            parse_me(&Response::new(200, br#"{"name":"Spring Hall"}"#.to_vec())).unwrap(),
            "Spring Hall"
        );
    }

    /// Vimeo's tus side: keeps what arrives, drops a chosen piece halfway.
    struct Tus {
        got: RefCell<Vec<u8>>,
        drop_on: usize,
        calls: RefCell<usize>,
    }

    impl Http for Tus {
        fn send(&self, r: &Request) -> Result<Response, String> {
            let n = {
                let mut c = self.calls.borrow_mut();
                *c += 1;
                *c
            };
            assert_eq!(r.header("Tus-Resumable"), Some("1.0.0"));
            let have = self.got.borrow().len();
            if r.method == Method::Head {
                return Ok(
                    Response::new(200, Vec::new()).with_header("Upload-Offset", &have.to_string())
                );
            }
            assert_eq!(r.method, Method::Patch);
            let at: usize = r.header("Upload-Offset").unwrap().parse().unwrap();
            assert_eq!(at, have, "sent from where it got to");
            if n == self.drop_on {
                self.got
                    .borrow_mut()
                    .extend_from_slice(&r.body[..r.body.len() / 2]);
                return Err("reset".into());
            }
            self.got.borrow_mut().extend_from_slice(&r.body);
            let now = self.got.borrow().len();
            Ok(Response::new(204, Vec::new()).with_header("Upload-Offset", &now.to_string()))
        }
    }

    #[test]
    fn sends_every_byte_once_and_goes_on_after_a_drop() {
        let data: Vec<u8> = (0..1000u32).map(|i| (i % 253) as u8).collect();
        let tus = Tus {
            got: RefCell::new(Vec::new()),
            drop_on: 3,
            calls: RefCell::new(0),
        };
        let stop = AtomicBool::new(false);
        let mut last = 0;
        send_file(
            &tus,
            "https://files.tus/42",
            &mut Cursor::new(data.clone()),
            1000,
            300,
            &stop,
            &|_| {},
            &mut |s| last = s.bytes,
        )
        .unwrap();
        assert_eq!(*tus.got.borrow(), data);
        assert_eq!(last, 1000);
    }

    #[test]
    fn captions_are_a_text_track() {
        let a = add_text_track("/videos/42", "en", "English");
        assert!(a.url.ends_with("/videos/42/texttracks"));
        assert_eq!(a.body_json()["type"], "captions");
        let p = put_text_track("https://up/tt", b"WEBVTT".to_vec());
        assert_eq!(p.method, Method::Put);
        let on = activate_text_track("/videos/42/texttracks/7");
        assert_eq!(on.method, Method::Patch);
        assert_eq!(on.body_json()["active"], true);
    }
}
