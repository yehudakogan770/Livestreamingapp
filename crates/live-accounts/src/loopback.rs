//! The small web server on 127.0.0.1 the browser comes back to after
//! signing in. It answers only on this computer, only for a few minutes, and
//! stops after the first real answer.

use std::io::{self, BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::parse_query;

/// What to answer a request the browser made.
pub enum Reply {
    /// The sign-in came back: show this page and stop with these values.
    Done(String),
    /// Show this page and keep waiting (e.g. the page that forwards
    /// Facebook's token from the address's `#` part).
    Page(String),
    /// Not ours (a favicon…): keep waiting.
    NotFound,
}

/// Listening on 127.0.0.1.
pub struct Loopback {
    listener: TcpListener,
    port: u16,
}

impl Loopback {
    /// Listen on `port` (0: any free port).
    ///
    /// # Errors
    /// The port is taken or listening isn't allowed.
    pub fn bind(port: u16) -> io::Result<Self> {
        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        Ok(Loopback { listener, port })
    }

    #[must_use]
    pub fn port(&self) -> u16 {
        self.port
    }

    /// `http://127.0.0.1:{port}{path}`.
    #[must_use]
    pub fn redirect_uri(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    /// Wait for the browser. `handle` gets each request's path and query and
    /// says what to answer; the first `Done` ends the wait with its query.
    ///
    /// # Errors
    /// `TimedOut` after `timeout`, `Interrupted` when `cancel` is set.
    pub fn wait(
        &self,
        timeout: Duration,
        cancel: &AtomicBool,
        mut handle: impl FnMut(&str, &[(String, String)]) -> Reply,
    ) -> io::Result<Vec<(String, String)>> {
        let until = Instant::now() + timeout;
        loop {
            if cancel.load(Ordering::SeqCst) {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "canceled"));
            }
            if Instant::now() >= until {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "timed out"));
            }
            match self.listener.accept() {
                Ok((stream, _)) => {
                    if let Some(done) = serve(stream, &mut handle) {
                        return Ok(done);
                    }
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(e) => return Err(e),
            }
        }
    }
}

fn serve(
    stream: TcpStream,
    handle: &mut impl FnMut(&str, &[(String, String)]) -> Reply,
) -> Option<Vec<(String, String)>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut reader = BufReader::new(&stream);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    // Read the rest of the headers (and ignore them).
    loop {
        let mut h = String::new();
        match reader.read_line(&mut h) {
            Ok(0) | Err(_) => break,
            Ok(_) if h.trim().is_empty() => break,
            Ok(_) => {}
        }
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    let (path, q) = target.split_once('?').unwrap_or((target, ""));
    let params = parse_query(q);
    let reply = if method == "GET" {
        handle(path, &params)
    } else {
        Reply::NotFound
    };
    let (status, body, done) = match reply {
        Reply::Done(page) => ("200 OK", page, true),
        Reply::Page(page) => ("200 OK", page, false),
        Reply::NotFound => ("404 Not Found", String::from("Not found"), false),
    };
    let mut out = &stream;
    let _ = write!(
        out,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = out.flush();
    done.then_some(params)
}

/// The page shown in the browser at the end (it can be closed).
#[must_use]
pub fn finished_page(title: &str, words: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Lumora</title>\
         <style>body{{font:16px system-ui,sans-serif;background:#1d2024;color:#e8eaed;display:grid;\
         place-items:center;height:100vh;margin:0}}main{{max-width:28rem;text-align:center}}\
         h1{{font-size:1.4rem}}</style></head><body><main><h1>{}</h1><p>{}</p></main></body></html>",
        html(title),
        html(words)
    )
}

/// A page that sends the `#` part of its own address (where Facebook puts the
/// token) back to this server as a query, at `to`.
#[must_use]
pub fn forward_fragment_page(to: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Lumora</title></head>\
         <body style=\"font:16px system-ui,sans-serif;background:#1d2024;color:#e8eaed\">\
         <p>Finishing…</p><script>location.replace({:?} + '?' + location.hash.slice(1));</script>\
         </body></html>",
        to
    )
}

fn html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::sync::Arc;

    fn get(port: u16, target: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn hands_back_the_code_from_the_browser() {
        let lb = Loopback::bind(0).unwrap();
        let port = lb.port();
        assert!(port > 0);
        assert_eq!(lb.redirect_uri(""), format!("http://127.0.0.1:{port}"));
        let browser = std::thread::spawn(move || {
            let icon = get(port, "/favicon.ico");
            let page = get(port, "/?state=s1&code=4%2F0Ab&scope=x");
            (icon, page)
        });
        let cancel = AtomicBool::new(false);
        let got = lb
            .wait(Duration::from_secs(10), &cancel, |path, q| {
                if path == "/" && q.iter().any(|(k, _)| k == "code") {
                    Reply::Done(finished_page(
                        "Connected",
                        "You can close this tab & go back.",
                    ))
                } else {
                    Reply::NotFound
                }
            })
            .unwrap();
        assert!(got.contains(&("code".to_owned(), "4/0Ab".to_owned())));
        let (icon, page) = browser.join().unwrap();
        assert!(icon.starts_with("HTTP/1.1 404"));
        assert!(page.starts_with("HTTP/1.1 200"));
        assert!(page.contains("close this tab &amp; go back"));
    }

    #[test]
    fn gives_up_when_canceled_or_too_late() {
        let lb = Loopback::bind(0).unwrap();
        let cancel = Arc::new(AtomicBool::new(true));
        let e = lb
            .wait(Duration::from_secs(10), &cancel, |_, _| Reply::NotFound)
            .unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::Interrupted);
        cancel.store(false, Ordering::SeqCst);
        let e = lb
            .wait(Duration::from_millis(120), &cancel, |_, _| Reply::NotFound)
            .unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn the_forwarding_page_sends_the_fragment_as_a_query() {
        let p = forward_fragment_page("/facebook/done");
        assert!(p.contains("location.replace(\"/facebook/done\" + '?' + location.hash.slice(1))"));
    }
}
