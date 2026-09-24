//! Saving the show to disk and loading it back.
//!
//! Loading is defensive: a file from an older version, or one that was edited
//! by hand, is repaired rather than rejected. Only a file that is not valid
//! JSON at all is refused, so the caller can fall back to a backup.

use std::collections::HashSet;

use thiserror::Error;

use crate::model::{Playback, ScreenId, Show, SourceKind, SHOW_VERSION};

#[derive(Debug, Error)]
pub enum LoadError {
    #[error("the show file could not be read: {0}")]
    Malformed(#[from] serde_json::Error),
    #[error("the show file is from a newer version of Lumora (format {found}, this version reads up to {supported})")]
    TooNew { found: u32, supported: u32 },
}

/// The show as it should be written to disk: everything that only makes sense
/// while running (transitions in progress, panic, play positions) is reset.
pub fn to_saved(show: &Show) -> Show {
    let mut s = show.clone();
    s.version = SHOW_VERSION;
    s.panic = false;
    s.panic_changed_at = 0;
    for id in ScreenId::ALL {
        let sc = s.screens.get_mut(id);
        sc.previous = None;
        sc.transition = None;
        sc.tbar = 0.0;
        sc.flash_at = 0;
        sc.blank_changed_at = 0;
    }
    for src in &mut s.sources {
        if let SourceKind::Video { playback, .. } = &mut src.kind {
            *playback = Playback::default();
        }
    }
    s
}

/// Serialise a show for saving.
///
/// # Panics
/// Never in practice: every type in the show serialises infallibly.
pub fn save_json(show: &Show) -> String {
    serde_json::to_string_pretty(&to_saved(show)).expect("show is always serialisable")
}

/// Read a saved show, repairing anything inconsistent.
///
/// # Errors
/// Fails only when the text is not a show file at all, or comes from a newer
/// version of Lumora.
pub fn load_json(text: &str) -> Result<Show, LoadError> {
    let raw: Show = serde_json::from_str(text)?;
    if raw.version > SHOW_VERSION {
        return Err(LoadError::TooNew {
            found: raw.version,
            supported: SHOW_VERSION,
        });
    }
    Ok(repair(to_saved(&raw)))
}

/// Fix anything that breaks the show's rules.
pub fn repair(mut s: Show) -> Show {
    // Drop sources with duplicate or empty ids (keep the first).
    let mut seen = HashSet::new();
    s.sources
        .retain(|src| !src.id.as_str().trim().is_empty() && seen.insert(src.id.clone()));

    for src in &mut s.sources {
        if !src.volume.is_finite() {
            src.volume = 1.0;
        }
        src.volume = src.volume.clamp(0.0, 1.0);
        let name = src.name.trim();
        src.name = if name.is_empty() {
            "Untitled".to_owned()
        } else {
            name.chars().take(crate::engine::MAX_NAME_LEN).collect()
        };
        match &mut src.kind {
            SourceKind::Color { color } => {
                let ok = color.len() == 7
                    && color.starts_with('#')
                    && color[1..].chars().all(|c| c.is_ascii_hexdigit());
                if !ok {
                    "#000000".clone_into(color);
                }
            }
            SourceKind::Video { duration_s, .. }
                if !(duration_s.is_finite() && *duration_s >= 0.0) =>
            {
                *duration_s = 0.0;
            }
            _ => {}
        }
    }

    // Screens may only point at sources that exist; the Monitor shows text only.
    for id in ScreenId::ALL {
        let known: HashSet<_> = s.sources.iter().map(|x| x.id.clone()).collect();
        let sc = s.screens.get_mut(id);
        for slot in [&mut sc.preview, &mut sc.program, &mut sc.previous] {
            if slot.as_ref().is_some_and(|x| !known.contains(x)) || id == ScreenId::Monitor {
                *slot = None;
            }
        }
        if !sc.tbar.is_finite() {
            sc.tbar = 0.0;
        }
    }

    s.transition = s.transition.clamped();
    if !s.master_volume.is_finite() {
        s.master_volume = 1.0;
    }
    s.master_volume = s.master_volume.clamp(0.0, 1.0);
    s.version = SHOW_VERSION;
    s
}
