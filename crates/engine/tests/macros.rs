//! Behavior tests for macros: named step lists with waits, the steps the
//! control window carries out (recording, streaming, replay), and macros
//! that run other macros.

use lumora_engine::macros::{AppStep, Macro};
use lumora_engine::persist::{load_json, save_json};
use lumora_engine::*;

fn apply(e: &mut Engine, a: Action, now: Millis) {
    e.apply(a, now).expect("action should be accepted");
}

fn id(s: &str) -> SourceId {
    SourceId::new(s)
}

fn setup() -> Engine {
    let mut e = Engine::new();
    for sid in ["cam1", "countdown"] {
        apply(
            &mut e,
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
                    screens: None,
                },
            },
            0,
        );
    }
    e
}

fn start_show() -> Macro {
    Macro {
        id: "start".into(),
        name: "Start show".into(),
        steps: vec![
            Step::Record { on: true },
            Step::Wait { ms: 2_000 },
            Step::Stream { on: true },
            Step::CutTo {
                screen: ScreenId::Live,
                source_id: id("countdown"),
            },
        ],
        hotkey: "Ctrl+1".into(),
    }
}

#[test]
fn a_macro_runs_its_steps_with_waits_and_leaves_requests_for_the_control_window() {
    let mut e = setup();
    apply(
        &mut e,
        Action::SetMacros {
            macros: vec![start_show()],
        },
        0,
    );
    apply(&mut e, Action::RunMacro { id: "start".into() }, 1_000);
    let reqs = &e.show().app_requests;
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].step, AppStep::Record { on: true });
    assert_eq!(e.show().screens.live.program, None, "waits 2 s first");
    e.tick(3_000);
    let reqs = &e.show().app_requests;
    assert_eq!(reqs.len(), 2);
    assert_eq!(reqs[1].step, AppStep::Stream { on: true });
    assert!(reqs[1].seq > reqs[0].seq);
    assert_eq!(e.show().screens.live.program, Some(id("countdown")));
    assert!(e.show().running.is_empty());
}

#[test]
fn unknown_macros_and_bad_lists_are_refused() {
    let mut e = setup();
    assert!(e.apply(Action::RunMacro { id: "x".into() }, 0).is_err());
    let no_id = Macro::default();
    assert!(e
        .apply(
            Action::SetMacros {
                macros: vec![no_id]
            },
            0
        )
        .is_err());
    let too_long = Macro {
        id: "w".into(),
        steps: vec![Step::Wait { ms: 11 * 60 * 1000 }],
        ..Macro::default()
    };
    assert!(e
        .apply(
            Action::SetMacros {
                macros: vec![too_long]
            },
            0
        )
        .is_err());
}

#[test]
fn a_macro_can_run_another_and_one_that_runs_itself_stops() {
    let mut e = setup();
    let inner = Macro {
        id: "inner".into(),
        name: "Inner".into(),
        steps: vec![Step::CutTo {
            screen: ScreenId::Live,
            source_id: id("cam1"),
        }],
        ..Macro::default()
    };
    let outer = Macro {
        id: "outer".into(),
        name: "Outer".into(),
        steps: vec![Step::Macro {
            macro_id: "inner".into(),
        }],
        ..Macro::default()
    };
    let forever = Macro {
        id: "loop".into(),
        name: "Loop".into(),
        steps: vec![
            Step::Replay {
                seconds: 5,
                slow: false,
            },
            Step::Macro {
                macro_id: "loop".into(),
            },
        ],
        ..Macro::default()
    };
    apply(
        &mut e,
        Action::SetMacros {
            macros: vec![inner, outer, forever],
        },
        0,
    );
    apply(&mut e, Action::RunMacro { id: "outer".into() }, 10);
    assert_eq!(e.show().screens.live.program, Some(id("cam1")));
    // Runs a few times, then stops by itself (no hang, no endless list).
    apply(&mut e, Action::RunMacro { id: "loop".into() }, 20);
    assert!(e.show().app_requests.len() <= lumora_engine::macros::MAX_REQUESTS);
    assert!(e.show().running.len() <= lumora_engine::macros::MAX_RUNNING);
}

#[test]
fn a_button_can_run_a_macro_and_step_the_data_rows() {
    let mut e = setup();
    apply(
        &mut e,
        Action::SetMacros {
            macros: vec![start_show()],
        },
        0,
    );
    apply(
        &mut e,
        Action::DataRows {
            headers: vec!["Name".into()],
            rows: vec![vec!["Ana".into()], vec!["Ben".into()]],
            error: String::new(),
        },
        0,
    );
    apply(
        &mut e,
        Action::RunSteps {
            name: "Button".into(),
            steps: vec![
                Step::DataStep { delta: 1 },
                Step::Macro {
                    macro_id: "start".into(),
                },
            ],
        },
        100,
    );
    assert_eq!(e.show().data.row, 1);
    assert_eq!(e.show().app_requests.len(), 1);
}

#[test]
fn macros_are_saved_but_requests_are_not() {
    let mut e = setup();
    apply(
        &mut e,
        Action::SetMacros {
            macros: vec![start_show()],
        },
        0,
    );
    apply(&mut e, Action::RunMacro { id: "start".into() }, 1);
    let back = load_json(&save_json(e.show())).unwrap();
    assert_eq!(back.macros, e.show().macros);
    assert!(back.app_requests.is_empty());
}
