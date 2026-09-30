//! Behaviour tests for the stage monitor, the event, and countdown inputs.

use lumora_engine::persist::{load_json, save_json};
use lumora_engine::*;

const MIN: u64 = 60_000;

fn engine() -> Engine {
    Engine::new()
}

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

fn add_countdown(e: &mut Engine, sid: &str) {
    add(
        e,
        sid,
        SourceKind::Countdown {
            background: "#0b2545".into(),
            logo: None,
            timer: Countdown::default(),
        },
    );
}

/// An engine with one countdown input, "cd".
fn with_countdown() -> Engine {
    let mut e = engine();
    add_countdown(&mut e, "cd");
    e
}

fn timer<'a>(e: &'a Engine, sid: &str) -> &'a Countdown {
    e.show().countdown(&id(sid)).expect("a countdown input")
}

fn left(e: &Engine, now: Millis) -> u64 {
    timer(e, "cd").remaining(now)
}

fn cd(a: impl Fn(SourceId) -> Action) -> Action {
    a(id("cd"))
}

fn take_live() -> Action {
    Action::Take {
        screen: ScreenId::Live,
        transition: None,
        duration_ms: None,
    }
}

#[test]
fn countdown_runs_pauses_and_resumes() {
    let mut e = with_countdown();
    apply(
        &mut e,
        cd(|id| Action::SetCountdownLength {
            id,
            length_ms: 2 * MIN,
        }),
        0,
    );
    apply(&mut e, cd(|id| Action::StartCountdown { id }), 1_000);
    assert_eq!(left(&e, 31_000), 90_000);
    apply(&mut e, cd(|id| Action::PauseCountdown { id }), 31_000);
    assert_eq!(left(&e, 999_000), 90_000, "a paused countdown stays put");
    apply(&mut e, cd(|id| Action::StartCountdown { id }), 40_000);
    assert_eq!(left(&e, 50_000), 80_000);
}

#[test]
fn adding_time_works_in_the_last_ten_seconds() {
    let mut e = with_countdown();
    apply(
        &mut e,
        cd(|id| Action::SetCountdownLength { id, length_ms: MIN }),
        0,
    );
    apply(&mut e, cd(|id| Action::StartCountdown { id }), 0);
    apply(
        &mut e,
        cd(|id| Action::AddCountdownTime { id, ms: 60_000 }),
        55_000,
    );
    assert_eq!(left(&e, 55_000), 65_000);
    assert!(timer(&e, "cd").running());
}

#[test]
fn adding_time_after_zero_restarts_the_count() {
    let mut e = with_countdown();
    apply(
        &mut e,
        cd(|id| Action::SetCountdownLength {
            id,
            length_ms: 10_000,
        }),
        0,
    );
    apply(&mut e, cd(|id| Action::StartCountdown { id }), 0);
    assert_eq!(e.tick(20_000), Outcome::Changed);
    assert!(timer(&e, "cd").fired);
    apply(
        &mut e,
        cd(|id| Action::AddCountdownTime { id, ms: 30_000 }),
        20_000,
    );
    assert_eq!(left(&e, 25_000), 25_000);
    assert!(!timer(&e, "cd").fired, "it can fire again at the new zero");
}

#[test]
fn taking_away_time_never_goes_below_zero() {
    let mut e = with_countdown();
    apply(
        &mut e,
        cd(|id| Action::AddCountdownTime {
            id,
            ms: -(10 * 60_000),
        }),
        0,
    );
    assert_eq!(left(&e, 0), 0);
}

#[test]
fn jump_to_last_ten_seconds_keeps_running() {
    let mut e = with_countdown();
    apply(&mut e, cd(|id| Action::StartCountdown { id }), 0);
    apply(
        &mut e,
        cd(|id| Action::SetCountdownRemaining { id, ms: 10_000 }),
        5_000,
    );
    assert_eq!(left(&e, 7_000), 8_000);
}

#[test]
fn count_down_to_a_clock_time() {
    let mut e = with_countdown();
    apply(
        &mut e,
        cd(|id| Action::CountdownTo { id, at: 1_000_000 }),
        400_000,
    );
    assert!(timer(&e, "cd").running());
    assert_eq!(left(&e, 700_000), 300_000);
    assert!(matches!(
        e.apply(cd(|id| Action::CountdownTo { id, at: 100 }), 400_000),
        Err(ActionError::InvalidValue { .. })
    ));
}

#[test]
fn reset_returns_to_the_length() {
    let mut e = with_countdown();
    apply(
        &mut e,
        cd(|id| Action::SetCountdownLength {
            id,
            length_ms: 3 * MIN,
        }),
        0,
    );
    apply(&mut e, cd(|id| Action::StartCountdown { id }), 0);
    apply(&mut e, cd(|id| Action::ResetCountdown { id }), 50_000);
    assert!(!timer(&e, "cd").running());
    assert_eq!(left(&e, 99_000), 3 * MIN);
}

#[test]
fn bad_lengths_and_inputs_are_refused() {
    let mut e = with_countdown();
    add(
        &mut e,
        "red",
        SourceKind::Color {
            color: "#ff0000".into(),
        },
    );
    assert!(e
        .apply(cd(|id| Action::SetCountdownLength { id, length_ms: 0 }), 0)
        .is_err());
    assert!(e
        .apply(
            cd(|id| Action::SetCountdownLength {
                id,
                length_ms: 25 * 60 * MIN
            }),
            0
        )
        .is_err());
    assert!(
        e.apply(Action::StartCountdown { id: id("red") }, 0)
            .is_err(),
        "only countdown inputs have a timer"
    );
}

#[test]
fn two_countdowns_count_on_their_own() {
    let mut e = with_countdown();
    add_countdown(&mut e, "next");
    apply(
        &mut e,
        Action::CutTo {
            screen: ScreenId::Live,
            source_id: id("cd"),
        },
        0,
    );
    apply(
        &mut e,
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: Some(id("next")),
        },
        0,
    );
    // Preparing the one in Next leaves the one on air alone.
    apply(
        &mut e,
        Action::SetCountdownLength {
            id: id("next"),
            length_ms: 10 * MIN,
        },
        30_000,
    );
    apply(
        &mut e,
        Action::UpdateCountdown {
            id: id("next"),
            patch: CountdownPatch {
                label: Some("Break ends".into()),
                ..Default::default()
            },
        },
        30_000,
    );
    assert_eq!(left(&e, 30_000), 5 * MIN - 30_000, "on air keeps counting");
    assert_eq!(timer(&e, "cd").label, "Starting soon");
    assert!(!timer(&e, "next").running(), "waiting in Next");
    assert_eq!(timer(&e, "next").remaining(30_000), 10 * MIN);
    // TAKE starts the one from Next.
    apply(&mut e, take_live(), 60_000);
    assert_eq!(timer(&e, "next").remaining(70_000), 10 * MIN - 10_000);
}

#[test]
fn at_zero_cuts_the_screen_it_is_on_once() {
    let mut e = with_countdown();
    add(&mut e, "opening", SourceKind::Pattern);
    apply(
        &mut e,
        cd(|id| Action::UpdateCountdown {
            id,
            patch: CountdownPatch {
                at_zero: Some(AtZero::CutTo {
                    source_id: SourceId::new("opening"),
                }),
                ..Default::default()
            },
        }),
        0,
    );
    apply(
        &mut e,
        cd(|id| Action::SetCountdownLength {
            id,
            length_ms: 5_000,
        }),
        0,
    );
    apply(
        &mut e,
        Action::CutTo {
            screen: ScreenId::Back,
            source_id: id("cd"),
        },
        0,
    );
    assert_eq!(e.tick(4_900), Outcome::Unchanged, "not yet");
    assert_eq!(
        e.tick(5_000),
        Outcome::Unchanged,
        "on 0: holds a moment first"
    );
    assert_eq!(e.tick(6_500), Outcome::Changed);
    assert_eq!(
        e.show().screens.back.program,
        Some(id("opening")),
        "the screen it was on"
    );
    assert_eq!(e.show().screens.live.program, None);
    assert_eq!(e.tick(8_000), Outcome::Unchanged, "only once");
}

#[test]
fn at_zero_blanks_the_screens_the_countdown_is_on() {
    let mut e = with_countdown();
    apply(
        &mut e,
        Action::CutTo {
            screen: ScreenId::Back,
            source_id: id("cd"),
        },
        0,
    );
    apply(
        &mut e,
        cd(|id| Action::UpdateCountdown {
            id,
            patch: CountdownPatch {
                at_zero: Some(AtZero::Blank),
                ..Default::default()
            },
        }),
        0,
    );
    apply(
        &mut e,
        cd(|id| Action::SetCountdownLength {
            id,
            length_ms: 1_000,
        }),
        0,
    );
    apply(&mut e, cd(|id| Action::StartCountdown { id }), 0);
    e.tick(2_500);
    assert!(e.show().screens.back.blank);
    assert!(!e.show().screens.live.blank);
}

#[test]
fn cut_to_an_unknown_source_is_refused_and_removed_sources_are_forgotten() {
    let mut e = with_countdown();
    add(&mut e, "opening", SourceKind::Pattern);
    let bad = cd(|id| Action::UpdateCountdown {
        id,
        patch: CountdownPatch {
            at_zero: Some(AtZero::CutTo {
                source_id: SourceId::new("nope"),
            }),
            ..Default::default()
        },
    });
    assert!(matches!(
        e.apply(bad, 0),
        Err(ActionError::UnknownSource { .. })
    ));
    apply(
        &mut e,
        cd(|id| Action::UpdateCountdown {
            id,
            patch: CountdownPatch {
                at_zero: Some(AtZero::CutTo {
                    source_id: SourceId::new("opening"),
                }),
                ..Default::default()
            },
        }),
        0,
    );
    apply(&mut e, Action::RemoveSource { id: id("opening") }, 0);
    assert_eq!(timer(&e, "cd").at_zero, AtZero::Hide);
}

#[test]
fn a_countdown_waits_in_next_and_starts_when_taken_to_air() {
    let mut e = with_countdown();
    apply(
        &mut e,
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: Some(id("cd")),
        },
        1_000,
    );
    assert!(
        !timer(&e, "cd").running(),
        "lined up in Next: still waiting"
    );
    assert_eq!(left(&e, 60_000), 5 * MIN);
    apply(&mut e, take_live(), 60_000);
    assert!(timer(&e, "cd").running(), "on air: counting");
    assert_eq!(left(&e, 70_000), 5 * MIN - 10_000);
    assert_eq!(
        e.show().screens.live.preview,
        None,
        "nothing was on air before: Next is left empty"
    );
}

#[test]
fn the_t_bar_and_cut_start_it_too_but_never_restart_a_running_one() {
    let mut e = with_countdown();
    apply(
        &mut e,
        Action::CutTo {
            screen: ScreenId::Back,
            source_id: id("cd"),
        },
        0,
    );
    assert!(timer(&e, "cd").running());
    apply(
        &mut e,
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: Some(id("cd")),
        },
        30_000,
    );
    apply(
        &mut e,
        Action::SetTbar {
            screen: ScreenId::Live,
            value: 1.0,
        },
        30_000,
    );
    assert_eq!(left(&e, 30_000), 5 * MIN - 30_000);
}

#[test]
fn the_main_countdown_is_the_one_on_air() {
    let mut e = with_countdown();
    add_countdown(&mut e, "other");
    assert_eq!(
        e.show().main_countdown(),
        Some(&id("cd")),
        "the first when none is on air"
    );
    apply(
        &mut e,
        Action::CutTo {
            screen: ScreenId::Live,
            source_id: id("other"),
        },
        0,
    );
    assert_eq!(e.show().main_countdown(), Some(&id("other")));
}

#[test]
fn steps_without_a_countdown_named_use_the_main_one() {
    let mut e = with_countdown();
    apply(
        &mut e,
        Action::RunSteps {
            name: "Go".into(),
            steps: vec![Step::StartCountdown { source_id: None }],
        },
        0,
    );
    assert!(timer(&e, "cd").running());
}

#[test]
fn a_running_countdown_survives_a_restart() {
    let mut e = with_countdown();
    apply(&mut e, cd(|id| Action::StartCountdown { id }), 1_000);
    let loaded = load_json(&save_json(e.show())).expect("loads");
    assert_eq!(
        loaded.countdown(&id("cd")).unwrap().ends_at,
        timer(&e, "cd").ends_at
    );
    assert_eq!(loaded.monitor.quick.len(), 8);
}

#[test]
fn old_shows_move_the_shared_countdown_into_their_countdown_inputs() {
    let old = r##"{"version":2,"sources":[{"id":"cd","name":"Countdown","kind":{"type":"countdown","background":"#000000"},"volume":1,"muted":false,"looping":false,"fit":"contain"}],"countdown":{"lengthMs":120000,"remainingMs":120000,"label":"Doors open","atZero":{"type":"showText"}}}"##;
    let s = load_json(old).unwrap();
    let t = s.countdown(&id("cd")).unwrap();
    assert_eq!(t.label, "Doors open");
    assert_eq!(t.length_ms, 120_000);
    assert_eq!(t.at_zero, AtZero::ShowText);
    let older = r##"{"version":1,"sources":[{"id":"cd","name":"C","kind":{"type":"countdown","background":"#000000"},"volume":1,"muted":false,"looping":false,"fit":"contain"}],"countdown":{"atZero":{"type":"hold"}}}"##;
    assert_eq!(
        load_json(older)
            .unwrap()
            .countdown(&id("cd"))
            .unwrap()
            .at_zero,
        AtZero::Hide
    );
    assert_eq!(Countdown::default().at_zero, AtZero::Hide);
}

#[test]
fn a_countdown_input_can_have_an_event_logo() {
    let mut e = with_countdown();
    let logo_of = |e: &Engine| match &e.show().sources[0].kind {
        SourceKind::Countdown { logo, .. } => logo.clone(),
        _ => unreachable!(),
    };
    apply(
        &mut e,
        Action::UpdateSource {
            id: id("cd"),
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
            id: id("cd"),
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
fn old_show_files_get_a_default_monitor() {
    let loaded = load_json(r#"{"version":1,"sources":[]}"#).expect("loads");
    assert_eq!(loaded.monitor, Monitor::default());
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
                wifi: None,
                place: None,
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
