//! Video playlists: a video input that plays a list of videos one after
//! another. The input's own path is always the current item, so everything
//! that plays videos plays playlists too.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Millis, Playback, Source, SourceKind};
use crate::timing::source_ended;

/// One video in a playlist.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct PlaylistItem {
    pub path: String,
    pub name: String,
    /// Its length once known (0 until then).
    pub duration_s: f64,
}

/// The list and where it is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Playlist {
    pub items: Vec<PlaylistItem>,
    /// The item playing (or ready).
    pub current: usize,
    /// Go on to the next video when one ends.
    pub auto_next: bool,
    /// After the last, start again from the first.
    pub loop_all: bool,
}

impl Default for Playlist {
    fn default() -> Self {
        Playlist {
            items: Vec::new(),
            current: 0,
            auto_next: true,
            loop_all: false,
        }
    }
}

/// Most videos in one playlist.
pub const MAX_ITEMS: usize = 500;

impl Playlist {
    /// Keep it valid.
    pub fn repair(&mut self) {
        self.items.retain(|i| !i.path.is_empty());
        self.items.truncate(MAX_ITEMS);
        for i in &mut self.items {
            if !i.duration_s.is_finite() || i.duration_s < 0.0 {
                i.duration_s = 0.0;
            }
            i.name = i.name.chars().take(120).collect();
        }
        self.current = self.current.min(self.items.len().saturating_sub(1));
    }

    /// The item after the current one, if any.
    #[must_use]
    pub fn next_index(&self) -> Option<usize> {
        if self.current + 1 < self.items.len() {
            Some(self.current + 1)
        } else if self.loop_all && !self.items.is_empty() {
            Some(0)
        } else {
            None
        }
    }
}

/// The current video has just ended and the list goes on by itself.
#[must_use]
pub fn due(src: &Source, now: Millis) -> bool {
    let (Some(p), SourceKind::Video { playback, .. }) = (&src.playlist, &src.kind) else {
        return false;
    };
    p.auto_next && playback.playing && p.next_index().is_some() && source_ended(src, now)
}

/// Make item `index` the input's video: from the start, playing or not.
pub fn go(src: &mut Source, index: usize, playing: bool, now: Millis) -> bool {
    let Some(p) = &mut src.playlist else {
        return false;
    };
    let Some(item) = p.items.get(index).cloned() else {
        return false;
    };
    p.current = index;
    if let SourceKind::Video {
        path,
        duration_s,
        playback,
    } = &mut src.kind
    {
        *path = item.path;
        *duration_s = item.duration_s;
        *playback = Playback {
            playing,
            pos_s: 0.0,
            at: now,
        };
        true
    } else {
        false
    }
}
