//! Behavior tests for slideshows.

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

fn img(p: &str) -> Slide {
    Slide::Image { path: p.into() }
}

/// Three picture slides with a video between the first two.
fn setup() -> Engine {
    let mut e = Engine::new();
    add(
        &mut e,
        "vid",
        SourceKind::Video {
            path: "/v.mp4".into(),
            duration_s: 10.0,
            playback: Playback::default(),
        },
    );
    add(&mut e, "cam", SourceKind::Pattern);
    let sh = Slideshow {
        slides: vec![
            img("/1.png"),
            Slide::Input {
                source_id: id("vid"),
            },
            img("/2.png"),
            img("/3.png"),
        ],
        ..Slideshow::default()
    };
    add(&mut e, "show", SourceKind::Slideshow(Box::default()));
    e.apply(
        Action::UpdateSlideshow {
            id: id("show"),
            slideshow: sh,
        },
        0,
    )
    .unwrap();
    e
}

fn slides(e: &Engine) -> Slideshow {
    match &e.show().source(&id("show")).unwrap().kind {
        SourceKind::Slideshow(s) => (**s).clone(),
        _ => panic!(),
    }
}

fn playing(e: &Engine, sid: &str) -> bool {
    matches!(&e.show().source(&id(sid)).unwrap().kind, SourceKind::Video { playback, .. } if playback.playing)
}

#[test]
fn next_and_back_move_one_slide_and_a_video_slide_plays() {
    let mut e = setup();
    e.apply(Action::SlideNext { id: id("show") }, 100).unwrap();
    assert_eq!(slides(&e).current, 1);
    assert!(
        playing(&e, "vid"),
        "the video between slides starts when it comes up"
    );
    e.apply(Action::SlideNext { id: id("show") }, 200).unwrap();
    e.apply(Action::SlidePrevious { id: id("show") }, 300)
        .unwrap();
    assert_eq!(slides(&e).current, 1);
    e.apply(
        Action::SlideGo {
            id: id("show"),
            index: 99,
        },
        400,
    )
    .unwrap();
    assert_eq!(slides(&e).current, 3, "clamped to the last slide");
}

#[test]
fn it_loops_or_stops_at_the_end() {
    let mut e = setup();
    e.apply(
        Action::SlideGo {
            id: id("show"),
            index: 3,
        },
        1,
    )
    .unwrap();
    e.apply(Action::SlideNext { id: id("show") }, 2).unwrap();
    assert_eq!(slides(&e).current, 0, "looping: back to the first");
    let mut sh = slides(&e);
    sh.looping = false;
    e.apply(
        Action::UpdateSlideshow {
            id: id("show"),
            slideshow: sh,
        },
        3,
    )
    .unwrap();
    e.apply(
        Action::SlideGo {
            id: id("show"),
            index: 3,
        },
        4,
    )
    .unwrap();
    assert_eq!(
        e.apply(Action::SlideNext { id: id("show") }, 5).unwrap(),
        Outcome::Unchanged
    );
}

#[test]
fn auto_advance_only_while_on_air() {
    let mut e = setup();
    let mut sh = slides(&e);
    sh.auto_ms = Some(5000);
    e.apply(
        Action::UpdateSlideshow {
            id: id("show"),
            slideshow: sh,
        },
        0,
    )
    .unwrap();
    assert_eq!(e.tick(20_000), Outcome::Unchanged);
    e.apply(
        Action::CutTo {
            screen: ScreenId::Back,
            source_id: id("show"),
        },
        20_000,
    )
    .unwrap();
    e.apply(
        Action::SlideGo {
            id: id("show"),
            index: 2,
        },
        20_000,
    )
    .unwrap();
    assert_eq!(e.tick(26_000), Outcome::Changed);
    assert_eq!(slides(&e).current, 3);
}

#[test]
fn only_pictures_can_be_slides_and_removing_one_drops_its_slide() {
    let mut e = setup();
    add(
        &mut e,
        "mic",
        SourceKind::Microphone {
            device_id: "m".into(),
            label: "Mic".into(),
        },
    );
    let mut sh = slides(&e);
    sh.slides.push(Slide::Input {
        source_id: id("mic"),
    });
    assert!(e
        .apply(
            Action::UpdateSlideshow {
                id: id("show"),
                slideshow: sh
            },
            1
        )
        .is_err());
    let mut sh = slides(&e);
    sh.slides.push(Slide::Input {
        source_id: id("show"),
    });
    assert!(
        e.apply(
            Action::UpdateSlideshow {
                id: id("show"),
                slideshow: sh
            },
            1
        )
        .is_err(),
        "not itself"
    );
    e.apply(Action::RemoveSource { id: id("vid") }, 2).unwrap();
    assert_eq!(slides(&e).slides.len(), 3);
}
