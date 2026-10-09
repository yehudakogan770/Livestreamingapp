//! Facebook Live through the Graph API: sign in with Facebook Login for
//! desktop apps, pick a Page the person manages, make a live video and send to
//! its secure stream address, end it when Lumora stops.
//! <https://developers.facebook.com/docs/live-video-api>
//!
//! Sign-in: desktop apps can't keep an app secret, so the token comes back in
//! the address (`response_type=token`), either to Lumora's own page on
//! `http://localhost` (which forwards it to the loopback server) or, when that
//! address isn't allowed, to Facebook's `login_success.html` page, whose
//! address the operator pastes into Lumora. Such tokens last an hour or two.
//!
//! Publishing needs the `publish_video` and Page permissions, which Meta only
//! grants to an app after App Review (until then, only the app's own admins,
//! developers and testers can use it).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::youtube::{Health, Phase};
use crate::{encode, AccountError, Request, Response};

pub const VERSION: &str = "v21.0";
pub const GRAPH: &str = "https://graph.facebook.com/v21.0";
pub const DIALOG: &str = "https://www.facebook.com/v21.0/dialog/oauth";
/// Where the manual sign-in ends (the address is pasted into Lumora).
pub const MANUAL_REDIRECT: &str = "https://www.facebook.com/connect/login_success.html";
/// Lumora's own page for the sign-in to come back to (registered in the Meta app).
pub const LOOPBACK_PORT: u16 = 47_321;
pub const LOOPBACK_PATH: &str = "/facebook";
/// What Lumora asks for: list the Pages, post live videos to them, and read
/// the comments on those live videos (for the live chat).
pub const SCOPES: &str = "public_profile,pages_show_list,pages_read_engagement,\
pages_read_user_content,pages_manage_posts,publish_video";

/// `http://localhost:47321/facebook` (what the Meta app must list as a valid redirect).
#[must_use]
pub fn loopback_redirect() -> String {
    format!("http://localhost:{LOOPBACK_PORT}{LOOPBACK_PATH}")
}

/// The address that opens in the browser.
#[must_use]
pub fn auth_url(app_id: &str, redirect_uri: &str, state: &str) -> String {
    format!(
        "{DIALOG}?{}",
        crate::query(&[
            ("client_id", app_id),
            ("redirect_uri", redirect_uri),
            ("response_type", "token"),
            ("scope", SCOPES),
            ("state", state),
        ])
    )
}

/// The values in a sign-in answer: the query or `#` part of a pasted address,
/// or the whole address.
#[must_use]
pub fn params_from_address(address: &str) -> Vec<(String, String)> {
    let a = address.trim();
    let part = a
        .split_once('#')
        .map(|(_, f)| f)
        .or_else(|| a.split_once('?').map(|(_, q)| q))
        .unwrap_or(a);
    crate::parse_query(part)
}

/// A user's access token from the sign-in.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserToken {
    pub token: String,
    /// Seconds since 1970 (0: Facebook didn't say).
    pub expires_at: u64,
}

impl std::fmt::Debug for UserToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UserToken")
            .field("expires_at", &self.expires_at)
            .finish_non_exhaustive()
    }
}

impl UserToken {
    #[must_use]
    pub fn valid_at(&self, now: u64) -> bool {
        self.expires_at == 0 || now + 60 < self.expires_at
    }
}

/// Read the sign-in answer (`expected_state` guards against answers Lumora didn't ask for).
///
/// # Errors
/// Canceled, refused or not Lumora's, in words.
pub fn parse_callback(
    params: &[(String, String)],
    expected_state: &str,
    now: u64,
) -> Result<UserToken, AccountError> {
    let get = |k: &str| {
        params
            .iter()
            .find(|(n, _)| n == k)
            .map(|(_, v)| v.as_str())
            .unwrap_or_default()
    };
    if !get("error").is_empty() || !get("error_reason").is_empty() {
        return Err(AccountError::new(
            if get("error_reason") == "user_denied" || get("error") == "access_denied" {
                "The Facebook connection was canceled in the browser. Nothing was changed."
                    .to_owned()
            } else {
                format!(
                    "Facebook didn’t connect ({}).",
                    if get("error_description").is_empty() {
                        get("error")
                    } else {
                        get("error_description")
                    }
                )
            },
        ));
    }
    if get("state") != expected_state {
        return Err(AccountError::new(
            "That sign-in answer isn’t from this connection. Click Connect Facebook and try again.",
        ));
    }
    let token = get("access_token");
    if token.is_empty() {
        return Err(AccountError::new(
            "Facebook didn’t send a sign-in token. Copy the whole address of the page Facebook \
             showed (it starts with https://www.facebook.com/connect/login_success.html#).",
        ));
    }
    let expires_in: u64 = get("expires_in").parse().unwrap_or(0);
    Ok(UserToken {
        token: token.to_owned(),
        expires_at: if expires_in == 0 { 0 } else { now + expires_in },
    })
}

/// The signed-in person.
#[must_use]
pub fn me() -> Request {
    Request::get(format!("{GRAPH}/me?fields=id,name"))
}

/// The Pages the person manages, each with its own token.
#[must_use]
pub fn pages() -> Request {
    Request::get(format!(
        "{GRAPH}/me/accounts?fields=id,name,access_token,tasks&limit=100"
    ))
}

/// Who or where a live video goes.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    /// A Page id, or `me` for the person's own profile.
    pub id: String,
    pub name: String,
    /// The person may post live videos there.
    pub can_publish: bool,
    #[serde(skip)]
    pub token: String,
}

impl std::fmt::Debug for Target {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Target")
            .field("id", &self.id)
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

/// The person's id and name.
///
/// # Errors
/// Facebook refused, in words.
pub fn parse_me(resp: &Response) -> Result<(String, String), AccountError> {
    let v = ok_json(resp)?;
    Ok((
        v["id"].as_str().unwrap_or_default().to_owned(),
        v["name"].as_str().unwrap_or_default().to_owned(),
    ))
}

/// The Pages in a `me/accounts` answer.
///
/// # Errors
/// Facebook refused, in words.
pub fn parse_pages(resp: &Response) -> Result<Vec<Target>, AccountError> {
    let v = ok_json(resp)?;
    Ok(v["data"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|p| {
                    let tasks: Vec<&str> = p["tasks"]
                        .as_array()
                        .map(|t| t.iter().filter_map(Value::as_str).collect())
                        .unwrap_or_default();
                    Target {
                        id: p["id"].as_str().unwrap_or_default().to_owned(),
                        name: p["name"].as_str().unwrap_or_default().to_owned(),
                        // Without `tasks` (older answers), let Facebook decide.
                        can_publish: tasks.is_empty()
                            || tasks
                                .iter()
                                .any(|t| matches!(*t, "CREATE_CONTENT" | "MANAGE")),
                        token: p["access_token"].as_str().unwrap_or_default().to_owned(),
                    }
                })
                .collect()
        })
        .unwrap_or_default())
}

/// Who sees a live video on the person's own profile (Pages are always public).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum FbPrivacy {
    #[default]
    Everyone,
    Friends,
    OnlyMe,
}

impl FbPrivacy {
    fn as_str(self) -> &'static str {
        match self {
            FbPrivacy::Everyone => "EVERYONE",
            FbPrivacy::Friends => "ALL_FRIENDS",
            FbPrivacy::OnlyMe => "SELF",
        }
    }
}

/// A live video's settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LiveSettings {
    pub title: String,
    pub description: String,
    pub privacy: FbPrivacy,
}

/// Make a live video that goes live as soon as the stream arrives.
#[must_use]
pub fn create_live(target_id: &str, s: &LiveSettings) -> Request {
    let title: String = s.title.trim().chars().take(255).collect();
    let mut pairs = vec![("status", "LIVE_NOW".to_owned())];
    if !title.is_empty() {
        pairs.push(("title", title));
    }
    if !s.description.trim().is_empty() {
        pairs.push(("description", s.description.trim().to_owned()));
    }
    if target_id == "me" {
        pairs.push((
            "privacy",
            json!({ "value": s.privacy.as_str() }).to_string(),
        ));
    }
    let borrowed: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    Request::post_form(
        format!("{GRAPH}/{}/live_videos", encode(target_id)),
        &borrowed,
    )
}

/// A live video Lumora made.
#[derive(Clone, PartialEq, Eq)]
pub struct LiveVideo {
    pub id: String,
    /// `rtmps://live-api-s.facebook.com:443/rtmp`.
    pub server: String,
    pub key: String,
}

impl std::fmt::Debug for LiveVideo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LiveVideo")
            .field("id", &self.id)
            .field("server", &self.server)
            .finish_non_exhaustive()
    }
}

/// The live video a create answered with, its address split into server and key.
///
/// # Errors
/// Facebook refused, or sent no stream address.
pub fn parse_live(resp: &Response) -> Result<LiveVideo, AccountError> {
    let v = ok_json(resp)?;
    let url = v["secure_stream_url"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| v["stream_url"].as_str())
        .unwrap_or_default();
    let (server, key) = url.rsplit_once('/').unwrap_or_default();
    if server.is_empty() || key.is_empty() {
        return Err(AccountError::new(
            "Facebook made the live video but sent no stream address. Try again.",
        ));
    }
    Ok(LiveVideo {
        id: v["id"].as_str().unwrap_or_default().to_owned(),
        server: server.to_owned(),
        key: key.to_owned(),
    })
}

/// End the live video (it stays on the Page as a video).
#[must_use]
pub fn end_live(id: &str) -> Request {
    Request::post_form(
        format!("{GRAPH}/{}", encode(id)),
        &[("end_live_video", "true")],
    )
}

/// The live video's state and address.
#[must_use]
pub fn live_status(id: &str) -> Request {
    Request::get(format!(
        "{GRAPH}/{}?fields=status,permalink_url,ingest_streams",
        encode(id)
    ))
}

/// The comments on a live video, oldest first, after `after` (a cursor from
/// the last answer; empty: from the start).
#[must_use]
pub fn comments(id: &str, after: &str) -> Request {
    let mut url = format!(
        "{GRAPH}/{}/comments?order=chronological&filter=stream&live_filter=no_filter\
         &fields=id,message,from%7Bname%7D&limit=100",
        encode(id)
    );
    if !after.is_empty() {
        url.push_str("&after=");
        url.push_str(&encode(after));
    }
    Request::get(url)
}

/// One comment from a Facebook live video.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: String,
    pub text: String,
}

/// The comments in an answer, and the cursor to ask from next time (the old
/// one when there was nothing new).
///
/// # Errors
/// Facebook refused, in words.
pub fn parse_comments(
    resp: &Response,
    after: &str,
) -> Result<(Vec<Comment>, String), AccountError> {
    let v = ok_json(resp)?;
    let list = v["data"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    let text = c["message"].as_str().unwrap_or_default().trim();
                    let id = c["id"].as_str().unwrap_or_default();
                    (!text.is_empty() && !id.is_empty()).then(|| Comment {
                        id: id.to_owned(),
                        author: c["from"]["name"]
                            .as_str()
                            .filter(|n| !n.trim().is_empty())
                            .unwrap_or("Facebook viewer")
                            .to_owned(),
                        text: text.to_owned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let next = v["paging"]["cursors"]["after"]
        .as_str()
        .filter(|c| !c.is_empty())
        .unwrap_or(after)
        .to_owned();
    Ok((list, next))
}

/// How a live video is doing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveState {
    pub status: String,
    pub phase: Phase,
    pub health: Health,
    pub watch_url: String,
}

/// Read a live video's state.
///
/// # Errors
/// Facebook refused, in words.
pub fn parse_status(resp: &Response) -> Result<LiveState, AccountError> {
    let v = ok_json(resp)?;
    let status = v["status"].as_str().unwrap_or_default().to_owned();
    let phase = match status.as_str() {
        "LIVE" => Phase::Live,
        "LIVE_STOPPED" | "PROCESSING" | "VOD" | "SCHEDULED_EXPIRED" | "SCHEDULED_CANCELED" => {
            Phase::Complete
        }
        _ => Phase::Ready,
    };
    let receiving = v["ingest_streams"]["data"]
        .as_array()
        .is_some_and(|a| a.iter().any(|s| !s["stream_health"].is_null()));
    let link = v["permalink_url"].as_str().unwrap_or_default();
    Ok(LiveState {
        phase,
        health: if receiving {
            Health::Good
        } else {
            Health::NoData
        },
        watch_url: if link.starts_with('/') {
            format!("https://www.facebook.com{link}")
        } else {
            link.to_owned()
        },
        status,
    })
}

fn ok_json(resp: &Response) -> Result<Value, AccountError> {
    if resp.ok() {
        Ok(resp.json())
    } else {
        Err(api_error(resp))
    }
}

/// A Graph API error answer, in words.
#[must_use]
pub fn api_error(resp: &Response) -> AccountError {
    let v = resp.json();
    let e = &v["error"];
    let code = e["code"].as_i64().unwrap_or(0);
    let message = e["message"].as_str().unwrap_or_default();
    let lower = message.to_lowercase();
    match code {
        190 | 102 => AccountError::reconnect(
            "The Facebook connection has run out (Facebook keeps it for an hour or two). \
             Connect Facebook again.",
        ),
        4 | 17 | 32 | 613 | 80001 => AccountError::new(
            "Facebook is getting too many requests from Lumora right now. Wait a few minutes \
             and try again.",
        ),
        10 | 200..=299
            if lower.contains("profile")
                || lower.contains("timeline")
                || lower.contains("user") =>
        {
            AccountError::new(
                "Facebook doesn’t let apps go live on a personal profile anymore. Choose a Page \
                 you manage instead.",
            )
        }
        10 | 200..=299 => AccountError::new(
            "Facebook didn’t allow this. You need to manage the Page (with permission to post), \
             and Lumora’s Meta app needs the publish_video permission, which Meta grants after \
             App Review. See Help → Going live with YouTube and Facebook accounts.",
        ),
        100 if lower.contains("live") && lower.contains("eligib") => AccountError::new(
            "Facebook says this Page can’t go live right now. Open Live Producer on Facebook \
             to see why (new Pages and Pages with restrictions sometimes have to wait).",
        ),
        368 => AccountError::new(
            "Facebook has blocked this account from going live for now (a policy restriction). \
             Check the account’s notifications on Facebook.",
        ),
        _ if resp.status >= 500 => {
            AccountError::new("Facebook is having trouble right now. Try again in a minute.")
        }
        _ if message.is_empty() => AccountError::new(format!(
            "Facebook refused the request (error {}).",
            resp.status
        )),
        _ => AccountError::new(format!("Facebook said: {message}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Response {
        let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        Response::new(200, std::fs::read(path).unwrap())
    }

    #[test]
    fn reads_live_comments_and_keeps_the_place() {
        let r = comments("9876", "");
        assert!(r
            .url
            .starts_with("https://graph.facebook.com/v21.0/9876/comments?"));
        assert_eq!(r.query_value("order").unwrap(), "chronological");
        assert_eq!(r.query_value("live_filter").unwrap(), "no_filter");
        assert_eq!(r.query_value("fields").unwrap(), "id,message,from{name}");
        assert!(r.query_value("after").is_none());
        assert_eq!(
            comments("9876", "QVF+x").query_value("after").unwrap(),
            "QVF+x"
        );

        let resp = Response::new(
            200,
            r#"{"data":[{"id":"1_2","message":" Hello from Ohio ","from":{"name":"Ana"}},
                {"id":"1_3","message":""},{"id":"1_4","message":"Great show"}],
                "paging":{"cursors":{"before":"b","after":"NEXT"}}}"#,
        );
        let (list, next) = parse_comments(&resp, "OLD").unwrap();
        assert_eq!(
            list,
            vec![
                Comment {
                    id: "1_2".into(),
                    author: "Ana".into(),
                    text: "Hello from Ohio".into()
                },
                Comment {
                    id: "1_4".into(),
                    author: "Facebook viewer".into(),
                    text: "Great show".into()
                },
            ]
        );
        assert_eq!(next, "NEXT");
        let (none, same) = parse_comments(&Response::new(200, r#"{"data":[]}"#), "OLD").unwrap();
        assert!(none.is_empty());
        assert_eq!(same, "OLD");
        let err = parse_comments(
            &Response::new(400, r#"{"error":{"code":190,"message":"expired"}}"#),
            "",
        )
        .unwrap_err();
        assert!(err.message.contains("Connect Facebook again"));
    }

    #[test]
    fn builds_the_sign_in_address() {
        let url = auth_url("1234567890", &loopback_redirect(), "st");
        let r = Request::get(url.clone());
        assert!(url.starts_with("https://www.facebook.com/v21.0/dialog/oauth?"));
        assert_eq!(r.query_value("client_id").unwrap(), "1234567890");
        assert_eq!(
            r.query_value("redirect_uri").unwrap(),
            "http://localhost:47321/facebook"
        );
        assert_eq!(r.query_value("response_type").unwrap(), "token");
        assert!(r.query_value("scope").unwrap().contains("publish_video"));
        assert_eq!(r.query_value("state").unwrap(), "st");
    }

    #[test]
    fn reads_the_sign_in_answer_from_a_pasted_address() {
        let pasted = "https://www.facebook.com/connect/login_success.html#access_token=EAAB%2Ftoken&data_access_expiration_time=1799999999&expires_in=5400&state=st";
        let p = params_from_address(pasted);
        let t = parse_callback(&p, "st", 1000).unwrap();
        assert_eq!(t.token, "EAAB/token");
        assert_eq!(t.expires_at, 6400);
        assert!(t.valid_at(6000));
        assert!(!t.valid_at(6350));
        assert!(!format!("{t:?}").contains("EAAB"));
        // Someone else's answer, a canceled one, and one without a token.
        assert!(parse_callback(&p, "other", 0)
            .unwrap_err()
            .message
            .contains("isn’t from this connection"));
        let no = params_from_address("?error=access_denied&error_reason=user_denied&state=st");
        assert!(parse_callback(&no, "st", 0)
            .unwrap_err()
            .message
            .contains("canceled"));
        assert!(parse_callback(&params_from_address("#state=st"), "st", 0)
            .unwrap_err()
            .message
            .contains("login_success"));
    }

    #[test]
    fn lists_the_pages_that_can_go_live() {
        let pages = parse_pages(&fixture("fb_accounts.json")).unwrap();
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].name, "Riverside Community Hall");
        assert!(pages[0].can_publish);
        assert_eq!(pages[0].token, "EAAPageTokenOne");
        assert!(!pages[1].can_publish);
        assert!(!format!("{pages:?}").contains("EAAPage"));
        assert!(!serde_json::to_string(&pages).unwrap().contains("EAAPage"));
        assert_eq!(parse_me(&fixture("fb_me.json")).unwrap().1, "Alex Rivera");
    }

    #[test]
    fn makes_and_ends_a_live_video() {
        let s = LiveSettings {
            title: "Spring concert".into(),
            description: "Live from the hall".into(),
            privacy: FbPrivacy::Friends,
        };
        let r = create_live("112233445566778", &s);
        assert_eq!(
            r.url,
            "https://graph.facebook.com/v21.0/112233445566778/live_videos"
        );
        let body = crate::parse_query(&r.body_text());
        assert!(body.contains(&("status".into(), "LIVE_NOW".into())));
        assert!(body.contains(&("title".into(), "Spring concert".into())));
        // Privacy is only for the person's own profile.
        assert!(!body.iter().any(|(k, _)| k == "privacy"));
        let me = crate::parse_query(&create_live("me", &s).body_text());
        assert!(me.contains(&("privacy".into(), r#"{"value":"ALL_FRIENDS"}"#.into())));
        let live = parse_live(&fixture("fb_live_create.json")).unwrap();
        assert_eq!(live.id, "1357924680135792");
        assert_eq!(live.server, "rtmps://live-api-s.facebook.com:443/rtmp");
        assert_eq!(live.key, "FB-1357924680135792-0-AbzTestKey123");
        assert!(!format!("{live:?}").contains("AbzTestKey"));
        let end = end_live("1357924680135792");
        assert_eq!(end.body_text(), "end_live_video=true");
        assert_eq!(end.url, "https://graph.facebook.com/v21.0/1357924680135792");
        let st = parse_status(&fixture("fb_live_status.json")).unwrap();
        assert_eq!(st.phase, Phase::Live);
        assert_eq!(st.health, Health::Good);
        assert_eq!(
            st.watch_url,
            "https://www.facebook.com/112233445566778/videos/2468013579246801/"
        );
    }

    #[test]
    fn says_what_went_wrong_in_plain_words() {
        let expired = api_error(&Response::new(
            400,
            include_str!("../tests/fixtures/fb_error_token.json"),
        ));
        assert!(expired.reconnect);
        let err = |code: i64, msg: &str| {
            api_error(&Response::new(
                400,
                format!(
                    r#"{{"error":{{"message":"{msg}","type":"OAuthException","code":{code}}}}}"#
                ),
            ))
        };
        assert!(err(200, "Permissions error").message.contains("App Review"));
        assert!(
            err(200, "Publishing to user timelines is no longer supported")
                .message
                .contains("personal profile")
        );
        assert!(err(4, "Application request limit reached")
            .message
            .contains("too many requests"));
        assert_eq!(
            err(1, "An unknown error occurred").message,
            "Facebook said: An unknown error occurred"
        );
    }
}
