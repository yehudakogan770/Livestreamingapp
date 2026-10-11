//! The sound this computer plays, for "Computer sound" inputs: everything it
//! plays except Lumora itself (so Lumora's own sound never comes back round
//! into the mix), or one program and the programs it started (a browser's
//! sound comes from its helper processes). Windows 10 version 2004 and
//! later, through WASAPI process loopback (`loopback_win.rs`); elsewhere
//! [`start`] says it can't.
//!
//! The sound comes as 48 kHz stereo 16-bit little-endian PCM — what the
//! app's frame server hands to the control window's sound engine for stream
//! inputs — in pieces of about 10 ms.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::JoinHandle;

/// Samples a second, each channel.
pub const RATE: u32 = 48_000;
/// Bytes in one stereo 16-bit frame.
pub const FRAME_BYTES: usize = 4;

/// Whose sound to take.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// Everything this computer plays except process `except` (Lumora) and the processes it started.
    Everything { except: u32 },
    /// Only process `pid` and the processes it started.
    Program { pid: u32 },
}

/// Where the sound goes: each piece as it comes (48 kHz stereo 16-bit).
pub type Sink = Box<dyn FnMut(&[u8]) + Send>;

/// A program that is playing sound now (to choose one).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Program {
    pub pid: u32,
    /// Its file, lower case ("spotify.exe").
    pub exe: String,
    /// A name to show ("Spotify").
    pub name: String,
}

/// A running capture; stops when dropped.
pub struct Loopback {
    stop: Arc<AtomicBool>,
    ended: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    thread: Option<JoinHandle<()>>,
}

impl Loopback {
    /// The capture stopped by itself (the device changed, or it failed).
    pub fn finished(&self) -> bool {
        self.ended.load(Ordering::Acquire)
    }

    /// Why it stopped, if it failed.
    pub fn error(&self) -> Option<String> {
        self.error
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn stop(mut self) {
        self.halt();
    }

    fn halt(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for Loopback {
    fn drop(&mut self) {
        self.halt();
    }
}

/// Can this computer take its own sound (Windows)?
pub const fn available() -> bool {
    cfg!(windows)
}

/// Start taking `target`'s sound into `sink`. Waits (a few seconds at most)
/// until Windows has started it, so a refusal comes back here.
///
/// # Errors
/// Why the sound can't be taken, in plain words.
pub fn start(target: Target, sink: Sink) -> Result<Loopback, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let ended = Arc::new(AtomicBool::new(false));
    let error = Arc::new(Mutex::new(None));
    let thread = run(
        target,
        sink,
        Arc::clone(&stop),
        Arc::clone(&ended),
        Arc::clone(&error),
    )?;
    Ok(Loopback {
        stop,
        ended,
        error,
        thread: Some(thread),
    })
}

#[cfg(windows)]
fn run(
    target: Target,
    sink: Sink,
    stop: Arc<AtomicBool>,
    ended: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
) -> Result<JoinHandle<()>, String> {
    crate::loopback_win::run(target, sink, stop, ended, error)
}

#[cfg(not(windows))]
fn run(
    _target: Target,
    _sink: Sink,
    _stop: Arc<AtomicBool>,
    _ended: Arc<AtomicBool>,
    _error: Arc<Mutex<Option<String>>>,
) -> Result<JoinHandle<()>, String> {
    Err(NOT_HERE.to_owned())
}

#[cfg(not(windows))]
const NOT_HERE: &str = "Taking this computer's sound works on Windows.";

/// The programs playing sound now (not Lumora), one entry per program.
pub fn programs() -> Vec<Program> {
    #[cfg(windows)]
    {
        let own = std::process::id();
        let mut list = crate::loopback_win::sessions();
        list.retain(|p| p.pid != own && p.pid != 0);
        tidy(list)
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// The process to take a program's sound from: the first of the running
/// processes with that file name whose parent isn't one of them (the root of
/// its tree, which brings its helpers' sound too). None if it isn't running.
pub fn find_program(exe: &str) -> Option<u32> {
    #[cfg(windows)]
    {
        root_process(&crate::loopback_win::processes(), exe)
    }
    #[cfg(not(windows))]
    {
        let _ = exe;
        None
    }
}

/// See [`find_program`]: `processes` are (pid, parent pid, file name).
pub fn root_process(processes: &[(u32, u32, String)], exe: &str) -> Option<u32> {
    let exe = exe.to_lowercase();
    let same: Vec<&(u32, u32, String)> = processes
        .iter()
        .filter(|(_, _, e)| e.to_lowercase() == exe)
        .collect();
    same.iter()
        .find(|(_, parent, _)| !same.iter().any(|(pid, _, _)| pid == parent))
        .or_else(|| same.first())
        .map(|(pid, _, _)| *pid)
}

/// One entry per program file, named nicely, sorted by name.
pub fn tidy(list: Vec<Program>) -> Vec<Program> {
    let mut out: Vec<Program> = Vec::new();
    for mut p in list {
        p.exe = p.exe.to_lowercase();
        if p.exe.is_empty() || out.iter().any(|o| o.exe == p.exe) {
            continue;
        }
        if p.name.trim().is_empty() || p.name.starts_with('@') {
            p.name = nice_name(&p.exe);
        }
        out.push(p);
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    out
}

/// "spotify.exe" → "Spotify", "msedge.exe" → "Msedge".
pub fn nice_name(exe: &str) -> String {
    let stem = exe
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(exe)
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE");
    let mut c = stem.chars();
    c.next().map_or_else(String::new, |f| {
        f.to_uppercase().collect::<String>() + c.as_str()
    })
}

/// 16-bit samples from 32-bit float ones (clipped), little-endian.
pub fn float_to_pcm16(samples: &[f32], out: &mut Vec<u8>) {
    out.reserve(samples.len() * 2);
    for &s in samples {
        #[allow(clippy::cast_possible_truncation)]
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_program_is_taken_from_the_root_of_its_tree() {
        let ps = vec![
            (40, 30, "chrome.exe".to_owned()),
            (30, 4, "Chrome.exe".to_owned()),
            (41, 30, "chrome.exe".to_owned()),
            (50, 4, "spotify.exe".to_owned()),
        ];
        assert_eq!(root_process(&ps, "CHROME.EXE"), Some(30));
        assert_eq!(root_process(&ps, "spotify.exe"), Some(50));
        assert_eq!(root_process(&ps, "zoom.exe"), None);
    }

    #[test]
    fn programs_are_listed_once_with_a_name() {
        let p = |pid, exe: &str, name: &str| Program {
            pid,
            exe: exe.to_owned(),
            name: name.to_owned(),
        };
        let list = tidy(vec![
            p(1, "Spotify.exe", ""),
            p(2, "chrome.exe", "@%SystemRoot%\\x.dll"),
            p(3, "spotify.exe", "Spotify"),
            p(4, "", "nothing"),
        ]);
        assert_eq!(
            list,
            vec![p(2, "chrome.exe", "Chrome"), p(1, "spotify.exe", "Spotify")]
        );
        assert_eq!(nice_name("C:\\Apps\\zoom.exe"), "Zoom");
    }

    #[test]
    fn float_sound_becomes_16_bit() {
        let mut out = Vec::new();
        float_to_pcm16(&[0.0, 1.0, -1.0, 2.0], &mut out);
        assert_eq!(out, [0, 0, 0xff, 0x7f, 0x01, 0x80, 0xff, 0x7f]);
    }

    #[cfg(not(windows))]
    #[test]
    fn elsewhere_it_says_it_cannot() {
        assert!(!available());
        assert!(start(Target::Everything { except: 1 }, Box::new(|_| {})).is_err());
        assert!(programs().is_empty());
        assert_eq!(find_program("spotify.exe"), None);
    }
}
