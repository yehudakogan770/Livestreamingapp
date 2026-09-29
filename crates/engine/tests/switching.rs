//! Fade to black, favourite transitions and quick play.

use lumora_engine::*;

fn show_with(ids: &[&str]) -> Engine {
    let mut e = Engine::new();
    for id in ids {
        e.apply(
            Action::AddSource {
                source: NewSource {
                    id: Some(SourceId::new(*id)),
                    name: (*id).into(),
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
    e
}

#[test]
fn fade_to_black_takes_the_chosen_length_and_comes_back() {
    let mut e = show_with(&[]);
    assert_eq!(e.show().settings.fade_to_black_ms, 2000);
    e.apply(Action::SetFadeToBlackLength { ms: 99_999 }, 0)
        .unwrap();
    assert_eq!(e.show().settings.fade_to_black_ms, 10_000);
    e.apply(Action::SetFadeToBlackLength { ms: 3000 }, 0)
        .unwrap();
    e.apply(
        Action::FadeToBlack {
            screen: ScreenId::Live,
        },
        500,
    )
    .unwrap();
    let sc = &e.show().screens.live;
    assert!(sc.blank);
    assert_eq!(sc.blank_fade_ms, 3000);
    assert_eq!(sc.blank_changed_at, 500);
    e.apply(
        Action::FadeToBlack {
            screen: ScreenId::Live,
        },
        900,
    )
    .unwrap();
    assert!(!e.show().screens.live.blank);
    // The quick Blank uses the usual fade.
    e.apply(
        Action::SetBlank {
            screens: vec![ScreenId::Live],
            value: true,
            fade_ms: None,
        },
        1000,
    )
    .unwrap();
    assert_eq!(e.show().screens.live.blank_fade_ms, 0);
    assert!(e
        .apply(
            Action::FadeToBlack {
                screen: ScreenId::Monitor
            },
            0
        )
        .is_err());
}

#[test]
fn favourite_transitions_are_four_and_can_be_changed() {
    let mut e = show_with(&[]);
    assert_eq!(e.show().settings.favourite_transitions.len(), 4);
    let t = Transition {
        kind: TransitionKind::Wipe,
        duration_ms: 2500,
    };
    e.apply(
        Action::SetFavouriteTransition {
            index: 0,
            transition: t,
        },
        0,
    )
    .unwrap();
    assert_eq!(e.show().settings.favourite_transitions[0], t);
    assert!(e
        .apply(
            Action::SetFavouriteTransition {
                index: 4,
                transition: t
            },
            0
        )
        .is_err());
}

#[test]
fn play_now_sends_an_input_to_air_and_keeps_next() {
    let mut e = show_with(&["a", "b", "c"]);
    e.apply(
        Action::SetPreview {
            screen: ScreenId::Live,
            source_id: Some(SourceId::new("b")),
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::PlayNow {
            screen: ScreenId::Live,
            source_id: SourceId::new("c"),
            transition: Transition {
                kind: TransitionKind::Dip,
                duration_ms: 1000,
            },
        },
        100,
    )
    .unwrap();
    let sc = &e.show().screens.live;
    assert_eq!(sc.program, Some(SourceId::new("c")));
    assert_eq!(sc.preview, Some(SourceId::new("b")), "Next stays lined up");
    assert_eq!(
        sc.transition.as_ref().map(|t| t.kind),
        Some(TransitionKind::Dip)
    );
}
