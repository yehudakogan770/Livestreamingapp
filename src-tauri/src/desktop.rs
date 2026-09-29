//! Screen capture inputs: a display or a window of this computer, captured
//! by Windows and served as live pictures like a stream input.

use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use lumora_engine::screen::{CaptureTarget, ScreenCapture};
use lumora_engine::{Show, SourceKind};

use crate::browser::capture::{self, Capture};
use crate::browser::Frames;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

pub struct Desktop {
    tx: Mutex<Sender<Show>>,
}

impl Desktop {
    pub fn new(frames: Arc<Frames>) -> Desktop {
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || manage(&rx, &frames));
        Desktop { tx: Mutex::new(tx) }
    }

    /// The show changed: start or stop captures to match.
    pub fn sync(&self, show: &Show) {
        let _ = lock(&self.tx).send(show.clone());
    }
}

fn open(id: &str, c: &ScreenCapture, frames: &Arc<Frames>) -> Option<Capture> {
    match &c.target {
        CaptureTarget::Display { index, .. } => {
            capture::start_display(*index, id, c.cursor, Arc::clone(frames))
        }
        CaptureTarget::Window { title } if !title.trim().is_empty() => {
            capture::start_window(title, id, c.cursor, Arc::clone(frames))
        }
        CaptureTarget::Window { .. } => None,
    }
}

fn manage(rx: &Receiver<Show>, frames: &Arc<Frames>) {
    let mut wanted: HashMap<String, ScreenCapture> = HashMap::new();
    let mut running: HashMap<String, (ScreenCapture, Capture)> = HashMap::new();
    loop {
        // Every couple of seconds, bring back captures whose window went away.
        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok(mut show) => {
                while let Ok(newer) = rx.try_recv() {
                    show = newer;
                }
                wanted = show
                    .sources
                    .iter()
                    .filter_map(|s| match &s.kind {
                        SourceKind::Screen(c) => Some((s.id.as_str().to_owned(), (**c).clone())),
                        _ => None,
                    })
                    .collect();
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        let ids: Vec<String> = running.keys().cloned().collect();
        for id in ids {
            let keep = running
                .get(&id)
                .is_some_and(|(c, cap)| wanted.get(&id) == Some(c) && !cap.finished());
            if !keep {
                if let Some((_, cap)) = running.remove(&id) {
                    cap.stop();
                }
                if !wanted.contains_key(&id) {
                    frames.remove(&id);
                }
            }
        }
        for (id, c) in &wanted {
            if running.contains_key(id) {
                continue;
            }
            if let Some(cap) = open(id, c, frames) {
                running.insert(id.clone(), (c.clone(), cap));
            }
        }
    }
    for (_, (_, cap)) in running {
        cap.stop();
    }
}
