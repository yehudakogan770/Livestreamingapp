//! Behavior tests for overlay channels.

use lumora_engine::persist::{load_json, save_json};
use lumora_engine::*;

fn apply(e: &mut Engine, a: Action, now: Millis) {
    e.apply(a, now).expect("action should be accepted");
}

fn id(s: &str) -> SourceId {
    SourceId::new(s)
}

fn add(e: &mut Engine, sid: &str, kind: SourceKind) {
    apply(
        e,
        Action::AddSource {
            source: NewSource {
                id: Some(id(sid)),
                name: sid.into(),
                kind,
                volume: None,
                muted: None,
                looping: None,
                fit: None,
                audio: None,
                key: None,
            },
        },
        0,
    );
}

fn setup() -> Engine {
    let mut e = Engine::new();
    add(
        &mut e,
        "logo",
        SourceKind::Image {
            path: "/logo.png".into(),
        },
    );
    add(&mut e, "cam", SourceKind::Pattern);
    add(
        &mut e,
        "mic",
        SourceKind::Microphone {
            device_id: "m".into(),
            label: "Mic".into(),
        },
    );
    apply(
        &mut e,
        Action::SetOverlaySource {
            channel: 0,
            source_id: Some(id("logo")),
        },
        0,
    );
    e
}

fn on(e: &Engine, ch: usize) -> bool {
    e.show().overlays[ch].on
}

#[test]
fn a_new_show_has_four_empty_channels() {
    let e = Engine::new();
    assert_eq!(e.show().overlays.len(), 4);
    assert!(e
        .show()
        .overlays
        .iter()
        .all(|o| o.source_id.is_none() && !o.on));
}

#[test]
fn an_overlay_goes_on_and_off_and_remembers_when() {
    let mut e = setup();
    apply(
        &mut e,
        Action::SetOverlayOn {
            channel: 0,
            value: true,
        },
        100,
    );
    assert!(on(&e, 0));
    assert_eq!(e.show().overlays[0].changed_at, 100);
    apply(
        &mut e,
        Action::SetOverlayOn {
            channel: 0,
            value: false,
        },
        900,
    );
    assert!(!on(&e, 0));
    assert_eq!(e.show().overlays[0].changed_at, 900);
}

#[test]
fn an_empty_channel_or_a_microphone_cannot_go_on() {
    let mut e = setup();
    assert!(e
        .apply(
            Action::SetOverlayOn {
                channel: 1,
                value: true
            },
            1
        )
        .is_err());
    assert!(e
        .apply(
            Action::SetOverlaySource {
                channel: 1,
                source_id: Some(id("mic"))
            },
            1
        )
        .is_err());
    assert!(e
        .apply(
            Action::SetOverlayOn {
                channel: 7,
                value: true
            },
            1
        )
        .is_err());
}

#[test]
fn it_can_be_set_up_in_next_then_sent_to_air() {
    let mut e = setup();
    apply(
        &mut e,
        Action::SetOverlayInNext {
            channel: 0,
            value: true,
        },
        1,
    );
    assert!(e.show().overlays[0].in_next && !on(&e, 0));
    apply(
        &mut e,
        Action::SetOverlayOn {
            channel: 0,
            value: true,
        },
        2,
    );
    assert!(on(&e, 0) && !e.show().overlays[0].in_next);
}

#[test]
fn auto_hide_takes_it_off_by_itself() {
    let mut e = setup();
    apply(
        &mut e,
        Action::UpdateOverlay {
            channel: 0,
            patch: OverlayPatch {
                auto_hide_ms: Some(8000),
                ..OverlayPatch::default()
            },
        },
        0,
    );
    apply(
        &mut e,
        Action::SetOverlayOn {
            channel: 0,
            value: true,
        },
        1000,
    );
    assert_eq!(e.tick(8000), Outcome::Unchanged);
    assert_eq!(e.tick(9000), Outcome::Changed);
    assert!(!on(&e, 0));
}

#[test]
fn a_video_overlay_turns_off_when_it_ends_unless_it_loops() {
    let mut e = setup();
    add(
        &mut e,
        "confetti",
        SourceKind::Video {
            path: "/c.webm".into(),
            duration_s: 6.0,
            playback: Playback::default(),
        },
    );
    apply(
        &mut e,
        Action::SetOverlaySource {
            channel: 1,
            source_id: Some(id("confetti")),
        },
        0,
    );
    apply(
        &mut e,
        Action::SetOverlayOn {
            channel: 1,
            value: true,
        },
        1000,
    );
    assert!(e.show().source(&id("confetti")).is_some_and(
        |s| matches!(&s.kind, SourceKind::Video { playback, .. } if playback.playing)
    ));
    assert_eq!(e.tick(5000), Outcome::Unchanged);
    e.tick(7100);
    assert!(!on(&e, 1));
}

#[test]
fn the_box_stays_on_screen_and_the_monitor_is_never_a_target() {
    let mut e = setup();
    apply(
        &mut e,
        Action::UpdateOverlay {
            channel: 0,
            patch: OverlayPatch {
                frame: Some(Frame {
                    x: 95.0,
                    y: -5.0,
                    w: 20.0,
                    h: 0.0,
                }),
                opacity: Some(3.0),
                screens: Some(vec![ScreenId::Live, ScreenId::Monitor, ScreenId::Back]),
                ..OverlayPatch::default()
            },
        },
        0,
    );
    let o = &e.show().overlays[0];
    assert_eq!(
        o.frame,
        Frame {
            x: 80.0,
            y: 0.0,
            w: 20.0,
            h: 1.0
        }
    );
    assert!((o.opacity - 1.0).abs() < f32::EPSILON);
    assert_eq!(o.screens, [ScreenId::Live, ScreenId::Back]);
}

#[test]
fn removing_the_input_empties_its_channel_and_saves_survive() {
    let mut e = setup();
    apply(
        &mut e,
        Action::SetOverlayOn {
            channel: 0,
            value: true,
        },
        1,
    );
    let back = load_json(&save_json(e.show())).unwrap();
    assert_eq!(back.overlays, e.show().overlays);
    apply(&mut e, Action::RemoveSource { id: id("logo") }, 2);
    assert!(e.show().overlays[0].source_id.is_none() && !on(&e, 0));
}

#[test]
fn old_shows_without_overlays_get_four_channels() {
    let e = Engine::new();
    let mut v: serde_json::Value = serde_json::from_str(&save_json(e.show())).unwrap();
    v.as_object_mut().unwrap().remove("overlays");
    assert_eq!(load_json(&v.to_string()).unwrap().overlays.len(), 4);
}
