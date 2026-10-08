//! Every action group, allowed or refused for every role (checked on the
//! show computer).

use lumora_engine::action::Action;
use lumora_seats::role::{group_of, seat_may, seat_may_command, Group, Refusal, Role, SeatCommand};
use serde_json::{json, Value};

fn action(v: Value) -> Action {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{v}: {e}"))
}

/// Actions from each group (several where the group is mixed).
fn samples() -> Vec<(Group, Vec<Action>)> {
    vec![
        (
            Group::Switching,
            vec![
                action(json!({"type": "take", "screen": "live"})),
                action(json!({"type": "cutTo", "screen": "live", "sourceId": "cam1"})),
                action(json!({"type": "setTbar", "screen": "live", "value": 0.5})),
                action(json!({"type": "setBlank", "screens": ["live"], "value": true})),
                action(json!({"type": "fadeToBlack", "screen": "live"})),
                action(json!({"type": "panic", "value": true})),
                action(json!({"type": "nextPreset"})),
            ],
        ),
        (
            Group::Preview,
            vec![action(
                json!({"type": "setPreview", "screen": "live", "sourceId": "cam1"}),
            )],
        ),
        (
            Group::Cameras,
            vec![action(json!({"type": "setPtz", "id": "cam1", "ptz": null}))],
        ),
        (
            Group::Overlays,
            vec![
                action(json!({"type": "setOverlayOn", "channel": 0, "value": true})),
                action(json!({"type": "setOverlayInNext", "channel": 1, "value": true})),
                action(json!({"type": "overlaysOff"})),
            ],
        ),
        (
            Group::Titles,
            vec![
                action(json!({"type": "scriptureStep", "id": "s", "delta": 1})),
                action(json!({"type": "creditsPlay", "id": "c", "value": true})),
                action(json!({"type": "pesukimNext", "id": "p"})),
                action(json!({"type": "showComment", "id": "k", "comment": null})),
            ],
        ),
        (
            Group::Scoreboards,
            vec![
                action(json!({"type": "scoreReset", "id": "b"})),
                action(json!({"type": "scoreClock", "id": "b", "run": true})),
            ],
        ),
        (
            Group::Countdowns,
            vec![
                action(json!({"type": "startCountdown", "id": "t"})),
                action(json!({"type": "addCountdownTime", "id": "t", "ms": 60000})),
            ],
        ),
        (
            Group::Lyrics,
            vec![
                action(json!({"type": "lyricsNext", "id": "l"})),
                action(json!({"type": "lyricsBlank", "id": "l", "value": true})),
            ],
        ),
        (
            Group::Slides,
            vec![
                action(json!({"type": "slideNext", "id": "d"})),
                action(json!({"type": "slideBlack", "id": "d", "value": true})),
            ],
        ),
        (
            Group::Data,
            vec![
                action(json!({"type": "dataStep", "delta": 1})),
                action(json!({"type": "dataRow", "row": 3})),
            ],
        ),
        (
            Group::Audience,
            vec![
                action(json!({"type": "pollOpen", "id": "q", "value": true})),
                action(json!({"type": "raffleDraw", "id": "r"})),
                action(json!({"type": "qnaOpen", "value": true})),
            ],
        ),
        (
            Group::Audio,
            vec![
                action(json!({"type": "setMasterVolume", "value": 0.5})),
                action(json!({"type": "setMasterMuted", "value": true})),
                action(json!({"type": "setSolo", "sourceId": null})),
                // An input's own volume or mute is the mixer's too.
                action(json!({"type": "updateSource", "id": "mic1", "patch": {"volume": 0.4}})),
                action(json!({"type": "updateSource", "id": "mic1", "patch": {"muted": true}})),
            ],
        ),
        (
            Group::Replay,
            vec![action(
                json!({"type": "requestApp", "step": {"command": "replay", "seconds": 5, "slow": false}}),
            )],
        ),
        (
            Group::Recording,
            vec![
                action(json!({"type": "requestApp", "step": {"command": "record", "on": true}})),
                action(json!({"type": "requestApp", "step": {"command": "stream", "on": true}})),
            ],
        ),
        (
            Group::Playback,
            vec![
                action(json!({"type": "play", "id": "v"})),
                action(json!({"type": "seek", "id": "v", "posS": 3.0})),
            ],
        ),
        (
            Group::Inputs,
            vec![
                action(json!({"type": "removeSource", "id": "cam1"})),
                action(json!({"type": "moveSource", "id": "cam1", "index": 0})),
                // A name change (even with a volume) is not just the mixer's.
                action(
                    json!({"type": "updateSource", "id": "mic1", "patch": {"name": "Pulpit", "volume": 0.4}}),
                ),
                action(
                    json!({"type": "addSource", "source": {"name": "Cam 4", "kind": {"type": "camera", "deviceId": "x", "label": "Cam"}}}),
                ),
            ],
        ),
        (
            Group::RunOfShow,
            vec![
                action(json!({"type": "nextCue"})),
                action(json!({"type": "runMacro", "id": "m"})),
                action(json!({"type": "fireTrigger", "id": "t"})),
            ],
        ),
        (
            Group::Stage,
            vec![
                action(json!({"type": "monitorFlash"})),
                action(json!({"type": "prompterRun", "run": true})),
            ],
        ),
        (
            Group::EventSettings,
            vec![action(json!({"type": "setBackupOn", "value": true}))],
        ),
    ]
}

/// Only the show computer itself sends these (or the phone remote's server).
fn show_computer_only() -> Vec<Action> {
    vec![
        action(json!({"type": "setDisplay", "screen": "live", "displayId": null})),
        action(json!({"type": "setAudioOutput", "output": "master", "deviceId": null})),
        action(json!({"type": "setDataFile", "path": "C:/show/data.csv", "everyMs": 1000})),
        action(json!({"type": "relinkMedia", "from": "a.mp4", "to": "b.mp4"})),
        action(json!({"type": "setNoSignal", "ids": ["cam1"]})),
        action(json!({"type": "setDuration", "id": "v", "durationS": 3.0})),
        action(json!({"type": "pollVote", "id": "q", "round": 1, "option": 0, "previous": null})),
        action(json!({"type": "qnaAsk", "author": "A", "text": "Q?"})),
    ]
}

fn expected(role: &Role, group: Group) -> bool {
    use Group as G;
    match role {
        Role::Director => true,
        Role::Graphics => matches!(
            group,
            G::Overlays
                | G::Titles
                | G::Scoreboards
                | G::Countdowns
                | G::Lyrics
                | G::Slides
                | G::Data
        ),
        Role::Audio => group == G::Audio,
        Role::Replay => group == G::Replay,
        Role::Cameras => matches!(group, G::Cameras | G::Preview),
        Role::Custom { groups } => groups.contains(&group),
    }
}

fn roles() -> Vec<Role> {
    vec![
        Role::Director,
        Role::Graphics,
        Role::Audio,
        Role::Replay,
        Role::Cameras,
        Role::Custom {
            groups: vec![Group::Lyrics, Group::Slides, Group::Audio],
        },
        Role::Custom { groups: vec![] },
    ]
}

#[test]
fn every_group_is_tested() {
    let tested: Vec<Group> = samples().into_iter().map(|(g, _)| g).collect();
    for g in Group::ALL {
        assert!(tested.contains(&g), "{g:?} has no sample");
    }
}

#[test]
fn samples_are_in_their_group() {
    for (g, actions) in samples() {
        for a in actions {
            assert_eq!(group_of(&a), Some(g), "{a:?}");
        }
    }
}

#[test]
fn every_role_against_every_group() {
    for role in roles() {
        for (g, actions) in samples() {
            for a in actions {
                let got = seat_may(&a, &role, false);
                if expected(&role, g) {
                    assert_eq!(got, Ok(()), "{role:?} should be allowed {a:?}");
                } else {
                    assert_eq!(
                        got,
                        Err(Refusal::NotYourSeat),
                        "{role:?} should be refused {a:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn graphics_can_not_cut_go_live_or_record() {
    let g = Role::Graphics;
    for a in [
        json!({"type": "take", "screen": "live"}),
        json!({"type": "cutTo", "screen": "live", "sourceId": "cam1"}),
        json!({"type": "setPreview", "screen": "live", "sourceId": "cam1"}),
        json!({"type": "requestApp", "step": {"command": "stream", "on": true}}),
        json!({"type": "requestApp", "step": {"command": "record", "on": true}}),
    ] {
        assert_eq!(seat_may(&action(a), &g, false), Err(Refusal::NotYourSeat));
    }
    for c in [
        SeatCommand::Record { on: true },
        SeatCommand::Stream { on: true },
    ] {
        assert_eq!(seat_may_command(&c, &g, false), Err(Refusal::NotYourSeat));
    }
}

#[test]
fn new_titles_and_countdowns_go_with_graphics_other_inputs_do_not() {
    use lumora_engine::{NewSource, SourceKind};
    let add = |kind: SourceKind| Action::AddSource {
        source: NewSource {
            id: None,
            name: "New".into(),
            kind,
            volume: None,
            muted: None,
            looping: None,
            fit: None,
            audio: None,
            key: None,
            screens: None,
        },
    };
    assert_eq!(
        group_of(&add(SourceKind::Text(Box::default()))),
        Some(Group::Titles)
    );
    assert_eq!(
        group_of(&add(SourceKind::Countdown {
            background: "#000".into(),
            logo: None,
            timer: lumora_engine::Countdown::default(),
        })),
        Some(Group::Countdowns)
    );
    assert_eq!(group_of(&add(SourceKind::Pattern)), Some(Group::Inputs));
    assert!(seat_may(
        &add(SourceKind::Text(Box::default())),
        &Role::Graphics,
        false
    )
    .is_ok());
    assert_eq!(
        seat_may(&add(SourceKind::Pattern), &Role::Graphics, false),
        Err(Refusal::NotYourSeat)
    );
}

#[test]
fn the_show_computers_own_things_are_refused_even_for_the_director() {
    for role in roles() {
        for a in show_computer_only() {
            assert_eq!(group_of(&a), None, "{a:?}");
            assert_eq!(
                seat_may(&a, &role, false),
                Err(Refusal::ShowComputerOnly),
                "{role:?} {a:?}"
            );
        }
    }
}

#[test]
fn a_locked_seat_can_do_nothing() {
    for role in roles() {
        for (_, actions) in samples() {
            for a in actions {
                assert_eq!(seat_may(&a, &role, true), Err(Refusal::Locked));
            }
        }
        assert_eq!(
            seat_may_command(
                &SeatCommand::Replay {
                    seconds: 5,
                    slow: false
                },
                &role,
                true
            ),
            Err(Refusal::Locked)
        );
    }
}

#[test]
fn control_window_requests_by_role() {
    let replay = SeatCommand::Replay {
        seconds: 8,
        slow: true,
    };
    let buffer = SeatCommand::ReplayBuffer { on: true };
    let record = SeatCommand::Record { on: true };
    let stream = SeatCommand::Stream { on: false };
    let rehearsal = SeatCommand::Rehearsal { on: true };
    for role in roles() {
        for c in [&replay, &buffer] {
            assert_eq!(
                seat_may_command(c, &role, false).is_ok(),
                expected(&role, Group::Replay),
                "{role:?} {c:?}"
            );
        }
        for c in [&record, &stream, &rehearsal] {
            assert_eq!(
                seat_may_command(c, &role, false).is_ok(),
                expected(&role, Group::Recording),
                "{role:?} {c:?}"
            );
        }
    }
    assert!(!SeatCommand::Replay {
        seconds: 0,
        slow: false
    }
    .valid());
    assert!(!SeatCommand::Replay {
        seconds: 61,
        slow: false
    }
    .valid());
    assert!(replay.valid());
}

#[test]
fn roles_and_groups_have_a_stable_json_form() {
    assert_eq!(
        serde_json::to_value(Role::Graphics).unwrap(),
        json!({"kind": "graphics"})
    );
    assert_eq!(
        serde_json::to_value(Role::Custom {
            groups: vec![Group::RunOfShow, Group::EventSettings]
        })
        .unwrap(),
        json!({"kind": "custom", "groups": ["runOfShow", "eventSettings"]})
    );
    let back: Role =
        serde_json::from_value(json!({"kind": "custom", "groups": ["audio", "audio"]})).unwrap();
    assert_eq!(back.groups(), vec![Group::Audio]);
    assert_eq!(Role::Director.groups().len(), Group::ALL.len());
    assert_eq!(Role::Cameras.label(), "Cameras");
}
