//! Behavior tests for the 12 Pesukim input.

use lumora_engine::persist::{load_json, save_json};
use lumora_engine::pesukim::words_of;
use lumora_engine::*;

fn apply(e: &mut Engine, a: Action, now: Millis) {
    e.apply(a, now).expect("action should be accepted");
}

fn id(s: &str) -> SourceId {
    SourceId::new(s)
}

fn add(e: &mut Engine, sid: &str, kind: SourceKind) {
    apply(
        e,
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
                screens: None,
            },
        },
        0,
    );
}

fn pasuk(child: &str, text: &str) -> Pasuk {
    Pasuk {
        child: child.into(),
        text: text.into(),
        ..Pasuk::default()
    }
}

/// A Pesukim input with three pesukim filled in, and a camera.
fn setup() -> Engine {
    let mut e = Engine::new();
    add(&mut e, "cam", SourceKind::Pattern);
    add(&mut e, "p", SourceKind::Pesukim(Box::default()));
    let mut list = vec![Pasuk::default(); 12];
    list[0] = pasuk("Mendel", "תּוֹרָה צִוָּה לָנוּ");
    list[1] = pasuk("Chaya", "שְׁמַע יִשְׂרָאֵל ה׳-אֱלֹקֵינוּ");
    list[11] = pasuk("Levi", "אחד שנים");
    apply(
        &mut e,
        Action::UpdatePesukim {
            id: id("p"),
            pesukim: Some(list),
            look: None,
        },
        0,
    );
    e
}

fn place(e: &Engine) -> (usize, usize) {
    let p = e.show().pesukim(&id("p")).unwrap();
    (p.place.pasuk, p.place.word)
}

#[test]
fn a_hyphen_joins_words_shown_together() {
    assert_eq!(
        words_of("שְׁמַע יִשְׂרָאֵל ה׳-אֱלֹקֵינוּ"),
        ["שְׁמַע", "יִשְׂרָאֵל", "ה׳ אֱלֹקֵינוּ"]
    );
    // The Hebrew maqaf stays part of the word.
    assert_eq!(words_of("כָּל־הָעָם"), ["כָּל־הָעָם"]);
    assert_eq!(words_of("G-d is-our-G-d"), ["G-d", "is our G-d"]);
}

#[test]
fn next_goes_word_by_word_then_on_to_the_next_pasuk() {
    let mut e = setup();
    let next = Action::PesukimNext { id: id("p") };
    apply(&mut e, next.clone(), 1);
    apply(&mut e, next.clone(), 2);
    assert_eq!(place(&e), (0, 2));
    apply(&mut e, next.clone(), 3);
    assert_eq!(place(&e), (1, 0), "after the last word: the next pasuk");
    apply(&mut e, Action::PesukimBack { id: id("p") }, 4);
    assert_eq!(
        place(&e),
        (0, 2),
        "back from the first word: the last word before"
    );
}

#[test]
fn the_childs_name_comes_before_their_pasuk_only() {
    let mut e = setup();
    let next = Action::PesukimNext { id: id("p") };
    for t in 1..=3 {
        apply(&mut e, next.clone(), t);
    }
    let p = e.show().pesukim(&id("p")).unwrap();
    assert_eq!((p.place.pasuk, p.place.word, p.place.intro), (1, 0, true));
    apply(&mut e, next.clone(), 4);
    let p = e.show().pesukim(&id("p")).unwrap();
    assert_eq!((p.place.pasuk, p.place.word, p.place.intro), (1, 0, false));
    apply(&mut e, Action::PesukimBack { id: id("p") }, 5);
    assert!(
        e.show().pesukim(&id("p")).unwrap().place.intro,
        "back to the name"
    );
    // Jumping to the first word of the same pasuk: straight to it.
    apply(
        &mut e,
        Action::PesukimGo {
            id: id("p"),
            pasuk: 1,
            word: 0,
        },
        6,
    );
    assert!(!e.show().pesukim(&id("p")).unwrap().place.intro);
    // Another pasuk: the name first.
    apply(
        &mut e,
        Action::PesukimGo {
            id: id("p"),
            pasuk: 0,
            word: 0,
        },
        6,
    );
    assert!(e.show().pesukim(&id("p")).unwrap().place.intro);
    // A pasuk with no child's name goes straight to the words.
    apply(
        &mut e,
        Action::PesukimGo {
            id: id("p"),
            pasuk: 5,
            word: 0,
        },
        6,
    );
    assert!(!e.show().pesukim(&id("p")).unwrap().place.intro);
}

#[test]
fn go_jumps_anywhere_and_the_end_stays_put() {
    let mut e = setup();
    apply(
        &mut e,
        Action::PesukimGo {
            id: id("p"),
            pasuk: 11,
            word: 99,
        },
        1,
    );
    assert_eq!(place(&e), (11, 1), "clamped to the last word");
    assert_eq!(
        e.apply(Action::PesukimNext { id: id("p") }, 2).unwrap(),
        Outcome::Unchanged
    );
}

#[test]
fn whole_pasuk_and_blank_end_with_the_next_word() {
    let mut e = setup();
    apply(
        &mut e,
        Action::PesukimWhole {
            id: id("p"),
            value: true,
        },
        1,
    );
    assert!(e.show().pesukim(&id("p")).unwrap().place.whole);
    apply(&mut e, Action::PesukimNext { id: id("p") }, 2);
    let p = e.show().pesukim(&id("p")).unwrap();
    assert!(!p.place.whole);
    assert_eq!((p.place.pasuk, p.place.word), (0, 1));
    apply(
        &mut e,
        Action::PesukimBlank {
            id: id("p"),
            value: true,
        },
        3,
    );
    assert!(e.show().pesukim(&id("p")).unwrap().place.blank);
}

#[test]
fn auto_advance_moves_on_only_while_on_air() {
    let mut e = setup();
    let look = PesukimLook {
        auto_ms: Some(3000),
        ..PesukimLook::default()
    };
    apply(
        &mut e,
        Action::UpdatePesukim {
            id: id("p"),
            pesukim: None,
            look: Some(look),
        },
        0,
    );
    assert_eq!(e.tick(10_000), Outcome::Unchanged, "not on air: stays");
    apply(
        &mut e,
        Action::CutTo {
            screen: ScreenId::Live,
            source_id: id("p"),
        },
        10_000,
    );
    apply(
        &mut e,
        Action::PesukimGo {
            id: id("p"),
            pasuk: 0,
            word: 0,
        },
        10_000,
    );
    assert_eq!(e.tick(12_000), Outcome::Unchanged);
    assert_eq!(e.tick(13_000), Outcome::Changed);
    assert_eq!(place(&e), (0, 1));
}

#[test]
fn only_a_picture_can_go_behind_the_words_and_removing_it_clears_it() {
    let mut e = setup();
    let behind = |b: &str| PesukimLook {
        behind: Some(id(b)),
        ..PesukimLook::default()
    };
    assert!(e
        .apply(
            Action::UpdatePesukim {
                id: id("p"),
                pesukim: None,
                look: Some(behind("p"))
            },
            1
        )
        .is_err());
    assert!(e
        .apply(
            Action::UpdatePesukim {
                id: id("p"),
                pesukim: None,
                look: Some(behind("nope"))
            },
            1
        )
        .is_err());
    apply(
        &mut e,
        Action::UpdatePesukim {
            id: id("p"),
            pesukim: None,
            look: Some(behind("cam")),
        },
        1,
    );
    apply(&mut e, Action::RemoveSource { id: id("cam") }, 2);
    assert_eq!(e.show().pesukim(&id("p")).unwrap().look.behind, None);
}

#[test]
fn always_twelve_pesukim_and_saved_with_the_show() {
    let mut e = setup();
    apply(
        &mut e,
        Action::UpdatePesukim {
            id: id("p"),
            pesukim: Some(vec![pasuk("A", "one two")]),
            look: None,
        },
        1,
    );
    assert_eq!(e.show().pesukim(&id("p")).unwrap().pesukim.len(), 12);
    apply(&mut e, Action::PesukimNext { id: id("p") }, 2);
    let back = load_json(&save_json(e.show())).unwrap();
    assert_eq!(back.pesukim(&id("p")), e.show().pesukim(&id("p")));
}

#[test]
fn a_broken_save_is_repaired() {
    let e = setup();
    let mut v: serde_json::Value = serde_json::from_str(&save_json(e.show())).unwrap();
    let kind = &mut v["sources"][1]["kind"];
    kind["look"]["textColor"] = "red".into();
    kind["look"]["behind"] = "gone".into();
    kind["place"]["pasuk"] = 40.into();
    kind["pesukim"] = serde_json::json!([{ "child": "X", "text": "a b" }]);
    let show = load_json(&v.to_string()).unwrap();
    let p = show.pesukim(&id("p")).unwrap();
    assert_eq!(p.pesukim.len(), 12);
    assert_eq!(p.look.text_color, PesukimLook::default().text_color);
    assert_eq!(p.look.behind, None);
    assert_eq!(p.place.pasuk, 11);
}
