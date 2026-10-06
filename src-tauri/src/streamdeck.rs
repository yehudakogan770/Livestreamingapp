//! Lumora's Stream Deck buttons, shipped inside the installer.
//!
//! When the Elgato Stream Deck app is on this computer and Lumora's plugin is
//! missing (or older than the one Lumora carries), the control window offers
//! to add it, once per plugin version. Adding it opens the bundled
//! `.streamDeckPlugin` file, which the Stream Deck app installs itself.
//! People without a Stream Deck never see any of this.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::store::write_file_atomic;

/// The plugin's folder name inside Stream Deck's `Plugins` folder.
pub const PLUGIN_ID: &str = "com.lumora.streamdeck";
/// The file Lumora's installer carries (in its resources, under `streamdeck/`).
pub const PACKAGE: &str = "com.lumora.streamdeck.streamDeckPlugin";
/// What we remember: the last plugin version the offer was answered for.
const FILE: &str = "streamdeck.json";

/// Where things are on this computer (passed in, so tests use temp folders).
#[derive(Debug, Clone, Default)]
pub struct Places {
    /// `%APPDATA%`.
    pub app_data: Option<PathBuf>,
    /// `%ProgramFiles%` and `%ProgramFiles(x86)%`.
    pub program_files: Vec<PathBuf>,
    /// Lumora's resources folder (the bundled plugin lives in `streamdeck/`).
    pub resources: Option<PathBuf>,
    /// Lumora's own data folder (to remember the answer).
    pub data: Option<PathBuf>,
}

impl Places {
    /// The real places on this computer.
    pub fn here(resources: Option<PathBuf>, data: Option<PathBuf>) -> Places {
        let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
        Places {
            app_data: var("APPDATA"),
            program_files: ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
                .iter()
                .filter_map(|k| var(k))
                .collect(),
            resources,
            data,
        }
    }

    fn stream_deck_data(&self) -> Option<PathBuf> {
        self.app_data
            .as_ref()
            .map(|d| d.join("Elgato").join("StreamDeck"))
    }

    fn installed_dir(&self) -> Option<PathBuf> {
        self.stream_deck_data()
            .map(|d| d.join("Plugins").join(format!("{PLUGIN_ID}.sdPlugin")))
    }

    fn bundled_dir(&self) -> Option<PathBuf> {
        self.resources.as_ref().map(|r| r.join("streamdeck"))
    }
}

/// Is the Elgato Stream Deck app on this computer?
pub fn found(places: &Places) -> bool {
    places.stream_deck_data().is_some_and(|d| d.is_dir())
        || places.program_files.iter().any(|p| {
            p.join("Elgato")
                .join("StreamDeck")
                .join("StreamDeck.exe")
                .is_file()
        })
}

/// The `Version` in a plugin's manifest.
fn manifest_version(manifest: &Path) -> Option<String> {
    let text = std::fs::read_to_string(manifest).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v["Version"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Is version `a` newer than `b`? ("1.2.0.0" vs "1.10": numbers, not text;
/// missing parts count as 0.)
pub fn newer(a: &str, b: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> {
        v.split('.')
            .map(|p| p.trim().parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (a, b) = (parts(a), parts(b));
    let n = a.len().max(b.len());
    let at = |v: &[u64], i: usize| v.get(i).copied().unwrap_or(0);
    (0..n)
        .map(|i| at(&a, i).cmp(&at(&b, i)))
        .find(|o| o.is_ne())
        .is_some_and(std::cmp::Ordering::is_gt)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Remembered {
    /// The bundled version the offer was last answered for (added or "not now").
    answered: Option<String>,
}

fn remembered(places: &Places) -> Remembered {
    places
        .data
        .as_ref()
        .and_then(|d| std::fs::read_to_string(d.join(FILE)).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// What the control window shows about the Stream Deck.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckStatus {
    /// The Stream Deck app is on this computer.
    pub found: bool,
    /// The version of Lumora's plugin in Stream Deck, if it is there.
    pub installed: Option<String>,
    /// The version Lumora carries (none in development builds).
    pub bundled: Option<String>,
    /// The bundled plugin is newer than the installed one.
    pub update: bool,
    /// Offer it now (found, missing or older, and not yet answered for this version).
    pub offer: bool,
}

/// Look at this computer.
pub fn status(places: &Places) -> DeckStatus {
    let found = found(places);
    let installed = places
        .installed_dir()
        .and_then(|d| manifest_version(&d.join("manifest.json")));
    let bundled = places
        .bundled_dir()
        .filter(|d| d.join(PACKAGE).is_file())
        .and_then(|d| manifest_version(&d.join("manifest.json")));
    let update = matches!((&installed, &bundled), (Some(i), Some(b)) if newer(b, i));
    let wanted = bundled.is_some() && (installed.is_none() || update);
    let answered = remembered(places).answered;
    DeckStatus {
        offer: found && wanted && answered != bundled,
        found,
        installed,
        bundled,
        update,
    }
}

/// "Not now" (or added): don't offer this version again.
pub fn answer(places: &Places) -> DeckStatus {
    let now = status(places);
    if let (Some(dir), Some(v)) = (&places.data, &now.bundled) {
        let r = Remembered {
            answered: Some(v.clone()),
        };
        if let Ok(text) = serde_json::to_string_pretty(&r) {
            let _ = write_file_atomic(&dir.join(FILE), &text);
        }
    }
    status(places)
}

/// The bundled plugin file, ready to open.
pub fn package(places: &Places) -> Result<PathBuf, String> {
    places
        .bundled_dir()
        .map(|d| d.join(PACKAGE))
        .filter(|p| p.is_file())
        .ok_or_else(|| "This copy of Lumora does not carry the Stream Deck plugin.".to_owned())
}

/// Hand the plugin to the Stream Deck app (it asks, then installs it).
pub fn install(places: &Places) -> Result<DeckStatus, String> {
    let file = package(places)?;
    open(&file).map_err(|e| {
        format!(
            "The Stream Deck app could not be asked to add the plugin ({e}). Open this file to add it: {}",
            file.display()
        )
    })?;
    Ok(answer(places))
}

#[cfg(windows)]
fn open(file: &Path) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    // Explorer opens the file with its app (Stream Deck), as a double-click would.
    std::process::Command::new("explorer")
        .arg(file)
        .creation_flags(0x0800_0000)
        .spawn()
        .map(|_| ())
}

#[cfg(not(windows))]
fn open(file: &Path) -> std::io::Result<()> {
    let _ = file;
    Err(std::io::Error::other("only on Windows"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    /// A pretend computer in a temp folder.
    fn computer() -> (PathBuf, Places) {
        let root = std::env::temp_dir().join(format!(
            "lumora-deck-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&root);
        for d in ["appdata", "pf", "res", "data"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        let places = Places {
            app_data: Some(root.join("appdata")),
            program_files: vec![root.join("pf")],
            resources: Some(root.join("res")),
            data: Some(root.join("data")),
        };
        (root, places)
    }

    fn manifest(dir: &Path, version: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("manifest.json"),
            format!(r#"{{"Name":"Lumora","Version":"{version}"}}"#),
        )
        .unwrap();
    }

    fn bundle(p: &Places, version: &str) {
        let dir = p.bundled_dir().unwrap();
        manifest(&dir, version);
        std::fs::write(dir.join(PACKAGE), b"PK").unwrap();
    }

    #[test]
    fn versions_compare_as_numbers() {
        assert!(newer("1.10.0.0", "1.9.0.0"));
        assert!(newer("1.0.1", "1.0.0.9"));
        assert!(newer("2", "1.99"));
        assert!(!newer("1.0.0.0", "1.0"));
        assert!(!newer("1.0.0", "1.0.0.0"));
        assert!(!newer("0.9", "1.0"));
        assert!(newer("1.0.0.1", "garbage"));
    }

    #[test]
    fn nothing_without_a_stream_deck() {
        let (root, p) = computer();
        bundle(&p, "1.0.0.0");
        let s = status(&p);
        assert!(!s.found && !s.offer);
        assert_eq!(s.bundled.as_deref(), Some("1.0.0.0"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn finds_the_stream_deck_app_by_its_settings_or_its_program() {
        let (root, p) = computer();
        assert!(!found(&p));
        let exe = root.join("pf").join("Elgato").join("StreamDeck");
        std::fs::create_dir_all(&exe).unwrap();
        std::fs::write(exe.join("StreamDeck.exe"), b"").unwrap();
        assert!(found(&p));
        let (root2, p2) = computer();
        std::fs::create_dir_all(p2.stream_deck_data().unwrap()).unwrap();
        assert!(found(&p2));
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(root2);
    }

    #[test]
    fn offers_once_per_version_and_again_for_a_newer_one() {
        let (root, p) = computer();
        std::fs::create_dir_all(p.stream_deck_data().unwrap()).unwrap();
        // A development build carries no plugin: nothing to offer.
        assert!(!status(&p).offer);
        bundle(&p, "1.0.0.0");
        let s = status(&p);
        assert!(s.found && s.offer && s.installed.is_none() && !s.update);
        // Not now: not asked again for this version.
        assert!(!answer(&p).offer);
        // Installed (by Stream Deck) at the same version: up to date.
        manifest(&p.installed_dir().unwrap(), "1.0.0.0");
        let s = status(&p);
        assert_eq!(s.installed.as_deref(), Some("1.0.0.0"));
        assert!(!s.update && !s.offer);
        // Lumora updated and carries a newer plugin: offered (once).
        bundle(&p, "1.1.0.0");
        let s = status(&p);
        assert!(s.update && s.offer);
        assert!(!answer(&p).offer);
        assert!(status(&p).update, "still shown in Settings");
        // An older bundled plugin never replaces a newer installed one.
        bundle(&p, "0.9.5.0");
        let s = status(&p);
        assert!(!s.update && !s.offer);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn says_so_when_there_is_no_plugin_to_add() {
        let (root, p) = computer();
        assert!(package(&p).is_err());
        assert!(install(&p).is_err());
        let _ = std::fs::remove_dir_all(root);
    }
}
