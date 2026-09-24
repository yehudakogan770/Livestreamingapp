//! Behaviour tests for the show engine.

use lumora_engine::persist::{load_json, save_json};
use lumora_engine::*;

fn color(name: &str) -> Action {
    Action::AddSource {
        source: NewSource {
            id: None,
            name: name.into(),
            kind: SourceKind::Color {
                color: "#112233".into(),
            },
            volume: None,
            muted: None,
            looping: None,
            fit: None,
        },
    }
}

fn video(name: &str, duration_s: f64) -> Action {
    Action::AddSource {
        source: NewSource {
            id: None,
            name: name.into(),
            kind: SourceKind::Video {
                path: format!("C:/media/{name}.mp4"),
                duration_s,
                playback: Playback::default(),
            },
            volume: None,
            muted: None,
            looping: None,
            fit: None,
        },
    }
}

fn id(s: &str) -> SourceId {
    SourceId::new(s)
}

/// An engine with two colour sources (src-1, src-2) and src-1 on air on Live.
fn on_air() -> Engine {
    let mut e = Engine::new();
    e.apply(color("Camera 1"), 0).unwrap();
    e.apply(color("Camera 2"), 0).unwrap();
    e.apply(
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: Some(id("src-1")),
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::Take {
            screen: ScreenId::Live,
            transition: Some(TransitionKind::Cut),
            duration_ms: None,
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: Some(id("src-2")),
        },
        0,
    )
    .unwrap();
    e
}

// ---------- sources ----------

#[test]
fn sources_get_sequential_ids_and_clean_values() {
    let mut e = Engine::new();
    e.apply(color("  Camera 1  "), 0).unwrap();
    e.apply(color(""), 0).unwrap();
    let s = e.show();
    assert_eq!(s.sources[0].id, id("src-1"));
    assert_eq!(s.sources[0].name, "Camera 1");
    assert_eq!(s.sources[1].id, id("src-2"));
    assert_eq!(s.sources[1].name, "Untitled");
}

#[test]
fn duplicate_ids_are_refused() {
    let mut e = Engine::new();
    let a = Action::AddSource {
        source: NewSource {
            id: Some(id("cam")),
            name: "A".into(),
            kind: SourceKind::Pattern,
            volume: None,
            muted: None,
            looping: None,
            fit: None,
        },
    };
    e.apply(a.clone(), 0).unwrap();
    assert_eq!(
        e.apply(a, 0),
        Err(ActionError::DuplicateSource { id: id("cam") })
    );
    assert_eq!(e.show().sources.len(), 1);
}

#[test]
fn bad_colours_are_refused_and_change_nothing() {
    let mut e = Engine::new();
    let bad = Action::AddSource {
        source: NewSource {
            id: None,
            name: "x".into(),
            kind: SourceKind::Color {
                color: "red".into(),
            },
            volume: None,
            muted: None,
            looping: None,
            fit: None,
        },
    };
    assert!(matches!(
        e.apply(bad, 0),
        Err(ActionError::InvalidValue { .. })
    ));
    assert!(e.show().sources.is_empty());
    assert_eq!(e.revision(), 0);
}

#[test]
fn removing_a_source_clears_it_from_every_screen() {
    let mut e = on_air();
    e.apply(Action::RemoveSource { id: id("src-1") }, 10)
        .unwrap();
    let live = &e.show().screens.live;
    assert_eq!(live.program, None);
    assert_eq!(live.preview, Some(id("src-2")));
}

#[test]
fn moving_a_source_reorders_it() {
    let mut e = on_air();
    e.apply(color("Camera 3"), 0).unwrap();
    e.apply(
        Action::MoveSource {
            id: id("src-3"),
            index: 0,
        },
        0,
    )
    .unwrap();
    let order: Vec<_> = e
        .show()
        .sources
        .iter()
        .map(|s| s.id.as_str().to_owned())
        .collect();
    assert_eq!(order, ["src-3", "src-1", "src-2"]);
    // Index past the end means "move to the end".
    e.apply(
        Action::MoveSource {
            id: id("src-3"),
            index: 99,
        },
        0,
    )
    .unwrap();
    assert_eq!(e.show().sources.last().unwrap().id, id("src-3"));
}

#[test]
fn update_clamps_volume_and_rejects_nan() {
    let mut e = on_air();
    e.apply(
        Action::UpdateSource {
            id: id("src-1"),
            patch: SourcePatch {
                volume: Some(3.0),
                ..Default::default()
            },
        },
        0,
    )
    .unwrap();
    assert!((e.show().sources[0].volume - 1.0).abs() < f32::EPSILON);
    let nan = Action::UpdateSource {
        id: id("src-1"),
        patch: SourcePatch {
            volume: Some(f32::NAN),
            ..Default::default()
        },
    };
    assert!(e.apply(nan, 0).is_err());
}

// ---------- switching ----------

#[test]
fn take_swaps_preview_and_program_and_records_the_transition() {
    let mut e = on_air();
    e.apply(
        Action::Take {
            screen: ScreenId::Live,
            transition: None,
            duration_ms: None,
        },
        5_000,
    )
    .unwrap();
    let live = &e.show().screens.live;
    assert_eq!(live.program, Some(id("src-2")));
    assert_eq!(
        live.preview,
        Some(id("src-1")),
        "what was on air drops back into preview"
    );
    assert_eq!(live.previous, Some(id("src-1")));
    let t = live.transition.unwrap();
    assert_eq!(t.kind, TransitionKind::Fade);
    assert_eq!(t.duration_ms, 800);
    assert_eq!(t.started_at, 5_000);
    assert!(in_transition(live, 5_400));
    assert!(!in_transition(live, 5_800));
}

#[test]
fn take_with_nothing_in_preview_is_refused() {
    let mut e = Engine::new();
    assert_eq!(
        e.apply(
            Action::Take {
                screen: ScreenId::Back,
                transition: None,
                duration_ms: None
            },
            0
        ),
        Err(ActionError::NothingInPreview {
            screen: ScreenId::Back
        })
    );
}

#[test]
fn transition_durations_are_kept_in_range() {
    let mut e = on_air();
    e.apply(
        Action::Take {
            screen: ScreenId::Live,
            transition: Some(TransitionKind::Wipe),
            duration_ms: Some(1),
        },
        0,
    )
    .unwrap();
    assert_eq!(
        e.show().screens.live.transition.unwrap().duration_ms,
        MIN_TRANSITION_MS
    );
    e.apply(
        Action::SetTransition {
            kind: Some(TransitionKind::Dip),
            duration_ms: Some(999_999),
        },
        0,
    )
    .unwrap();
    assert_eq!(
        e.show().transition,
        Transition {
            kind: TransitionKind::Dip,
            duration_ms: MAX_TRANSITION_MS
        }
    );
}

#[test]
fn screens_are_independent() {
    let mut e = on_air();
    e.apply(
        Action::SetPreview {
            screen: ScreenId::Back,
            source_id: Some(id("src-2")),
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::Take {
            screen: ScreenId::Back,
            transition: None,
            duration_ms: None,
        },
        0,
    )
    .unwrap();
    assert_eq!(e.show().screens.back.program, Some(id("src-2")));
    assert_eq!(
        e.show().screens.live.program,
        Some(id("src-1")),
        "Live is untouched"
    );
}

#[test]
fn the_monitor_never_shows_sources() {
    let mut e = on_air();
    assert_eq!(
        e.apply(
            Action::SetPreview {
                screen: ScreenId::Monitor,
                source_id: Some(id("src-1"))
            },
            0
        ),
        Err(ActionError::MonitorIsTextOnly)
    );
    assert_eq!(
        e.apply(
            Action::CutTo {
                screen: ScreenId::Monitor,
                source_id: id("src-1")
            },
            0
        ),
        Err(ActionError::MonitorIsTextOnly)
    );
}

#[test]
fn cut_to_goes_straight_to_air_and_keeps_the_preview() {
    let mut e = on_air();
    e.apply(color("Camera 3"), 0).unwrap();
    e.apply(
        Action::CutTo {
            screen: ScreenId::Live,
            source_id: id("src-3"),
        },
        100,
    )
    .unwrap();
    let live = &e.show().screens.live;
    assert_eq!(live.program, Some(id("src-3")));
    assert_eq!(live.preview, Some(id("src-2")));
    assert_eq!(live.transition.unwrap().kind, TransitionKind::Cut);
}

#[test]
fn tbar_moves_and_completes_the_take_at_the_end() {
    let mut e = on_air();
    e.apply(
        Action::SetTbar {
            screen: ScreenId::Live,
            value: 0.4,
        },
        0,
    )
    .unwrap();
    assert!((e.show().screens.live.tbar - 0.4).abs() < 1e-6);
    assert_eq!(e.show().screens.live.program, Some(id("src-1")));
    e.apply(
        Action::SetTbar {
            screen: ScreenId::Live,
            value: 1.0,
        },
        0,
    )
    .unwrap();
    let live = &e.show().screens.live;
    assert_eq!(live.program, Some(id("src-2")));
    assert!(live.tbar.abs() < 1e-6);
    assert_eq!(
        live.transition.unwrap().kind,
        TransitionKind::Cut,
        "the fader already did the mix"
    );
}

#[test]
fn tbar_rejects_nan_and_needs_a_preview() {
    let mut e = on_air();
    assert!(e
        .apply(
            Action::SetTbar {
                screen: ScreenId::Live,
                value: f32::NAN
            },
            0
        )
        .is_err());
    e.apply(
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: None,
        },
        0,
    )
    .unwrap();
    assert_eq!(
        e.apply(
            Action::SetTbar {
                screen: ScreenId::Live,
                value: 0.5
            },
            0
        ),
        Err(ActionError::NothingInPreview {
            screen: ScreenId::Live
        })
    );
}

// ---------- blank & panic ----------

#[test]
fn blank_and_panic_are_recorded_with_their_time() {
    let mut e = on_air();
    e.apply(
        Action::SetBlank {
            screens: vec![ScreenId::Back, ScreenId::Live],
            value: true,
        },
        700,
    )
    .unwrap();
    assert!(e.show().screens.back.blank && e.show().screens.live.blank);
    assert_eq!(e.show().screens.back.blank_changed_at, 700);
    assert!(!e.show().screens.monitor.blank);

    e.apply(Action::Panic { value: true }, 900).unwrap();
    assert!(e.show().panic);
    assert_eq!(e.show().panic_changed_at, 900);
    // Pressing panic again while already in panic changes nothing.
    assert_eq!(
        e.apply(Action::Panic { value: true }, 950).unwrap(),
        Outcome::Unchanged
    );
}

#[test]
fn unchanged_actions_do_not_bump_the_revision() {
    let mut e = on_air();
    let r = e.revision();
    assert_eq!(
        e.apply(Action::SetMasterVolume { value: 1.0 }, 0).unwrap(),
        Outcome::Unchanged
    );
    assert_eq!(e.revision(), r);
    assert_eq!(
        e.apply(Action::SetMasterVolume { value: 0.5 }, 0).unwrap(),
        Outcome::Changed
    );
    assert_eq!(e.revision(), r + 1);
}

// ---------- video ----------

#[test]
fn taking_a_video_starts_it_and_it_can_be_paused_and_seeked() {
    let mut e = Engine::new();
    e.apply(video("Opening", 130.0), 0).unwrap();
    e.apply(
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: Some(id("src-1")),
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::Take {
            screen: ScreenId::Live,
            transition: None,
            duration_ms: None,
        },
        1_000,
    )
    .unwrap();
    let v = e.show().source(&id("src-1")).unwrap().clone();
    assert!((source_position(&v, 11_000) - 10.0).abs() < 1e-9);

    e.apply(Action::Pause { id: id("src-1") }, 11_000).unwrap();
    e.apply(
        Action::Seek {
            id: id("src-1"),
            pos_s: 60.0,
        },
        12_000,
    )
    .unwrap();
    let v = e.show().source(&id("src-1")).unwrap().clone();
    assert!((source_position(&v, 50_000) - 60.0).abs() < 1e-9);

    // Seeking past the end is held at the end.
    e.apply(
        Action::Seek {
            id: id("src-1"),
            pos_s: 9_999.0,
        },
        12_000,
    )
    .unwrap();
    let v = e.show().source(&id("src-1")).unwrap().clone();
    assert!((source_position(&v, 12_000) - 130.0).abs() < 1e-9);
}

#[test]
fn playing_a_finished_video_restarts_it() {
    let mut e = Engine::new();
    e.apply(video("Clip", 5.0), 0).unwrap();
    e.apply(Action::Play { id: id("src-1") }, 0).unwrap();
    e.apply(Action::Play { id: id("src-1") }, 10_000).unwrap();
    let v = e.show().source(&id("src-1")).unwrap().clone();
    assert!((source_position(&v, 11_000) - 1.0).abs() < 1e-9);
}

#[test]
fn playback_actions_on_non_videos_are_refused() {
    let mut e = on_air();
    assert_eq!(
        e.apply(Action::Play { id: id("src-1") }, 0),
        Err(ActionError::NotAVideo { id: id("src-1") })
    );
}

// ---------- saving ----------

#[test]
fn save_and_load_round_trip_resets_runtime_state() {
    let mut e = on_air();
    e.apply(
        Action::Take {
            screen: ScreenId::Live,
            transition: None,
            duration_ms: None,
        },
        100,
    )
    .unwrap();
    e.apply(Action::Panic { value: true }, 200).unwrap();
    e.apply(
        Action::SetDisplay {
            screen: ScreenId::Back,
            display_id: Some("DISPLAY3".into()),
        },
        0,
    )
    .unwrap();

    let loaded = load_json(&save_json(e.show())).unwrap();
    assert_eq!(loaded.sources, e.show().sources);
    assert_eq!(loaded.screens.live.program, Some(id("src-2")));
    assert_eq!(loaded.screens.live.transition, None);
    assert!(!loaded.panic, "never reopen in panic");
    assert_eq!(loaded.settings.displays.back.as_deref(), Some("DISPLAY3"));
}

#[test]
fn damaged_save_files_are_repaired() {
    let text = r#"{
        "version": 1,
        "sources": [
            { "id": "a", "name": "  ", "kind": { "type": "color", "color": "nope" }, "volume": 7, "muted": false, "looping": false, "fit": "contain" },
            { "id": "a", "name": "dup", "kind": { "type": "pattern" }, "volume": 1, "muted": false, "looping": false, "fit": "contain" }
        ],
        "screens": { "live": { "program": "missing" }, "monitor": { "program": "a" } },
        "transition": { "kind": "fade", "durationMs": 0 }
    }"#;
    let s = load_json(text).unwrap();
    assert_eq!(s.sources.len(), 1, "duplicate id dropped");
    assert_eq!(s.sources[0].name, "Untitled");
    assert!((s.sources[0].volume - 1.0).abs() < f32::EPSILON);
    assert_eq!(
        s.sources[0].kind,
        SourceKind::Color {
            color: "#000000".into()
        }
    );
    assert_eq!(
        s.screens.live.program, None,
        "pointer to a missing source removed"
    );
    assert_eq!(
        s.screens.monitor.program, None,
        "the monitor never holds a source"
    );
    assert_eq!(s.transition.duration_ms, MIN_TRANSITION_MS);
}

#[test]
fn garbage_and_future_files_are_refused() {
    assert!(load_json("not json").is_err());
    assert!(load_json(r#"{ "version": 999 }"#).is_err());
}

#[test]
fn actions_round_trip_through_json_the_way_the_ui_sends_them() {
    let json = r#"{ "type": "take", "screen": "back", "transition": "wipe", "durationMs": 600 }"#;
    let a: Action = serde_json::from_str(json).unwrap();
    assert_eq!(
        a,
        Action::Take {
            screen: ScreenId::Back,
            transition: Some(TransitionKind::Wipe),
            duration_ms: Some(600)
        }
    );
    let json = r#"{ "type": "setPreview", "screen": "live", "sourceId": null }"#;
    let a: Action = serde_json::from_str(json).unwrap();
    assert_eq!(
        a,
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: None
        }
    );
}
