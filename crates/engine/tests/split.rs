//! Behavior tests for split screens.

use lumora_engine::*;

fn id(s: &str) -> SourceId {
    SourceId::new(s)
}

fn add(e: &mut Engine, sid: &str, kind: SourceKind) {
    e.apply(
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
    )
    .unwrap();
}

fn setup() -> Engine {
    let mut e = Engine::new();
    add(&mut e, "cam1", SourceKind::Pattern);
    add(
        &mut e,
        "cam2",
        SourceKind::Color {
            color: "#223344".into(),
        },
    );
    add(&mut e, "split", SourceKind::Split(Box::default()));
    e
}

fn split(e: &Engine) -> Split {
    match &e.show().source(&id("split")).unwrap().kind {
        SourceKind::Split(s) => (**s).clone(),
        _ => panic!(),
    }
}

#[test]
fn a_ready_made_layout_places_its_boxes_and_keeps_the_inputs() {
    let mut e = setup();
    let mut s = split(&e);
    assert_eq!(s.boxes.len(), 2, "side by side: two boxes");
    s.boxes[0].source_id = Some(id("cam1"));
    s.boxes[1].source_id = Some(id("cam2"));
    s.layout = SplitLayout::Grid;
    e.apply(
        Action::UpdateSplit {
            id: id("split"),
            split: s,
        },
        1,
    )
    .unwrap();
    let s = split(&e);
    assert_eq!(s.boxes.len(), 4);
    assert_eq!(s.boxes[1].source_id, Some(id("cam2")));
    assert!(s
        .boxes
        .iter()
        .all(|b| b.frame.x + b.frame.w <= 100.0 && b.frame.y + b.frame.h <= 100.0));
}

#[test]
fn a_split_cannot_hold_a_microphone_or_another_split() {
    let mut e = setup();
    add(
        &mut e,
        "mic",
        SourceKind::Microphone {
            device_id: "m".into(),
            label: "Mic".into(),
        },
    );
    add(&mut e, "split2", SourceKind::Split(Box::default()));
    for bad in ["mic", "split2", "gone"] {
        let mut s = split(&e);
        s.boxes[0].source_id = Some(id(bad));
        assert!(
            e.apply(
                Action::UpdateSplit {
                    id: id("split"),
                    split: s
                },
                1
            )
            .is_err(),
            "{bad}"
        );
    }
}

#[test]
fn removing_an_input_empties_its_box() {
    let mut e = setup();
    let mut s = split(&e);
    s.boxes[0].source_id = Some(id("cam1"));
    e.apply(
        Action::UpdateSplit {
            id: id("split"),
            split: s,
        },
        1,
    )
    .unwrap();
    e.apply(Action::RemoveSource { id: id("cam1") }, 2).unwrap();
    assert_eq!(split(&e).boxes[0].source_id, None);
}

#[test]
fn custom_boxes_stay_where_they_are_put() {
    let mut e = setup();
    let mut s = split(&e);
    s.layout = SplitLayout::Custom;
    s.boxes[0].frame = Frame {
        x: 10.0,
        y: 10.0,
        w: 30.0,
        h: 30.0,
    };
    e.apply(
        Action::UpdateSplit {
            id: id("split"),
            split: s,
        },
        1,
    )
    .unwrap();
    assert_eq!(
        split(&e).boxes[0].frame,
        Frame {
            x: 10.0,
            y: 10.0,
            w: 30.0,
            h: 30.0
        }
    );
}
