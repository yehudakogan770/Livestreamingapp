//! Pure time calculations shared by the engine and every window.

use crate::model::{Millis, ScreenState, Source, SourceKind, TransitionKind};

/// Current playback position of a video, in seconds, at time `now`.
/// Non-video sources are always at position 0.
pub fn source_position(src: &Source, now: Millis) -> f64 {
    let SourceKind::Video {
        duration_s,
        playback,
        ..
    } = &src.kind
    else {
        return 0.0;
    };
    let mut pos = if playback.playing {
        playback.pos_s + now.saturating_sub(playback.at) as f64 / 1000.0
    } else {
        playback.pos_s
    };
    if *duration_s > 0.0 {
        if src.looping {
            pos = pos.rem_euclid(*duration_s);
        } else {
            pos = pos.min(*duration_s);
        }
    }
    pos.max(0.0)
}

/// True when a non-looping video has played to its end.
pub fn source_ended(src: &Source, now: Millis) -> bool {
    match &src.kind {
        SourceKind::Video { duration_s, .. } => {
            !src.looping && *duration_s > 0.0 && source_position(src, now) >= duration_s - 0.05
        }
        _ => false,
    }
}

/// Progress of a screen's current transition, from 0.0 (just started) to 1.0
/// (finished). A screen with no running transition is always at 1.0.
pub fn transition_progress(screen: &ScreenState, now: Millis) -> f32 {
    let Some(t) = screen.transition else {
        return 1.0;
    };
    if screen.previous.is_none() || t.kind == TransitionKind::Cut || t.duration_ms == 0 {
        return 1.0;
    }
    let elapsed = now.saturating_sub(t.started_at) as f32;
    (elapsed / t.duration_ms as f32).clamp(0.0, 1.0)
}

/// True while a transition is still animating on this screen.
pub fn in_transition(screen: &ScreenState, now: Millis) -> bool {
    transition_progress(screen, now) < 1.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ActiveTransition, Fit, Playback, SourceId};

    fn video(duration_s: f64, looping: bool, playback: Playback) -> Source {
        Source {
            id: SourceId::new("v"),
            name: "Video".into(),
            kind: SourceKind::Video {
                path: String::new(),
                duration_s,
                playback,
            },
            volume: 1.0,
            muted: false,
            looping,
            fit: Fit::Contain,
        }
    }

    #[test]
    fn paused_video_stays_put() {
        let v = video(
            30.0,
            false,
            Playback {
                playing: false,
                pos_s: 12.0,
                at: 1_000,
            },
        );
        assert!((source_position(&v, 99_000) - 12.0).abs() < 1e-9);
    }

    #[test]
    fn playing_video_advances_with_the_clock() {
        let v = video(
            30.0,
            false,
            Playback {
                playing: true,
                pos_s: 2.0,
                at: 1_000,
            },
        );
        assert!((source_position(&v, 4_500) - 5.5).abs() < 1e-9);
    }

    #[test]
    fn looping_video_wraps_around() {
        let v = video(
            10.0,
            true,
            Playback {
                playing: true,
                pos_s: 8.0,
                at: 0,
            },
        );
        assert!((source_position(&v, 5_000) - 3.0).abs() < 1e-9);
        assert!(!source_ended(&v, 5_000));
    }

    #[test]
    fn non_looping_video_stops_at_the_end() {
        let v = video(
            10.0,
            false,
            Playback {
                playing: true,
                pos_s: 8.0,
                at: 0,
            },
        );
        assert!((source_position(&v, 5_000) - 10.0).abs() < 1e-9);
        assert!(source_ended(&v, 5_000));
    }

    #[test]
    fn clock_going_backwards_never_panics() {
        let v = video(
            10.0,
            false,
            Playback {
                playing: true,
                pos_s: 1.0,
                at: 5_000,
            },
        );
        assert!((source_position(&v, 1_000) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn transition_progress_runs_from_zero_to_one() {
        let screen = ScreenState {
            previous: Some(SourceId::new("a")),
            program: Some(SourceId::new("b")),
            transition: Some(ActiveTransition {
                kind: TransitionKind::Fade,
                duration_ms: 1_000,
                started_at: 10_000,
            }),
            ..ScreenState::default()
        };
        assert!(transition_progress(&screen, 10_000).abs() < 1e-6);
        assert!((transition_progress(&screen, 10_250) - 0.25).abs() < 1e-6);
        assert!((transition_progress(&screen, 20_000) - 1.0).abs() < 1e-6);
        assert!(in_transition(&screen, 10_500));
        assert!(!in_transition(&screen, 11_000));
    }

    #[test]
    fn cuts_have_no_animation() {
        let screen = ScreenState {
            previous: Some(SourceId::new("a")),
            transition: Some(ActiveTransition {
                kind: TransitionKind::Cut,
                duration_ms: 100,
                started_at: 0,
            }),
            ..ScreenState::default()
        };
        assert!((transition_progress(&screen, 0) - 1.0).abs() < 1e-6);
    }
}
