//! Keeps the show safe on disk.
//!
//! - Writes happen on a background thread, so saving never slows the engine.
//! - Bursts of changes are coalesced: only the newest show is written.
//! - Each write goes to a temporary file first and is then renamed over the
//!   real one, so a crash or power cut mid-write can never corrupt the save.
//! - The previous good save is kept as a backup and used if the main file is
//!   ever unreadable.
//! - When the event has its own file (Save event as…), that file is kept up
//!   to date too, the same safe way. The app's own copy is always written,
//!   so crash recovery works whether or not the event was saved anywhere.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use lumora_engine::persist::{load_json, save_json};
use lumora_engine::Show;

const FILE: &str = "show.json";
const BACKUP: &str = "show.backup.json";
const TEMP: &str = "show.json.tmp";

/// Where the show was loaded from, for the log and the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadedFrom {
    Main,
    Backup,
    Fresh,
}

enum Msg {
    Save(Box<Show>),
    /// Also keep this event file up to date (or stop).
    Target(Option<PathBuf>),
}

pub struct Store {
    tx: Sender<Msg>,
}

impl Store {
    /// Load the saved show (or start fresh) and start the background writer.
    pub fn open(dir: PathBuf) -> (Store, Show, LoadedFrom) {
        let _ = fs::create_dir_all(&dir);
        let (show, from) = load(&dir);
        let (tx, rx) = mpsc::channel();
        thread::Builder::new()
            .name("lumora-store".into())
            .spawn(move || writer(&dir, &rx))
            .expect("start the save thread");
        (Store { tx }, show, from)
    }

    /// Ask for the show to be saved. Returns immediately.
    pub fn save(&self, show: Show) {
        let _ = self.tx.send(Msg::Save(Box::new(show)));
    }

    /// Keep an event file up to date from now on (`None`: only the app's copy).
    pub fn set_target(&self, path: Option<PathBuf>) {
        let _ = self.tx.send(Msg::Target(path));
    }
}

fn load(dir: &Path) -> (Show, LoadedFrom) {
    for (name, from) in [(FILE, LoadedFrom::Main), (BACKUP, LoadedFrom::Backup)] {
        if let Ok(text) = fs::read_to_string(dir.join(name)) {
            match load_json(&text) {
                Ok(show) => return (show, from),
                Err(e) => eprintln!("lumora: {name} could not be loaded: {e}"),
            }
        }
    }
    (Show::default(), LoadedFrom::Fresh)
}

fn writer(dir: &Path, rx: &Receiver<Msg>) {
    let mut target: Option<PathBuf> = None;
    while let Ok(msg) = rx.recv() {
        let mut latest = None;
        let mut apply = |m: Msg, latest: &mut Option<Show>| match m {
            Msg::Save(show) => *latest = Some(*show),
            Msg::Target(t) => target = t,
        };
        apply(msg, &mut latest);
        // Coalesce: skip straight to the newest queued show.
        while let Ok(m) = rx.try_recv() {
            apply(m, &mut latest);
        }
        let Some(show) = latest else { continue };
        let text = save_json(&show);
        if let Err(e) = write_atomic(dir, &text) {
            eprintln!("lumora: saving the show failed: {e}");
        }
        if let Some(path) = &target {
            if let Err(e) = write_file_atomic(path, &text) {
                eprintln!("lumora: saving the event file failed: {e}");
            }
        }
    }
}

/// Write any file safely: temporary file first, then rename over it.
pub fn write_file_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    let temp = PathBuf::from(temp);
    {
        let mut f = fs::File::create(&temp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&temp, path)
}

fn write_atomic(dir: &Path, text: &str) -> std::io::Result<()> {
    let main = dir.join(FILE);
    let temp = dir.join(TEMP);
    {
        let mut f = fs::File::create(&temp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
    }
    if main.exists() {
        // Keep the last good save as the backup.
        let _ = fs::copy(&main, dir.join(BACKUP));
    }
    fs::rename(&temp, &main)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lumora_engine::{Action, Engine, NewSource, SourceKind};
    use std::time::{Duration, Instant};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lumora-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn wait_for(path: &Path, contains: &str) {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            if fs::read_to_string(path).is_ok_and(|t| t.contains(contains)) {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("{} never contained {contains}", path.display());
    }

    fn show_with(name: &str) -> Show {
        let mut e = Engine::new();
        let source = NewSource {
            id: None,
            name: name.into(),
            kind: SourceKind::Pattern,
            volume: None,
            muted: None,
            looping: None,
            fit: None,
            audio: None,
            key: None,
        };
        e.apply(Action::AddSource { source }, 0).unwrap();
        e.show().clone()
    }

    #[test]
    fn starts_fresh_then_saves_and_reloads() {
        let dir = temp_dir("roundtrip");
        let (store, show, from) = Store::open(dir.clone());
        assert_eq!(from, LoadedFrom::Fresh);
        assert_eq!(show.sources.len(), 0);

        store.save(show_with("Camera 1"));
        wait_for(&dir.join(FILE), "Camera 1");
        drop(store);

        let (_store, show, from) = Store::open(dir.clone());
        assert_eq!(from, LoadedFrom::Main);
        assert_eq!(show.sources[0].name, "Camera 1");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_corrupt_save_falls_back_to_the_backup() {
        let dir = temp_dir("backup");
        let (store, _, _) = Store::open(dir.clone());
        store.save(show_with("First"));
        wait_for(&dir.join(FILE), "First");
        store.save(show_with("Second"));
        wait_for(&dir.join(BACKUP), "First");
        drop(store);

        fs::write(dir.join(FILE), "{ this is not a show").unwrap();
        let (_store, show, from) = Store::open(dir.clone());
        assert_eq!(from, LoadedFrom::Backup);
        assert_eq!(show.sources[0].name, "First");
        let _ = fs::remove_dir_all(dir);
    }
}
