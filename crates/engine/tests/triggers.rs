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

#[test]
fn a_few_seconds_before_a_video_ends_once_per_play() {
    let mut e = setup();
    e.apply(
        Action::SetTriggers {
            triggers: vec![trigger(
                "line up the camera",
                When::VideoTimeLeft {
                    source_id: id("vid"),
                    seconds: 3,
                },
                vec![Step::Preview {
                    screen: ScreenId::Live,
                    source_id: Some(id("cam")),
                }],
            )],
        },
        0,
    )
    .unwrap();
    cut(&mut e, ScreenId::Live, "vid", 1000);
    e.apply(Action::Play { id: id("vid") }, 1000).unwrap();
    assert_eq!(e.tick(5000), Outcome::Unchanged, "6 s left");
    assert_eq!(e.tick(8500), Outcome::Changed, "2.5 s left");
    assert_eq!(e.show().screens.live.preview, Some(id("cam")));
    e.apply(
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: None,
        },
        8600,
    )
    .unwrap();
    assert_eq!(
        e.tick(9000),
        Outcome::Unchanged,
        "not again in the same play"
    );
    assert_eq!(e.show().screens.live.preview, None);
}

#[test]
fn when_an_input_loses_its_picture_and_gets_it_back() {
    let mut e = setup();
    e.apply(
        Action::SetTriggers {
            triggers: vec![
                trigger(
                    "camera lost",
                    When::InputLost {
                        source_id: id("cam"),
                    },
                    vec![Step::CutTo {
                        screen: ScreenId::Back,
                        source_id: id("logo"),
                    }],
                ),
                trigger(
                    "camera back",
                    When::InputBack {
                        source_id: id("cam"),
                    },
                    vec![Step::CutTo {
                        screen: ScreenId::Back,
                        source_id: id("cam"),
                    }],
                ),
            ],
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::SetNoSignal {
            ids: vec![id("cam")],
        },
        100,
    )
    .unwrap();
    assert_eq!(e.show().triggers[0].last_fired, 100);
    assert_eq!(e.show().triggers[1].last_fired, 0);
    assert_eq!(e.show().screens.back.program, Some(id("logo")));
    // Still lost: nothing more.
    e.apply(
        Action::SetNoSignal {
            ids: vec![id("cam")],
        },
        200,
    )
    .unwrap();
    assert_eq!(e.show().triggers[0].last_fired, 100);
    e.apply(Action::SetNoSignal { ids: vec![] }, 300).unwrap();
    assert_eq!(e.show().triggers[1].last_fired, 300);
    assert_eq!(e.show().screens.back.program, Some(id("cam")));
}

#[test]
fn sound_and_broadcast_triggers_are_left_to_the_control_window() {
    let mut e = setup();
    let sound = trigger(
        "talking",
        When::Sound {
            source_id: id("cam"),
            above: true,
            db: -90,
            hold_ms: 99_000_000,
        },
        vec![Step::CutTo {
            screen: ScreenId::Live,
            source_id: id("cam"),
        }],
    );
    let live = trigger(
        "went live",
        When::Broadcast {
            what: lumora_engine::triggers::BroadcastWhat::Stream,
            on: true,
        },
        vec![Step::CutTo {
            screen: ScreenId::Live,
            source_id: id("logo"),
        }],
    );
    e.apply(
        Action::SetTriggers {
            triggers: vec![sound, live],
        },
        0,
    )
    .unwrap();
    // Kept in range.
    match &e.show().triggers[0].when {
        When::Sound { db, hold_ms, .. } => {
            assert_eq!(*db, -60);
            assert_eq!(*hold_ms, 600_000);
        }
        other => panic!("{other:?}"),
    }
    cut(&mut e, ScreenId::Live, "vid", 100);
    assert_eq!(e.tick(5000), Outcome::Unchanged);
    assert_eq!(e.show().screens.live.program, Some(id("vid")));
    e.apply(
        Action::FireTrigger {
            id: "went live".into(),
        },
        6000,
    )
    .unwrap();
    assert_eq!(e.show().screens.live.program, Some(id("logo")));
}
