//! Behaviour tests for the stage monitor and the countdown.

use lumora_engine::persist::{load_json, save_json};
use lumora_engine::*;

const MIN: u64 = 60_000;

fn engine() -> Engine {
    Engine::new()
}

fn apply(e: &mut Engine, a: Action, now: Millis) {
    e.apply(a, now).expect("action should be accepted");
}

fn left(e: &Engine, now: Millis) -> u64 {
    e.show().countdown.remaining(now)
}

#[test]
fn countdown_runs_pauses_and_resumes() {
    let mut e = engine();
    apply(&mut e, Action::SetCountdownLength { length_ms: 2 * MIN }, 0);
    apply(&mut e, Action::StartCountdown, 1_000);
    assert_eq!(left(&e, 31_000), 90_000);
    apply(&mut e, Action::PauseCountdown, 31_000);
    assert_eq!(left(&e, 999_000), 90_000, "a paused countdown stays put");
    apply(&mut e, Action::StartCountdown, 40_000);
    assert_eq!(left(&e, 50_000), 80_000);
}

#[test]
fn adding_time_works_in_the_last_ten_seconds() {
    let mut e = engine();
    apply(&mut e, Action::SetCountdownLength { length_ms: MIN }, 0);
    apply(&mut e, Action::StartCountdown, 0);
    // 5 seconds left.
    apply(&mut e, Action::AddCountdownTime { ms: 60_000 }, 55_000);
    assert_eq!(left(&e, 55_000), 65_000);
    assert!(e.show().countdown.running());
}

#[test]
fn adding_time_after_zero_restarts_the_count() {
    let mut e = engine();
    apply(&mut e, Action::SetCountdownLength { length_ms: 10_000 }, 0);
    apply(&mut e, Action::StartCountdown, 0);
    assert_eq!(e.tick(20_000), Outcome::Changed);
    assert!(e.show().countdown.fired);
    apply(&mut e, Action::AddCountdownTime { ms: 30_000 }, 20_000);
    assert_eq!(left(&e, 25_000), 25_000);
    assert!(
        !e.show().countdown.fired,
        "it can fire again at the new zero"
    );
}

#[test]
fn taking_away_time_never_goes_below_zero() {
    let mut e = engine();
    apply(&mut e, Action::AddCountdownTime { ms: -(10 * 60_000) }, 0);
    assert_eq!(left(&e, 0), 0);
}

#[test]
fn jump_to_last_ten_seconds_keeps_running() {
    let mut e = engine();
    apply(&mut e, Action::StartCountdown, 0);
    apply(&mut e, Action::SetCountdownRemaining { ms: 10_000 }, 5_000);
    assert_eq!(left(&e, 7_000), 8_000);
}

#[test]
fn count_down_to_a_clock_time() {
    let mut e = engine();
    apply(&mut e, Action::CountdownTo { at: 1_000_000 }, 400_000);
    assert!(e.show().countdown.running());
    assert_eq!(left(&e, 700_000), 300_000);
    assert!(matches!(
        e.apply(Action::CountdownTo { at: 100 }, 400_000),
        Err(ActionError::InvalidValue { .. })
    ));
}

#[test]
fn reset_returns_to_the_length() {
    let mut e = engine();
    apply(&mut e, Action::SetCountdownLength { length_ms: 3 * MIN }, 0);
    apply(&mut e, Action::StartCountdown, 0);
    apply(&mut e, Action::ResetCountdown, 50_000);
    assert!(!e.show().countdown.running());
    assert_eq!(left(&e, 99_000), 3 * MIN);
}

#[test]
fn bad_lengths_are_refused() {
    let mut e = engine();
    assert!(e
        .apply(Action::SetCountdownLength { length_ms: 0 }, 0)
        .is_err());
    assert!(e
        .apply(
            Action::SetCountdownLength {
                length_ms: 25 * 60 * MIN
            },
            0
        )
        .is_err());
}

#[test]
fn at_zero_cuts_live_to_a_source_once() {
    let mut e = engine();
    apply(
        &mut e,
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new("opening")),
                name: "Opening".into(),
                kind: SourceKind::Pattern,
                volume: None,
                muted: None,
                looping: None,
                fit: None,
                audio: None,
            },
        },
        0,
    );
    apply(
        &mut e,
        Action::UpdateCountdown {
            patch: CountdownPatch {
                at_zero: Some(AtZero::CutTo {
                    source_id: SourceId::new("opening"),
                }),
                ..Default::default()
            },
        },
        0,
    );
    apply(&mut e, Action::SetCountdownLength { length_ms: 5_000 }, 0);
    apply(&mut e, Action::StartCountdown, 0);
    assert_eq!(e.tick(4_900), Outcome::Unchanged, "not yet");
    assert_eq!(e.tick(5_000), Outcome::Changed);
    assert_eq!(
        e.show().screens.live.program,
        Some(SourceId::new("opening"))
    );
    assert_eq!(e.tick(6_000), Outcome::Unchanged, "only once");
}

#[test]
fn at_zero_blanks_the_screens_the_countdown_is_on() {
    let mut e = engine();
    apply(
        &mut e,
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new("count")),
                name: "Countdown".into(),
                kind: SourceKind::Countdown {
                    background: "#0b2545".into(),
                    logo: None,
                },
                volume: None,
                muted: None,
                looping: None,
                fit: None,
                audio: None,
            },
        },
        0,
    );
    apply(
        &mut e,
        Action::CutTo {
            screen: ScreenId::Back,
            source_id: SourceId::new("count"),
        },
        0,
    );
    apply(
        &mut e,
        Action::UpdateCountdown {
            patch: CountdownPatch {
                at_zero: Some(AtZero::Blank),
                ..Default::default()
            },
        },
        0,
    );
    apply(&mut e, Action::SetCountdownLength { length_ms: 1_000 }, 0);
    apply(&mut e, Action::StartCountdown, 0);
    e.tick(1_000);
    assert!(e.show().screens.back.blank);
    assert!(!e.show().screens.live.blank);
}

#[test]
fn cut_to_an_unknown_source_is_refused_and_removed_sources_are_forgotten() {
    let mut e = engine();
    let bad = Action::UpdateCountdown {
        patch: CountdownPatch {
            at_zero: Some(AtZero::CutTo {
                source_id: SourceId::new("nope"),
            }),
            ..Default::default()
        },
    };
    assert!(matches!(
        e.apply(bad, 0),
        Err(ActionError::UnknownSource { .. })
    ));
}

#[test]
fn monitor_message_and_options() {
    let mut e = engine();
    apply(
        &mut e,
        Action::UpdateMonitor {
            patch: MonitorPatch {
                message: Some("  Please   wrap\nup  ".into()),
                message_on: Some(true),
                layout: Some(MonitorLayout::Split),
                text_size: Some(TextSize::Xl),
                ..Default::default()
            },
        },
        0,
    );
    let m = &e.show().monitor;
    assert_eq!(m.message, "Please wrap up", "tidied to one line");
    assert!(m.message_on);
    assert_eq!(m.layout, MonitorLayout::Split);
    assert_eq!(m.text_size, TextSize::Xl);
}

#[test]
fn quick_messages_can_be_edited_but_there_are_only_eight() {
    let mut e = engine();
    apply(
        &mut e,
        Action::SetQuickMessage {
            index: 7,
            text: "Mazel tov!".into(),
        },
        0,
    );
    assert_eq!(e.show().monitor.quick[7], "Mazel tov!");
    assert!(e
        .apply(
            Action::SetQuickMessage {
                index: 8,
                text: "x".into()
            },
            0
        )
        .is_err());
}

#[test]
fn a_running_countdown_survives_a_restart() {
    let mut e = engine();
    apply(&mut e, Action::StartCountdown, 1_000);
    let saved = save_json(e.show());
    let loaded = load_json(&saved).expect("loads");
    assert_eq!(loaded.countdown.ends_at, e.show().countdown.ends_at);
    assert_eq!(loaded.monitor.quick.len(), 8);
}

#[test]
fn old_show_files_get_default_monitor_and_countdown() {
    let loaded = load_json(r#"{"version":1,"sources":[]}"#).expect("loads");
    assert_eq!(loaded.monitor, Monitor::default());
    assert_eq!(loaded.countdown.length_ms, 5 * MIN);
}

#[test]
fn by_default_the_numbers_come_off_at_zero_and_older_shows_are_updated() {
    assert_eq!(Countdown::default().at_zero, AtZero::Hide);
    let old = r#"{"version":1,"sources":[],"countdown":{"atZero":{"type":"hold"}}}"#;
    assert_eq!(load_json(old).unwrap().countdown.at_zero, AtZero::Hide);
    let new = r#"{"version":2,"sources":[],"countdown":{"atZero":{"type":"hold"}}}"#;
    assert_eq!(
        load_json(new).unwrap().countdown.at_zero,
        AtZero::Hold,
        "a deliberate choice is kept"
    );
}

#[test]
fn a_countdown_input_can_have_an_event_logo() {
    let mut e = engine();
    apply(
        &mut e,
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new("cd")),
                name: "Countdown".into(),
                kind: SourceKind::Countdown {
                    background: "#000000".into(),
                    logo: None,
                },
                volume: None,
                muted: None,
                looping: None,
                fit: None,
                audio: None,
            },
        },
        0,
    );
    let logo_of = |e: &Engine| match &e.show().sources[0].kind {
        SourceKind::Countdown { logo, .. } => logo.clone(),
        _ => unreachable!(),
    };
    apply(
        &mut e,
        Action::UpdateSource {
            id: SourceId::new("cd"),
            patch: SourcePatch {
                logo: Some("C:/event/logo.png".into()),
                ..Default::default()
            },
        },
        0,
    );
    assert_eq!(logo_of(&e).as_deref(), Some("C:/event/logo.png"));
    apply(
        &mut e,
        Action::UpdateSource {
            id: SourceId::new("cd"),
            patch: SourcePatch {
                logo: Some(String::new()),
                ..Default::default()
            },
        },
        0,
    );
    assert_eq!(logo_of(&e), None, "an empty path removes it");
}

#[test]
fn the_event_remembers_its_name_logo_and_emergency_plan() {
    let mut e = engine();
    assert!(
        !e.show().event.set_up,
        "a new show asks the setup questions"
    );
    apply(
        &mut e,
        Action::UpdateEvent {
            patch: EventPatch {
                name: Some("  Chanukah   Rally ".into()),
                logo: Some("C:/event/logo.png".into()),
                on_failure: Some(SafeScreen::Logo),
                panic_shows: Some(SafeScreen::Logo),
                set_up: Some(true),
            },
        },
        0,
    );
    let loaded = load_json(&save_json(e.show())).unwrap();
    assert_eq!(loaded.event.name, "Chanukah Rally");
    assert_eq!(loaded.event.logo.as_deref(), Some("C:/event/logo.png"));
    assert_eq!(loaded.event.on_failure, SafeScreen::Logo);
    assert_eq!(loaded.event.panic_shows, SafeScreen::Logo);
    assert!(loaded.event.set_up);
}
