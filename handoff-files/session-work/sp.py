import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

p = 'src-tauri/src/speaker.rs'
rep(p, """        Some(json!({
            "name": show.source(id).map(|s| s.name.clone()).unwrap_or_default(),
            "endsAt": c.ends_at,
            "remainingMs": c.remaining_ms,
        }))
    });
    json!({
        "event": show.event.name,
        "locked": rules.locked,
        "allowBlack": rules.black,
        "slideshows": shows.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
        "countdown": countdown,
    })""", """        Some(json!({
            "name": show.source(id).map(|s| s.name.clone()).unwrap_or_default(),
            "endsAt": c.ends_at,
            "remainingMs": c.remaining_ms,
            "lengthMs": c.length_ms,
            // At zero: the words chosen for the end, or the time over.
            "endText": matches!(c.at_zero, lumora_engine::AtZero::ShowText).then(|| c.end_text.clone()),
        }))
    });
    let m = &show.monitor;
    json!({
        "event": show.event.name,
        "locked": rules.locked,
        "allowBlack": rules.black,
        "slideshows": shows.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
        "countdown": countdown,
        // The speaker sees the timing and the operator's message as the stage Monitor does.
        "timing": { "wrapUpS": m.wrap_up_s, "overtime": m.overtime },
        "message": (m.message_on && !m.message.trim().is_empty()).then(|| m.message.clone()),
    })""")
rep(p, """        assert_eq!(v["locked"], true);
        assert_eq!(v["allowBlack"], false);""", """        assert_eq!(v["locked"], true);
        assert_eq!(v["allowBlack"], false);
        assert_eq!(v["timing"]["wrapUpS"], 120);
        assert_eq!(v["timing"]["overtime"], true);
        assert!(v["message"].is_null());""")

p = 'src-tauri/remote/slides-core.js'
rep(p, """ *   countdown: { name: string, endsAt: number | null, remainingMs: number } | null""",
""" *   countdown: { name: string, endsAt: number | null, remainingMs: number, lengthMs?: number, endText?: string | null } | null,
 *   timing?: { wrapUpS: number, overtime: boolean },
 *   message?: string | null""")
rep(p, """/** Time since (rounded down, unlike a countdown). @param {number} ms */""", """/**
 * The countdown as the stage Monitor shows it (mirrors app/src/engine/stageTimer.ts):
 * amber to wrap up, red in the last minute, and after zero the time over.
 * @param {{ endsAt: number | null, remainingMs: number, endText?: string | null }} c
 * @param {{ wrapUpS: number, overtime: boolean } | undefined} timing
 * @param {number} now
 * @returns {{ tone: 'normal' | 'wrapUp' | 'urgent' | 'over' | 'paused', text: string }}
 */
export function stageTime(c, timing, now) {
  const left = remaining(c, now);
  if (c.endsAt === null) return { tone: 'paused', text: clockText(left) };
  if (left > 0) {
    const wrap = (timing?.wrapUpS ?? 120) * 1000;
    return { tone: left <= 60_000 ? 'urgent' : wrap > 0 && left <= wrap ? 'wrapUp' : 'normal', text: clockText(left) };
  }
  if (c.endText) return { tone: 'urgent', text: c.endText };
  const over = now - c.endsAt;
  if ((timing?.overtime ?? true) && over >= 1000) return { tone: 'over', text: `+${elapsedText(over)}` };
  return { tone: 'urgent', text: clockText(0) };
}

/** Time since (rounded down, unlike a countdown). @param {number} ms */""")

p = 'src-tauri/remote/slides.js'
rep(p, """    $('cd-name').textContent = cd.name || 'Countdown';
    $('cd-time').textContent = clockText(remaining(cd, now()));
  }""", """    const t = stageTime(cd, view?.timing, now());
    $('cd-name').textContent = t.tone === 'over' ? 'Over time' : cd.name || 'Countdown';
    $('cd-time').textContent = t.text;
    $('cd').dataset.tone = t.tone;
  }
  const msg = view?.message ?? '';
  $('stage-msg').hidden = !msg;
  if ($('stage-msg').textContent !== msg) $('stage-msg').textContent = msg;""")

p = 'src-tauri/remote/slides.html'
rep(p, """      <div id="offline" class="banner" role="status" hidden>""", """      <div id="stage-msg" class="banner banner--msg" role="status" aria-live="assertive" hidden></div>
      <div id="offline" class="banner" role="status" hidden>""")

p = 'src-tauri/remote/slides.css'
rep(p, """.chip--cd b {
  color: var(--accent);
}""", """.chip--cd b {
  color: var(--accent);
}
/* The countdown as the stage Monitor shows it. */
.chip--cd[data-tone='wrapUp'] b {
  color: #f2b33d;
}
.chip--cd[data-tone='urgent'] b,
.chip--cd[data-tone='over'] b,
.chip--cd[data-tone='over'] small {
  color: #ff5a4f;
}
.chip--cd[data-tone='paused'] b {
  color: var(--text-dim);
}
/* The operator's message to the stage. */
.banner--msg {
  background: #1d1f23;
  color: #fff;
  font-size: 1.4em;
  padding: 12px 14px;
  border-bottom: 1px solid #000;
}""")
