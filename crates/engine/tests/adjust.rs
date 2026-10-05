//! Behavior tests for picture adjustments.

use lumora_engine::adjust::Adjust;
use lumora_engine::*;

fn add(e: &mut Engine, id: &str, kind: SourceKind) {
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new(id)),
                name: id.into(),
                kind,
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
}

#[test]
fn a_camera_is_adjusted_and_silly_values_are_kept_in_range() {
    let mut e = Engine::new();
    add(
        &mut e,
        "cam",
        SourceKind::Camera {
            device_id: "d".into(),
            label: "Cam".into(),
        },
    );
    assert_eq!(e.show().sources[0].adjust, Adjust::default());
    let warm = Adjust {
        temperature: 4200.0,
        contrast: 500.0,
        zoom: f32::NAN,
        ..Adjust::default()
    };
    e.apply(
        Action::UpdateSource {
            id: SourceId::new("cam"),
            patch: SourcePatch {
                adjust: Some(warm),
                ..SourcePatch::default()
            },
        },
        0,
    )
    .unwrap();
    let a = e.show().sources[0].adjust;
    assert!((a.temperature - 4200.0).abs() < 1e-3);
    assert!((a.contrast - 100.0).abs() < 1e-3);
    assert!((a.zoom - 100.0).abs() < 1e-3);
}

#[test]
fn only_pictures_can_be_adjusted() {
    let mut e = Engine::new();
    add(&mut e, "bars", SourceKind::Pattern);
    assert!(e
        .apply(
            Action::UpdateSource {
                id: SourceId::new("bars"),
                patch: SourcePatch {
                    adjust: Some(Adjust::default()),
                    ..SourcePatch::default()
                },
            },
            0,
        )
        .is_err());
}
