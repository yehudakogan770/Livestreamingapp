//! Google sign-in for installed apps: authorization code with PKCE, a
//! loopback redirect on 127.0.0.1, and refresh tokens.
//! <https://developers.google.com/identity/protocols/oauth2/native-app>

use serde_json::Value;

use crate::pkce::Pkce;
use crate::{AccountError, Http, Request, Response};

pub const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
pub const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
/// The one scope Lumora asks for: manage the channel's live broadcasts and
/// set thumbnails (the narrowest scope that allows liveBroadcasts.insert,
/// liveStreams.insert and thumbnails.set).
pub const YOUTUBE_SCOPE: &str = "https://www.googleapis.com/auth/youtube.force-ssl";
/// An access token this close to running out is refreshed first.
pub const EARLY_SECS: u64 = 60;

/// The owner's Google OAuth client (type "Desktop app"). Neither value is a
/// secret for a desktop app: Google says the "client secret" of a desktop
/// client can't be kept secret and PKCE is what protects the sign-in. Google
/// still asks for it in the token request when the client has one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleClient {
    pub client_id: String,
    pub client_secret: Option<String>,
}

impl GoogleClient {
    /// The address that opens in the browser.
    #[must_use]
    pub fn auth_url(&self, redirect_uri: &str, pkce: &Pkce, state: &str) -> String {
        format!(
            "{AUTH_URL}?{}",
            crate::query(&[
                ("client_id", &self.client_id),
                ("redirect_uri", redirect_uri),
                ("response_type", "code"),
                ("scope", YOUTUBE_SCOPE),
                ("code_challenge", &pkce.challenge),
                ("code_challenge_method", "S256"),
                ("state", state),
                // A refresh token, every time (so reconnecting always gets one).
                ("access_type", "offline"),
                ("prompt", "consent"),
            ])
        )
    }

    fn with_secret<'a>(&'a self, mut pairs: Vec<(&'a str, &'a str)>) -> Vec<(&'a str, &'a str)> {
        if let Some(s) = self.client_secret.as_deref().filter(|s| !s.is_empty()) {
            pairs.push(("client_secret", s));
        }
        pairs
    }

    /// Trade the code from the browser for tokens.
    #[must_use]
    pub fn exchange(&self, code: &str, verifier: &str, redirect_uri: &str) -> Request {
        let pairs = self.with_secret(vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("code_verifier", verifier),
            ("client_id", &self.client_id),
            ("redirect_uri", redirect_uri),
        ]);
        Request::post_form(TOKEN_URL, &pairs)
    }

    /// A new access token from the refresh token.
    #[must_use]
    pub fn refresh(&self, refresh_token: &str) -> Request {
        let pairs = self.with_secret(vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", &self.client_id),
        ]);
        Request::post_form(TOKEN_URL, &pairs)
    }
}

/// Disconnect: the refresh token stops working everywhere.
#[must_use]
pub fn revoke(token: &str) -> Request {
    Request::post_form(REVOKE_URL, &[("token", token)])
}

/// What the token endpoint gave.
#[derive(Clone, PartialEq, Eq)]
pub struct Tokens {
    pub access_token: String,
    pub expires_in: u64,
    /// Only on the first exchange (and now and then on a refresh).
    pub refresh_token: Option<String>,
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Tokens")
            .field("expires_in", &self.expires_in)
            .field("has_refresh_token", &self.refresh_token.is_some())
            .finish_non_exhaustive()
    }
}

/// Read the token endpoint's answer.
///
/// # Errors
/// What went wrong, in words; `reconnect` when the sign-in must be done again.
pub fn parse_tokens(resp: &Response) -> Result<Tokens, AccountError> {
    let v = resp.json();
    if resp.ok() {
        let access_token = v["access_token"].as_str().unwrap_or_default().to_owned();
        if access_token.is_empty() {
            return Err(AccountError::new(
                "Google answered without an access token. Try connecting again.",
            ));
        }
        return Ok(Tokens {
            access_token,
            expires_in: v["expires_in"].as_u64().unwrap_or(3600),
            refresh_token: v["refresh_token"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
        });
    }
    Err(token_error(&v, resp.status))
}

fn token_error(v: &Value, status: u16) -> AccountError {
    let code = v["error"].as_str().unwrap_or_default();
    let detail = v["error_description"].as_str().unwrap_or_default();
    match code {
        "invalid_grant" => AccountError::reconnect(
            "The YouTube connection has expired or was removed (for example in your Google \
             account’s security settings). Connect the YouTube account again.",
        ),
        "invalid_client" | "unauthorized_client" => AccountError::new(
            "Google didn’t accept this copy of Lumora’s YouTube sign-in setup (the client ID \
             is wrong or was deleted). The person who set up Lumora needs to check the OAuth \
             client in Google Cloud Console (see docs/LIVE_ACCOUNTS.md).",
        ),
        "access_denied" => AccountError::new(
            "The YouTube connection was canceled in the browser. Nothing was changed.",
        ),
        "invalid_request" if detail.contains("client_secret") => AccountError::new(
            "Google asks for the client secret of the Desktop OAuth client. The person who set \
             up Lumora needs to add LUMORA_YT_CLIENT_SECRET (see docs/LIVE_ACCOUNTS.md).",
        ),
        _ if status >= 500 => AccountError::new(
            "Google’s sign-in service is having trouble right now. Try again in a minute.",
        ),
        _ => AccountError::new(format!(
            "Google didn’t accept the sign-in ({}). Try connecting again.",
            if detail.is_empty() { code } else { detail }
        )),
    }
}

/// An access token and when it runs out (seconds since 1970).
#[derive(Clone, PartialEq, Eq)]
struct Access {
    token: String,
    expires_at: u64,
}

/// Keeps a working access token: refreshes it shortly before it runs out,
/// and after the API says it no longer works.
pub struct TokenKeeper {
    client: GoogleClient,
    refresh_token: String,
    access: Option<Access>,
    /// Google sent a new refresh token: the app keeps it instead.
    rotated: bool,
}

impl std::fmt::Debug for TokenKeeper {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenKeeper")
            .field("has_access", &self.access.is_some())
            .finish_non_exhaustive()
    }
}

impl TokenKeeper {
    #[must_use]
    pub fn new(client: GoogleClient, refresh_token: String) -> Self {
        TokenKeeper {
            client,
            refresh_token,
            access: None,
            rotated: false,
        }
    }

    /// Start with the tokens of a new sign-in.
    #[must_use]
    pub fn from_tokens(client: GoogleClient, tokens: Tokens, now: u64) -> Option<Self> {
        let refresh_token = tokens.refresh_token?;
        Some(TokenKeeper {
            client,
            refresh_token,
            access: Some(Access {
                token: tokens.access_token,
                expires_at: now + tokens.expires_in,
            }),
            rotated: false,
        })
    }

    #[must_use]
    pub fn refresh_token(&self) -> &str {
        &self.refresh_token
    }

    /// Google replaced the refresh token since the last call (it must be saved).
    pub fn take_rotated(&mut self) -> bool {
        std::mem::take(&mut self.rotated)
    }

    /// The access token is still good at `now` (with a minute to spare).
    #[must_use]
    pub fn fresh_at(&self, now: u64) -> bool {
        self.access
            .as_ref()
            .is_some_and(|a| now + EARLY_SECS < a.expires_at)
    }

    /// The API refused the access token: the next call refreshes it.
    pub fn forget_access(&mut self) {
        self.access = None;
    }

    /// A working access token, refreshed first when needed.
    ///
    /// # Errors
    /// The refresh failed; `reconnect` when the refresh token no longer works.
    pub fn access(&mut self, http: &dyn Http, now: u64) -> Result<String, AccountError> {
        if let Some(a) = self.access.as_ref().filter(|_| self.fresh_at(now)) {
            return Ok(a.token.clone());
        }
        let resp = http
            .send(&self.client.refresh(&self.refresh_token))
            .map_err(|e| AccountError::offline("Google", &e))?;
        let tokens = parse_tokens(&resp)?;
        if let Some(r) = tokens.refresh_token {
            if r != self.refresh_token {
                self.refresh_token = r;
                self.rotated = true;
            }
        }
        self.access = Some(Access {
            token: tokens.access_token.clone(),
            expires_at: now + tokens.expires_in,
        });
        Ok(tokens.access_token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Fake(RefCell<Vec<Response>>, RefCell<Vec<Request>>);
    impl Http for Fake {
        fn send(&self, r: &Request) -> Result<Response, String> {
            self.1.borrow_mut().push(r.clone());
            let mut q = self.0.borrow_mut();
            if q.is_empty() {
                Err("offline".into())
            } else {
                Ok(q.remove(0))
            }
        }
    }

    fn client() -> GoogleClient {
        GoogleClient {
            client_id: "123.apps.googleusercontent.com".into(),
            client_secret: Some("GOCSPX-abc".into()),
        }
    }

    #[test]
    fn builds_the_sign_in_address_with_pkce() {
        let p = Pkce::from_bytes(&[7; 32]);
        let url = client().auth_url("http://127.0.0.1:51234", &p, "st4te");
        let r = Request::get(url.clone());
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert_eq!(
            r.query_value("client_id").unwrap(),
            "123.apps.googleusercontent.com"
        );
        assert_eq!(
            r.query_value("redirect_uri").unwrap(),
            "http://127.0.0.1:51234"
        );
        assert_eq!(r.query_value("response_type").unwrap(), "code");
        assert_eq!(r.query_value("scope").unwrap(), YOUTUBE_SCOPE);
        assert_eq!(r.query_value("code_challenge").unwrap(), p.challenge);
        assert_eq!(r.query_value("code_challenge_method").unwrap(), "S256");
        assert_eq!(r.query_value("state").unwrap(), "st4te");
        assert_eq!(r.query_value("access_type").unwrap(), "offline");
        // The verifier itself never goes in the address.
        assert!(!url.contains(&p.verifier));
    }

    #[test]
    fn exchanges_the_code_with_the_verifier() {
        let r = client().exchange("4/0Ab", "verif", "http://127.0.0.1:51234");
        assert_eq!(r.url, TOKEN_URL);
        assert_eq!(
            r.header("content-type"),
            Some("application/x-www-form-urlencoded")
        );
        let body = crate::parse_query(&r.body_text());
        let get = |k: &str| body.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());
        assert_eq!(get("grant_type"), Some("authorization_code"));
        assert_eq!(get("code"), Some("4/0Ab"));
        assert_eq!(get("code_verifier"), Some("verif"));
        assert_eq!(get("client_secret"), Some("GOCSPX-abc"));
        let no_secret = GoogleClient {
            client_secret: None,
            ..client()
        };
        assert!(!no_secret
            .refresh("1//r")
            .body_text()
            .contains("client_secret"));
    }

    #[test]
    fn reads_tokens_and_errors() {
        let ok = Response::new(200, include_str!("../tests/fixtures/google_token.json"));
        let t = parse_tokens(&ok).unwrap();
        assert_eq!(t.access_token, "ya29.a0-test-access");
        assert_eq!(t.expires_in, 3599);
        assert_eq!(t.refresh_token.as_deref(), Some("1//0g-test-refresh"));
        let bad = Response::new(
            400,
            r#"{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"#,
        );
        let e = parse_tokens(&bad).unwrap_err();
        assert!(e.reconnect);
        assert!(e.message.contains("Connect the YouTube account again"));
        let secret = Response::new(
            400,
            r#"{"error":"invalid_request","error_description":"client_secret is missing."}"#,
        );
        assert!(parse_tokens(&secret)
            .unwrap_err()
            .message
            .contains("LUMORA_YT_CLIENT_SECRET"));
    }

    #[test]
    fn refreshes_only_when_the_token_runs_out() {
        let http = Fake(
            RefCell::new(vec![
                Response::new(200, r#"{"access_token":"A1","expires_in":3600}"#),
                Response::new(
                    200,
                    r#"{"access_token":"A2","expires_in":3600,"refresh_token":"R2"}"#,
                ),
            ]),
            RefCell::new(Vec::new()),
        );
        let mut k = TokenKeeper::new(client(), "R1".into());
        assert!(!k.fresh_at(1000));
        assert_eq!(k.access(&http, 1000).unwrap(), "A1");
        // Still good: no new request.
        assert_eq!(k.access(&http, 1000 + 3000).unwrap(), "A1");
        assert_eq!(http.1.borrow().len(), 1);
        // Within a minute of the end: refreshed, and the new refresh token kept.
        assert_eq!(k.access(&http, 1000 + 3550).unwrap(), "A2");
        assert_eq!(k.refresh_token(), "R2");
        assert!(k.take_rotated());
        assert!(!k.take_rotated());
        let sent = http.1.borrow();
        assert!(sent[1].body_text().contains("refresh_token=R1"));
    }

    #[test]
    fn a_refused_token_is_refreshed_and_an_expired_refresh_asks_to_reconnect() {
        let http = Fake(
            RefCell::new(vec![
                Response::new(200, r#"{"access_token":"A1","expires_in":3600}"#),
                Response::new(400, r#"{"error":"invalid_grant"}"#),
            ]),
            RefCell::new(Vec::new()),
        );
        let mut k = TokenKeeper::new(client(), "R1".into());
        k.access(&http, 0).unwrap();
        k.forget_access();
        assert!(k.access(&http, 10).unwrap_err().reconnect);
        // No internet: says so, and doesn't ask to reconnect.
        let e = k.access(&http, 20).unwrap_err();
        assert!(!e.reconnect);
        assert!(e.message.contains("couldn’t reach Google"));
    }
}
