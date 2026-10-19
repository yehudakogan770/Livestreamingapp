//! "Computer sound" inputs: the sound this computer plays — everything
//! except Lumora's own, or one program's (Spotify, a browser, Zoom) — taken
//! by Windows (`live_engine::loopback`) and served like a stream input's
//! sound (`browser::Sounds`, the frame server's `/audio/<id>`), so the
//! control window's sound engine mixes it like any other input.
//!
//! They are sound inputs ("microphones" in the show) whose device is
//! `lumora:computer` or `lumora:app:<program file>`, so the mixer, buses,
//! filters, triggers, captions and each input's own recording all work as
//! for a microphone. A program that isn't running is waited for; one that
//! started again (a new process) is followed.

use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use live_engine::loopback::{self, Loopback, Sink, Target};
use lumora_engine::{Show, SourceKind};
use serde::Serialize;

use crate::browser::Sounds;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Everything this computer plays (except Lumora).
pub const EVERYTHING: &str = "lumora:computer";
/// One program: followed by its file name.
pub const PROGRAM: &str = "lumora:app:";

/// Whose sound an input takes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Want {
    Everything,
    /// A program, by its file name (lower case).
    Program(String),
}

/// What a sound input's device means, if it is the computer's sound.
pub fn parse(device_id: &str) -> Option<Want> {
    if device_id == EVERYTHING {
        return Some(Want::Everything);
    }
    let exe = device_id.strip_prefix(PROGRAM)?.trim().to_lowercase();
    (!exe.is_empty() && !exe.contains(['/', '\\'])).then_some(Want::Program(exe))
}

/// How each computer sound input is doing (for the control window).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundStatus {
    pub id: String,
    /// "on", "waiting" (the program isn't running) or "failed".
    pub state: &'static str,
    pub detail: Option<String>,
}

/// Starts a capture (Windows' own, or a stand-in in tests).
pub type Starter = Arc<dyn Fn(Target, Sink) -> Result<Running, String> + Send + Sync>;
/// Finds a program's process by its file name.
pub type Finder = Arc<dyn Fn(&str) -> Option<u32> + Send + Sync>;

/// A capture that is running.
pub trait Capture: Send {
    fn finished(&self) -> bool;
    fn error(&self) -> Option<String>;
}

pub type Running = Box<dyn Capture>;

impl Capture for Loopback {
    fn finished(&self) -> bool {
        Loopback::finished(self)
    }
    fn error(&self) -> Option<String> {
        Loopback::error(self)
    }
}

pub struct ComputerSound {
    tx: Mutex<Sender<Show>>,
    status: Arc<Mutex<Vec<SoundStatus>>>,
}

impl ComputerSound {
    /// Taking the sound with Windows.
    pub fn new(sounds: Arc<Sounds>) -> ComputerSound {
        let start: Starter =
            Arc::new(|target, sink| loopback::start(target, sink).map(|l| Box::new(l) as Running));
        let find: Finder = Arc::new(loopback::find_program);
        Self::with(sounds, start, find, Duration::from_secs(3))
    }

    pub fn with(
        sounds: Arc<Sounds>,
        start: Starter,
        find: Finder,
        every: Duration,
    ) -> ComputerSound {
        let (tx, rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(Vec::new()));
        let st = Arc::clone(&status);
        thread::Builder::new()
            .name("lumora-computer-sound".into())
            .spawn(move || manage(&rx, &sounds, &start, &find, &st, every))
            .expect("start the computer sound thread");
        ComputerSound {
            tx: Mutex::new(tx),
            status,
        }
    }

    /// The show changed: start or stop taking sound to match.
    pub fn sync(&self, show: &Show) {
        let _ = lock(&self.tx).send(show.clone());
    }

    pub fn status(&self) -> Vec<SoundStatus> {
        lock(&self.status).clone()
    }
}

/// The computer sound inputs in a show.
fn wanted(show: &Show) -> HashMap<String, Want> {
    show.sources
        .iter()
        .filter_map(|s| match &s.kind {
            SourceKind::Microphone { device_id, .. } => {
                parse(device_id).map(|w| (s.id.as_str().to_owned(), w))
            }
            _ => None,
        })
        .collect()
}

struct Taking {
    want: Want,
    target: Target,
    capture: Running,
}

fn manage(
    rx: &Receiver<Show>,
    sounds: &Arc<Sounds>,
    start: &Starter,
    find: &Finder,
    status: &Mutex<Vec<SoundStatus>>,
    every: Duration,
) {
    let me = std::process::id();
    let mut want: HashMap<String, Want> = HashMap::new();
    let mut running: HashMap<String, Taking> = HashMap::new();
    // Why each input that isn't running isn't.
    let mut why: HashMap<String, (&'static str, String)> = HashMap::new();
    loop {
        match rx.recv_timeout(every) {
            Ok(mut show) => {
                while let Ok(newer) = rx.try_recv() {
                    show = newer;
                }
                want = wanted(&show);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        why.retain(|id, _| want.contains_key(id));
        // What each input should take now (a program is found again each time: it may have restarted).
        let targets: HashMap<String, Option<Target>> = want
            .iter()
            .map(|(id, w)| {
                let t = match w {
                    Want::Everything => Some(Target::Everything { except: me }),
                    Want::Program(exe) => find(exe).map(|pid| Target::Program { pid }),
                };
                (id.clone(), t)
            })
            .collect();
        running.retain(|id, t| {
            let keep = want.get(id) == Some(&t.want)
                && targets.get(id).copied().flatten() == Some(t.target)
                && !t.capture.finished();
            if !keep && t.capture.finished() {
                if let Some(e) = t.capture.error() {
                    why.insert(id.clone(), ("failed", e));
                }
            }
            keep
        });
        for (id, w) in &want {
            if running.contains_key(id) {
                continue;
            }
            let Some(target) = targets.get(id).copied().flatten() else {
                let Want::Program(exe) = w else { continue };
                why.insert(
                    id.clone(),
                    (
                        "waiting",
                        format!(
                            "{} isn't running; its sound comes in once it starts.",
                            loopback::nice_name(exe)
                        ),
                    ),
                );
                continue;
            };
            let to = Arc::clone(sounds);
            let key = id.clone();
            let sink: Sink = Box::new(move |pcm| to.put(&key, pcm.to_vec()));
            match start(target, sink) {
                Ok(capture) => {
                    why.remove(id);
                    running.insert(
                        id.clone(),
                        Taking {
                            want: w.clone(),
                            target,
                            capture,
                        },
                    );
                }
                Err(e) => {
                    why.insert(id.clone(), ("failed", e));
                }
            }
        }
        let mut list: Vec<SoundStatus> = want
            .keys()
            .map(|id| match (running.contains_key(id), why.get(id)) {
                (true, _) => SoundStatus {
                    id: id.clone(),
                    state: "on",
                    detail: None,
                },
                (false, Some((state, detail))) => SoundStatus {
                    id: id.clone(),
                    state,
                    detail: Some(detail.clone()),
                },
                (false, None) => SoundStatus {
                    id: id.clone(),
                    state: "waiting",
                    detail: None,
                },
            })
            .collect();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        *lock(status) = list;
    }
}

/// What "Add input → This computer's sound" offers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerSoundChoices {
    /// This computer can take its own sound (Windows).
    pub available: bool,
    /// The programs playing sound now.
    pub programs: Vec<ProgramChoice>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramChoice {
    /// The device to keep in the show (`lumora:app:spotify.exe`).
    pub device_id: String,
    pub name: String,
}

pub fn choices() -> ComputerSoundChoices {
    ComputerSoundChoices {
        available: loopback::available(),
        programs: loopback::programs()
            .into_iter()
            .map(|p| ProgramChoice {
                device_id: format!("{PROGRAM}{}", p.exe),
                name: p.name,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

    #[test]
    fn devices_say_whose_sound() {
        assert_eq!(parse("lumora:computer"), Some(Want::Everything));
        assert_eq!(
            parse("lumora:app:Spotify.exe"),
            Some(Want::Program("spotify.exe".into()))
        );
        assert_eq!(parse("lumora:app:"), None);
        assert_eq!(parse("lumora:app:..\\x.exe"), None);
        assert_eq!(parse("default"), None);
    }

    struct Fake {
        ended: Arc<AtomicBool>,
    }
    impl Capture for Fake {
        fn finished(&self) -> bool {
            self.ended.load(Ordering::SeqCst)
        }
        fn error(&self) -> Option<String> {
            Some("the speakers were unplugged".into())
        }
    }

    fn show_with(device: &str) -> Show {
        let mut engine = lumora_engine::Engine::new();
        engine
            .apply(
                lumora_engine::Action::AddSource {
                    source: serde_json::from_value(serde_json::json!({
                        "id": "pc", "name": "Computer sound",
                        "kind": {"type": "microphone", "deviceId": device, "label": "This computer's sound"}
                    }))
                    .unwrap(),
                },
                1,
            )
            .unwrap();
        engine.show().clone()
    }

    fn wait_for(cs: &ComputerSound, state: &str) -> SoundStatus {
        for _ in 0..200 {
            if let Some(s) = cs.status().into_iter().find(|s| s.state == state) {
                return s;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("never {state}: {:?}", cs.status());
    }

    #[test]
    fn sound_is_taken_and_handed_on_while_the_input_exists() {
        let sounds = Arc::new(Sounds::default());
        let ears = sounds.listen("pc");
        let started = Arc::new(Mutex::new(Vec::new()));
        let s2 = Arc::clone(&started);
        let start: Starter = Arc::new(move |target, mut sink| {
            lock(&s2).push(target);
            sink(&[1, 2, 3, 4]);
            Ok(Box::new(Fake {
                ended: Arc::new(AtomicBool::new(false)),
            }) as Running)
        });
        let cs = ComputerSound::with(sounds, start, Arc::new(|_| None), Duration::from_millis(20));
        cs.sync(&show_with(EVERYTHING));
        wait_for(&cs, "on");
        assert_eq!(
            *lock(&started),
            [Target::Everything {
                except: std::process::id()
            }]
        );
        assert_eq!(
            *ears.recv_timeout(Duration::from_secs(1)).unwrap(),
            vec![1, 2, 3, 4]
        );
        cs.sync(&Show::default());
        for _ in 0..200 {
            if cs.status().is_empty() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert!(cs.status().is_empty());
    }

    #[test]
    fn a_program_is_waited_for_and_followed_when_it_starts_again() {
        let pid = Arc::new(AtomicU32::new(0));
        let p2 = Arc::clone(&pid);
        let find: Finder = Arc::new(move |exe| {
            assert_eq!(exe, "spotify.exe");
            Some(p2.load(Ordering::SeqCst)).filter(|&p| p != 0)
        });
        let started = Arc::new(Mutex::new(Vec::new()));
        let s2 = Arc::clone(&started);
        let start: Starter = Arc::new(move |target, _| {
            lock(&s2).push(target);
            Ok(Box::new(Fake {
                ended: Arc::new(AtomicBool::new(false)),
            }) as Running)
        });
        let cs = ComputerSound::with(
            Arc::new(Sounds::default()),
            start,
            find,
            Duration::from_millis(20),
        );
        cs.sync(&show_with("lumora:app:spotify.exe"));
        let waiting = wait_for(&cs, "waiting");
        assert!(waiting.detail.unwrap().starts_with("Spotify isn't running"));
        pid.store(40, Ordering::SeqCst);
        wait_for(&cs, "on");
        pid.store(77, Ordering::SeqCst);
        for _ in 0..200 {
            if lock(&started).len() == 2 {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            *lock(&started),
            [Target::Program { pid: 40 }, Target::Program { pid: 77 }]
        );
    }

    #[test]
    fn a_capture_that_stops_says_why_and_is_started_again() {
        let ended = Arc::new(AtomicBool::new(false));
        let e2 = Arc::clone(&ended);
        let count = Arc::new(AtomicU32::new(0));
        let c2 = Arc::clone(&count);
        let start: Starter = Arc::new(move |_, _| {
            if c2.fetch_add(1, Ordering::SeqCst) == 1 {
                return Err("Windows did not start taking the sound".into());
            }
            Ok(Box::new(Fake {
                ended: Arc::clone(&e2),
            }) as Running)
        });
        let cs = ComputerSound::with(
            Arc::new(Sounds::default()),
            start,
            Arc::new(|_| None),
            Duration::from_millis(20),
        );
        cs.sync(&show_with(EVERYTHING));
        wait_for(&cs, "on");
        ended.store(true, Ordering::SeqCst);
        let failed = wait_for(&cs, "failed");
        assert!(failed.detail.is_some());
        ended.store(false, Ordering::SeqCst);
        wait_for(&cs, "on");
        assert!(count.load(Ordering::SeqCst) >= 3);
    }
}
