//! Behavior tests for credits.

use lumora_engine::*;

fn id(s: &str) -> SourceId {
    SourceId::new(s)
}

fn setup() -> Engine {
    let mut e = Engine::new();
    let credits = Credits {
        names: vec!["Mendel K. — Chazzan".into(), "  ".into(), "Chaya S.".into()],
        ..Credits::default()
    };
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(id("c")),
                name: "Credits".into(),
                kind: SourceKind::Credits(Box::new(credits)),
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
    e
}

fn credits(e: &Engine) -> Credits {
    match &e.show().source(&id("c")).unwrap().kind {
        SourceKind::Credits(c) => (**c).clone(),
        _ => panic!(),
    }
}

#[test]
fn blank_names_are_dropped_and_it_waits_until_on_air() {
    let e = setup();
    let c = credits(&e);
    assert_eq!(c.names, ["Mendel K. — Chazzan", "Chaya S."]);
    assert!(!c.playing);
}

#[test]
fn it_rolls_from_the_top_when_taken_to_air() {
    let mut e = setup();
    e.apply(
        Action::CutTo {
            screen: ScreenId::Live,
            source_id: id("c"),
        },
        5000,
    )
    .unwrap();
    let c = credits(&e);
    assert!(c.playing);
    assert_eq!(c.position(8000), 3000);
}

#[test]
fn pause_speed_and_restart_never_jump() {
    let mut e = setup();
    e.apply(
        Action::CreditsPlay {
            id: id("c"),
            value: true,
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::CreditsPlay {
            id: id("c"),
            value: false,
        },
        4000,
    )
    .unwrap();
    assert_eq!(credits(&e).position(9000), 4000, "paused stays put");
    e.apply(
        Action::CreditsPlay {
            id: id("c"),
            value: true,
        },
        9000,
    )
    .unwrap();
    e.apply(
        Action::CreditsSpeed {
            id: id("c"),
            speed: 120,
        },
        10_000,
    )
    .unwrap();
    assert_eq!(credits(&e).position(10_000), 5000);
    assert_eq!(credits(&e).speed, 120);
    e.apply(Action::CreditsRestart { id: id("c") }, 11_000)
        .unwrap();
    assert_eq!(credits(&e).position(12_000), 1000);
}

#[test]
fn editing_the_names_keeps_where_it_is() {
    let mut e = setup();
    e.apply(
        Action::CreditsPlay {
            id: id("c"),
            value: true,
        },
        0,
    )
    .unwrap();
    let mut c = credits(&e);
    c.names.push("Levi G.".into());
    c.playing = false;
    c.pos_ms = 0;
    e.apply(
        Action::UpdateCredits {
            id: id("c"),
            credits: c,
        },
        3000,
    )
    .unwrap();
    let c = credits(&e);
    assert_eq!(c.names.len(), 3);
    assert!(c.playing);
    assert_eq!(c.position(3000), 3000);
}
