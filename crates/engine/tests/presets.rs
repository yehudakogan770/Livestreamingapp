//! Behaviour tests for presets and preset buttons.

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
    for (sid, kind) in [
        ("cam1", SourceKind::Pattern),
        ("cam2", SourceKind::Pattern),
        (
            "lower",
            SourceKind::Color {
                color: "#112233".into(),
            },
        ),
        (
            "mic",
            SourceKind::Microphone {
                device_id: "m".into(),
                label: "Mic".into(),
            },
        ),
    ] {
        apply(
            &mut e,
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
                },
            },
            0,
        );
    }
    e
}

fn preset(name: &str, sources: &[&str]) -> Preset {
    Preset {
        name: name.into(),
        sources: sources.iter().map(|s| id(s)).collect(),
        ..Preset::default()
    }
}

#[test]
fn picking_a_preset_sets_its_transition_and_lines_up_its_first_input() {
    let mut e = setup();
    let mut p = preset("Speaker", &["mic", "cam2", "lower"]);
    p.transition = Some(Transition {
        kind: TransitionKind::Dip,
        duration_ms: 1_200,
    });
    apply(&mut e, Action::AddPreset { preset: p }, 0);
    let pid = e.show().presets[0].id.clone();
    assert_eq!(pid, "preset-1");
    apply(
        &mut e,
        Action::PickPreset {
            id: Some(pid.clone()),
        },
        0,
    );
    let s = e.show();
    assert_eq!(s.active_preset.as_deref(), Some(pid.as_str()));
    assert_eq!(s.transition.kind, TransitionKind::Dip);
    assert_eq!(
        s.screens.live.preview,
        Some(id("cam2")),
        "the microphone is skipped: it can't go on a screen"
    );
}

#[test]
fn next_and_previous_run_the_show_in_order() {
    let mut e = setup();
    for n in ["Opening", "Welcome", "Speaker"] {
        apply(
            &mut e,
            Action::AddPreset {
                preset: preset(n, &["cam1"]),
            },
            0,
        );
    }
    let name = |e: &Engine| {
        let a = e.show().active_preset.clone().unwrap();
        e.show()
            .presets
            .iter()
            .find(|p| p.id == a)
            .unwrap()
            .name
            .clone()
    };
    apply(&mut e, Action::NextPreset, 0);
    assert_eq!(name(&e), "Opening");
    apply(&mut e, Action::NextPreset, 0);
    apply(&mut e, Action::NextPreset, 0);
    apply(&mut e, Action::NextPreset, 0);
    assert_eq!(name(&e), "Speaker", "stops at the last one");
    apply(&mut e, Action::PreviousPreset, 0);
    assert_eq!(name(&e), "Welcome");
}

#[test]
fn a_button_runs_its_steps_in_order_with_waits() {
    let mut e = setup();
    let steps = vec![
        Step::CutTo {
            screen: ScreenId::Live,
            source_id: id("cam1"),
        },
        Step::Wait { ms: 3_000 },
        Step::MonitorMessage {
            text: "You're on".into(),
        },
        Step::Wait { ms: 2_000 },
        Step::CutTo {
            screen: ScreenId::Live,
            source_id: id("lower"),
        },
    ];
    apply(
        &mut e,
        Action::RunSteps {
            name: "Cam 1 + message".into(),
            steps,
        },
        1_000,
    );
    assert_eq!(
        e.show().screens.live.program,
        Some(id("cam1")),
        "runs straight away"
    );
    assert!(!e.show().monitor.message_on, "then waits");
    assert_eq!(e.tick(3_900), Outcome::Unchanged);
    assert_eq!(e.tick(4_000), Outcome::Changed);
    assert!(e.show().monitor.message_on);
    e.tick(6_000);
    assert_eq!(e.show().screens.live.program, Some(id("lower")));
    assert!(e.show().running.is_empty(), "finished");
}

#[test]
fn a_step_that_cannot_run_is_skipped_and_the_rest_still_run() {
    let mut e = setup();
    apply(
        &mut e,
        Action::RunSteps {
            name: "B".into(),
            steps: vec![
                Step::CutTo {
                    screen: ScreenId::Live,
                    source_id: id("gone"),
                },
                Step::CutTo {
                    screen: ScreenId::Live,
                    source_id: id("cam2"),
                },
            ],
        },
        0,
    );
    assert_eq!(e.show().screens.live.program, Some(id("cam2")));
}

#[test]
fn stop_cancels_running_buttons() {
    let mut e = setup();
    apply(
        &mut e,
        Action::RunSteps {
            name: "B".into(),
            steps: vec![
                Step::Wait { ms: 1_000 },
                Step::CutTo {
                    screen: ScreenId::Live,
                    source_id: id("cam2"),
                },
            ],
        },
        0,
    );
    apply(&mut e, Action::StopSteps, 500);
    e.tick(2_000);
    assert_eq!(e.show().screens.live.program, None);
}

#[test]
fn bad_presets_are_refused() {
    let mut e = setup();
    let mut on_monitor = preset("M", &[]);
    on_monitor.screen = ScreenId::Monitor;
    assert!(e
        .apply(Action::AddPreset { preset: on_monitor }, 0)
        .is_err());
    assert!(e
        .apply(
            Action::AddPreset {
                preset: preset("X", &["nope"])
            },
            0
        )
        .is_err());
    let mut long_wait = preset("W", &[]);
    long_wait.buttons = vec![PresetButton {
        name: "b".into(),
        steps: vec![Step::Wait { ms: 11 * 60 * 1000 }],
    }];
    assert!(e.apply(Action::AddPreset { preset: long_wait }, 0).is_err());
}

#[test]
fn removing_an_input_takes_it_out_of_presets_and_presets_are_saved() {
    let mut e = setup();
    let mut p = preset("Speaker", &["cam1", "cam2"]);
    p.buttons = vec![PresetButton {
        name: "Go".into(),
        steps: vec![Step::StartCountdown { source_id: None }],
    }];
    apply(&mut e, Action::AddPreset { preset: p }, 0);
    apply(&mut e, Action::RemoveSource { id: id("cam1") }, 0);
    assert_eq!(e.show().presets[0].sources, vec![id("cam2")]);
    let loaded = load_json(&save_json(e.show())).unwrap();
    assert_eq!(loaded.presets, e.show().presets);
}

#[test]
fn editing_and_reordering_presets() {
    let mut e = setup();
    apply(
        &mut e,
        Action::AddPreset {
            preset: preset("A", &[]),
        },
        0,
    );
    apply(
        &mut e,
        Action::AddPreset {
            preset: preset("B", &[]),
        },
        0,
    );
    let mut b = e.show().presets[1].clone();
    b.name = "Band".into();
    apply(&mut e, Action::UpdatePreset { preset: b.clone() }, 0);
    apply(
        &mut e,
        Action::MovePreset {
            id: b.id.clone(),
            index: 0,
        },
        0,
    );
    let names: Vec<_> = e.show().presets.iter().map(|p| p.name.clone()).collect();
    assert_eq!(names, ["Band", "A"]);
    apply(
        &mut e,
        Action::PickPreset {
            id: Some(b.id.clone()),
        },
        0,
    );
    apply(&mut e, Action::RemovePreset { id: b.id }, 0);
    assert_eq!(e.show().active_preset, None);
}
