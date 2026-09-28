//! Event files: New / Open / Save as, the recent list, and which event is
//! open. The engine's show is the working copy; `store` keeps it (and the
//! event file, once there is one) safely on disk.

use std::fs;
use std::path::{Path, PathBuf};

use lumora_engine::persist::{load_json, save_json};
use lumora_engine::Show;
use serde::{Deserialize, Serialize};

use crate::store::write_file_atomic;

const FILE: &str = "events.json";
const MAX_RECENT: usize = 8;
/// Extension of event files.
pub const EXTENSION: &str = "lumora";

/// The open event's file and the recent list, remembered between starts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EventFiles {
    /// File of the open event (`None`: not saved to a file yet).
    pub current: Option<String>,
    /// Most recent first.
    pub recent: Vec<String>,
}

impl EventFiles {
    pub fn load(dir: &Path) -> EventFiles {
        fs::read_to_string(dir.join(FILE))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) {
        if let Ok(text) = serde_json::to_string_pretty(self) {
            let _ = write_file_atomic(&dir.join(FILE), &text);
        }
    }

    /// Make `path` the open event and the top of the recent list.
    pub fn opened(&mut self, path: &str) {
        self.current = Some(path.to_owned());
        self.recent.retain(|p| p != path);
        self.recent.insert(0, path.to_owned());
        self.recent.truncate(MAX_RECENT);
    }
}

/// Add `.lumora` when the name has no extension.
pub fn with_extension(path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    if p.extension().is_none() {
        p.with_extension(EXTENSION)
    } else {
        p
    }
}

/// A fresh show that keeps this computer's own settings (displays, speakers).
pub fn fresh(current: &Show) -> Show {
    Show {
        settings: current.settings.clone(),
        ..Show::default()
    }
}

/// Read an event file. This computer's own settings are kept.
pub fn read(path: &Path, current: &Show) -> Result<Show, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("could not read the file: {e}"))?;
    let mut show = load_json(&text).map_err(|e| e.to_string())?;
    show.settings = current.settings.clone();
    Ok(show)
}

/// Write the show to an event file now.
pub fn write(path: &Path, show: &Show) -> Result<(), String> {
    write_file_atomic(path, &save_json(show)).map_err(|e| format!("could not save the file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lumora_engine::{Action, Engine, EventPatch};

    #[test]
    fn recent_list_keeps_newest_first_without_repeats() {
        let mut f = EventFiles::default();
        for p in ["a", "b", "a", "c"] {
            f.opened(p);
        }
        assert_eq!(f.recent, ["c", "a", "b"]);
        assert_eq!(f.current.as_deref(), Some("c"));
        for i in 0..20 {
            f.opened(&i.to_string());
        }
        assert_eq!(f.recent.len(), MAX_RECENT);
    }

    #[test]
    fn saving_then_opening_an_event_keeps_this_computers_settings() {
        let dir = std::env::temp_dir().join(format!("lumora-events-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = with_extension(dir.join("rally").to_str().unwrap());
        assert_eq!(path.extension().unwrap(), EXTENSION);

        let mut e = Engine::new();
        e.apply(
            Action::UpdateEvent {
                patch: EventPatch {
                    name: Some("Rally".into()),
                    ..EventPatch::default()
                },
            },
            0,
        )
        .unwrap();
        write(&path, e.show()).unwrap();

        let mut here = Show::default();
        here.settings.displays.live = Some("Projector".into());
        let opened = read(&path, &here).unwrap();
        assert_eq!(opened.event.name, "Rally");
        assert_eq!(opened.settings.displays.live.as_deref(), Some("Projector"));
        assert_eq!(fresh(&opened).event.name, "");
        assert_eq!(fresh(&opened).settings, opened.settings);
        let _ = fs::remove_dir_all(&dir);
    }
}
