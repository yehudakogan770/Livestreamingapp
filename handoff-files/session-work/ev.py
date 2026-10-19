import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

p = 'crates/engine/src/triggers.rs'
rep(p, """                When::VideoEnds { .. } | When::AtTime { .. } | When::VideoTimeLeft { .. }""",
"""                    When::VideoEnds { .. }
                        | When::AtTime { .. }
                        | When::VideoTimeLeft { .. }
                        | When::Every { .. }""")
rep(p, """            When::VideoTimeLeft { seconds, .. } => *seconds = (*seconds).clamp(1, 600),""",
"""            When::VideoTimeLeft { seconds, .. } => *seconds = (*seconds).clamp(1, 600),
            When::Every { minutes } => *minutes = (*minutes).clamp(1, 24 * 60),""")

p = 'crates/engine/tests/triggers.rs'
s = open(p).read()
s += '''
#[test]
fn over_and_over_minutes_apart() {
    let mut e = setup();
    let mut t = trigger(
        "sponsor",
        When::Every { minutes: 10 },
        vec![Step::CutTo {
            screen: ScreenId::Back,
            source_id: id("logo"),
        }],
    );
    // Counted from when it was made.
    t.last_fired = 1_000;
    e.apply(Action::SetTriggers { triggers: vec![t] }, 1_000)
        .unwrap();
    assert_eq!(e.tick(5 * 60_000), Outcome::Unchanged);
    assert_eq!(e.tick(10 * 60_000 + 1_000), Outcome::Changed);
    assert_eq!(e.show().screens.back.program, Some(id("logo")));
    cut(&mut e, ScreenId::Back, "cam", 10 * 60_000 + 2_000);
    assert_eq!(e.tick(15 * 60_000), Outcome::Unchanged);
    assert_eq!(e.tick(20 * 60_000 + 1_000), Outcome::Changed);
    assert_eq!(e.show().screens.back.program, Some(id("logo")));
    // Never made with a start: waits (it is given one when made in Lumora).
    let mut never = trigger("never", When::Every { minutes: 0 }, vec![]);
    never.last_fired = 0;
    e.apply(
        Action::SetTriggers {
            triggers: vec![never],
        },
        0,
    )
    .unwrap();
    assert!(matches!(
        e.show().triggers[0].when,
        When::Every { minutes: 1 }
    ));
    assert_eq!(e.tick(99 * 60_000), Outcome::Unchanged);
}
'''
open(p, 'w').write(s)

p = 'app/src/engine/triggers.ts'
rep(p, """    else if (w.type === 'inputBack') hit = lost(before, w.sourceId) && !lost(after, w.sourceId);""",
"""    else if (w.type === 'inputBack') hit = lost(before, w.sourceId) && !lost(after, w.sourceId);
    else if (w.type === 'every') hit = t.lastFired > 0 && now - t.lastFired >= Math.max(1, w.minutes) * 60_000;""")
p = 'app/src/engine/demo.ts'
rep(p, """        if (w.type === 'videoTimeLeft') w.seconds = Math.min(600, Math.max(1, Math.round(w.seconds)));""",
"""        if (w.type === 'videoTimeLeft') w.seconds = Math.min(600, Math.max(1, Math.round(w.seconds)));
        if (w.type === 'every') w.minutes = Math.min(1440, Math.max(1, Math.round(w.minutes)));""")

p = 'app/src/views/TriggersDialog.tsx'
rep(p, """  { type: 'atTime', name: 'At a clock time (every day)' },
];""", """  { type: 'atTime', name: 'At a clock time (every day)' },
  { type: 'every', name: 'Every few minutes' },
];""")
rep(p, """    case 'broadcast':
      return `When ${w.what === 'record' ? 'recording' : 'the stream'} ${w.on ? 'starts' : 'stops'}`;
  }""", """    case 'broadcast':
      return `When ${w.what === 'record' ? 'recording' : 'the stream'} ${w.on ? 'starts' : 'stops'}`;
    case 'every':
      return `Every ${w.minutes} minute${w.minutes === 1 ? '' : 's'}`;
  }""")
rep(p, """    case 'broadcast':
      return { type, what: 'stream', on: true };
  }""", """    case 'broadcast':
      return { type, what: 'stream', on: true };
    case 'every':
      return { type, minutes: 10 };
  }""")
# Counting starts when the kind is chosen, or when the minutes change.
rep(p, """                  <select value={w.type} onChange={(e) => change({ when: freshWhen(e.target.value as When['type'], show) })} aria-label="When">""",
"""                  <select
                    value={w.type}
                    onChange={(e) => change({ when: freshWhen(e.target.value as When['type'], show), ...(e.target.value === 'every' ? { lastFired: Date.now() } : {}) })}
                    aria-label="When"
                  >""")
rep(p, """                {w.type === 'broadcast' && (""", """                {w.type === 'every' && (
                  <label className="field">
                    <span className="field__label">Minutes apart</span>
                    <input
                      className="text"
                      type="number"
                      min={1}
                      max={1440}
                      value={w.minutes}
                      onChange={(e) =>
                        change({ when: { ...w, minutes: Math.round(Math.min(1440, Math.max(1, Number(e.target.value) || 1))) }, lastFired: Date.now() })
                      }
                      aria-label="Minutes apart"
                    />
                    <span className="field__note">Counted from now. For example, put the sponsor logo on as an overlay every 10 minutes.</span>
                  </label>
                )}
                {w.type === 'broadcast' && (""")
