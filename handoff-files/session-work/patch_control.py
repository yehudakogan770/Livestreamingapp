import sys


def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a[:60])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)


edit(sys.argv[1], [
    ("""    ("ptz", "input or name, preset, move, zoom, speed"),""", """    ("ptz", "input or name, preset, move, zoom, speed"),
    (
        "voting",
        "input or name (a poll, word cloud or rating), state (on, off, toggle)",
    ),
    ("questions", "state (on, off, toggle)"),
    ("reactions", "input or name, state (on, off, toggle)"),"""),
    ("""        "blank" | "panic" | "record" | "stream" | "replaybuffer" | "clock" => "state",""",
     """        "blank" | "panic" | "record" | "stream" | "replaybuffer" | "clock" | "questions" => {
            "state"
        }"""),
    ("""        "scorereset" => json!({"type": "scoreReset", "id": input(show, q)?}),""", """        "scorereset" => json!({"type": "scoreReset", "id": input(show, q)?}),
        "voting" | "reactions" => {
            let id = input(show, q)?;
            let kind = if cmd.eq_ignore_ascii_case("voting") {
                "poll"
            } else {
                "reactions"
            };
            let src = sources(show)
                .iter()
                .find(|s| s["id"] == json!(id))
                .filter(|s| s["kind"]["type"] == kind)
                .ok_or(if kind == "poll" {
                    "that input is not a poll, word cloud or rating"
                } else {
                    "that input is not reactions"
                })?;
            let open = state(q, src["kind"]["open"].as_bool().unwrap_or(false))?;
            if kind == "poll" {
                json!({"type": "pollOpen", "id": id, "value": open})
            } else {
                json!({"type": "reactionsOpen", "id": id, "value": open})
            }
        }
        "questions" => {
            let open = show["qna"]["open"].as_bool().unwrap_or(false);
            json!({"type": "qnaOpen", "value": state(q, open)?})
        }"""),
])
edit(sys.argv[2], [
    ("""            | Action::QnaShow { .. }""", """            | Action::QnaShow { .. }
            | Action::QnaOpen { .. }
            | Action::PollOpen { .. }
            | Action::ReactionsOpen { .. }"""),
])
print('ok')
