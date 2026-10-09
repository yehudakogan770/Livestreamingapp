//! Requests as data, the transport the app provides, and plain-words errors.

use std::fmt;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Head,
    Delete,
}

impl Method {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
            Method::Put => "PUT",
            Method::Patch => "PATCH",
            Method::Head => "HEAD",
            Method::Delete => "DELETE",
        }
    }
}

/// One HTTP request, built here and sent by the app.
#[derive(Clone, PartialEq, Eq)]
pub struct Request {
    pub method: Method,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// Never shows tokens: the authorization header and the body (which may hold a
/// code, a refresh token or a stream key) are left out.
impl fmt::Debug for Request {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let url = self.url.split('?').next().unwrap_or_default();
        f.debug_struct("Request")
            .field("method", &self.method)
            .field("url", &url)
            .field("body_bytes", &self.body.len())
            .finish_non_exhaustive()
    }
}

impl Request {
    #[must_use]
    pub fn get(url: impl Into<String>) -> Self {
        Request {
            method: Method::Get,
            url: url.into(),
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    /// A POST with a form body (`a=1&b=2`).
    #[must_use]
    pub fn post_form(url: impl Into<String>, pairs: &[(&str, &str)]) -> Self {
        Request {
            method: Method::Post,
            url: url.into(),
            headers: vec![(
                "Content-Type".to_owned(),
                "application/x-www-form-urlencoded".to_owned(),
            )],
            body: query(pairs).into_bytes(),
        }
    }

    /// A request with a JSON body.
    #[must_use]
    pub fn json(method: Method, url: impl Into<String>, body: &Value) -> Self {
        Request {
            method,
            url: url.into(),
            headers: vec![(
                "Content-Type".to_owned(),
                "application/json; charset=utf-8".to_owned(),
            )],
            body: body.to_string().into_bytes(),
        }
    }

    /// A POST with no body.
    #[must_use]
    pub fn post(url: impl Into<String>) -> Self {
        Request {
            method: Method::Post,
            url: url.into(),
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    /// The same request, signed with an access token.
    #[must_use]
    pub fn bearer(mut self, token: &str) -> Self {
        self.headers
            .push(("Authorization".to_owned(), format!("Bearer {token}")));
        self
    }

    #[must_use]
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// The body as text (for tests and form bodies).
    #[must_use]
    pub fn body_text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    /// The body as JSON (for tests).
    #[must_use]
    pub fn body_json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    /// The query parameters of the address, decoded.
    #[must_use]
    pub fn query_pairs(&self) -> Vec<(String, String)> {
        self.url
            .split_once('?')
            .map(|(_, q)| parse_query(q))
            .unwrap_or_default()
    }

    /// One query parameter of the address.
    #[must_use]
    pub fn query_value(&self, name: &str) -> Option<String> {
        self.query_pairs()
            .into_iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v)
    }
}

/// What came back.
#[derive(Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
    /// The answer's headers, when the transport keeps them (uploads need
    /// `Location` and `Range`).
    pub headers: Vec<(String, String)>,
}

impl fmt::Debug for Response {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Response")
            .field("status", &self.status)
            .field("body_bytes", &self.body.len())
            .finish()
    }
}

impl Response {
    #[must_use]
    pub fn new(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Response {
            status,
            body: body.into(),
            headers: Vec::new(),
        }
    }

    /// The same answer with a header (for transports and tests).
    #[must_use]
    pub fn with_header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_owned(), value.to_owned()));
        self
    }

    /// One of the answer's headers (any case).
    #[must_use]
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    #[must_use]
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// The body as JSON (`Null` when it isn't JSON, or is empty).
    #[must_use]
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

/// Sends requests (the app's HTTPS client).
pub trait Http {
    /// # Errors
    /// The request never got an answer (no internet, timed out…), in words.
    fn send(&self, request: &Request) -> Result<Response, String>;
}

/// Where long-lived tokens are kept (Windows Credential Manager in the app).
pub trait Secrets {
    fn get(&self, name: &str) -> Option<String>;
    /// # Errors
    /// The credential store refused it, in words.
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    fn delete(&self, name: &str);
}

/// Something went wrong, said for the operator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountError {
    pub message: String,
    /// The account must be connected again (the sign-in expired or was removed).
    pub reconnect: bool,
}

impl AccountError {
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        AccountError {
            message: message.into(),
            reconnect: false,
        }
    }

    #[must_use]
    pub fn reconnect(message: impl Into<String>) -> Self {
        AccountError {
            message: message.into(),
            reconnect: true,
        }
    }

    /// No answer at all from the service.
    #[must_use]
    pub fn offline(service: &str, why: &str) -> Self {
        AccountError::new(format!(
            "Lumora couldn’t reach {service} ({why}). Check the internet connection and try again."
        ))
    }
}

impl fmt::Display for AccountError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AccountError {}

/// Percent-encode one part of an address or form (everything but `A-Z a-z 0-9 - . _ ~`).
#[must_use]
pub fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `a=1&b=2`, each part encoded.
#[must_use]
pub fn query(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `a=1&b=2` (or the part after `?` or `#`) into decoded pairs.
#[must_use]
pub fn parse_query(s: &str) -> Vec<(String, String)> {
    let s = s.trim_start_matches(['?', '#']);
    s.split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (decode(k), decode(v))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_and_decodes_both_ways() {
        assert_eq!(encode("a b&c=d/é"), "a%20b%26c%3Dd%2F%C3%A9");
        assert_eq!(query(&[("x", "1 2"), ("y", "a+b")]), "x=1%202&y=a%2Bb");
        assert_eq!(
            parse_query("?x=1%202&y=a%2Bb&z=c+d&empty&bad=%zz"),
            vec![
                ("x".into(), "1 2".into()),
                ("y".into(), "a+b".into()),
                ("z".into(), "c d".into()),
                ("empty".into(), String::new()),
                ("bad".into(), "%zz".into()),
            ]
        );
        assert_eq!(parse_query("#a=%"), vec![("a".into(), "%".into())]);
    }

    #[test]
    fn debug_never_shows_tokens() {
        let r = Request::post_form(
            "https://x/token?code=secret",
            &[("refresh_token", "1//secret")],
        )
        .bearer("ya29.secret");
        let shown = format!("{r:?}");
        assert!(!shown.contains("secret"), "{shown}");
        assert_eq!(r.header("authorization"), Some("Bearer ya29.secret"));
        let shown = format!("{:?}", Response::new(200, "{\"access_token\":\"secret\"}"));
        assert!(!shown.contains("secret"));
    }
}
