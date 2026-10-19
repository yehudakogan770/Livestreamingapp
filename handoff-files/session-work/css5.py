P = '/home/user/Livestreamingapp/.claude/worktrees/agent-a22c0ed40f10ed52f/editor/app/src/editor.css'
s = open(P).read()
a = s.index("/* Clips: a muted body per kind")
b = s.index(".clip.is-off {")
s = s[:a] + """/* Clips: a muted graphite body per kind (picture slate-gray, sound green-gray),
   the label or camera color only in the name band along the top, a thin
   darker edge, and the accent outline when selected. */
.clip {
  --band: color-mix(in srgb, var(--clip) 52%, #24282e);
  position: absolute;
  z-index: 2;
  border-radius: var(--radius-sm);
  overflow: visible;
  background: color-mix(in srgb, var(--clip) 14%, #2c3138);
  box-shadow:
    inset 0 15px 0 var(--band),
    inset 0 0 0 1px color-mix(in srgb, var(--clip) 30%, #08090b);
}
.clip--audio {
  --band: color-mix(in srgb, var(--clip) 40%, #222824);
  background: color-mix(in srgb, var(--clip) 16%, #20262a);
}
.clip.is-sel {
  background: color-mix(in srgb, var(--clip) 20%, #353b43);
  box-shadow:
    inset 0 15px 0 var(--band),
    inset 0 0 0 1px var(--accent),
    0 0 0 1px var(--accent);
  z-index: 3;
}
.clip--audio.is-sel {
  background: color-mix(in srgb, var(--clip) 22%, #283030);
}
""" + s[b:]
open(P, 'w').write(s)
print('ok')
