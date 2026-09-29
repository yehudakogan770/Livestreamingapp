//! Applying actions to the show.

use crate::action::{Action, ActionError, CountdownPatch, MonitorPatch, NewSource, SourcePatch};
use crate::audio::{SourceAudio, MAX_BUS_NAME_LEN};
use crate::credits::Credits;
use crate::model::ChromaKey;
use crate::model::{
    ActiveTransition, Millis, Playback, ScreenId, ScreenState, Show, Source, SourceId, SourceKind,
    Transition, TransitionKind, MIN_TRANSITION_MS,
};
use crate::overlays::Overlay;
use crate::pesukim::{Pesukim, PesukimLook};
use crate::presets::{
    Preset, PresetButton, RunningSteps, Step, MAX_PRESET_NAME_LEN, MAX_STEPS, MAX_WAIT_MS,
};
use crate::slideshow::{Slide, Slideshow};
use crate::stage::{AtZero, MAX_COUNTDOWN_MS, MAX_MESSAGE_LEN, MAX_SHORT_TEXT_LEN, QUICK_MESSAGES};
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

    /// Replace the whole show (opening an event, starting a new one).
    pub fn replace(&mut self, show: Show) {
        self.show = show;
        self.revision += 1;
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
        let live_before = next.screens.live.clone();
        let was_following = next.back_follows_live;
        apply_to(&mut next, action, now)?;
        follow_live(&mut next, &live_before, was_following, now);
        if next == self.show {
            return Ok(Outcome::Unchanged);
        }
        self.show = next;
        self.revision += 1;
        Ok(Outcome::Changed)
    }

    /// Let time pass: runs anything due at `now` — the countdown's at-zero
    /// action, and preset-button steps waiting to resume. Call it a few
    /// times a second.
    pub fn tick(&mut self, now: Millis) -> Outcome {
        // Each countdown lands on 0, holds a moment, then its at-zero action runs.
        let due: Vec<SourceId> = self
            .show
            .sources
            .iter()
            .filter(|src| {
                matches!(&src.kind, SourceKind::Countdown { timer, .. } if !timer.fired && timer.due(now))
            })
            .map(|src| src.id.clone())
            .collect();
        let steps_due = self.show.running.iter().any(|r| r.resume_at <= now);
        // Pesukim on auto-advance move on by themselves, only while on air.
        let on_air =
            [ScreenId::Live, ScreenId::Back].map(|sc| self.show.screens.get(sc).program.clone());
        let words_due: Vec<SourceId> = self
            .show
            .sources
            .iter()
            .filter(|src| on_air.contains(&Some(src.id.clone())))
            .filter(|src| matches!(&src.kind, SourceKind::Pesukim(p) if p.due(now)))
            .map(|src| src.id.clone())
            .collect();
        let cue_due = self.show.run.due(now);
        let visuals_due = self.show.visuals.due(now);
        let slides_due: Vec<SourceId> = self
            .show
            .sources
            .iter()
            .filter(|src| on_air.contains(&Some(src.id.clone())))
            .filter(|src| matches!(&src.kind, SourceKind::Slideshow(sh) if sh.due(now)))
            .map(|src| src.id.clone())
            .collect();
        let overlays_due: Vec<usize> = (0..self.show.overlays.len())
            .filter(|&i| overlay_due(&self.show, i, now))
            .collect();
        if due.is_empty()
            && cue_due.is_none()
            && !steps_due
            && words_due.is_empty()
            && overlays_due.is_empty()
            && slides_due.is_empty()
            && !visuals_due
        {
            return Outcome::Unchanged;
        }
        let mut next = self.show.clone();
        let live_before = next.screens.live.clone();
        let was_following = next.back_follows_live;
        for id in &due {
            run_at_zero(&mut next, id, now);
        }
        if let Some(i) = cue_due {
            let _ = fire_cue(&mut next, i, now);
        }
        if steps_due {
            run_steps(&mut next, now);
        }
        for id in &slides_due {
            let _ = apply_slideshow(&mut next, Action::SlideNext { id: id.clone() }, now);
        }
        if visuals_due {
            next.visuals.auto_change(now);
        }
        for &i in &overlays_due {
            next.overlays[i].set_on(false, now);
        }
        for id in &words_due {
            if let Ok(p) = pesukim_mut(&mut next, id) {
                p.next(now);
            }
        }
        follow_live(&mut next, &live_before, was_following, now);
        if next == self.show {
            return Outcome::Unchanged;
        }
        self.show = next;
        self.revision += 1;
        Outcome::Changed
    }
}

/// An overlay goes off by itself: its auto-hide time is up, or its video
/// ended (video overlays turn off at the end unless they loop).
fn overlay_due(s: &Show, i: usize, now: Millis) -> bool {
    let o = &s.overlays[i];
    if !o.on {
        return false;
    }
    if o.due(now) {
        return true;
    }
    o.source_id
        .as_ref()
        .and_then(|id| s.source(id))
        .is_some_and(|src| src.kind.is_video() && source_ended(src, now))
}

/// A countdown input has held on 0: do what was chosen for zero, once.
fn run_at_zero(next: &mut Show, id: &SourceId, now: Millis) {
    let Ok(timer) = timer_mut(next, id) else {
        return;
    };
    timer.fired = true;
    let at_zero = timer.at_zero.clone();
    // The screens showing this countdown right now.
    let showing: Vec<ScreenId> = [ScreenId::Live, ScreenId::Back]
        .into_iter()
        .filter(|sc| next.screens.get(*sc).program.as_ref() == Some(id))
        .collect();
    match at_zero {
        AtZero::Hold | AtZero::ShowText | AtZero::Hide => {}
        AtZero::Blank => {
            for sc in showing {
                let st = next.screens.get_mut(sc);
                if !st.blank {
                    st.blank = true;
                    st.blank_changed_at = now;
                }
            }
        }
        AtZero::CutTo { source_id } => {
            // Switch the screens it is on (the Live Screen if none). The
            // input may have been removed since; then nothing happens.
            let screens = if showing.is_empty() {
                vec![ScreenId::Live]
            } else {
                showing
            };
            for screen in screens {
                let _ = apply_to(
                    next,
                    Action::CutTo {
                        screen,
                        source_id: source_id.clone(),
                    },
                    now,
                );
            }
        }
    }
}

/// A countdown input's timer, or why there isn't one.
fn timer_mut<'a>(s: &'a mut Show, id: &SourceId) -> Result<&'a mut crate::stage::Countdown> {
    match s.source_mut(id).map(|x| &mut x.kind) {
        Some(SourceKind::Countdown { timer, .. }) => Ok(timer),
        Some(_) => Err(ActionError::invalid("id", "that input is not a countdown")),
        None => Err(ActionError::UnknownSource { id: id.clone() }),
    }
}

// One arm per action keeps every rule of the show in a single, readable place.
fn pesukim_mut<'a>(s: &'a mut Show, id: &SourceId) -> Result<&'a mut Pesukim> {
    let src = s
        .sources
        .iter_mut()
        .find(|x| &x.id == id)
        .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
    match &mut src.kind {
        SourceKind::Pesukim(p) => Ok(p),
        _ => Err(ActionError::invalid(
            "pesukim",
            "that input is not a 12 Pesukim input",
        )),
    }
}

/// Colours must be colours; what is behind the words must be a picture that
/// exists (not another text input, so nothing can draw itself forever).
fn check_look(s: &Show, id: &SourceId, look: &PesukimLook) -> Result<()> {
    clean_color(&look.background)?;
    clean_color(&look.text_color)?;
    if let Some(behind) = &look.behind {
        let src = s
            .source(behind)
            .ok_or_else(|| ActionError::UnknownSource { id: behind.clone() })?;
        if behind == id || !can_be_behind(&src.kind) {
            return Err(ActionError::invalid(
                "behind",
                "only a camera, video, picture, colour or test pattern can go behind the words",
            ));
        }
    }
    Ok(())
}

/// Can go behind the pesukim.
pub(crate) fn can_be_behind(kind: &SourceKind) -> bool {
    matches!(
        kind,
        SourceKind::Camera { .. }
            | SourceKind::Video { .. }
            | SourceKind::Image { .. }
            | SourceKind::Color { .. }
            | SourceKind::Pattern
            | SourceKind::Visuals
    )
}

/// Run a cue: its steps start now, and the show carries on from it.
fn fire_cue(s: &mut Show, index: usize, now: Millis) -> Result<()> {
    let cue = s
        .run
        .cues
        .get(index)
        .cloned()
        .ok_or_else(|| ActionError::invalid("cue", "there is no such cue"))?;
    s.run.current = Some(index);
    s.run.cue_started_at = now;
    apply_to(
        s,
        Action::RunSteps {
            name: cue.name,
            steps: cue.steps,
        },
        now,
    )
}

/// The run-of-show actions.
fn apply_run(s: &mut Show, action: Action, now: Millis) -> Result<()> {
    match action {
        Action::SetCues { cues } => {
            for c in &cues {
                clean_steps(c.steps.clone())?;
            }
            let keep = s
                .run
                .current
                .and_then(|i| s.run.cues.get(i))
                .map(|c| c.id.clone());
            s.run.cues = cues;
            // Stay on the same cue if it is still there.
            s.run.current = keep.and_then(|id| s.run.cues.iter().position(|c| c.id == id));
            s.run.repair();
        }
        Action::StartShow { utc_offset_min } => {
            s.run.running = true;
            s.run.paused = false;
            s.run.current = None;
            s.run.started_at = now;
            s.run.cue_started_at = now;
            s.run.utc_offset_min = utc_offset_min;
            s.run.repair();
        }
        Action::StopShow => {
            s.run.running = false;
            s.run.paused = false;
        }
        Action::PauseShow { value } => s.run.paused = value && s.run.running,
        Action::NextCue => {
            if let Some(i) = s.run.next_index() {
                if !s.run.running {
                    s.run.running = true;
                    s.run.started_at = now;
                }
                fire_cue(s, i, now)?;
            }
        }
        Action::GoCue { index } => fire_cue(s, index, now)?,
        _ => {}
    }
    Ok(())
}

fn slideshow_mut<'a>(s: &'a mut Show, id: &SourceId) -> Result<&'a mut Slideshow> {
    let src = s
        .source_mut(id)
        .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
    match &mut src.kind {
        SourceKind::Slideshow(sh) => Ok(sh),
        _ => Err(ActionError::invalid(
            "slideshow",
            "that input is not a slideshow",
        )),
    }
}

/// Move a slideshow to a slide; an input on the new slide (a video) starts.
fn go_to_slide(s: &mut Show, id: &SourceId, index: usize, now: Millis) -> Result<()> {
    if let Some(inner) = slideshow_mut(s, id)?.go(index, now) {
        start_if_video(s, &inner, now);
    }
    Ok(())
}

/// The slideshow actions.
fn apply_visuals(s: &mut Show, action: Action, now: Millis) -> Result<()> {
    let v = &mut s.visuals;
    match action {
        Action::VisualsScene { scene } => {
            if !scene.exists() {
                return Err(ActionError::invalid("scene", "there is no such scene"));
            }
            v.launch(scene, now);
        }
        Action::VisualsStep { step } => v.step(step.signum(), now),
        Action::VisualsTempo { bpm } => v.set_bpm(finite(bpm, "bpm")?, now),
        Action::VisualsSync => v.sync_to_one(now),
        Action::VisualsFlash => v.flash_at = now,
        Action::UpdateVisuals { patch } => v.apply_patch(patch, now),
        Action::VisualsLook { slot, store } => {
            if slot >= crate::visuals::LOOK_SLOTS {
                return Err(ActionError::invalid("slot", "there are 8 looks"));
            }
            if store {
                v.store_look(slot);
            } else if !v.recall_look(slot, now) {
                return Err(ActionError::invalid("slot", "nothing is saved there"));
            }
        }
        _ => {}
    }
    Ok(())
}

fn apply_slideshow(s: &mut Show, action: Action, now: Millis) -> Result<()> {
    match action {
        Action::SlideNext { id } => {
            if let Some(i) = slideshow_mut(s, &id)?.next_index() {
                go_to_slide(s, &id, i, now)?;
            }
        }
        Action::SlidePrevious { id } => {
            let i = slideshow_mut(s, &id)?.current.saturating_sub(1);
            go_to_slide(s, &id, i, now)?;
        }
        Action::SlideGo { id, index } => go_to_slide(s, &id, index, now)?,
        Action::UpdateSlideshow { id, slideshow } => {
            // Slides and what is behind may only be pictures that exist, and
            // never a slideshow (nothing can contain itself).
            let inputs = slideshow.slides.iter().filter_map(|sl| match sl {
                Slide::Input { source_id } => Some(source_id),
                Slide::Image { .. } => None,
            });
            for inner in inputs.chain(slideshow.behind.iter()) {
                require_picture(s, inner)?;
                if matches!(
                    s.source(inner).map(|x| &x.kind),
                    Some(SourceKind::Slideshow(_))
                ) {
                    return Err(ActionError::invalid(
                        "slideshow",
                        "a slideshow can't show another slideshow",
                    ));
                }
            }
            let sh = slideshow_mut(s, &id)?;
            let (current, changed_at) = (sh.current, sh.changed_at);
            *sh = Slideshow {
                current,
                changed_at,
                ..slideshow
            };
            sh.repair();
        }
        _ => {}
    }
    Ok(())
}

fn credits_mut<'a>(s: &'a mut Show, id: &SourceId) -> Result<&'a mut Credits> {
    let src = s
        .source_mut(id)
        .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
    match &mut src.kind {
        SourceKind::Credits(c) => Ok(c),
        _ => Err(ActionError::invalid(
            "credits",
            "that input is not a credits input",
        )),
    }
}

/// The credits actions.
fn apply_credits(s: &mut Show, action: Action, now: Millis) -> Result<()> {
    match action {
        Action::UpdateCredits { id, credits } => {
            let c = credits_mut(s, &id)?;
            let (playing, pos_ms, at) = (c.playing, c.pos_ms, c.at);
            *c = Credits {
                playing,
                pos_ms,
                at,
                ..credits
            };
            c.repair();
        }
        Action::CreditsPlay { id, value } => credits_mut(s, &id)?.play(value, now),
        Action::CreditsRestart { id } => credits_mut(s, &id)?.restart(now),
        Action::CreditsSpeed { id, speed } => credits_mut(s, &id)?.set_speed(speed, now),
        _ => {}
    }
    Ok(())
}

fn channel_mut(s: &mut Show, channel: usize) -> Result<&mut Overlay> {
    s.overlays
        .get_mut(channel)
        .ok_or_else(|| ActionError::invalid("channel", "overlay channels are 1 to 4"))
}

/// The overlay actions.
fn apply_overlay(s: &mut Show, action: Action, now: Millis) -> Result<()> {
    match action {
        Action::SetOverlaySource { channel, source_id } => {
            if let Some(id) = &source_id {
                require_picture(s, id)?;
            }
            let o = channel_mut(s, channel)?;
            if o.source_id != source_id {
                o.source_id = source_id;
                // A new input starts off air; an emptied channel goes off.
                o.on = false;
                o.changed_at = now;
            }
            o.repair();
        }
        Action::UpdateOverlay { channel, patch } => {
            let o = channel_mut(s, channel)?;
            if let Some(f) = patch.frame {
                o.frame = f;
            }
            if let Some(v) = patch.opacity {
                o.opacity = finite(v, "opacity")?;
            }
            if let Some(a) = patch.anim_in {
                o.anim_in = a;
            }
            if let Some(a) = patch.anim_out {
                o.anim_out = a;
            }
            if let Some(ms) = patch.anim_ms {
                o.anim_ms = ms;
            }
            if let Some(ms) = patch.auto_hide_ms {
                o.auto_hide_ms = (ms > 0).then_some(ms);
            }
            if let Some(screens) = patch.screens {
                o.screens = screens;
            }
            o.repair();
        }
        Action::SetOverlayOn { channel, value } => {
            let o = channel_mut(s, channel)?;
            if value && o.source_id.is_none() {
                return Err(ActionError::invalid(
                    "overlay",
                    "choose an input for this overlay first",
                ));
            }
            o.set_on(value, now);
            if value {
                o.in_next = false;
            }
            // A video overlay starts when it comes on.
            if let (true, Some(id)) = (value, o.source_id.clone()) {
                start_if_video(s, &id, now);
            }
        }
        Action::SetOverlayInNext { channel, value } => {
            let o = channel_mut(s, channel)?;
            if value && o.source_id.is_none() {
                return Err(ActionError::invalid(
                    "overlay",
                    "choose an input for this overlay first",
                ));
            }
            o.in_next = value;
        }
        Action::OverlaysOff => {
            for o in &mut s.overlays {
                o.set_on(false, now);
                o.in_next = false;
            }
        }
        _ => {}
    }
    Ok(())
}

/// The 12 Pesukim actions.
fn apply_pesukim(s: &mut Show, action: Action, now: Millis) -> Result<()> {
    match action {
        Action::PesukimNext { id } => {
            pesukim_mut(s, &id)?.next(now);
            Ok(())
        }
        Action::PesukimBack { id } => {
            pesukim_mut(s, &id)?.back(now);
            Ok(())
        }
        Action::PesukimGo { id, pasuk, word } => {
            pesukim_mut(s, &id)?.go(pasuk, word, now);
            Ok(())
        }
        Action::PesukimWhole { id, value } => {
            let p = pesukim_mut(s, &id)?;
            p.place.whole = value;
            if value {
                p.place.blank = false;
            }
            p.place.changed_at = now;
            Ok(())
        }
        Action::PesukimBlank { id, value } => {
            let p = pesukim_mut(s, &id)?;
            p.place.blank = value;
            p.place.changed_at = now;
            Ok(())
        }
        Action::UpdatePesukim { id, pesukim, look } => {
            if let Some(look) = &look {
                check_look(s, &id, look)?;
            }
            let p = pesukim_mut(s, &id)?;
            if let Some(list) = pesukim {
                p.pesukim = list;
            }
            if let Some(look) = look {
                p.look = look;
            }
            p.repair();
            Ok(())
        }
        _ => Ok(()),
    }
}

#[allow(clippy::too_many_lines)]
fn apply_to(s: &mut Show, action: Action, now: Millis) -> Result<()> {
    // Switching the Back Screen by hand means the operator wants it back:
    // stop following the Live Screen before doing it.
    if let Action::Take {
        screen: ScreenId::Back,
        ..
    }
    | Action::CutTo {
        screen: ScreenId::Back,
        ..
    }
    | Action::SetTbar {
        screen: ScreenId::Back,
        ..
    } = &action
    {
        s.back_follows_live = false;
    }
    match action {
        Action::AddSource { source } => add_source(s, source),
        Action::UpdateSource { id, patch } => update_source(s, &id, patch),
        Action::RemoveSource { id } => {
            let index = index_of(s, &id)?;
            s.sources.remove(index);
            for p in &mut s.presets {
                p.sources.retain(|x| x != &id);
            }
            if s.audio.solo.as_ref() == Some(&id) {
                s.audio.solo = None;
            }
            for src in &mut s.sources {
                match &mut src.kind {
                    SourceKind::Countdown { timer, .. } => {
                        if matches!(&timer.at_zero, AtZero::CutTo { source_id } if *source_id == id)
                        {
                            timer.at_zero = AtZero::Hide;
                        }
                    }
                    SourceKind::Slideshow(sh) => {
                        sh.slides.retain(
                            |sl| !matches!(sl, Slide::Input { source_id } if *source_id == id),
                        );
                        if sh.behind.as_ref() == Some(&id) {
                            sh.behind = None;
                        }
                        sh.repair();
                    }
                    SourceKind::Split(sp) => {
                        for b in &mut sp.boxes {
                            if b.source_id.as_ref() == Some(&id) {
                                b.source_id = None;
                            }
                        }
                    }
                    SourceKind::Pesukim(p) if p.look.behind.as_ref() == Some(&id) => {
                        p.look.behind = None;
                    }
                    _ => {}
                }
            }
            for o in &mut s.overlays {
                if o.source_id.as_ref() == Some(&id) {
                    o.source_id = None;
                    o.repair();
                }
            }
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
                require_picture(s, id)?;
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
            require_picture(s, &source_id)?;
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
        Action::SetBlank {
            screens,
            value,
            fade_ms,
        } => {
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
                    sc.blank_fade_ms = fade_ms.map_or(0, |ms| ms.clamp(100, 10_000));
                }
            }
            Ok(())
        }
        Action::FadeToBlack { screen } => {
            not_monitor(screen)?;
            let ms = s.settings.fade_to_black_ms;
            let sc = s.screens.get_mut(screen);
            sc.blank = !sc.blank;
            sc.blank_changed_at = now;
            sc.blank_fade_ms = ms;
            Ok(())
        }
        Action::SetFadeToBlackLength { ms } => {
            s.settings.fade_to_black_ms = ms.clamp(100, 10_000);
            Ok(())
        }
        Action::SetFavouriteTransition { index, transition } => {
            let slot = s
                .settings
                .favourite_transitions
                .get_mut(index)
                .ok_or_else(|| {
                    ActionError::invalid("index", "there are 4 favourite transitions")
                })?;
            *slot = transition.clamped();
            Ok(())
        }
        Action::PlayNow {
            screen,
            source_id,
            transition,
        } => {
            not_monitor(screen)?;
            require_picture(s, &source_id)?;
            let keep = s.screens.get(screen).preview.clone();
            s.screens.get_mut(screen).preview = Some(source_id);
            take(s, screen, transition.clamped(), now)?;
            if keep.is_some() {
                s.screens.get_mut(screen).preview = keep;
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
        Action::SetMasterMuted { value } => {
            s.audio.master_muted = value;
            Ok(())
        }
        Action::UpdateBus { bus, patch } => {
            let b = match bus {
                crate::audio::BusId::A => &mut s.audio.a,
                crate::audio::BusId::B => &mut s.audio.b,
            };
            if let Some(name) = patch.name {
                b.name = short_text(&name, MAX_BUS_NAME_LEN);
            }
            if let Some(v) = patch.volume {
                b.volume = finite(v, "volume")?.clamp(0.0, 1.0);
            }
            if let Some(m) = patch.muted {
                b.muted = m;
            }
            Ok(())
        }
        Action::SetSolo { source_id } => {
            if let Some(id) = &source_id {
                let src = s
                    .source(id)
                    .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
                if !src.kind.has_sound() {
                    return Err(ActionError::invalid("sourceId", "that input has no sound"));
                }
            }
            s.audio.solo = source_id;
            Ok(())
        }
        Action::SetAudioOutput { output, device_id } => {
            *s.settings.audio_outputs.get_mut(output) = device_id;
            Ok(())
        }
        Action::SetDisplay { screen, display_id } => {
            *s.settings.displays.get_mut(screen) = display_id;
            Ok(())
        }
        Action::SetBackFollowsLive { value } => {
            s.back_follows_live = value;
            Ok(())
        }
        Action::SetAutoPlayOnTake { value } => {
            s.settings.auto_play_on_take = value;
            Ok(())
        }
        Action::AddPreset { preset } => {
            let mut p = clean_preset(s, preset)?;
            if p.id.trim().is_empty() {
                p.id = next_preset_id(s);
            } else if s.presets.iter().any(|x| x.id == p.id) {
                return Err(ActionError::invalid(
                    "id",
                    "a preset with that id already exists",
                ));
            }
            s.presets.push(p);
            Ok(())
        }
        Action::UpdatePreset { preset } => {
            let i = preset_index(s, &preset.id)?;
            s.presets[i] = clean_preset(s, preset)?;
            Ok(())
        }
        Action::RemovePreset { id } => {
            let i = preset_index(s, &id)?;
            s.presets.remove(i);
            if s.active_preset.as_deref() == Some(id.as_str()) {
                s.active_preset = None;
            }
            Ok(())
        }
        Action::MovePreset { id, index } => {
            let from = preset_index(s, &id)?;
            let p = s.presets.remove(from);
            let to = index.min(s.presets.len());
            s.presets.insert(to, p);
            Ok(())
        }
        Action::PickPreset { id } => pick_preset(s, id, now),
        Action::NextPreset => step_preset(s, true, now),
        Action::PreviousPreset => step_preset(s, false, now),
        Action::RunSteps { name, steps } => {
            let steps = clean_steps(steps)?;
            if steps.is_empty() {
                return Ok(());
            }
            s.running.push(RunningSteps {
                name: short_text(&name, MAX_PRESET_NAME_LEN),
                steps,
                next: 0,
                resume_at: now,
            });
            run_steps(s, now);
            Ok(())
        }
        Action::StopSteps => {
            s.running.clear();
            Ok(())
        }
        Action::UpdateEvent { patch } => {
            let ev = &mut s.event;
            if let Some(name) = patch.name {
                ev.name = short_text(&name, crate::event::MAX_EVENT_NAME_LEN);
            }
            if let Some(path) = patch.logo {
                ev.logo = Some(path).filter(|p| !p.trim().is_empty());
            }
            if let Some(v) = patch.on_failure {
                ev.on_failure = v;
            }
            if let Some(v) = patch.panic_shows {
                ev.panic_shows = v;
            }
            if let Some(v) = patch.set_up {
                ev.set_up = v;
            }
            Ok(())
        }
        Action::UpdateMonitor { patch } => {
            update_monitor(s, patch);
            Ok(())
        }
        Action::SetQuickMessage { index, text } => {
            if index >= QUICK_MESSAGES {
                return Err(ActionError::invalid(
                    "index",
                    "there are 8 quick messages (0 – 7)",
                ));
            }
            s.monitor.quick[index] = short_text(&text, MAX_SHORT_TEXT_LEN);
            Ok(())
        }
        Action::UpdateCountdown { id, patch } => update_countdown(s, &id, patch),
        Action::SetCountdownLength { id, length_ms } => {
            let len = countdown_ms(length_ms, "lengthMs")?;
            let t = timer_mut(s, &id)?;
            t.length_ms = len;
            t.reset();
            Ok(())
        }
        Action::StartCountdown { id } => {
            timer_mut(s, &id)?.start(now);
            Ok(())
        }
        Action::PauseCountdown { id } => {
            timer_mut(s, &id)?.pause(now);
            Ok(())
        }
        Action::ResetCountdown { id } => {
            timer_mut(s, &id)?.reset();
            Ok(())
        }
        Action::AddCountdownTime { id, ms } => {
            if ms.unsigned_abs() > MAX_COUNTDOWN_MS {
                return Err(ActionError::invalid("ms", "at most 24 hours at a time"));
            }
            timer_mut(s, &id)?.add(ms, now);
            Ok(())
        }
        Action::SetCountdownRemaining { id, ms } => {
            timer_mut(s, &id)?.set_remaining(ms.min(MAX_COUNTDOWN_MS), now);
            Ok(())
        }
        a @ (Action::SlideNext { .. }
        | Action::SlidePrevious { .. }
        | Action::SlideGo { .. }
        | Action::UpdateSlideshow { .. }) => apply_slideshow(s, a, now),
        Action::UpdateSplit { id, split } => {
            // Each box shows a picture that exists, and never a split screen
            // (so nothing can contain itself).
            for b in &split.boxes {
                if let Some(bid) = &b.source_id {
                    require_picture(s, bid)?;
                    if matches!(s.source(bid).map(|x| &x.kind), Some(SourceKind::Split(_))) {
                        return Err(ActionError::invalid(
                            "split",
                            "a split screen can't be inside another split screen",
                        ));
                    }
                }
            }
            let src = s
                .source_mut(&id)
                .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
            if !matches!(src.kind, SourceKind::Split(_)) {
                return Err(ActionError::invalid(
                    "split",
                    "that input is not a split screen",
                ));
            }
            let mut sp = split;
            sp.repair();
            src.kind = SourceKind::Split(Box::new(sp));
            Ok(())
        }
        a @ (Action::UpdateCredits { .. }
        | Action::CreditsPlay { .. }
        | Action::CreditsRestart { .. }
        | Action::CreditsSpeed { .. }) => apply_credits(s, a, now),
        a @ (Action::SetCues { .. }
        | Action::StartShow { .. }
        | Action::StopShow
        | Action::PauseShow { .. }
        | Action::NextCue
        | Action::GoCue { .. }) => apply_run(s, a, now),
        Action::RelinkMedia { from, to } => {
            crate::media::relink(s, &from, &to);
            Ok(())
        }
        Action::UpdateBrowser { id, browser } => {
            let url = crate::browser::clean_url(&browser.url)
                .ok_or_else(|| ActionError::invalid("url", "that is not a web address"))?;
            let src = s
                .source_mut(&id)
                .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
            if !matches!(src.kind, SourceKind::Browser(_)) {
                return Err(ActionError::invalid(
                    "browser",
                    "that input is not a web page",
                ));
            }
            let mut b = browser;
            b.url = url;
            b.repair();
            src.kind = SourceKind::Browser(Box::new(b));
            Ok(())
        }
        Action::UpdateLogo3d { id, logo } => {
            let src = s
                .source_mut(&id)
                .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
            if !matches!(src.kind, SourceKind::Logo3d(_)) {
                return Err(ActionError::invalid("logo", "that input is not a 3D logo"));
            }
            let mut l = logo;
            l.repair();
            src.kind = SourceKind::Logo3d(Box::new(l));
            Ok(())
        }
        Action::UpdateText { id, text } => {
            let src = s
                .source_mut(&id)
                .ok_or_else(|| ActionError::UnknownSource { id: id.clone() })?;
            if !matches!(src.kind, SourceKind::Text(_)) {
                return Err(ActionError::invalid(
                    "text",
                    "that input is not a text input",
                ));
            }
            let mut t = text;
            t.repair();
            src.kind = SourceKind::Text(Box::new(t));
            Ok(())
        }
        a @ (Action::VisualsScene { .. }
        | Action::VisualsStep { .. }
        | Action::VisualsTempo { .. }
        | Action::VisualsSync
        | Action::VisualsFlash
        | Action::UpdateVisuals { .. }
        | Action::VisualsLook { .. }) => apply_visuals(s, a, now),
        a @ (Action::SetOverlaySource { .. }
        | Action::UpdateOverlay { .. }
        | Action::SetOverlayOn { .. }
        | Action::SetOverlayInNext { .. }
        | Action::OverlaysOff) => apply_overlay(s, a, now),
        a @ (Action::PesukimNext { .. }
        | Action::PesukimBack { .. }
        | Action::PesukimGo { .. }
        | Action::PesukimWhole { .. }
        | Action::PesukimBlank { .. }
        | Action::UpdatePesukim { .. }) => apply_pesukim(s, a, now),
        Action::CountdownTo { id, at } => {
            if at <= now {
                return Err(ActionError::invalid("at", "that time has already passed"));
            }
            let left = countdown_ms(at - now, "at")?;
            let t = timer_mut(s, &id)?;
            t.length_ms = left;
            t.remaining_ms = left;
            t.ends_at = Some(at);
            t.fired = false;
            Ok(())
        }
    }
}

// ---------- presets and their steps ----------

fn preset_index(s: &Show, id: &str) -> Result<usize> {
    s.presets
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| ActionError::invalid("id", "there is no such preset"))
}

fn next_preset_id(s: &Show) -> String {
    let mut n = s.presets.len() + 1;
    while s.presets.iter().any(|p| p.id == format!("preset-{n}")) {
        n += 1;
    }
    format!("preset-{n}")
}

fn clean_preset(s: &Show, p: Preset) -> Result<Preset> {
    if p.screen == ScreenId::Monitor {
        return Err(ActionError::MonitorIsTextOnly);
    }
    for id in &p.sources {
        require_source(s, id)?;
    }
    let name = short_text(&p.name, MAX_PRESET_NAME_LEN);
    let mut buttons = Vec::with_capacity(p.buttons.len());
    for b in p.buttons {
        let bname = short_text(&b.name, MAX_PRESET_NAME_LEN);
        buttons.push(PresetButton {
            name: if bname.is_empty() {
                "Button".to_owned()
            } else {
                bname
            },
            steps: clean_steps(b.steps)?,
        });
    }
    let mut sources = p.sources;
    let mut seen = std::collections::HashSet::new();
    sources.retain(|x| seen.insert(x.clone()));
    Ok(Preset {
        id: p.id.trim().to_owned(),
        name: if name.is_empty() {
            "Preset".to_owned()
        } else {
            name
        },
        category: short_text(&p.category, MAX_PRESET_NAME_LEN),
        screen: p.screen,
        sources,
        transition: p.transition.map(Transition::clamped),
        load_first: p.load_first,
        buttons,
    })
}

fn clean_steps(steps: Vec<Step>) -> Result<Vec<Step>> {
    if steps.len() > MAX_STEPS {
        return Err(ActionError::invalid(
            "steps",
            "at most 50 steps in one button",
        ));
    }
    steps
        .into_iter()
        .map(|st| match st {
            Step::Wait { ms } if ms > MAX_WAIT_MS => Err(ActionError::invalid(
                "steps",
                "a wait can be at most 10 minutes",
            )),
            Step::MonitorMessage { text } => Ok(Step::MonitorMessage {
                text: short_text(&text, MAX_MESSAGE_LEN),
            }),
            other => Ok(other),
        })
        .collect()
}

fn pick_preset(s: &mut Show, id: Option<String>, _now: Millis) -> Result<()> {
    let Some(id) = id else {
        s.active_preset = None;
        return Ok(());
    };
    let p = s.presets[preset_index(s, &id)?].clone();
    s.active_preset = Some(id);
    if let Some(t) = p.transition {
        s.transition = t.clamped();
    }
    if p.load_first {
        let first = p
            .sources
            .iter()
            .find(|x| s.source(x).is_some_and(|src| !src.kind.is_sound_only()))
            .cloned();
        if let Some(first) = first {
            let sc = s.screens.get_mut(p.screen);
            if sc.program.as_ref() != Some(&first) {
                sc.preview = Some(first);
                sc.tbar = 0.0;
            }
        }
    }
    Ok(())
}

fn step_preset(s: &mut Show, forward: bool, now: Millis) -> Result<()> {
    if s.presets.is_empty() {
        return Ok(());
    }
    let last = s.presets.len() - 1;
    let at = s
        .active_preset
        .as_deref()
        .and_then(|id| s.presets.iter().position(|p| p.id == id));
    let to = match (at, forward) {
        (None, true) => 0,
        (None, false) => last,
        (Some(i), true) => (i + 1).min(last),
        (Some(i), false) => i.saturating_sub(1),
    };
    let id = s.presets[to].id.clone();
    pick_preset(s, Some(id), now)
}

/// Turn a step into the action it stands for (waits are handled by the runner).
fn step_action(step: Step, main: Option<&SourceId>) -> Option<Action> {
    Some(match step {
        Step::Preview { screen, source_id } => Action::SetPreview { screen, source_id },
        Step::Take { screen, transition } => Action::Take {
            screen,
            transition,
            duration_ms: None,
        },
        Step::CutTo { screen, source_id } => Action::CutTo { screen, source_id },
        Step::Blank { screens, value } => Action::SetBlank {
            screens,
            value,
            fade_ms: None,
        },
        Step::MonitorMessage { text } => Action::UpdateMonitor {
            patch: MonitorPatch {
                message: Some(text),
                message_on: Some(true),
                ..MonitorPatch::default()
            },
        },
        Step::ClearMonitorMessage => Action::UpdateMonitor {
            patch: MonitorPatch {
                message_on: Some(false),
                ..MonitorPatch::default()
            },
        },
        Step::StartCountdown { source_id } => Action::StartCountdown {
            id: source_id.or_else(|| main.cloned())?,
        },
        Step::PauseCountdown { source_id } => Action::PauseCountdown {
            id: source_id.or_else(|| main.cloned())?,
        },
        Step::ResetCountdown { source_id } => Action::ResetCountdown {
            id: source_id.or_else(|| main.cloned())?,
        },
        Step::SetCountdownLength {
            source_id,
            length_ms,
        } => Action::SetCountdownLength {
            id: source_id.or_else(|| main.cloned())?,
            length_ms,
        },
        Step::Play { source_id } => Action::Play { id: source_id },
        Step::Pause { source_id } => Action::Pause { id: source_id },
        Step::BackFollowsLive { value } => Action::SetBackFollowsLive { value },
        Step::Overlay { channel, value } => Action::SetOverlayOn { channel, value },
        Step::Preset { preset_id } => Action::PickPreset {
            id: Some(preset_id),
        },
        Step::Wait { .. } => return None,
    })
}

/// Run every step that is due. A step that cannot be done (say, its input
/// was removed) is skipped so the rest still run.
fn run_steps(s: &mut Show, now: Millis) {
    let mut running = std::mem::take(&mut s.running);
    for r in &mut running {
        while r.resume_at <= now && r.next < r.steps.len() {
            let step = r.steps[r.next].clone();
            r.next += 1;
            if let Step::Wait { ms } = step {
                // Timed from when the wait was due, so waits never drift.
                r.resume_at = r.resume_at.saturating_add(u64::from(ms));
            } else if let Some(action) = step_action(step, s.main_countdown()) {
                let _ = apply_to(s, action, now);
            }
        }
    }
    running.retain(|r| r.next < r.steps.len());
    s.running = running;
}

// ---------- stage monitor and countdown ----------

fn update_monitor(s: &mut Show, p: MonitorPatch) {
    let m = &mut s.monitor;
    if let Some(text) = p.message {
        m.message = short_text(&text, MAX_MESSAGE_LEN);
    }
    if let Some(v) = p.message_on {
        m.message_on = v;
    }
    if let Some(v) = p.layout {
        m.layout = v;
    }
    if let Some(v) = p.show_clock {
        m.show_clock = v;
    }
    if let Some(v) = p.show_timer {
        m.show_timer = v;
    }
    if let Some(v) = p.text_size {
        m.text_size = v;
    }
    if let Some(v) = p.clock_24h {
        m.clock_24h = v;
    }
}

fn update_countdown(s: &mut Show, id: &SourceId, p: CountdownPatch) -> Result<()> {
    if let Some(AtZero::CutTo { source_id }) = &p.at_zero {
        require_picture(s, source_id)?;
    }
    let c = timer_mut(s, id)?;
    if let Some(text) = p.label {
        c.label = short_text(&text, MAX_SHORT_TEXT_LEN);
    }
    if let Some(text) = p.end_text {
        c.end_text = short_text(&text, MAX_SHORT_TEXT_LEN);
    }
    if let Some(v) = p.format {
        c.format = v;
    }
    if let Some(v) = p.at_zero {
        c.at_zero = v;
    }
    Ok(())
}

fn countdown_ms(ms: u64, field: &str) -> Result<u64> {
    if ms == 0 || ms > MAX_COUNTDOWN_MS {
        return Err(ActionError::invalid(
            field,
            "must be between 1 second and 24 hours",
        ));
    }
    Ok(ms)
}

/// Trimmed, one line, at most `max` characters.
pub(crate) fn short_text(text: &str, max: usize) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max)
        .collect()
}

// ---------- Back follows Live ----------

/// Keep the Back Screen showing the Live Screen while following is on.
///
/// - Just switched on: the Back Screen moves to what Live shows, using the
///   show's transition, so the audience never sees a jump.
/// - Already following and the Live Screen changed: the Back Screen copies it
///   exactly (same source, same transition, same timing), so both play in sync.
///
/// The Back Screen keeps its own preview and its own blank.
fn follow_live(s: &mut Show, live_before: &ScreenState, was_following: bool, now: Millis) {
    if !s.back_follows_live {
        return;
    }
    let live = s.screens.live.clone();
    let back = &mut s.screens.back;
    if !was_following {
        if back.program != live.program {
            back.previous = back
                .program
                .clone()
                .filter(|b| Some(b) != live.program.as_ref());
            back.program.clone_from(&live.program);
            let t = s.transition;
            back.transition = Some(ActiveTransition {
                kind: t.kind,
                duration_ms: t.duration_ms,
                started_at: now,
            });
        }
        back.tbar = 0.0;
    } else if &live != live_before {
        back.program = live.program;
        back.previous = live.previous;
        back.transition = live.transition;
        back.tbar = live.tbar;
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
    // Broadcast convention: what was on air drops back into Next. When
    // nothing was on air, Next is left empty rather than showing the same
    // picture twice.
    sc.preview = outgoing;
    sc.transition = Some(ActiveTransition {
        kind: t.kind,
        duration_ms: t.duration_ms,
        started_at: now,
    });
    sc.tbar = 0.0;
    start_if_video(s, &incoming, now);
    start_if_countdown(s, &incoming, now);
    // Credits roll from the top when they go on air.
    if let Ok(c) = credits_mut(s, &incoming) {
        if !c.playing {
            c.restart(now);
            c.play(true, now);
        }
    }
    Ok(())
}

/// A countdown waits in Next and starts counting when it goes on air.
fn start_if_countdown(s: &mut Show, id: &SourceId, now: Millis) {
    if let Ok(timer) = timer_mut(s, id) {
        if !timer.running() {
            timer.start(now);
        }
    }
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
    let mut audio = new.audio.unwrap_or_else(|| {
        if kind.is_sound_only() {
            SourceAudio::live()
        } else {
            SourceAudio::default()
        }
    });
    audio.delay_ms = audio.delay_ms.min(crate::audio::MAX_AUDIO_DELAY_MS);
    let src = Source {
        id,
        name: clean_name(&new.name),
        kind,
        volume: finite(new.volume.unwrap_or(1.0), "volume")?.clamp(0.0, 1.0),
        muted: new.muted.unwrap_or(false),
        looping: new.looping.unwrap_or(false),
        fit: new.fit.unwrap_or_default(),
        audio,
        key: new.key.map_or_else(ChromaKey::default, |mut k| {
            k.repair();
            k
        }),
        adjust: crate::adjust::Adjust::default(),
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
            SourceKind::Color { color }
            | SourceKind::Countdown {
                background: color, ..
            } => {
                *color = clean_color(&c)?;
            }
            _ => {
                return Err(ActionError::invalid(
                    "color",
                    "only colour sources have a colour",
                ))
            }
        }
    }
    if let Some(path) = patch.logo {
        match &mut src.kind {
            SourceKind::Countdown { logo, .. } => {
                *logo = Some(path).filter(|p| !p.trim().is_empty());
            }
            _ => {
                return Err(ActionError::invalid(
                    "logo",
                    "only countdown inputs have an event logo",
                ))
            }
        }
    }
    if let Some(a) = patch.audio {
        src.audio.apply(&a);
    }
    if let Some(mut k) = patch.key {
        if !matches!(
            src.kind,
            SourceKind::Camera { .. } | SourceKind::Video { .. } | SourceKind::Image { .. }
        ) {
            return Err(ActionError::invalid(
                "key",
                "green screen works on cameras, videos and pictures",
            ));
        }
        k.repair();
        src.key = k;
    }
    if let Some(mut a) = patch.adjust {
        if !matches!(
            src.kind,
            SourceKind::Camera { .. } | SourceKind::Video { .. } | SourceKind::Image { .. }
        ) {
            return Err(ActionError::invalid(
                "adjust",
                "adjustments work on cameras, videos and pictures",
            ));
        }
        a.repair();
        src.adjust = a;
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
        SourceKind::Visuals => SourceKind::Visuals,
        SourceKind::Logo3d(mut l) => {
            l.repair();
            SourceKind::Logo3d(l)
        }
        SourceKind::Browser(mut b) => {
            b.url = crate::browser::clean_url(&b.url)
                .ok_or_else(|| ActionError::invalid("url", "that is not a web address"))?;
            b.repair();
            SourceKind::Browser(b)
        }
        SourceKind::Microphone { device_id, label } => SourceKind::Microphone { device_id, label },
        SourceKind::Slideshow(mut sh) => {
            sh.current = 0;
            sh.behind = None;
            sh.repair();
            SourceKind::Slideshow(sh)
        }
        SourceKind::Split(mut sp) => {
            sp.repair();
            SourceKind::Split(sp)
        }
        SourceKind::Credits(mut c) => {
            c.playing = false;
            c.pos_ms = 0;
            c.repair();
            SourceKind::Credits(c)
        }
        SourceKind::Text(mut t) => {
            t.repair();
            SourceKind::Text(t)
        }
        SourceKind::Pesukim(mut p) => {
            clean_color(&p.look.background)?;
            clean_color(&p.look.text_color)?;
            // Something to go behind is chosen after adding (it must exist).
            p.look.behind = None;
            p.place = crate::pesukim::PesukimPlace::default();
            p.repair();
            SourceKind::Pesukim(p)
        }
        SourceKind::Countdown {
            background,
            logo,
            timer,
        } => SourceKind::Countdown {
            background: clean_color(&background)?,
            logo: logo.filter(|p| !p.trim().is_empty()),
            // A new countdown input waits, ready to start from its length.
            timer: crate::stage::Countdown {
                ends_at: None,
                remaining_ms: timer.length_ms.clamp(1_000, MAX_COUNTDOWN_MS),
                length_ms: timer.length_ms.clamp(1_000, MAX_COUNTDOWN_MS),
                fired: false,
                ..timer
            },
        },
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

/// A source that can go on a screen (exists and is not sound only).
fn require_picture(s: &Show, id: &SourceId) -> Result<()> {
    match s.source(id) {
        None => Err(ActionError::UnknownSource { id: id.clone() }),
        Some(src) if src.kind.is_sound_only() => Err(ActionError::SoundOnly { id: id.clone() }),
        Some(_) => Ok(()),
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
