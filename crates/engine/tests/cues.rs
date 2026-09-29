//! Behaviour tests for the run of show.

use lumora_engine::cues::clock_seconds;
use lumora_engine::*;

fn id(s: &str) -> SourceId {
    SourceId::new(s)
}

fn setup() -> Engine {
    let mut e = Engine::new();
    for sid in ["a", "b", "c"] {
        e.apply(
            Action::AddSource {
                source: NewSource {
                    id: Some(id(sid)),
                    name: sid.into(),
                    kind: SourceKind::Pattern,
                    volume: None,
                    muted: None,
                    looping: None,
                    fit: None,
                    audio: None,
                    key: None,
                },
            },
            0,
        )
        .unwrap();
    }
    let cut = |sid: &str| Step::CutTo {
        screen: ScreenId::Live,
        source_id: id(sid),
    };
    let cues = vec![
        Cue {
            id: "1".into(),
            name: "Doors".into(),
            trigger: CueTrigger::Clock {
                time: "19:30".into(),
            },
            length_ms: Some(60_000),
            steps: vec![cut("a")],
            ..Cue::default()
        },
        Cue {
            id: "2".into(),
            name: "Video".into(),
            trigger: CueTrigger::AfterPrevious,
            length_ms: Some(10_000),
            steps: vec![cut("b")],
            ..Cue::default()
        },
        Cue {
            id: "3".into(),
            name: "Speech".into(),
            trigger: CueTrigger::Manual,
            steps: vec![cut("c")],
            ..Cue::default()
        },
    ];
    e.apply(Action::SetCues { cues }, 0).unwrap();
    e
}

fn on_air(e: &Engine) -> Option<SourceId> {
    e.show().screens.live.program.clone()
}

/// ms since 1970 for a UTC time of day on a fixed day.
fn at(h: u64, m: u64, s: u64) -> Millis {
    1_790_000_000_000 - 1_790_000_000_000 % 86_400_000 + ((h * 60 + m) * 60 + s) * 1000
}

#[test]
fn clock_times_read_like_a_clock() {
    assert_eq!(clock_seconds("19:30"), Some(70_200));
    assert_eq!(clock_seconds("7:05:09"), Some(25_509));
    assert_eq!(clock_seconds("25:00"), None);
    assert_eq!(clock_seconds("soon"), None);
}

#[test]
fn clock_then_after_previous_then_waits_for_the_operator() {
    let mut e = setup();
    e.apply(Action::StartShow { utc_offset_min: 0 }, at(19, 0, 0))
        .unwrap();
    assert_eq!(e.tick(at(19, 29, 59)), Outcome::Unchanged, "not yet");
    e.tick(at(19, 30, 0));
    assert_eq!(on_air(&e), Some(id("a")), "on the clock");
    e.tick(at(19, 30, 59));
    assert_eq!(on_air(&e), Some(id("a")));
    e.tick(at(19, 31, 0));
    assert_eq!(on_air(&e), Some(id("b")), "after the previous cue's length");
    e.tick(at(20, 0, 0));
    assert_eq!(on_air(&e), Some(id("b")), "a manual cue waits");
    e.apply(Action::NextCue, at(20, 0, 1)).unwrap();
    assert_eq!(on_air(&e), Some(id("c")));
    assert_eq!(e.show().run.current, Some(2));
}

#[test]
fn clock_cues_use_the_computers_time_zone() {
    let mut e = setup();
    // 19:30 in UTC+2 is 17:30 UTC.
    e.apply(
        Action::StartShow {
            utc_offset_min: 120,
        },
        at(17, 0, 0),
    )
    .unwrap();
    e.tick(at(17, 30, 0));
    assert_eq!(on_air(&e), Some(id("a")));
}

#[test]
fn paused_holds_everything_and_a_cue_can_be_run_by_hand() {
    let mut e = setup();
    e.apply(Action::StartShow { utc_offset_min: 0 }, at(19, 0, 0))
        .unwrap();
    e.apply(Action::PauseShow { value: true }, at(19, 0, 0))
        .unwrap();
    assert_eq!(e.tick(at(19, 45, 0)), Outcome::Unchanged);
    e.apply(Action::GoCue { index: 2 }, at(19, 45, 0)).unwrap();
    assert_eq!(on_air(&e), Some(id("c")));
}

#[test]
fn editing_the_cues_keeps_the_place() {
    let mut e = setup();
    e.apply(Action::GoCue { index: 1 }, 1).unwrap();
    let mut cues = e.show().run.cues.clone();
    cues.insert(
        0,
        Cue {
            id: "0".into(),
            name: "New first".into(),
            ..Cue::default()
        },
    );
    e.apply(Action::SetCues { cues }, 2).unwrap();
    assert_eq!(e.show().run.current, Some(2), "still on the video cue");
}
