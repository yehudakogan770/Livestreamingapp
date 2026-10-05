//! Triggers: when this happens, do that.

use lumora_engine::triggers::{Trigger, When};
use lumora_engine::*;

fn id(s: &str) -> SourceId {
    SourceId::new(s)
}

fn add(e: &mut Engine, sid: &str, kind: SourceKind) {
    e.apply(
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
                screens: None,
            },
        },
        0,
    )
    .unwrap();
}

fn trigger(name: &str, when: When, steps: Vec<Step>) -> Trigger {
    Trigger {
        id: name.into(),
        name: name.into(),
        enabled: true,
        when,
        steps,
        last_fired: 0,
    }
}

fn cut(e: &mut Engine, screen: ScreenId, sid: &str, now: Millis) {
    e.apply(
        Action::CutTo {
            screen,
            source_id: id(sid),
        },
        now,
    )
    .unwrap();
}

fn setup() -> Engine {
    let mut e = Engine::new();
    add(&mut e, "cam", SourceKind::Pattern);
    add(
        &mut e,
        "logo",
        SourceKind::Color {
            color: "#ffffff".into(),
        },
    );
    add(
        &mut e,
        "vid",
        SourceKind::Video {
            path: "/v.mp4".into(),
            duration_s: 10.0,
            playback: Playback::default(),
        },
    );
    e
}

#[test]
fn when_an_input_goes_on_air_something_else_happens() {
    let mut e = setup();
    e.apply(
        Action::SetTriggers {
            triggers: vec![trigger(
                "logo with camera",
                When::OnAir {
                    source_id: id("cam"),
                    screen: Some(ScreenId::Live),
                },
                vec![Step::CutTo {
                    screen: ScreenId::Back,
                    source_id: id("logo"),
                }],
            )],
        },
        0,
    )
    .unwrap();
    cut(&mut e, ScreenId::Back, "cam", 100);
    assert_eq!(
        e.show().screens.back.program,
        Some(id("cam")),
        "only on the Live Screen"
    );
    cut(&mut e, ScreenId::Live, "cam", 200);
    assert_eq!(e.show().screens.back.program, Some(id("logo")));
    assert_eq!(e.show().triggers[0].last_fired, 200);
}

#[test]
fn when_a_video_ends_cut_to_the_camera_once() {
    let mut e = setup();
    e.apply(
        Action::SetTriggers {
            triggers: vec![trigger(
                "after the video",
                When::VideoEnds {
                    source_id: id("vid"),
                },
                vec![Step::CutTo {
                    screen: ScreenId::Live,
                    source_id: id("cam"),
                }],
            )],
        },
        0,
    )
    .unwrap();
    cut(&mut e, ScreenId::Live, "vid", 1000);
    e.apply(Action::Play { id: id("vid") }, 1000).unwrap();
    assert_eq!(e.tick(5000), Outcome::Unchanged);
    assert_eq!(e.show().screens.live.program, Some(id("vid")));
    assert_eq!(e.tick(11_000), Outcome::Changed);
    assert_eq!(e.show().screens.live.program, Some(id("cam")));
    // Not again for the same play.
    cut(&mut e, ScreenId::Live, "vid", 12_000);
    assert_eq!(e.tick(13_000), Outcome::Unchanged);
    assert_eq!(e.show().screens.live.program, Some(id("vid")));
}

#[test]
fn at_a_clock_time_once_a_day() {
    let mut e = setup();
    // 19:30 local in a zone 2 hours ahead of UTC = 17:30 UTC.
    e.apply(
        Action::SetTriggers {
            triggers: vec![trigger(
                "opening",
                When::AtTime {
                    minute: 19 * 60 + 30,
                    utc_offset_min: 120,
                },
                vec![Step::CutTo {
                    screen: ScreenId::Live,
                    source_id: id("logo"),
                }],
            )],
        },
        0,
    )
    .unwrap();
    let t = (17 * 60 + 30) * 60_000;
    assert_eq!(e.tick(t - 60_000), Outcome::Unchanged);
    assert_eq!(e.tick(t + 1000), Outcome::Changed);
    assert_eq!(e.show().screens.live.program, Some(id("logo")));
    cut(&mut e, ScreenId::Live, "cam", t + 2000);
    assert_eq!(
        e.tick(t + 30_000),
        Outcome::Unchanged,
        "once, not every tick"
    );
}

#[test]
fn switched_off_triggers_do_nothing_and_can_be_tried_by_hand() {
    let mut e = setup();
    let mut t = trigger(
        "off",
        When::OnAir {
            source_id: id("cam"),
            screen: None,
        },
        vec![Step::CutTo {
            screen: ScreenId::Back,
            source_id: id("logo"),
        }],
    );
    t.enabled = false;
    e.apply(Action::SetTriggers { triggers: vec![t] }, 0)
        .unwrap();
    cut(&mut e, ScreenId::Live, "cam", 100);
    assert_eq!(e.show().screens.back.program, None);
    e.apply(Action::FireTrigger { id: "off".into() }, 200)
        .unwrap();
    assert_eq!(e.show().screens.back.program, Some(id("logo")));
}
