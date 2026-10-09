//! Uploading a finished film to YouTube (Lumora Studio): the YouTube Data
//! API's resumable upload, so a long event survives a dropped connection and
//! is sent a piece at a time (never held in memory whole), then the
//! thumbnail and the captions.
//! <https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol>
//!
//! As in the rest of this crate, requests are built as data and sent through
//! the `Http` the app passes in; `send_file` drives the upload against any
//! reader, so the whole conversation is checked in tests with made-up answers.
//!
//! Quota: an upload is 1,600 units (of 10,000 a day per Google Cloud project),
//! a thumbnail 50 and a caption track 400.

use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::youtube::{api_error, error_reason, UPLOAD_API};
use crate::{encode, AccountError, Http, Method, Request, Response};

/// How much is sent at a time (a multiple of 256 KiB, as YouTube asks).
pub const CHUNK: usize = 8 * 1024 * 1024;
/// How many times one piece is tried again after the connection drops.
pub const RETRIES: u32 = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Visibility {
    Public,
    Unlisted,
    #[default]
    Private,
}

impl Visibility {
    fn as_str(self) -> &'static str {
        match self {
            Visibility::Public => "public",
            Visibility::Unlisted => "unlisted",
            Visibility::Private => "private",
        }
    }
}

/// What the video is called and who may see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VideoDetails {
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// YouTube's category number ("22" People & Blogs, "24" Entertainment, "27" Education…).
    #[serde(default)]
    pub category: String,
    pub visibility: Visibility,
    /// YouTube requires every upload to say whether it is made for children.
    pub made_for_kids: bool,
}

/// The longest title YouTube takes.
pub const TITLE_MAX: usize = 100;
/// The longest description (bytes).
pub const DESCRIPTION_MAX: usize = 5000;

/// Problems with the details before anything is sent.
#[must_use]
pub fn check_details(d: &VideoDetails) -> Option<String> {
    let title = d.title.trim();
    if title.is_empty() {
        return Some("Give the video a title.".to_owned());
    }
    if title.chars().count() > TITLE_MAX {
        return Some(format!(
            "The title is too long: YouTube takes {TITLE_MAX} characters at most."
        ));
    }
    if title.contains(['<', '>']) || d.description.contains(['<', '>']) {
        return Some("YouTube doesn’t take < or > in a title or description.".to_owned());
    }
    if d.description.len() > DESCRIPTION_MAX {
        return Some("The description is too long: YouTube takes about 5,000 letters.".to_owned());
    }
    None
}

/// Start an upload session (1,600 units): the details, and how big the file is.
#[must_use]
pub fn start(d: &VideoDetails, bytes: u64, mime: &str) -> Request {
    let mut snippet = json!({ "title": d.title.trim(), "description": d.description });
    if !d.tags.is_empty() {
        snippet["tags"] = json!(d.tags);
    }
    if !d.category.is_empty() {
        snippet["categoryId"] = json!(d.category);
    }
    let body = json!({
        "snippet": snippet,
        "status": { "privacyStatus": d.visibility.as_str(), "selfDeclaredMadeForKids": d.made_for_kids },
    });
    let mut r = Request::json(
        Method::Post,
        format!("{UPLOAD_API}/videos?uploadType=resumable&part=snippet,status"),
        &body,
    );
    r.headers
        .push(("X-Upload-Content-Length".to_owned(), bytes.to_string()));
    r.headers
        .push(("X-Upload-Content-Type".to_owned(), mime.to_owned()));
    r
}

/// The session's address, from the answer to `start`.
///
/// # Errors
/// YouTube refused (in words), or answered without an address.
pub fn session(resp: &Response) -> Result<String, AccountError> {
    if !resp.ok() {
        return Err(upload_error(resp));
    }
    resp.header("Location")
        .map(str::to_owned)
        .ok_or_else(|| AccountError::new("YouTube didn’t start the upload. Try again."))
}

/// One piece of the file, from `offset`.
#[must_use]
pub fn piece(url: &str, data: Vec<u8>, offset: u64, total: u64) -> Request {
    let end = offset + data.len() as u64 - 1;
    Request {
        method: Method::Put,
        url: url.to_owned(),
        headers: vec![(
            "Content-Range".to_owned(),
            format!("bytes {offset}-{end}/{total}"),
        )],
        body: data,
    }
}

/// Ask how much of the file YouTube has (after the connection dropped).
#[must_use]
pub fn ask(url: &str, total: u64) -> Request {
    Request {
        method: Method::Put,
        url: url.to_owned(),
        headers: vec![("Content-Range".to_owned(), format!("bytes */{total}"))],
        body: Vec::new(),
    }
}

/// Where an upload stands after an answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Send from this byte on.
    From(u64),
    /// Finished: the new video's id.
    Done(String),
}

/// Read an answer to a piece or a question.
///
/// # Errors
/// YouTube refused, in words.
pub fn step(resp: &Response) -> Result<Step, AccountError> {
    if resp.status == 308 {
        // "Range: bytes=0-1234": the next byte is 1235. No range: nothing has arrived.
        let next = resp
            .header("Range")
            .and_then(|r| r.rsplit('-').next())
            .and_then(|n| n.trim().parse::<u64>().ok())
            .map_or(0, |last| last + 1);
        return Ok(Step::From(next));
    }
    if resp.ok() {
        let id = resp.json()["id"].as_str().unwrap_or_default().to_owned();
        if id.is_empty() {
            return Err(AccountError::new(
                "YouTube finished the upload without saying where the video is. Look in YouTube Studio.",
            ));
        }
        return Ok(Step::Done(id));
    }
    Err(upload_error(resp))
}

/// Errors YouTube may give for an upload, in words (the rest as for any request).
#[must_use]
pub fn upload_error(resp: &Response) -> AccountError {
    let words = match error_reason(resp).as_str() {
        "quotaExceeded" | "dailyLimitExceeded" => {
            "YouTube’s daily limit for uploads from Lumora Studio is used up. It starts again at \
             midnight Pacific time; until then, upload the exported file at studio.youtube.com."
        }
        "uploadLimitExceeded" => {
            "This YouTube channel has reached its upload limit for today. Try again tomorrow."
        }
        "invalidTitle" => "YouTube didn’t take the title (at most 100 characters, no < or >).",
        "invalidDescription" => "YouTube didn’t take the description (too long, or it has < or >).",
        "invalidTags" => "YouTube didn’t take the tags (500 characters in all at most).",
        "invalidCategoryId" => "YouTube doesn’t know that category. Choose another one.",
        "mediaBodyRequired" | "invalidVideoMetadata" => {
            "YouTube didn’t take the file. Export it again and try once more."
        }
        "forbidden" | "insufficientPermissions" | "ACCESS_TOKEN_SCOPE_INSUFFICIENT" => {
            return AccountError::reconnect(
                "Lumora Studio wasn’t given permission to upload to this channel. Connect the \
                 YouTube account again and allow everything it asks for.",
            )
        }
        _ => return api_error(resp),
    };
    AccountError::new(words)
}

/// What an upload has done so far, for the progress bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sent {
    pub bytes: u64,
    pub total: u64,
}

/// Send a whole file through a session: a piece at a time; when the
/// connection drops, ask YouTube how much arrived and go on from there (up to
/// `RETRIES` times in a row, waiting longer each time). `wait` sleeps between
/// tries (seconds); `stop` ends it early.
///
/// # Errors
/// Stopped, YouTube refused, or the connection never came back, in words.
#[allow(clippy::too_many_arguments)]
pub fn send_file<R: Read + Seek>(
    http: &dyn Http,
    url: &str,
    file: &mut R,
    total: u64,
    chunk: usize,
    stop: &AtomicBool,
    wait: &dyn Fn(u64),
    progress: &mut dyn FnMut(Sent),
) -> Result<String, AccountError> {
    let mut offset = 0u64;
    let mut tries = 0u32;
    let mut buf = vec![0u8; chunk.max(1)];
    loop {
        if stop.load(Ordering::SeqCst) {
            return Err(AccountError::new("The upload was stopped."));
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| AccountError::new(format!("The file couldn’t be read ({e}).")))?;
        let want = usize::try_from((total - offset).min(chunk as u64)).unwrap_or(chunk);
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
        if got == 0 && total > 0 {
            return Err(AccountError::new(
                "The file got shorter while it was being uploaded. Export it again.",
            ));
        }
        let answer = http.send(&piece(url, buf[..got].to_vec(), offset, total));
        let next = match answer {
            Ok(resp) if resp.status >= 500 || resp.status == 429 => None,
            Ok(resp) => match step(&resp)? {
                Step::Done(id) => {
                    progress(Sent {
                        bytes: total,
                        total,
                    });
                    return Ok(id);
                }
                Step::From(n) => Some(n),
            },
            Err(_) => None,
        };
        match next {
            Some(n) => {
                tries = 0;
                offset = n;
                progress(Sent {
                    bytes: offset,
                    total,
                });
            }
            None => {
                // Dropped: wait, then ask where it stands.
                tries += 1;
                if tries > RETRIES {
                    return Err(AccountError::new(
                        "The connection to YouTube kept dropping, so the upload stopped. Try \
                         again: it goes on from where it got to if you try within a day.",
                    ));
                }
                wait(2u64.pow(tries.min(6)));
                match http.send(&ask(url, total)) {
                    Ok(resp) if resp.status < 500 => match step(&resp)? {
                        Step::Done(id) => return Ok(id),
                        Step::From(n) => offset = n,
                    },
                    _ => {}
                }
            }
        }
    }
}

/// A caption track (400 units): an .srt file in a language, for viewers to turn on.
#[must_use]
pub fn add_captions(video_id: &str, language: &str, name: &str, srt: &[u8]) -> Request {
    const BOUNDARY: &str = "lumora-studio-captions";
    let meta = json!({ "snippet": { "videoId": video_id, "language": language, "name": name, "isDraft": false } });
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{BOUNDARY}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{BOUNDARY}\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(srt);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    Request {
        method: Method::Post,
        url: format!("{UPLOAD_API}/captions?uploadType=multipart&part=snippet"),
        headers: vec![(
            "Content-Type".to_owned(),
            format!("multipart/related; boundary={BOUNDARY}"),
        )],
        body,
    }
}

/// The address people watch the video at.
#[must_use]
pub fn watch_url(video_id: &str) -> String {
    format!("https://youtu.be/{}", encode(video_id))
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::io::Cursor;

    use super::*;

    fn details() -> VideoDetails {
        VideoDetails {
            title: "Spring Gala 2026".into(),
            description: "0:00 Welcome\n4:12 Awards".into(),
            tags: vec!["gala".into()],
            category: "22".into(),
            visibility: Visibility::Unlisted,
            made_for_kids: false,
        }
    }

    #[test]
    fn checks_the_details_first() {
        assert!(check_details(&details()).is_none());
        let mut d = details();
        d.title = "  ".into();
        assert!(check_details(&d).unwrap().contains("title"));
        d.title = "x".repeat(101);
        assert!(check_details(&d).unwrap().contains("100"));
        d.title = "A <b> title".into();
        assert!(check_details(&d).unwrap().contains('<'));
    }

    #[test]
    fn starts_a_resumable_session_with_the_details_and_size() {
        let r = start(&details(), 123_456, "video/mp4");
        assert_eq!(r.method, Method::Post);
        assert!(r.url.contains("uploadType=resumable"));
        assert_eq!(r.header("X-Upload-Content-Length"), Some("123456"));
        assert_eq!(r.header("X-Upload-Content-Type"), Some("video/mp4"));
        let b = r.body_json();
        assert_eq!(b["snippet"]["title"], "Spring Gala 2026");
        assert_eq!(b["snippet"]["categoryId"], "22");
        assert_eq!(b["status"]["privacyStatus"], "unlisted");
        assert_eq!(b["status"]["selfDeclaredMadeForKids"], false);
        let ok = Response::new(200, Vec::new()).with_header("location", "https://up/session1");
        assert_eq!(session(&ok).unwrap(), "https://up/session1");
        assert!(session(&Response::new(200, Vec::new())).is_err());
    }

    #[test]
    fn reads_where_an_upload_stands() {
        let more = Response::new(308, Vec::new()).with_header("Range", "bytes=0-262143");
        assert_eq!(step(&more).unwrap(), Step::From(262_144));
        assert_eq!(
            step(&Response::new(308, Vec::new())).unwrap(),
            Step::From(0)
        );
        let done = Response::new(201, br#"{"id":"abc123"}"#.to_vec());
        assert_eq!(step(&done).unwrap(), Step::Done("abc123".into()));
        let limit = Response::new(
            400,
            br#"{"error":{"errors":[{"reason":"uploadLimitExceeded"}],"message":"x"}}"#.to_vec(),
        );
        assert!(step(&limit).unwrap_err().message.contains("upload limit"));
        let p = piece("https://up/s", vec![0; 10], 20, 100);
        assert_eq!(p.header("Content-Range"), Some("bytes 20-29/100"));
        assert_eq!(
            ask("https://up/s", 100).header("Content-Range"),
            Some("bytes */100")
        );
    }

    /// YouTube's side: keeps what arrives, drops chosen pieces, finishes when it has everything.
    struct Tube {
        got: RefCell<Vec<u8>>,
        total: usize,
        drop_on: RefCell<Vec<usize>>,
        calls: RefCell<usize>,
    }

    impl Http for Tube {
        fn send(&self, r: &Request) -> Result<Response, String> {
            let n = {
                let mut c = self.calls.borrow_mut();
                *c += 1;
                *c
            };
            let range = r.header("Content-Range").unwrap().to_owned();
            if range.starts_with("bytes */") {
                let have = self.got.borrow().len();
                return Ok(if have == self.total {
                    Response::new(200, br#"{"id":"v1"}"#.to_vec())
                } else if have == 0 {
                    Response::new(308, Vec::new())
                } else {
                    Response::new(308, Vec::new())
                        .with_header("Range", &format!("bytes=0-{}", have - 1))
                });
            }
            if self.drop_on.borrow().contains(&n) {
                // Half of the piece arrived, then the connection dropped.
                let half = r.body.len() / 2;
                let start: usize = range[6..].split('-').next().unwrap().parse().unwrap();
                let mut g = self.got.borrow_mut();
                if start == g.len() {
                    g.extend_from_slice(&r.body[..half]);
                }
                return Err("connection reset".into());
            }
            let start: usize = range[6..].split('-').next().unwrap().parse().unwrap();
            let mut g = self.got.borrow_mut();
            g.truncate(start);
            g.extend_from_slice(&r.body);
            Ok(if g.len() == self.total {
                Response::new(201, br#"{"id":"v1"}"#.to_vec())
            } else {
                Response::new(308, Vec::new())
                    .with_header("Range", &format!("bytes=0-{}", g.len() - 1))
            })
        }
    }

    #[test]
    fn sends_the_whole_file_in_pieces_and_goes_on_after_a_drop() {
        let data: Vec<u8> = (0..1000u32).map(|i| (i % 251) as u8).collect();
        let tube = Tube {
            got: RefCell::new(Vec::new()),
            total: data.len(),
            drop_on: RefCell::new(vec![2, 5]),
            calls: RefCell::new(0),
        };
        let stop = AtomicBool::new(false);
        let waits = RefCell::new(Vec::new());
        let mut seen = Vec::new();
        let id = send_file(
            &tube,
            "https://up/s",
            &mut Cursor::new(data.clone()),
            data.len() as u64,
            256,
            &stop,
            &|s| waits.borrow_mut().push(s),
            &mut |s| seen.push(s.bytes),
        )
        .unwrap();
        assert_eq!(id, "v1");
        assert_eq!(*tube.got.borrow(), data, "every byte, once, in order");
        assert_eq!(waits.borrow().len(), 2);
        assert_eq!(*seen.last().unwrap(), 1000);
        assert!(seen.windows(2).all(|w| w[0] <= w[1]));
    }

    #[test]
    fn gives_up_when_the_connection_never_comes_back_and_can_be_stopped() {
        struct Down;
        impl Http for Down {
            fn send(&self, _: &Request) -> Result<Response, String> {
                Err("no internet".into())
            }
        }
        let stop = AtomicBool::new(false);
        let e = send_file(
            &Down,
            "u",
            &mut Cursor::new(vec![1u8; 10]),
            10,
            4,
            &stop,
            &|_| {},
            &mut |_| {},
        )
        .unwrap_err();
        assert!(e.message.contains("kept dropping"));
        stop.store(true, Ordering::SeqCst);
        let e = send_file(
            &Down,
            "u",
            &mut Cursor::new(vec![1u8; 10]),
            10,
            4,
            &stop,
            &|_| {},
            &mut |_| {},
        )
        .unwrap_err();
        assert!(e.message.contains("stopped"));
    }

    #[test]
    fn captions_go_up_as_one_multipart_request() {
        let r = add_captions(
            "v1",
            "en",
            "English",
            b"1\n00:00:00,000 --> 00:00:01,000\nHi\n",
        );
        assert!(r.url.contains("uploadType=multipart"));
        assert!(r
            .header("Content-Type")
            .unwrap()
            .starts_with("multipart/related; boundary="));
        let text = r.body_text();
        assert!(text.contains(r#""videoId":"v1""#));
        assert!(text.contains("00:00:00,000 --> 00:00:01,000"));
        assert!(text.trim_end().ends_with("--lumora-studio-captions--"));
        assert_eq!(watch_url("v1"), "https://youtu.be/v1");
    }
}
