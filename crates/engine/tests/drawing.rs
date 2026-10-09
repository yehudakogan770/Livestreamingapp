//! Drawing on screen: strokes, undo and clear through the engine.

use lumora_engine::drawing::{Drawing, Stroke};
use lumora_engine::*;

fn strokes(e: &Engine) -> usize {
    match &e.show().source(&SourceId::new("draw")).unwrap().kind {
        SourceKind::Drawing(d) => d.strokes.len(),
        other => panic!("{other:?}"),
    }
}

#[test]
fn lines_are_drawn_taken_back_and_cleared() {
    let mut e = Engine::new();
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new("draw")),
                name: "Drawing".into(),
                kind: SourceKind::Drawing(Box::new(Drawing {
                    strokes: vec![Stroke::default()],
                    changed_at: 0,
                })),
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
    // A stroke with no points is dropped when the input is made.
    assert_eq!(strokes(&e), 0);
    let line = Stroke {
        points: vec![[0.1, 0.2], [0.3, 0.4]],
        arrow: true,
        ..Stroke::default()
    };
    for t in 1..=3 {
        e.apply(
            Action::DrawStroke {
                id: SourceId::new("draw"),
                stroke: line.clone(),
            },
            t,
        )
        .unwrap();
    }
    assert_eq!(strokes(&e), 3);
    e.apply(
        Action::DrawUndo {
            id: SourceId::new("draw"),
        },
        4,
    )
    .unwrap();
    assert_eq!(strokes(&e), 2);
    e.apply(
        Action::DrawClear {
            id: SourceId::new("draw"),
        },
        5,
    )
    .unwrap();
    assert_eq!(strokes(&e), 0);
    // Only a drawing input takes strokes.
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new("cam")),
                name: "Cam".into(),
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
        6,
    )
    .unwrap();
    assert!(e
        .apply(
            Action::DrawClear {
                id: SourceId::new("cam"),
            },
            7,
        )
        .is_err());
}
