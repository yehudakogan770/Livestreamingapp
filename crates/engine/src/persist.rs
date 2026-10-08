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
    s.audio.solo = None;
    s.running.clear();
    s.app_requests.clear();
    s.no_signal.clear();
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
    let value: serde_json::Value = serde_json::from_str(text)?;
    // Before version 3 there was one shared countdown; its settings move
    // into every countdown input so nothing that was set up is lost.
    let old_countdown: Option<crate::stage::Countdown> = value
        .get("countdown")
        .and_then(|v| serde_json::from_value(v.clone()).ok());
    let mut show: Show = serde_json::from_value(value)?;
    if show.version > SHOW_VERSION {
        return Err(LoadError::TooNew {
            found: show.version,
            supported: SHOW_VERSION,
        });
    }
    if show.version < 3 {
        if let Some(mut old) = old_countdown {
            if show.version < 2 && old.at_zero == crate::stage::AtZero::Hold {
                // Shows from before version 2 kept the old default; use the new one.
                old.at_zero = crate::stage::AtZero::Hide;
            }
            for src in &mut show.sources {
                if let SourceKind::Countdown { timer, .. } = &mut src.kind {
                    *timer = old.clone();
                }
            }
        }
    }
    Ok(repair(to_saved(&show)))
}

/// Fix anything that breaks the show's rules.
/// The inputs the audience takes part in (raffles, games, walls…).
fn repair_audience(kind: &mut SourceKind) {
    match kind {
        SourceKind::Raffle(r) => r.repair(),
        SourceKind::Fundraiser(f) => f.repair(),
        SourceKind::Wall(w) => w.repair(),
        SourceKind::Auction(a) => a.repair(),
        SourceKind::Scripture(s) => s.repair(),
        SourceKind::Trivia(t) => t.repair(),
        SourceKind::Seating(s) => s.repair(),
        SourceKind::Graphic(g) => g.repair(),
        SourceKind::Titler(t) => t.repair(),
        _ => {}
    }
}

/// Cameras: the auto-switch list and each camera's settings.
fn repair_cameras(s: &mut Show) {
    let sources = s.sources.clone();
    s.auto_switch.repair(&sources);
    s.event.backup = std::mem::take(&mut s.event.backup).cleaned();
    s.event
        .backup
        .lineup
        .retain(|id| sources.iter().any(|x| &x.id == id));
    s.no_signal.clear();
    for src in &mut s.sources {
        if let Some(c) = &mut src.camera {
            c.repair();
        }
    }
}

fn repair_macros(s: &mut Show) {
    s.app_requests.clear();
    s.macros.truncate(crate::macros::MAX_MACROS);
    s.macros.retain(|m| !m.id.trim().is_empty());
    for m in &mut s.macros {
        m.repair();
    }
}

pub fn repair(mut s: Show) -> Show {
    repair_macros(&mut s);
    // Drop sources with duplicate or empty ids (keep the first).
    let mut seen = HashSet::new();
    s.sources
        .retain(|src| !src.id.as_str().trim().is_empty() && seen.insert(src.id.clone()));

    for src in &mut s.sources {
        src.key.repair();
        src.adjust.repair();
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
            SourceKind::Color { color }
            | SourceKind::Countdown {
                background: color, ..
            } => {
                if !is_color(color) {
                    "#000000".clone_into(color);
                }
            }
            SourceKind::Video { duration_s, .. }
                if !(duration_s.is_finite() && *duration_s >= 0.0) =>
            {
                *duration_s = 0.0;
            }
            SourceKind::Text(t) => t.repair(),
            SourceKind::Credits(c) => c.repair(),
            SourceKind::Split(sp) => sp.repair(),
            SourceKind::Slideshow(sh) => sh.repair(),
            SourceKind::Logo3d(l) => l.repair(),
            SourceKind::Browser(b) => b.repair(),
            SourceKind::Stream(st) => st.repair(),
            SourceKind::Scoreboard(sb) => sb.repair(),
            SourceKind::Screen(c) => c.repair(),
            SourceKind::Lyrics(l) => l.repair(),
            SourceKind::Poll(p) => p.repair(),
            SourceKind::Comment(c) => c.repair(),
            SourceKind::Guest(g) => g.repair(),
            SourceKind::Pesukim(p) => {
                p.repair();
                let defaults = crate::pesukim::PesukimLook::default();
                if !is_color(&p.look.background) {
                    p.look.background = defaults.background;
                }
                if !is_color(&p.look.text_color) {
                    p.look.text_color = defaults.text_color;
                }
                if !is_color(&p.look.outline_color) {
                    p.look.outline_color = defaults.outline_color;
                }
            }
            other => repair_audience(other),
        }
    }
    s.data.repair();
    repair_cameras(&mut s);
    repair_links(&mut s);
    s.run.repair();

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

    repair_sound(&mut s);
    repair_presets(&mut s);
    repair_stage(&mut s);
    s.visuals.repair();
    s.triggers.truncate(crate::triggers::MAX_TRIGGERS);
    for t in &mut s.triggers {
        t.repair();
    }
    let st = &mut s.settings;
    st.fade_to_black_ms = st.fade_to_black_ms.clamp(100, 10_000);
    if st.favourite_transitions.len() != 4 {
        st.favourite_transitions = crate::model::default_favourites();
    }
    for t in &mut st.favourite_transitions {
        *t = t.clamped();
    }
    // A held strobe never survives a restart.
    s.visuals.strobe = false;

    s.transition = s.transition.clamped();
    if !s.master_volume.is_finite() {
        s.master_volume = 1.0;
    }
    s.master_volume = s.master_volume.clamp(0.0, 1.0);
    s.version = SHOW_VERSION;
    s
}

/// Inputs that point at other inputs (behind the pesukim, split-screen
/// boxes, overlay channels) point only at ones that exist and can be shown.
fn repair_links(s: &mut Show) {
    // What is behind the pesukim must exist and be a picture.
    let pictures: HashSet<_> = s
        .sources
        .iter()
        .filter(|x| crate::engine::can_be_behind(&x.kind))
        .map(|x| x.id.clone())
        .collect();
    let splits: HashSet<_> = s
        .sources
        .iter()
        .filter(|x| matches!(x.kind, SourceKind::Split(_)))
        .map(|x| x.id.clone())
        .collect();
    let shown: HashSet<_> = s
        .sources
        .iter()
        .filter(|x| !x.kind.is_sound_only() && !splits.contains(&x.id))
        .map(|x| x.id.clone())
        .collect();
    let slideshows: HashSet<_> = s
        .sources
        .iter()
        .filter(|x| matches!(x.kind, SourceKind::Slideshow(_)))
        .map(|x| x.id.clone())
        .collect();
    let slide_ok = |id: &crate::model::SourceId| shown.contains(id) && !slideshows.contains(id);
    for src in &mut s.sources {
        if let SourceKind::Slideshow(sh) = &mut src.kind {
            sh.slides.retain(|sl| match sl {
                crate::slideshow::Slide::Input { source_id, .. } => slide_ok(source_id),
                crate::slideshow::Slide::Image { .. } => true,
            });
            if sh.behind.as_ref().is_some_and(|b| !slide_ok(b)) {
                sh.behind = None;
            }
            sh.repair();
        }
    }
    for src in &mut s.sources {
        if let SourceKind::Split(sp) = &mut src.kind {
            for b in &mut sp.boxes {
                if b.source_id.as_ref().is_some_and(|id| !shown.contains(id)) {
                    b.source_id = None;
                }
            }
        }
    }
    for src in &mut s.sources {
        if let SourceKind::Pesukim(p) = &mut src.kind {
            if p.look
                .behind
                .as_ref()
                .is_some_and(|b| !pictures.contains(b))
            {
                p.look.behind = None;
            }
        }
    }

    // The 12 Pesukim are always a bar: one saved in Next or on air goes up as an overlay.
    for screen in [ScreenId::Live, ScreenId::Back] {
        for on in [false, true] {
            let sc = s.screens.get(screen);
            let id = if on {
                sc.program.clone()
            } else {
                sc.preview.clone()
            };
            if let Some(id) = id
                .filter(|id| matches!(s.source(id).map(|x| &x.kind), Some(SourceKind::Pesukim(_))))
            {
                crate::engine::pesukim_bar(s, screen, &id, on, 0);
                let sc = s.screens.get_mut(screen);
                if on {
                    sc.program = None;
                } else {
                    sc.preview = None;
                }
            }
        }
    }

    // Four overlay channels, each pointing at a picture that exists.
    s.overlays
        .resize_with(crate::overlays::CHANNELS, Default::default);
    let pictures: HashSet<_> = s
        .sources
        .iter()
        .filter(|x| !x.kind.is_sound_only())
        .map(|x| x.id.clone())
        .collect();
    for o in &mut s.overlays {
        if o.source_id
            .as_ref()
            .is_some_and(|id| !pictures.contains(id))
        {
            o.source_id = None;
        }
        o.repair();
    }
}

/// `#rrggbb`.
fn is_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Sound: bounded delays and names; sound-only sources never on a screen.
fn repair_sound(s: &mut Show) {
    // Sound: bounded delays and names; sound-only sources never on a screen.
    for src in &mut s.sources {
        src.audio.delay_ms = src.audio.delay_ms.min(crate::audio::MAX_AUDIO_DELAY_MS);
    }
    for bus in [&mut s.audio.a, &mut s.audio.b] {
        bus.name = crate::engine::short_text(&bus.name, crate::audio::MAX_BUS_NAME_LEN);
        if !bus.volume.is_finite() {
            bus.volume = 1.0;
        }
        bus.volume = bus.volume.clamp(0.0, 1.0);
    }
    let sound_only: HashSet<_> = s
        .sources
        .iter()
        .filter(|x| x.kind.is_sound_only())
        .map(|x| x.id.clone())
        .collect();
    for id in ScreenId::ALL {
        let sc = s.screens.get_mut(id);
        for slot in [&mut sc.preview, &mut sc.program, &mut sc.previous] {
            if slot.as_ref().is_some_and(|x| sound_only.contains(x)) {
                *slot = None;
            }
        }
    }
}

/// Presets: unique ids, only known inputs, never the Monitor.
fn repair_presets(s: &mut Show) {
    // Presets: unique ids, only known inputs, never the Monitor.
    let known: HashSet<_> = s.sources.iter().map(|x| x.id.clone()).collect();
    let mut ids = HashSet::new();
    s.presets
        .retain(|p| !p.id.trim().is_empty() && ids.insert(p.id.clone()));
    for p in &mut s.presets {
        p.sources.retain(|x| known.contains(x));
        if p.screen == ScreenId::Monitor {
            p.screen = ScreenId::Live;
        }
        p.transition = p.transition.map(crate::model::Transition::clamped);
    }
    if s.active_preset
        .as_ref()
        .is_some_and(|a| !s.presets.iter().any(|p| &p.id == a))
    {
        s.active_preset = None;
    }
}

/// The event, the monitor and the countdown: bounded text and sane times.
fn repair_stage(s: &mut Show) {
    s.event.name = crate::engine::short_text(&s.event.name, crate::event::MAX_EVENT_NAME_LEN);
    if s.event.logo.as_deref().is_some_and(|p| p.trim().is_empty()) {
        s.event.logo = None;
    }

    s.monitor.prompter.repair();
    // Monitor and countdown: bounded text, exactly 8 quick messages, sane times.
    let m = &mut s.monitor;
    m.message = crate::engine::short_text(&m.message, crate::stage::MAX_MESSAGE_LEN);
    m.quick.resize(crate::stage::QUICK_MESSAGES, String::new());
    for q in &mut m.quick {
        *q = crate::engine::short_text(q, crate::stage::MAX_SHORT_TEXT_LEN);
    }
    let known: HashSet<_> = s.sources.iter().map(|x| x.id.clone()).collect();
    for src in &mut s.sources {
        let SourceKind::Countdown { timer: c, .. } = &mut src.kind else {
            continue;
        };
        let max = crate::stage::MAX_COUNTDOWN_MS;
        if c.length_ms == 0 || c.length_ms > max {
            c.length_ms = crate::stage::Countdown::default().length_ms;
        }
        c.remaining_ms = c.remaining_ms.min(max);
        c.label = crate::engine::short_text(&c.label, crate::stage::MAX_SHORT_TEXT_LEN);
        c.end_text = crate::engine::short_text(&c.end_text, crate::stage::MAX_SHORT_TEXT_LEN);
        if matches!(&c.at_zero, crate::stage::AtZero::CutTo { source_id } if !known.contains(source_id))
        {
            c.at_zero = crate::stage::AtZero::Hide;
        }
    }
}
