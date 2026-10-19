
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
    assert_eq!(e.tick(9000), Outcome::Unchanged, "not again in the same play");
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
    e.apply(Action::SetNoSignal { ids: vec![id("cam")] }, 100)
        .unwrap();
    assert_eq!(e.show().triggers[0].last_fired, 100);
    assert_eq!(e.show().triggers[1].last_fired, 0);
    assert_eq!(e.show().screens.back.program, Some(id("logo")));
    // Still lost: nothing more.
    e.apply(Action::SetNoSignal { ids: vec![id("cam")] }, 200)
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
