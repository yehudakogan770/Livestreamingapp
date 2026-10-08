//! The YouTube Live Streaming API (part of the YouTube Data API v3):
//! broadcasts (what viewers watch), the reusable stream Lumora sends to,
//! binding one to the other, moving a broadcast to live, thumbnails.
//! <https://developers.google.com/youtube/v3/live/docs>
//!
//! Quota (10,000 units a day per Google Cloud project, shared by every copy
//! of Lumora built with the same client ID): a list is 1 unit; an insert,
//! update, bind, transition or thumbnail upload is 50.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{encode, AccountError, Method, Request, Response};

pub const API: &str = "https://www.googleapis.com/youtube/v3";
pub const UPLOAD_API: &str = "https://www.googleapis.com/upload/youtube/v3";
/// The title of the reusable stream Lumora makes once per channel.
pub const STREAM_TITLE: &str = "Lumora";
/// YouTube takes thumbnails up to 2 MB.
pub const THUMBNAIL_MAX: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Privacy {
    Public,
    #[default]
    Unlisted,
    Private,
}

impl Privacy {
    fn as_str(self) -> &'static str {
        match self {
            Privacy::Public => "public",
            Privacy::Unlisted => "unlisted",
            Privacy::Private => "private",
        }
    }

    fn parse(s: &str) -> Self {
        match s {
            "public" => Privacy::Public,
            "private" => Privacy::Private,
            _ => Privacy::Unlisted,
        }
    }
}

/// How far behind viewers are: normal gives the best picture, ultra-low the
/// least delay (no 4K, no captions).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Latency {
    #[default]
    Normal,
    Low,
    UltraLow,
}

impl Latency {
    fn as_str(self) -> &'static str {
        match self {
            Latency::Normal => "normal",
            Latency::Low => "low",
            Latency::UltraLow => "ultraLow",
        }
    }

    fn parse(s: &str) -> Self {
        match s {
            "low" => Latency::Low,
            "ultraLow" => Latency::UltraLow,
            _ => Latency::Normal,
        }
    }
}

/// A new broadcast's settings (made when Lumora goes live, or ahead of time).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BroadcastSettings {
    pub title: String,
    pub description: String,
    pub privacy: Privacy,
    /// RFC 3339; empty: now.
    pub scheduled_start: String,
    /// Required by YouTube (COPPA): is it made for children?
    pub made_for_kids: bool,
    pub latency: Latency,
    /// Viewers can rewind while it's live.
    pub dvr: bool,
    /// YouTube goes live by itself when the stream arrives.
    pub auto_start: bool,
    /// YouTube ends the broadcast by itself when the stream stops.
    pub auto_stop: bool,
}

impl Default for BroadcastSettings {
    fn default() -> Self {
        BroadcastSettings {
            title: String::new(),
            description: String::new(),
            privacy: Privacy::Unlisted,
            scheduled_start: String::new(),
            made_for_kids: false,
            latency: Latency::Normal,
            dvr: true,
            auto_start: false,
            auto_stop: false,
        }
    }
}

/// Where a broadcast is (its `lifeCycleStatus`), simplified:
/// created → ready → testing → live → complete.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// Made, but no stream bound yet.
    Created,
    /// Bound to a stream: can go to testing (or live).
    Ready,
    /// On YouTube's monitor stream only (testStarting, testing).
    Testing,
    /// Viewers see it (liveStarting, live).
    Live,
    /// Over; it can't go live again.
    Complete,
    /// Removed by YouTube or the channel.
    Revoked,
}

impl Phase {
    #[must_use]
    pub fn from_life_cycle(s: &str) -> Self {
        match s {
            "ready" => Phase::Ready,
            "testStarting" | "testing" => Phase::Testing,
            "liveStarting" | "live" => Phase::Live,
            "complete" => Phase::Complete,
            "revoked" => Phase::Revoked,
            _ => Phase::Created,
        }
    }

    /// It can no longer be used.
    #[must_use]
    pub fn over(self) -> bool {
        matches!(self, Phase::Complete | Phase::Revoked)
    }
}

/// A move YouTube is asked to make (`liveBroadcasts.transition`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Transition {
    Testing,
    Live,
    Complete,
}

impl Transition {
    fn as_str(self) -> &'static str {
        match self {
            Transition::Testing => "testing",
            Transition::Live => "live",
            Transition::Complete => "complete",
        }
    }
}

/// What to ask YouTube next while Lumora streams, or `None` to wait.
///
/// - YouTube starts it by itself (`auto_start`): nothing to do.
/// - Ready and the stream is arriving: to testing (with the monitor stream),
///   else straight to live.
/// - Testing (settled) and the stream still arriving: to live.
///
/// A broadcast moving between states (`starting`) is left alone.
#[must_use]
pub fn next_step(
    phase: Phase,
    starting: bool,
    stream_active: bool,
    auto_start: bool,
    monitor: bool,
) -> Option<Transition> {
    if auto_start || starting || !stream_active {
        return None;
    }
    match phase {
        Phase::Ready if monitor => Some(Transition::Testing),
        Phase::Ready | Phase::Testing => Some(Transition::Live),
        _ => None,
    }
}

/// What to ask YouTube when the operator stops the stream.
#[must_use]
pub fn stop_step(phase: Phase, auto_stop: bool) -> Option<Transition> {
    match phase {
        Phase::Testing | Phase::Live if !auto_stop => Some(Transition::Complete),
        _ => None,
    }
}

/// A broadcast on the channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Broadcast {
    pub id: String,
    pub title: String,
    pub description: String,
    pub privacy: Privacy,
    pub scheduled_start: String,
    pub life_cycle: String,
    pub phase: Phase,
    pub bound_stream_id: Option<String>,
    pub auto_start: bool,
    pub auto_stop: bool,
    pub monitor: bool,
    pub made_for_kids: bool,
    pub latency: Latency,
    pub dvr: bool,
    pub watch_url: String,
    /// The picture viewers see before it starts (when there is one).
    pub thumbnail_url: Option<String>,
}

/// The ingest address and key of Lumora's stream.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ingest {
    /// RTMPS where YouTube offers it.
    pub server: String,
    pub backup_server: String,
    pub key: String,
}

impl std::fmt::Debug for Ingest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Ingest")
            .field("server", &self.server)
            .field("backup_server", &self.backup_server)
            .finish_non_exhaustive()
    }
}

/// How the stream reaches YouTube (`status.healthStatus.status`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Health {
    Good,
    Ok,
    Bad,
    NoData,
}

impl Health {
    fn parse(s: &str) -> Self {
        match s {
            "good" => Health::Good,
            "ok" => Health::Ok,
            "bad" => Health::Bad,
            _ => Health::NoData,
        }
    }
}

/// A stream (where Lumora sends the picture).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStream {
    pub id: String,
    pub title: String,
    pub reusable: bool,
    #[serde(skip)]
    pub ingest: Option<Ingest>,
    /// active, created, error, inactive, ready.
    pub stream_status: String,
    pub health: Health,
    /// YouTube's notes about the stream (bitrate too low, no keyframes…).
    pub issues: Vec<String>,
}

impl LiveStream {
    /// YouTube is getting the picture.
    #[must_use]
    pub fn active(&self) -> bool {
        self.stream_status == "active"
    }
}

/// The signed-in channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub title: String,
}

// ---- requests ----

const BROADCAST_PARTS: &str = "id,snippet,status,contentDetails";
const STREAM_PARTS: &str = "id,snippet,cdn,contentDetails,status";

/// The channel's name (1 unit).
#[must_use]
pub fn channel() -> Request {
    Request::get(format!("{API}/channels?part=id,snippet&mine=true"))
}

/// Broadcasts that haven't happened yet (1 unit).
#[must_use]
pub fn list_upcoming() -> Request {
    Request::get(format!(
        "{API}/liveBroadcasts?part={BROADCAST_PARTS}&broadcastStatus=upcoming&broadcastType=all&maxResults=25"
    ))
}

/// One broadcast (1 unit).
#[must_use]
pub fn get_broadcast(id: &str) -> Request {
    Request::get(format!(
        "{API}/liveBroadcasts?part={BROADCAST_PARTS}&id={}",
        encode(id)
    ))
}

fn broadcast_body(s: &BroadcastSettings, now: &str) -> Value {
    let title: String = s.title.trim().chars().take(100).collect();
    let start = if s.scheduled_start.trim().is_empty() {
        now
    } else {
        s.scheduled_start.trim()
    };
    json!({
        "snippet": {
            "title": if title.is_empty() { "Live with Lumora".to_owned() } else { title },
            "description": s.description.chars().take(5000).collect::<String>(),
            "scheduledStartTime": start,
        },
        "status": {
            "privacyStatus": s.privacy.as_str(),
            "selfDeclaredMadeForKids": s.made_for_kids,
        },
        "contentDetails": {
            "enableAutoStart": s.auto_start,
            "enableAutoStop": s.auto_stop,
            "enableDvr": s.dvr,
            "latencyPreference": s.latency.as_str(),
            // The monitor stream lets the broadcast be checked in YouTube
            // Studio (testing) before viewers see it.
            "monitorStream": { "enableMonitorStream": true, "broadcastStreamDelayMs": 0 },
        },
    })
}

/// Make a broadcast (50 units). `now` (RFC 3339) is its start when none is set.
#[must_use]
pub fn insert_broadcast(s: &BroadcastSettings, now: &str) -> Request {
    Request::json(
        Method::Post,
        format!("{API}/liveBroadcasts?part=snippet,status,contentDetails"),
        &broadcast_body(s, now),
    )
}

/// Lumora's streams, to find the reusable one (1 unit).
#[must_use]
pub fn list_streams() -> Request {
    Request::get(format!(
        "{API}/liveStreams?part={STREAM_PARTS}&mine=true&maxResults=50"
    ))
}

/// One stream's status and health (1 unit).
#[must_use]
pub fn stream_status(id: &str) -> Request {
    Request::get(format!(
        "{API}/liveStreams?part=id,status&id={}",
        encode(id)
    ))
}

/// Make Lumora's reusable stream (50 units, once per channel).
#[must_use]
pub fn insert_stream() -> Request {
    Request::json(
        Method::Post,
        format!("{API}/liveStreams?part=snippet,cdn,contentDetails,status"),
        &json!({
            "snippet": {
                "title": STREAM_TITLE,
                "description": "Made by Lumora. Every broadcast Lumora starts uses this stream.",
            },
            "cdn": {
                "ingestionType": "rtmp",
                "resolution": "variable",
                "frameRate": "variable",
            },
            "contentDetails": { "isReusable": true },
        }),
    )
}

/// Bind a broadcast to a stream (50 units).
#[must_use]
pub fn bind(broadcast_id: &str, stream_id: &str) -> Request {
    Request::post(format!(
        "{API}/liveBroadcasts/bind?id={}&part=id,contentDetails&streamId={}",
        encode(broadcast_id),
        encode(stream_id)
    ))
}

/// Move a broadcast (50 units).
#[must_use]
pub fn transition(broadcast_id: &str, to: Transition) -> Request {
    Request::post(format!(
        "{API}/liveBroadcasts/transition?broadcastStatus={}&id={}&part=id,status",
        to.as_str(),
        encode(broadcast_id)
    ))
}

/// Upload a thumbnail (50 units): a JPEG or PNG of at most 2 MB.
#[must_use]
pub fn set_thumbnail(video_id: &str, mime: &str, bytes: Vec<u8>) -> Request {
    Request {
        method: Method::Post,
        url: format!(
            "{UPLOAD_API}/thumbnails/set?videoId={}&uploadType=media",
            encode(video_id)
        ),
        headers: vec![("Content-Type".to_owned(), mime.to_owned())],
        body: bytes,
    }
}

/// The picture type of a thumbnail, from its first bytes.
#[must_use]
pub fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else {
        None
    }
}

/// The address viewers watch.
#[must_use]
pub fn watch_url(id: &str) -> String {
    format!("https://www.youtube.com/watch?v={id}")
}

// ---- answers ----

fn ok_json(resp: &Response) -> Result<Value, AccountError> {
    if resp.ok() {
        Ok(resp.json())
    } else {
        Err(api_error(resp))
    }
}

fn str_of(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_owned()
}

fn parse_broadcast(item: &Value) -> Broadcast {
    let id = str_of(&item["id"]);
    let cd = &item["contentDetails"];
    let life_cycle = str_of(&item["status"]["lifeCycleStatus"]);
    let thumbs = &item["snippet"]["thumbnails"];
    let thumbnail_url = ["maxres", "high", "medium", "default"]
        .iter()
        .find_map(|k| thumbs[k]["url"].as_str())
        .map(str::to_owned);
    Broadcast {
        watch_url: watch_url(&id),
        title: str_of(&item["snippet"]["title"]),
        description: str_of(&item["snippet"]["description"]),
        privacy: Privacy::parse(item["status"]["privacyStatus"].as_str().unwrap_or("")),
        scheduled_start: str_of(&item["snippet"]["scheduledStartTime"]),
        phase: Phase::from_life_cycle(&life_cycle),
        life_cycle,
        bound_stream_id: cd["boundStreamId"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
        auto_start: cd["enableAutoStart"].as_bool().unwrap_or(false),
        auto_stop: cd["enableAutoStop"].as_bool().unwrap_or(false),
        monitor: cd["monitorStream"]["enableMonitorStream"]
            .as_bool()
            .unwrap_or(true),
        made_for_kids: item["status"]["selfDeclaredMadeForKids"]
            .as_bool()
            .or_else(|| item["status"]["madeForKids"].as_bool())
            .unwrap_or(false),
        latency: Latency::parse(cd["latencyPreference"].as_str().unwrap_or("")),
        dvr: cd["enableDvr"].as_bool().unwrap_or(true),
        thumbnail_url,
        id,
    }
}

/// The broadcasts in a list answer.
///
/// # Errors
/// YouTube refused, in words.
pub fn parse_broadcasts(resp: &Response) -> Result<Vec<Broadcast>, AccountError> {
    let v = ok_json(resp)?;
    Ok(v["items"]
        .as_array()
        .map(|a| a.iter().map(parse_broadcast).collect())
        .unwrap_or_default())
}

/// The broadcast an insert, bind or transition answered with.
///
/// # Errors
/// YouTube refused, in words.
pub fn parse_one_broadcast(resp: &Response) -> Result<Broadcast, AccountError> {
    let v = ok_json(resp)?;
    if v["id"].as_str().is_none_or(str::is_empty) {
        return Err(AccountError::new(
            "YouTube answered without the broadcast. Try again.",
        ));
    }
    Ok(parse_broadcast(&v))
}

fn parse_stream(item: &Value) -> LiveStream {
    let info = &item["cdn"]["ingestionInfo"];
    let key = str_of(&info["streamName"]);
    let pick = |a: &str, b: &str| {
        info[a]
            .as_str()
            .filter(|s| !s.is_empty())
            .or_else(|| info[b].as_str())
            .unwrap_or_default()
            .to_owned()
    };
    let server = pick("rtmpsIngestionAddress", "ingestionAddress");
    let ingest = (!key.is_empty() && !server.is_empty()).then(|| Ingest {
        server,
        backup_server: pick("rtmpsBackupIngestionAddress", "backupIngestionAddress"),
        key,
    });
    let status = &item["status"];
    LiveStream {
        id: str_of(&item["id"]),
        title: str_of(&item["snippet"]["title"]),
        reusable: item["contentDetails"]["isReusable"]
            .as_bool()
            .unwrap_or(false),
        ingest,
        stream_status: str_of(&status["streamStatus"]),
        health: Health::parse(status["healthStatus"]["status"].as_str().unwrap_or("")),
        issues: status["healthStatus"]["configurationIssues"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|i| i["severity"].as_str() != Some("info"))
                    .filter_map(|i| {
                        i["description"]
                            .as_str()
                            .or_else(|| i["reason"].as_str())
                            .map(str::to_owned)
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }
}

/// The streams in a list answer.
///
/// # Errors
/// YouTube refused, in words.
pub fn parse_streams(resp: &Response) -> Result<Vec<LiveStream>, AccountError> {
    let v = ok_json(resp)?;
    Ok(v["items"]
        .as_array()
        .map(|a| a.iter().map(parse_stream).collect())
        .unwrap_or_default())
}

/// The stream an insert answered with.
///
/// # Errors
/// YouTube refused, in words.
pub fn parse_one_stream(resp: &Response) -> Result<LiveStream, AccountError> {
    Ok(parse_stream(&ok_json(resp)?))
}

/// Lumora's reusable stream among the channel's streams (one with an ingest key).
#[must_use]
pub fn lumora_stream(streams: &[LiveStream]) -> Option<&LiveStream> {
    streams
        .iter()
        .find(|s| s.title == STREAM_TITLE && s.reusable && s.ingest.is_some())
}

/// The channel in a channels answer.
///
/// # Errors
/// YouTube refused, or the account has no channel.
pub fn parse_channel(resp: &Response) -> Result<Channel, AccountError> {
    let v = ok_json(resp)?;
    let item = &v["items"][0];
    if item.is_null() {
        return Err(AccountError::new(
            "This Google account has no YouTube channel yet. Make one at youtube.com (your \
             picture → Create a channel), then connect again.",
        ));
    }
    Ok(Channel {
        id: str_of(&item["id"]),
        title: str_of(&item["snippet"]["title"]),
    })
}

/// The first reason in a YouTube error answer.
#[must_use]
pub fn error_reason(resp: &Response) -> String {
    let v = resp.json();
    v["error"]["errors"][0]["reason"]
        .as_str()
        .or_else(|| v["error"]["status"].as_str())
        .unwrap_or_default()
        .to_owned()
}

/// A YouTube error answer, in words.
#[must_use]
pub fn api_error(resp: &Response) -> AccountError {
    let v = resp.json();
    let reason = error_reason(resp);
    let message = v["error"]["message"].as_str().unwrap_or_default();
    let words = match reason.as_str() {
        "quotaExceeded" | "dailyLimitExceeded" => {
            "YouTube’s daily limit for Lumora is used up (10,000 units a day, shared by \
             everyone using this copy of Lumora). It starts again at midnight Pacific time. \
             For now, add a YouTube destination with a stream key instead (Settings → \
             Recording and streaming → Add a destination)."
        }
        "rateLimitExceeded" | "userRateLimitExceeded" | "userRequestsExceedRateLimit" => {
            "YouTube is getting too many requests right now. Wait a minute and try again."
        }
        "liveStreamingNotEnabled" => {
            "Live streaming isn’t turned on for this YouTube channel. Turn it on at \
             youtube.com/features (YouTube asks to verify a phone number). The first time, \
             YouTube takes up to 24 hours before the channel can go live."
        }
        "insufficientLivePermissions" | "livePermissionBlocked" => {
            "This YouTube channel isn’t allowed to live stream right now (it may have a \
             restriction or a strike). Check youtube.com/features."
        }
        "liveBroadcastNotFound" => {
            "That YouTube broadcast no longer exists. Choose another one, or let Lumora make a \
             new one."
        }
        "liveStreamNotFound" => {
            "Lumora’s YouTube stream was deleted. Try again: Lumora makes a new one."
        }
        "invalidTransition" | "errorStreamInactive" => {
            "YouTube isn’t getting the stream yet, so the broadcast can’t go live. Lumora keeps \
             trying while it streams."
        }
        "invalidScheduledStartTime" | "scheduledStartTimeRequired" => {
            "The scheduled start time isn’t valid. Choose a time in the future."
        }
        "titleRequired" | "invalidTitle" => {
            "The broadcast needs a title of at most 100 characters (no < or >)."
        }
        "invalidDescription" => {
            "The description is too long or has characters YouTube doesn’t take (< or >)."
        }
        "invalidLatencyPreferenceOptions" => {
            "That latency can’t be used with these settings (ultra-low latency has no DVR and \
             no 4K). Choose Normal or Low latency."
        }
        "invalidImage" | "mediaBodyRequired" | "invalidImageFormat" => {
            "YouTube didn’t take the picture. Use a JPG or PNG under 2 MB (1280 × 720 is best)."
        }
        "uploadRateLimitExceeded" => {
            "Too many thumbnails in a short time. Wait a little and try again."
        }
        "forbidden" if resp.status == 403 && message.to_lowercase().contains("thumbnail") => {
            "Custom thumbnails need a verified YouTube account. Verify it at youtube.com/verify."
        }
        "authError" | "UNAUTHENTICATED" => {
            return AccountError::reconnect(
                "YouTube no longer accepts Lumora’s sign-in. Connect the YouTube account again.",
            )
        }
        "insufficientPermissions" | "ACCESS_TOKEN_SCOPE_INSUFFICIENT" => {
            return AccountError::reconnect(
                "Lumora wasn’t given permission to manage the channel’s live streams. Connect \
                 the YouTube account again and allow everything Lumora asks for.",
            )
        }
        "youtubeSignupRequired" => {
            "This Google account has no YouTube channel yet. Make one at youtube.com, then \
             connect again."
        }
        _ if resp.status == 401 => {
            return AccountError::reconnect(
                "YouTube no longer accepts Lumora’s sign-in. Connect the YouTube account again.",
            )
        }
        _ if resp.status >= 500 => "YouTube is having trouble right now. Try again in a minute.",
        _ => {
            return AccountError::new(if message.is_empty() {
                format!("YouTube refused the request (error {}).", resp.status)
            } else {
                format!("YouTube said: {message}")
            })
        }
    };
    AccountError::new(words)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Response {
        let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        Response::new(200, std::fs::read(path).unwrap())
    }

    #[test]
    fn builds_a_new_broadcast() {
        let s = BroadcastSettings {
            title: "  Spring concert  ".into(),
            description: "Live from the hall".into(),
            privacy: Privacy::Public,
            made_for_kids: false,
            latency: Latency::UltraLow,
            dvr: false,
            auto_start: true,
            auto_stop: true,
            ..BroadcastSettings::default()
        };
        let r = insert_broadcast(&s, "2026-10-08T18:30:00Z");
        assert_eq!(r.method, Method::Post);
        assert_eq!(
            r.url,
            "https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails"
        );
        let b = r.body_json();
        assert_eq!(b["snippet"]["title"], "Spring concert");
        assert_eq!(b["snippet"]["scheduledStartTime"], "2026-10-08T18:30:00Z");
        assert_eq!(b["status"]["privacyStatus"], "public");
        assert_eq!(b["status"]["selfDeclaredMadeForKids"], false);
        assert_eq!(b["contentDetails"]["latencyPreference"], "ultraLow");
        assert_eq!(b["contentDetails"]["enableDvr"], false);
        assert_eq!(b["contentDetails"]["enableAutoStart"], true);
        assert_eq!(b["contentDetails"]["enableAutoStop"], true);
        // A set start time is kept; a missing title gets one.
        let later = BroadcastSettings {
            scheduled_start: "2026-12-01T19:00:00Z".into(),
            ..BroadcastSettings::default()
        };
        let b = insert_broadcast(&later, "now").body_json();
        assert_eq!(b["snippet"]["scheduledStartTime"], "2026-12-01T19:00:00Z");
        assert_eq!(b["snippet"]["title"], "Live with Lumora");
        assert_eq!(b["status"]["privacyStatus"], "unlisted");
    }

    #[test]
    fn builds_the_other_requests() {
        assert_eq!(
            bind("b 1", "s1").url,
            "https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=b%201&part=id,contentDetails&streamId=s1"
        );
        let t = transition("b1", Transition::Testing);
        assert_eq!(t.method, Method::Post);
        assert_eq!(t.query_value("broadcastStatus").unwrap(), "testing");
        assert_eq!(
            transition("b1", Transition::Complete)
                .query_value("broadcastStatus")
                .unwrap(),
            "complete"
        );
        assert_eq!(
            list_upcoming().query_value("broadcastStatus").unwrap(),
            "upcoming"
        );
        assert_eq!(stream_status("s1").query_value("id").unwrap(), "s1");
        let s = insert_stream().body_json();
        assert_eq!(s["contentDetails"]["isReusable"], true);
        assert_eq!(s["cdn"]["ingestionType"], "rtmp");
        assert_eq!(s["cdn"]["resolution"], "variable");
        let th = set_thumbnail("b1", "image/png", vec![1, 2, 3]);
        assert!(th
            .url
            .starts_with("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=b1"));
        assert_eq!(th.header("content-type"), Some("image/png"));
        assert_eq!(th.body, vec![1, 2, 3]);
        assert_eq!(image_type(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(image_type(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(image_type(b"GIF89a"), None);
    }

    #[test]
    fn reads_broadcasts() {
        let list = parse_broadcasts(&fixture("yt_broadcasts_upcoming.json")).unwrap();
        assert_eq!(list.len(), 2);
        let b = &list[0];
        assert_eq!(b.id, "Xq9hFm3kLw0");
        assert_eq!(b.title, "Sunday morning service");
        assert_eq!(b.phase, Phase::Ready);
        assert_eq!(b.bound_stream_id.as_deref(), Some("Abc123StreamId"));
        assert_eq!(b.privacy, Privacy::Unlisted);
        assert!(b.monitor);
        assert!(!b.auto_start);
        assert_eq!(b.latency, Latency::Low);
        assert_eq!(b.watch_url, "https://www.youtube.com/watch?v=Xq9hFm3kLw0");
        assert_eq!(
            b.thumbnail_url.as_deref(),
            Some("https://i.ytimg.com/vi/Xq9hFm3kLw0/hqdefault_live.jpg")
        );
        assert_eq!(list[1].phase, Phase::Created);
        assert_eq!(list[1].bound_stream_id, None);
        let made = parse_one_broadcast(&fixture("yt_broadcast_insert.json")).unwrap();
        assert_eq!(made.phase, Phase::Created);
        assert!(!made.made_for_kids && made.dvr);
    }

    #[test]
    fn reads_the_stream_and_its_ingest() {
        let list = parse_streams(&fixture("yt_streams.json")).unwrap();
        let s = lumora_stream(&list).unwrap();
        assert_eq!(s.id, "Abc123StreamId");
        let i = s.ingest.as_ref().unwrap();
        assert_eq!(i.server, "rtmps://a.rtmps.youtube.com/live2");
        assert_eq!(
            i.backup_server,
            "rtmps://b.rtmps.youtube.com/live2?backup=1"
        );
        assert_eq!(i.key, "abcd-efgh-ijkl-mnop-qrst");
        assert!(!format!("{i:?}").contains("abcd-efgh"));
        assert!(!s.active());
        assert_eq!(s.health, Health::NoData);
        let st = parse_streams(&fixture("yt_stream_status_active.json")).unwrap();
        assert!(st[0].active());
        assert_eq!(st[0].health, Health::Bad);
        assert_eq!(
            st[0].issues,
            vec![
                "The current bitrate (1500 Kbps) is lower than the recommended bitrate.".to_owned()
            ]
        );
    }

    #[test]
    fn reads_the_channel() {
        let c = parse_channel(&fixture("yt_channel.json")).unwrap();
        assert_eq!(c.title, "Riverside Community Hall");
        let none = Response::new(200, r#"{"kind":"youtube#channelListResponse","items":[]}"#);
        assert!(parse_channel(&none)
            .unwrap_err()
            .message
            .contains("no YouTube channel"));
    }

    #[test]
    fn says_what_went_wrong_in_plain_words() {
        let err = |status, reason: &str| {
            api_error(&Response::new(
                status,
                format!(
                    r#"{{"error":{{"code":{status},"message":"x","errors":[{{"reason":"{reason}","domain":"youtube.liveBroadcast"}}]}}}}"#
                ),
            ))
        };
        let q = api_error(&Response::new(
            403,
            include_str!("../tests/fixtures/yt_error_quota.json"),
        ));
        assert!(q.message.contains("daily limit"));
        assert!(!q.reconnect);
        let off = api_error(&Response::new(
            403,
            include_str!("../tests/fixtures/yt_error_not_enabled.json"),
        ));
        assert!(off.message.contains("24 hours"));
        assert!(off.message.contains("phone"));
        assert!(err(401, "authError").reconnect);
        assert!(err(403, "insufficientPermissions").reconnect);
        assert!(err(400, "invalidScheduledStartTime")
            .message
            .contains("future"));
        assert!(err(403, "errorStreamInactive")
            .message
            .contains("isn’t getting the stream"));
        assert!(err(503, "backendError").message.contains("trouble"));
        assert_eq!(err(400, "somethingNew").message, "YouTube said: x");
        assert_eq!(
            api_error(&Response::new(418, "")).message,
            "YouTube refused the request (error 418)."
        );
    }

    #[test]
    fn the_broadcast_moves_created_ready_testing_live_complete() {
        use Phase::*;
        // Nothing until the stream arrives.
        assert_eq!(next_step(Created, false, true, false, true), None);
        assert_eq!(next_step(Ready, false, false, false, true), None);
        // Ready → testing → live, with the monitor stream.
        assert_eq!(
            next_step(Ready, false, true, false, true),
            Some(Transition::Testing)
        );
        assert_eq!(next_step(Testing, true, true, false, true), None);
        assert_eq!(
            next_step(Testing, false, true, false, true),
            Some(Transition::Live)
        );
        assert_eq!(next_step(Live, false, true, false, true), None);
        // Without it, straight to live.
        assert_eq!(
            next_step(Ready, false, true, false, false),
            Some(Transition::Live)
        );
        // YouTube does it by itself.
        assert_eq!(next_step(Ready, false, true, true, true), None);
        // Stopping completes it, unless YouTube does.
        assert_eq!(stop_step(Live, false), Some(Transition::Complete));
        assert_eq!(stop_step(Testing, false), Some(Transition::Complete));
        assert_eq!(stop_step(Live, true), None);
        assert_eq!(stop_step(Ready, false), None);
        assert_eq!(stop_step(Complete, false), None);
        assert_eq!(Phase::from_life_cycle("liveStarting"), Live);
        assert_eq!(Phase::from_life_cycle("testStarting"), Testing);
        assert!(Phase::from_life_cycle("revoked").over());
    }
}
