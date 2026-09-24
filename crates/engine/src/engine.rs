//! Applying actions to the show.

use crate::action::{Action, ActionError, NewSource, SourcePatch};
use crate::model::{
    ActiveTransition, Millis, Playback, ScreenId, Show, Source, SourceId, SourceKind, Transition,
    TransitionKind, MIN_TRANSITION_MS,
};
use crate::timing::{source_ended, source_position};

/// Longest name a source may have.
pub const MAX_NAME_LEN: usize = 80;

/// What happened when an action was applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// The show changed; everyone watching it should get the new version.
    Changed,
    /// The action was valid but there was nothing to change.
    Unchanged,
}

/// Owns the show and is the only thing allowed to change it.
#[derive(Debug, Clone, Default)]
pub struct Engine {
    show: Show,
    /// Bumped on every change, so listeners can ignore stale updates.
    revision: u64,
}

type Result<T> = std::result::Result<T, ActionError>;

impl Engine {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start from a previously saved show.
    pub fn with_show(show: Show) -> Self {
        Engine { show, revision: 0 }
    }

    pub fn show(&self) -> &Show {
        &self.show
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Apply one action at time `now`. On error the show is left untouched.
    ///
    /// # Errors
    /// Returns an [`ActionError`] when the action refers to something that
    /// does not exist or asks for something that is not allowed.
    pub fn apply(&mut self, action: Action, now: Millis) -> Result<Outcome> {
        // Work on a copy so a failure halfway through can never leave the show
        // half-changed.
        let mut next = self.show.clone();
        apply_to(&mut next, action, now)?;
        if next == self.show {
            return Ok(Outcome::Unchanged);
        }
        self.show = next;
        self.revision += 1;
        Ok(Outcome::Changed)
    }
}

fn apply_to(s: &mut Show, action: Action, now: Millis) -> Result<()> {
    match action {
        Action::AddSource { source } => add_source(s, source),
        Action::UpdateSource { id, patch } => update_source(s, &id, patch),
        Action::RemoveSource { id } => {
            let index = index_of(s, &id)?;
            s.sources.remove(index);
            for id_screen in ScreenId::ALL {
                let sc = s.screens.get_mut(id_screen);
                for slot in [&mut sc.preview, &mut sc.program, &mut sc.previous] {
                    if slot.as_ref() == Some(&id) {
                        *slot = None;
                    }
                }
            }
            Ok(())
        }
        Action::MoveSource { id, index } => {
            let from = index_of(s, &id)?;
            let src = s.sources.remove(from);
            let to = index.min(s.sources.len());
            s.sources.insert(to, src);
            Ok(())
        }
        Action::SetPreview { screen, source_id } => {
            not_monitor(screen)?;
            if let Some(id) = &source_id {
                require_source(s, id)?;
            }
            let sc = s.screens.get_mut(screen);
            sc.preview = source_id;
            sc.tbar = 0.0;
            Ok(())
        }
        Action::Take {
            screen,
            transition,
            duration_ms,
        } => {
            not_monitor(screen)?;
            let t = Transition {
                kind: transition.unwrap_or(s.transition.kind),
                duration_ms: duration_ms.unwrap_or(s.transition.duration_ms),
            }
            .clamped();
            take(s, screen, t, now)
        }
        Action::CutTo { screen, source_id } => {
            not_monitor(screen)?;
            require_source(s, &source_id)?;
            let keep = s.screens.get(screen).preview.clone();
            s.screens.get_mut(screen).preview = Some(source_id);
            take(
                s,
                screen,
                Transition {
                    kind: TransitionKind::Cut,
                    duration_ms: MIN_TRANSITION_MS,
                },
                now,
            )?;
            if keep.is_some() {
                s.screens.get_mut(screen).preview = keep;
            }
            Ok(())
        }
        Action::SetTbar { screen, value } => {
            not_monitor(screen)?;
            let v = finite(value, "value")?.clamp(0.0, 1.0);
            let Some(preview) = s.screens.get(screen).preview.clone() else {
                return Err(ActionError::NothingInPreview { screen });
            };
            if v >= 0.999 {
                // Fader pushed all the way: the mix is already complete on
                // screen, so finish with a cut rather than a second animation.
                take(
                    s,
                    screen,
                    Transition {
                        kind: TransitionKind::Cut,
                        duration_ms: MIN_TRANSITION_MS,
                    },
                    now,
                )
            } else {
                s.screens.get_mut(screen).tbar = v;
                if v > 0.0 {
                    start_if_video(s, &preview, now);
                }
                Ok(())
            }
        }
        Action::SetTransition { kind, duration_ms } => {
            if let Some(k) = kind {
                s.transition.kind = k;
            }
            if let Some(d) = duration_ms {
                s.transition.duration_ms = d;
            }
            s.transition = s.transition.clamped();
            Ok(())
        }
        Action::SetBlank { screens, value } => {
            if screens.is_empty() {
                return Err(ActionError::invalid(
                    "screens",
                    "choose at least one screen",
                ));
            }
            for id in screens {
                let sc = s.screens.get_mut(id);
                if sc.blank != value {
                    sc.blank = value;
                    sc.blank_changed_at = now;
                }
            }
            Ok(())
        }
        Action::Panic { value } => {
            if s.panic != value {
                s.panic = value;
                s.panic_changed_at = now;
            }
            Ok(())
        }
        Action::MonitorFlash => {
            s.screens.monitor.flash_at = now;
            Ok(())
        }
        Action::Play { id } => set_playing(s, &id, true, now),
        Action::Pause { id } => set_playing(s, &id, false, now),
        Action::Seek { id, pos_s } => {
            let pos = finite(pos_s, "posS")?;
            let src = video_mut(s, &id)?;
            let SourceKind::Video {
                duration_s,
                playback,
                ..
            } = &mut src.kind
            else {
                unreachable!()
            };
            let max = if *duration_s > 0.0 {
                *duration_s
            } else {
                f64::MAX
            };
            *playback = Playback {
                playing: playback.playing,
                pos_s: pos.clamp(0.0, max),
                at: now,
            };
            Ok(())
        }
        Action::SetDuration { id, duration_s } => {
            let d = finite(duration_s, "durationS")?;
            if d <= 0.0 {
                return Err(ActionError::invalid("durationS", "must be more than zero"));
            }
            let src = video_mut(s, &id)?;
            let SourceKind::Video { duration_s, .. } = &mut src.kind else {
                unreachable!()
            };
            *duration_s = d;
            Ok(())
        }
        Action::SetMasterVolume { value } => {
            s.master_volume = finite(value, "value")?.clamp(0.0, 1.0);
            Ok(())
        }
        Action::SetDisplay { screen, display_id } => {
            *s.settings.displays.get_mut(screen) = display_id;
            Ok(())
        }
        Action::SetAutoPlayOnTake { value } => {
            s.settings.auto_play_on_take = value;
            Ok(())
        }
    }
}

// ---------- switching ----------

fn take(s: &mut Show, screen: ScreenId, t: Transition, now: Millis) -> Result<()> {
    let sc = s.screens.get(screen);
    let Some(incoming) = sc.preview.clone() else {
        return Err(ActionError::NothingInPreview { screen });
    };
    require_source(s, &incoming)?;
    let outgoing = sc.program.clone();

    let sc = s.screens.get_mut(screen);
    sc.previous = outgoing.clone().filter(|o| o != &incoming);
    sc.program = Some(incoming.clone());
    // Broadcast convention: what was on air drops back into preview.
    sc.preview = outgoing.or_else(|| Some(incoming.clone()));
    sc.transition = Some(ActiveTransition {
        kind: t.kind,
        duration_ms: t.duration_ms,
        started_at: now,
    });
    sc.tbar = 0.0;
    start_if_video(s, &incoming, now);
    Ok(())
}

fn start_if_video(s: &mut Show, id: &SourceId, now: Millis) {
    if !s.settings.auto_play_on_take {
        return;
    }
    let Some(src) = s.source_mut(id) else { return };
    let ended = source_ended(src, now);
    let pos = if ended {
        0.0
    } else {
        source_position(src, now)
    };
    if let SourceKind::Video { playback, .. } = &mut src.kind {
        if playback.playing && !ended {
            return;
        }
        *playback = Playback {
            playing: true,
            pos_s: pos,
            at: now,
        };
    }
}

fn set_playing(s: &mut Show, id: &SourceId, playing: bool, now: Millis) -> Result<()> {
    let src = video_mut(s, id)?;
    let ended = source_ended(src, now);
    let mut pos = source_position(src, now);
    if playing && ended {
        pos = 0.0;
    }
    if let SourceKind::Video { playback, .. } = &mut src.kind {
        if playback.playing == playing && !(playing && ended) {
            return Ok(());
        }
        *playback = Playback {
            playing,
            pos_s: pos,
            at: now,
        };
    }
    Ok(())
}

// ---------- sources ----------

fn add_source(s: &mut Show, new: NewSource) -> Result<()> {
    let id = match new.id {
        Some(id) if id.as_str().trim().is_empty() => {
            return Err(ActionError::invalid("id", "must not be empty"))
        }
        Some(id) => id,
        None => next_source_id(s),
    };
    if s.has_source(&id) {
        return Err(ActionError::DuplicateSource { id });
    }
    let kind = clean_kind(new.kind)?;
    let src = Source {
        id,
        name: clean_name(&new.name),
        kind,
        volume: finite(new.volume.unwrap_or(1.0), "volume")?.clamp(0.0, 1.0),
        muted: new.muted.unwrap_or(false),
        looping: new.looping.unwrap_or(false),
        fit: new.fit.unwrap_or_default(),
    };
    s.sources.push(src);
    Ok(())
}

fn update_source(s: &mut Show, id: &SourceId, patch: SourcePatch) -> Result<()> {
    let src = s
        .source_mut(id)
        .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
    if let Some(name) = patch.name {
        src.name = clean_name(&name);
    }
    if let Some(v) = patch.volume {
        src.volume = finite(v, "volume")?.clamp(0.0, 1.0);
    }
    if let Some(m) = patch.muted {
        src.muted = m;
    }
    if let Some(l) = patch.looping {
        src.looping = l;
    }
    if let Some(f) = patch.fit {
        src.fit = f;
    }
    if let Some(c) = patch.color {
        match &mut src.kind {
            SourceKind::Color { color } => *color = clean_color(&c)?,
            _ => {
                return Err(ActionError::invalid(
                    "color",
                    "only colour sources have a colour",
                ))
            }
        }
    }
    Ok(())
}

fn clean_kind(kind: SourceKind) -> Result<SourceKind> {
    Ok(match kind {
        SourceKind::Camera { device_id, label } => SourceKind::Camera { device_id, label },
        SourceKind::Video {
            path, duration_s, ..
        } => {
            let d = if duration_s.is_finite() && duration_s > 0.0 {
                duration_s
            } else {
                0.0
            };
            SourceKind::Video {
                path,
                duration_s: d,
                playback: Playback::default(),
            }
        }
        SourceKind::Image { path } => SourceKind::Image { path },
        SourceKind::Color { color } => SourceKind::Color {
            color: clean_color(&color)?,
        },
        SourceKind::Pattern => SourceKind::Pattern,
    })
}

fn clean_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return "Untitled".to_owned();
    }
    trimmed.chars().take(MAX_NAME_LEN).collect()
}

fn clean_color(c: &str) -> Result<String> {
    let ok = c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if ok {
        Ok(c.to_ascii_lowercase())
    } else {
        Err(ActionError::invalid("color", "use the form #rrggbb"))
    }
}

/// `src-1`, `src-2`, … — the next number not yet used.
fn next_source_id(s: &Show) -> SourceId {
    let highest = s
        .sources
        .iter()
        .filter_map(|src| src.id.as_str().strip_prefix("src-")?.parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    SourceId(format!("src-{}", highest + 1))
}

// ---------- small helpers ----------

fn index_of(s: &Show, id: &SourceId) -> Result<usize> {
    s.sources
        .iter()
        .position(|src| &src.id == id)
        .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })
}

fn require_source(s: &Show, id: &SourceId) -> Result<()> {
    if s.has_source(id) {
        Ok(())
    } else {
        Err(ActionError::UnknownSource { id: id.clone() })
    }
}

fn video_mut<'a>(s: &'a mut Show, id: &SourceId) -> Result<&'a mut Source> {
    let src = s
        .source_mut(id)
        .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
    if src.kind.is_video() {
        Ok(src)
    } else {
        Err(ActionError::NotAVideo { id: id.clone() })
    }
}

fn not_monitor(screen: ScreenId) -> Result<()> {
    if screen == ScreenId::Monitor {
        Err(ActionError::MonitorIsTextOnly)
    } else {
        Ok(())
    }
}

fn finite<T: Into<f64> + Copy>(v: T, field: &str) -> Result<T> {
    if v.into().is_finite() {
        Ok(v)
    } else {
        Err(ActionError::invalid(field, "must be a number"))
    }
}
