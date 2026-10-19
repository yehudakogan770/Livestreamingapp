import sys
p = sys.argv[1]
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:70]
    s = s.replace(a, b, 1)


rep("""    /// Inputs' small pictures for control surfaces (see `picture`).
    pictures: Mutex<Pictures>,""", """    /// Inputs' small pictures for control surfaces (see `picture`).
    pictures: Mutex<Pictures>,
    /// Reactions tapped since the last batch went to the show, by input (see `react`).
    taps: Mutex<HashMap<String, Vec<u32>>>,""")
rep("""                pictures: Mutex::new(Pictures::default()),""", """                pictures: Mutex::new(Pictures::default()),
                taps: Mutex::new(HashMap::new()),""")
rep("""        remote.save();
        if lock(&remote.config).enabled {""", """        remote.save();
        gather_reactions(&remote.shared);
        if lock(&remote.config).enabled {""")
rep("""            | "/api/ask/vote"
""", """            | "/api/ask/vote"
            | "/api/react"
""")
rep("""                "seating": open("seating", &["title"]),""", """                "seating": open("seating", &["title"]),
                "reactions": open("reactions", &[]),""")
rep("""        (Method::Post, "/api/ask/vote") => match question_vote(shared, &mut request) {""", """        (Method::Post, "/api/react") => match react(shared, &mut request) {
            Ok(()) => json(request, 200, "{}"),
            Err(status) => json(request, status, r#"{"code":"notTakingReactions"}"#),
        },
        (Method::Post, "/api/ask/vote") => match question_vote(shared, &mut request) {""")
rep("""/// Words each phone may send to one word cloud round.""", """/// How often the reactions tapped are handed to the show.
const REACT_EVERY: Duration = Duration::from_millis(250);
/// A phone's taps closer together than this count once, ms.
const REACT_GAP_MS: u64 = 120;

/// Hand the reactions tapped to the show a few times a second, gathered:
/// a crowd tapping at once changes the show four times a second, not once a tap.
fn gather_reactions(shared: &Arc<Shared>) {
    let weak = Arc::downgrade(shared);
    let _ = std::thread::Builder::new()
        .name("lumora-reactions".into())
        .spawn(move || loop {
            std::thread::sleep(REACT_EVERY);
            let Some(shared) = weak.upgrade() else { break };
            let taps = std::mem::take(&mut *lock(&shared.taps));
            for (id, taps) in taps {
                let _ = shared.backend.apply(Action::React {
                    id: lumora_engine::model::SourceId::new(id),
                    taps,
                });
            }
        });
}

#[derive(Deserialize)]
struct ReactIn {
    id: String,
    /// 0 Love, 1 Haha, 2 Wow, 3 Yes.
    kind: usize,
    voter: String,
}

/// A reaction from a phone, gathered for the next batch.
fn react(shared: &Shared, request: &mut Request) -> Result<(), u16> {
    let mut body = String::new();
    request
        .as_reader()
        .take(1024)
        .read_to_string(&mut body)
        .map_err(|_| 400u16)?;
    let r: ReactIn = serde_json::from_str(&body).map_err(|_| 400u16)?;
    if r.voter.is_empty() || r.voter.len() > 64 || r.kind >= lumora_engine::reactions::KINDS {
        return Err(400);
    }
    // Only reactions that are taking taps.
    let open = shared
        .backend
        .snapshot()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .is_some_and(|v| {
            v["show"]["sources"].as_array().is_some_and(|all| {
                all.iter().any(|s| {
                    s["id"] == r.id.as_str()
                        && s["kind"]["type"] == "reactions"
                        && s["kind"]["open"] == true
                })
            })
        });
    if !open {
        return Err(409);
    }
    let key = format!("react:{}", r.voter);
    let now = now_ms();
    {
        let mut asked = lock(&shared.asked);
        if asked
            .get(&key)
            .is_some_and(|&t| now.saturating_sub(t) < REACT_GAP_MS)
        {
            return Err(429);
        }
        if asked.len() > 50_000 {
            asked.clear();
        }
        asked.insert(key, now);
    }
    let mut taps = lock(&shared.taps);
    if taps.len() > 50 && !taps.contains_key(&r.id) {
        return Err(429);
    }
    let t = taps
        .entry(r.id)
        .or_insert_with(|| vec![0; lumora_engine::reactions::KINDS]);
    t[r.kind] = t[r.kind].saturating_add(1);
    Ok(())
}

/// Words each phone may send to one word cloud round.""")
rep("""    #[test]
    fn control_surfaces_get_input_pictures_from_the_control_window() {""", """    #[test]
    fn reactions_from_phones_reach_the_show_in_batches() {
        let (r, fake) = remote();
        let port = r.set_enabled(true).port.unwrap();
        let tap = |kind: usize, voter: &str| {
            let body = serde_json::json!({"id": "rx", "kind": kind, "voter": voter});
            request(port, "POST", "/api/react", "", &body.to_string()).0
        };
        lock(&fake.engine)
            .apply(
                Action::AddSource {
                    source: serde_json::from_value(serde_json::json!({
                        "id": "rx", "name": "Reactions", "kind": {"type": "reactions"}
                    }))
                    .unwrap(),
                },
                1,
            )
            .unwrap();
        assert_eq!(tap(0, "a"), 409, "closed");
        lock(&fake.engine)
            .apply(
                Action::ReactionsOpen {
                    id: lumora_engine::model::SourceId::new("rx"),
                    value: true,
                },
                2,
            )
            .unwrap();
        assert!(request(port, "GET", "/api/audience", "", "")
            .1
            .contains(r#""reactions":[{"id":"rx"}]"#));
        assert_eq!(tap(0, "a"), 200);
        assert_eq!(tap(0, "a"), 429, "too fast from one phone");
        assert_eq!(tap(3, "b"), 200);
        assert_eq!(tap(9, "c"), 400, "no such reaction");
        let counts = || match &lock(&fake.engine).show().sources[0].kind {
            lumora_engine::SourceKind::Reactions(x) => x.counts.clone(),
            _ => unreachable!(),
        };
        for _ in 0..40 {
            if counts() == vec![1, 0, 0, 1] {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(counts(), vec![1, 0, 0, 1]);
    }

    #[test]
    fn control_surfaces_get_input_pictures_from_the_control_window() {""")
open(p, 'w').write(s)
print('ok')
