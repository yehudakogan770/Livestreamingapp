import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

p = 'crates/engine/src/stage.rs'
rep(p, """    /// 24-hour clock (19:42) instead of 12-hour (7:42 PM).
    pub clock_24h: bool,
    /// Messages one click away.""", """    /// 24-hour clock (19:42) instead of 12-hour (7:42 PM).
    pub clock_24h: bool,
    /// The time left turns amber this many seconds before the end (0: never),
    /// and red in the last minute.
    pub wrap_up_s: u32,
    /// After zero, the time over is shown in red (+1:05) instead of 0:00.
    pub overtime: bool,
    /// A bar under the time left shows how much of it has gone.
    pub progress: bool,
    /// Messages one click away.""")
rep(p, """            clock_24h: false,
            quick: default_quick(),""", """            clock_24h: false,
            wrap_up_s: DEFAULT_WRAP_UP_S,
            overtime: true,
            progress: true,
            quick: default_quick(),""")
rep(p, """/// Number of quick messages.""", """/// The time left turns amber two minutes before the end, unless changed.
pub const DEFAULT_WRAP_UP_S: u32 = 120;
/// Longest wrap-up warning: an hour.
pub const MAX_WRAP_UP_S: u32 = 3600;
/// Number of quick messages.""")

p = 'crates/engine/src/action.rs'
rep(p, """    #[serde(default)]
    #[ts(optional)]
    pub clock_24h: Option<bool>,
}""", """    #[serde(default)]
    #[ts(optional)]
    pub clock_24h: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub wrap_up_s: Option<u32>,
    #[serde(default)]
    #[ts(optional)]
    pub overtime: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub progress: Option<bool>,
}""")

p = 'crates/engine/src/engine.rs'
rep(p, """    if let Some(v) = p.clock_24h {
        m.clock_24h = v;
    }
}""", """    if let Some(v) = p.clock_24h {
        m.clock_24h = v;
    }
    if let Some(v) = p.wrap_up_s {
        m.wrap_up_s = v.min(crate::stage::MAX_WRAP_UP_S);
    }
    if let Some(v) = p.overtime {
        m.overtime = v;
    }
    if let Some(v) = p.progress {
        m.progress = v;
    }
}""")

p = 'app/src/engine/demo.ts'
rep(p, """      if (p.clock24h !== undefined) m.clock24h = p.clock24h;
      return;""", """      if (p.clock24h !== undefined) m.clock24h = p.clock24h;
      if (p.wrapUpS !== undefined) m.wrapUpS = Math.min(3600, Math.max(0, Math.round(p.wrapUpS)));
      if (p.overtime !== undefined) m.overtime = p.overtime;
      if (p.progress !== undefined) m.progress = p.progress;
      return;""")
p = 'app/src/engine/client.ts'
rep(p, """      clock24h: false,""", """      clock24h: false,
      wrapUpS: 120,
      overtime: true,
      progress: true,""")
