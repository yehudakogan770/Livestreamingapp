//! Crash notes for Lumora and Lumora Studio.
//!
//! When the program panics, the hook installed by [`install`] writes a short
//! note (what went wrong, where in Lumora's code, which thread, the version)
//! into `<app data>/crash-reports/`, then lets the usual panic handling carry
//! on. Folders in the message are taken out (a path becomes its file name), so
//! no user names or project folders are kept. Next time the screens ask for
//! them ([`take`]) and send them only if the person agreed to error reports;
//! otherwise they are dropped. Nothing here talks to the internet.

use serde::{Deserialize, Serialize};
use std::any::Any;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

/// One crash, as the screens receive it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrashReport {
    /// What the panic said (cleaned, at most [`MAX_MESSAGE`] characters).
    pub message: String,
    /// Where in Lumora's code: `file.rs:line:column` (the file name only).
    pub location: String,
    /// The thread's name (`main`, or `unnamed`).
    pub thread: String,
    /// The program's version.
    pub version: String,
    /// When, in milliseconds since 1970.
    pub at: u64,
}

/// The longest message kept.
pub const MAX_MESSAGE: usize = 1000;
/// At most this many notes wait at once (the oldest go).
pub const MAX_KEPT: usize = 20;
const FOLDER: &str = "crash-reports";

/// The text a panic was raised with (`panic!("…")` gives a `&str` or a `String`).
pub fn payload_text(payload: &(dyn Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "(no message)".to_string()
    }
}

/// The last part of a path (`C:\Users\Ann\a.mp4` → `a.mp4`).
fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\'])
        .find(|p| !p.is_empty())
        .unwrap_or("")
}

fn is_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '"' | '\'' | '<' | '>' | '|' | '`')
}

/// Where a path starts at byte `i` of `s`: a drive (`C:\`, `C:/`), a share
/// (`\\server`), or a `/` at the start of a word with more path after it.
fn path_starts(s: &str, i: usize) -> bool {
    let rest = &s[i..];
    let before = s[..i].chars().next_back();
    let word_start =
        before.is_none_or(|c| c.is_whitespace() || matches!(c, '"' | '\'' | '(' | '[' | '=' | ','));
    // Drives and shares are paths wherever they are (`error:C:\…`), unless
    // they are the end of a longer word.
    let not_in_word = before.is_none_or(|c| !c.is_alphanumeric());
    let b = rest.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
    {
        return not_in_word;
    }
    if rest.starts_with("\\\\") {
        return not_in_word;
    }
    if rest.starts_with('/') || rest.starts_with("~/") {
        let tail = rest.trim_start_matches('~').trim_start_matches('/');
        let first_end = tail
            .find(|c: char| c.is_whitespace() || is_terminator(c))
            .unwrap_or(tail.len());
        return word_start && tail[..first_end].contains('/');
    }
    false
}

/// Takes the folders out of every path in `text`, keeping file names.
/// Spaces in folder names are fine (`C:\Users\Ann Lee\x.mp4` → `x.mp4`); in
/// doubt, more is taken out rather than less.
pub fn clean_paths(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        if path_starts(text, i) {
            let end = text[i..].find(is_terminator).map_or(text.len(), |e| i + e);
            if let Some(last_sep) = text[i..end].rfind(['/', '\\']) {
                let name_start = i + last_sep + 1;
                // The file name runs to the next space or terminator.
                let name_end = text[name_start..end]
                    .find(char::is_whitespace)
                    .map_or(end, |e| name_start + e);
                let name = &text[name_start..name_end];
                out.push_str(if name.is_empty() { "<folder>" } else { name });
                i = name_end;
                continue;
            }
        }
        let c = text[i..].chars().next().unwrap_or(' ');
        out.push(c);
        i += c.len_utf8();
    }
    out
}

fn cut(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut s: String = text.chars().take(max.saturating_sub(1)).collect();
    s.push('…');
    s
}

/// The note for one panic, cleaned.
pub fn format_report(
    message: &str,
    location: Option<(&str, u32, u32)>,
    thread: Option<&str>,
    version: &str,
    at: u64,
) -> CrashReport {
    CrashReport {
        message: cut(&clean_paths(message), MAX_MESSAGE),
        location: location.map_or_else(
            || "unknown".to_string(),
            |(file, line, col)| format!("{}:{line}:{col}", file_name(file)),
        ),
        thread: thread.unwrap_or("unnamed").to_string(),
        version: version.to_string(),
        at,
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// Writes a note into `dir/crash-reports/` (keeping at most [`MAX_KEPT`]).
///
/// # Errors
/// The folder or file can't be written.
pub fn write(dir: &Path, report: &CrashReport) -> std::io::Result<PathBuf> {
    static COUNT: AtomicU32 = AtomicU32::new(0);
    let folder = dir.join(FOLDER);
    fs::create_dir_all(&folder)?;
    let n = COUNT.fetch_add(1, Ordering::Relaxed);
    let path = folder.join(format!("{:015}-{}-{n}.json", report.at, std::process::id()));
    fs::write(
        &path,
        serde_json::to_vec(report).map_err(std::io::Error::other)?,
    )?;
    let mut all = notes(&folder);
    if all.len() > MAX_KEPT {
        all.sort();
        for old in &all[..all.len() - MAX_KEPT] {
            let _ = fs::remove_file(old);
        }
    }
    Ok(path)
}

fn notes(folder: &Path) -> Vec<PathBuf> {
    fs::read_dir(folder)
        .map(|r| {
            r.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "json"))
                .collect()
        })
        .unwrap_or_default()
}

/// The notes waiting in `dir` (oldest first), which are then removed.
pub fn take(dir: &Path) -> Vec<CrashReport> {
    let mut out: Vec<CrashReport> = notes(&dir.join(FOLDER))
        .into_iter()
        .filter_map(|p| {
            let report = fs::read(&p)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok());
            let _ = fs::remove_file(&p);
            report
        })
        .collect();
    out.sort_by_key(|r| r.at);
    out
}

/// From now on a panic anywhere in the program leaves a note in `dir`
/// (then the panic carries on as before: printed, and the thread unwinds).
pub fn install(dir: PathBuf, version: String) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = payload_text(info.payload());
        let location = info.location().map(|l| (l.file(), l.line(), l.column()));
        let thread = std::thread::current();
        let report = format_report(&message, location, thread.name(), &version, now_ms());
        let _ = write(&dir, &report);
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_report_names_the_file_not_the_folder() {
        let r = format_report(
            r"could not open C:\Users\Ann Lee\Videos\Gala.mp4: access denied",
            Some((r"D:\a\Livestreamingapp\src-tauri\src\capture.rs", 120, 9)),
            Some("main"),
            "0.1.200",
            42,
        );
        assert_eq!(r.message, "could not open Gala.mp4: access denied");
        assert_eq!(r.location, "capture.rs:120:9");
        assert_eq!(r.thread, "main");
        assert_eq!(r.version, "0.1.200");
        assert_eq!(r.at, 42);
        let json = serde_json::to_string(&r).unwrap();
        assert!(!json.contains("Ann") && !json.contains("Users"), "{json}");
    }

    #[test]
    fn paths_of_every_kind_are_cleaned() {
        assert_eq!(
            clean_paths("read /home/ann/show/event.lumora failed"),
            "read event.lumora failed"
        );
        assert_eq!(
            clean_paths(r#"open "\\nas\share\cam 1.mov" now"#),
            r#"open "cam 1.mov" now"#
        );
        assert_eq!(clean_paths("C:/Users/ann/Videos/"), "<folder>");
        assert_eq!(clean_paths("~/Movies/a.mp4"), "a.mp4");
        // Not paths: ratios, words with a slash, the source file of the panic.
        assert_eq!(
            clean_paths("16/9 and/or src/lib.rs:12"),
            "16/9 and/or src/lib.rs:12"
        );
        assert_eq!(clean_paths("no paths here"), "no paths here");
    }

    #[test]
    fn long_messages_are_cut_and_unknowns_named() {
        let r = format_report(&"x".repeat(5000), None, None, "1", 0);
        assert_eq!(r.message.chars().count(), MAX_MESSAGE);
        assert!(r.message.ends_with('…'));
        assert_eq!(r.location, "unknown");
        assert_eq!(r.thread, "unnamed");
    }

    #[test]
    fn payloads_are_read_as_text() {
        assert_eq!(payload_text(&"boom"), "boom");
        assert_eq!(payload_text(&String::from("bang")), "bang");
        assert_eq!(payload_text(&7_u8), "(no message)");
    }

    #[test]
    fn notes_are_written_kept_few_and_taken_once() {
        let dir = std::env::temp_dir().join(format!("lumora-crash-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        for at in 0..(MAX_KEPT as u64 + 5) {
            write(&dir, &format_report("boom", None, None, "1", 1000 + at)).unwrap();
        }
        let taken = take(&dir);
        assert_eq!(taken.len(), MAX_KEPT);
        assert_eq!(taken[0].at, 1005, "the oldest went first");
        assert!(take(&dir).is_empty(), "taken only once");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_hook_writes_a_note_when_a_thread_panics() {
        let dir = std::env::temp_dir().join(format!("lumora-crash-hook-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        install(dir.clone(), "9.9.9".into());
        let r = std::thread::Builder::new()
            .name("worker".into())
            .spawn(|| panic!("cannot read /home/ann/secret/plan.txt"))
            .unwrap()
            .join();
        assert!(r.is_err());
        let _ = std::panic::take_hook();
        let notes = take(&dir);
        assert_eq!(notes.len(), 1, "{notes:?}");
        assert_eq!(notes[0].message, "cannot read plan.txt");
        assert_eq!(notes[0].thread, "worker");
        assert_eq!(notes[0].version, "9.9.9");
        assert!(
            notes[0].location.starts_with("lib.rs:"),
            "{}",
            notes[0].location
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
