//! Behaviour tests for text inputs (lower thirds, titles, tickers).

use lumora_engine::persist::{load_json, save_json};
use lumora_engine::*;

fn id(s: &str) -> SourceId {
    SourceId::new(s)
}

fn setup() -> Engine {
    let mut e = Engine::new();
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(id("lt")),
                name: "Lower third".into(),
                kind: SourceKind::Text(Box::default()),
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
    e
}

fn text(e: &Engine) -> TextInput {
    match &e.show().source(&id("lt")).unwrap().kind {
        SourceKind::Text(t) => (**t).clone(),
        _ => panic!("not text"),
    }
}

#[test]
fn a_text_input_is_edited_and_kept_in_range() {
    let mut e = setup();
    let mut t = text(&e);
    t.text = "Rabbi Cohen".into();
    t.sub = "Head of School".into();
    t.layout = TextLayout::Ticker;
    t.style.size = 5000;
    t.style.weight = 650;
    t.style.color = "blue".into();
    t.style.box_opacity = f32::NAN;
    e.apply(
        Action::UpdateText {
            id: id("lt"),
            text: t,
        },
        1,
    )
    .unwrap();
    let t = text(&e);
    assert_eq!(
        (t.text.as_str(), t.sub.as_str(), t.layout),
        ("Rabbi Cohen", "Head of School", TextLayout::Ticker)
    );
    assert_eq!((t.style.size, t.style.weight), (400, 600));
    assert_eq!(t.style.color, TextStyle::default().color);
    assert!((t.style.box_opacity - TextStyle::default().box_opacity).abs() < f32::EPSILON);
}

#[test]
fn only_text_inputs_take_text_and_it_is_saved() {
    let mut e = setup();
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(id("bars")),
                name: "Bars".into(),
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
    assert!(e
        .apply(
            Action::UpdateText {
                id: id("bars"),
                text: TextInput::default()
            },
            1
        )
        .is_err());
    let back = load_json(&save_json(e.show())).unwrap();
    assert_eq!(back.source(&id("lt")), e.show().source(&id("lt")));
}

#[test]
fn text_can_be_an_overlay() {
    let mut e = setup();
    e.apply(
        Action::SetOverlaySource {
            channel: 1,
            source_id: Some(id("lt")),
        },
        0,
    )
    .unwrap();
    e.apply(
        Action::SetOverlayOn {
            channel: 1,
            value: true,
        },
        1,
    )
    .unwrap();
    assert!(e.show().overlays[1].on);
}
