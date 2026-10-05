//! Behavior tests for 3D logos.

use lumora_engine::logo3d::{Logo3d, LogoMaterial};
use lumora_engine::*;

fn add(e: &mut Engine, kind: SourceKind) {
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new("logo")),
                name: "Logo".into(),
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

fn logo(e: &Engine) -> Logo3d {
    match &e.show().source(&SourceId::new("logo")).unwrap().kind {
        SourceKind::Logo3d(l) => (**l).clone(),
        _ => panic!("not a 3D logo"),
    }
}

#[test]
fn a_3d_logo_is_added_repaired_and_changed() {
    let mut e = Engine::new();
    let wild = Logo3d {
        depth: 900.0,
        seconds: f32::NAN,
        color: Some("green".into()),
        ..Logo3d::default()
    };
    add(&mut e, SourceKind::Logo3d(Box::new(wild)));
    let l = logo(&e);
    assert!((l.depth - 60.0).abs() < 1e-6);
    assert!((l.seconds - 6.0).abs() < 1e-6);
    assert_eq!(l.color.as_deref(), Some("#b8c0c8"));

    let glass = Logo3d {
        material: LogoMaterial::Glass,
        color: None,
        ..l
    };
    e.apply(
        Action::UpdateLogo3d {
            id: SourceId::new("logo"),
            logo: glass,
        },
        0,
    )
    .unwrap();
    assert_eq!(logo(&e).material, LogoMaterial::Glass);
    assert_eq!(logo(&e).color, None, "the logo's own colors");
    e.apply(
        Action::CutTo {
            screen: ScreenId::Live,
            source_id: SourceId::new("logo"),
        },
        0,
    )
    .unwrap();
}

#[test]
fn only_a_3d_logo_takes_3d_logo_settings() {
    let mut e = Engine::new();
    add(&mut e, SourceKind::Pattern);
    assert!(e
        .apply(
            Action::UpdateLogo3d {
                id: SourceId::new("logo"),
                logo: Logo3d::default(),
            },
            0
        )
        .is_err());
}

#[test]
fn every_file_in_the_show_can_be_moved_to_the_apps_copy() {
    let mut e = Engine::new();
    e.apply(
        Action::AddSource {
            source: NewSource {
                id: Some(SourceId::new("v")),
                name: "Video".into(),
                kind: SourceKind::Video {
                    path: "C:/Users/me/Desktop/intro.mp4".into(),
                    duration_s: 0.0,
                    playback: Playback::default(),
                },
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
    let wanted = vec!["C:/Users/me/Desktop/intro.mp4".to_owned()];
    assert_eq!(lumora_engine::media::paths(e.show()), wanted);
    e.apply(
        Action::RelinkMedia {
            from: "C:/Users/me/Desktop/intro.mp4".into(),
            to: "D:/Lumora/media/intro.mp4".into(),
        },
        0,
    )
    .unwrap();
    assert_eq!(
        lumora_engine::media::paths(e.show()),
        vec!["D:/Lumora/media/intro.mp4".to_owned()]
    );
}

#[test]
fn files_on_air_are_known_so_they_are_never_swapped_live() {
    let mut e = Engine::new();
    for (id, path) in [("a", "/a.png"), ("b", "/b.png")] {
        e.apply(
            Action::AddSource {
                source: NewSource {
                    id: Some(SourceId::new(id)),
                    name: id.into(),
                    kind: SourceKind::Image { path: path.into() },
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
    e.apply(
        Action::CutTo {
            screen: ScreenId::Back,
            source_id: SourceId::new("a"),
        },
        0,
    )
    .unwrap();
    let on = lumora_engine::media::on_air_paths(e.show());
    assert!(on.contains(&"/a.png".to_owned()));
    assert!(!on.contains(&"/b.png".to_owned()));
}
