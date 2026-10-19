W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('crates/live-engine/src/multiview.rs', [
("""    #[test]
    fn pictures_are_fitted_in_their_box() {""","""    /// The words' renderer reads this (`multiviewLabels.ts`: `MvLayout`).
    #[test]
    fn the_layout_reads_as_the_web_side_expects() {
        let v = serde_json::to_value(layout(&show(), 1920, 1080)).unwrap();
        assert_eq!(v["tiles"][0]["content"], serde_json::json!({ "type": "next", "id": "live" }));
        assert_eq!(v["tiles"][1]["tally"], "pgm");
        assert_eq!(v["tiles"][2]["content"], serde_json::json!({ "type": "input", "id": "a" }));
        assert_eq!(v["tiles"][2]["number"], 1);
        assert_eq!(v["header"].as_array().map(Vec::len), Some(4));
        assert_eq!(v["scale"], 1.0);
    }

    #[test]
    fn pictures_are_fitted_in_their_box() {"""),
])
edit('app/src/testevent/runner.ts', [
("""            if (p) answers.push({ id: 0, output: o, fps: p.fps, inSync: p.inSync, black: p.black, overlays: p.overlays, tally: null, width: p.width, height: p.height });
          }""","""            if (p) answers.push({ id: 0, output: o, fps: p.fps, inSync: p.inSync, black: p.black, overlays: p.overlays, tally: null, width: p.width, height: p.height });
          }
        // And for its multiview (drawn with the tally from the show itself).
        if (unifiedOn() && !answers.some((a) => a.output === 'multiview')) {
          const info = await refreshEngineInfo().catch(() => null);
          const s = info?.stats;
          if (s?.outputs.includes('multiview'))
            answers.push({ id: 0, output: 'multiview', fps: s.fps, inSync: null, black: null, overlays: null, tally: true, width: 1920, height: 1080 });
        }"""),
])
