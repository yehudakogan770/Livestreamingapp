P = '/home/user/Livestreamingapp/.claude/worktrees/agent-a22c0ed40f10ed52f/editor/app/src/editor.css'
s = open(P).read()


def rep(a, b, cnt=1):
    global s
    n = s.count(a)
    assert n == cnt, (a[:70], n)
    s = s.replace(a, b)


# ---- project panel ----
rep(""".media__seq,
.media__item,
.media__binhead {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;""", """.media__seq,
.media__item,
.media__binhead {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 28px;""")
rep(""".media__icon {
  color: var(--text-dim);
}
.media__fold {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 0;
  padding: 0;
  background: none;
  color: var(--text-dim);
}""", """.media__icon {
  width: 15px;
  height: 15px;
  color: var(--text-dim);
}
.media__fold {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 0;
  padding: 0;
  background: none;
  color: var(--text-faint);
}
.media__fold svg.lucide {
  width: 12px;
  height: 12px;
}
.media__fold svg.media__folder,
svg.media__folder {
  width: 15px;
  height: 15px;
  color: var(--text-dim);
}
.media__bar .btn svg.lucide {
  width: 13px;
  height: 13px;
}""")
rep(""".media__x {
  width: 20px;
  height: 20px;
  border: 0;""", """.media__x {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;""")
rep(""".media__thumb {
  flex: none;
  width: 43px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: #000;""", """.media__thumb {
  flex: none;
  width: 43px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: #000;""")
rep(""".media__thumb--audio {
  background: var(--well);
  color: var(--text-dim);
}""", """.media__thumb--audio {
  background: #18221c;
  color: #8fc2a0;
}
.media__thumb svg.lucide {
  width: 14px;
  height: 14px;
}""")
rep(""".fxlist__item {
  height: 24px;
  padding: 0 10px;""", """.fxlist__item {
  height: 26px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;""")
rep(""".fxlist__item::before {
  content: 'fx';
  display: inline-block;
  width: 22px;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 600;
}
.fxlist__item--audio::before {
  content: '♪';
}
.fxlist__item--gen::before {
  content: '✦';
}
.fxlist__item--tr::before {
  content: '⋈';
}""", """.fxlist__item svg.lucide {
  width: 13px;
  height: 13px;
  color: var(--text-faint);
}
.fxlist__item:hover svg.lucide {
  color: var(--text-dim);
}""")
rep(""".ttpl h4 {
  margin: 8px 0 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}""", """.ttpl h4 {
  margin: 8px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
}""")
rep(""".ttpl__btn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 6px;""", """.ttpl__btn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);""")
rep(""".ttpl__btn:hover {
  border-color: var(--accent);
}""", """.ttpl__btn:hover {
  border-color: var(--border-strong);
  background: var(--bar);
}""")
rep("""  border-radius: 4px;
  background: linear-gradient(135deg, #2a3442, #4a3a32);
}""", """  border-radius: var(--radius-sm);
  background: #2b2f35;
}""")
rep(""".ttpl__del {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;""", """.ttpl__del {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);""")

# ---- monitors ----
rep(""".vmon__head {
  flex: none;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 6px 0 10px;""", """.vmon__head {
  flex: none;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px 0 10px;""")
rep(""".vmon__title {
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}""", """.vmon__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vmon__title svg.lucide {
  color: var(--text-dim);
}
.vmon__title small {
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 400;
}""")
rep(""".vmon__audioonly {
  font-size: 28px;
  color: var(--text-faint);
}""", """.vmon__audioonly {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  color: var(--text-dim);
}
.vmon__audioonly svg.lucide {
  width: 28px;
  height: 28px;
  color: var(--text-faint);
}""")
rep(""".vtransport {
  flex: none;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  background: var(--bar);
  border-top: 1px solid var(--border);
}""", """.vtransport {
  flex: none;
  height: 38px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  background: var(--bar);
  border-top: 1px solid var(--border);
}
/* Transport keys in groups (marks, motion, edits), split by a 1px rule. */
.vtransport__group {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 0 6px;
  border-left: 1px solid var(--border);
}
.vtransport__group:first-of-type {
  border-left: 0;
}
.vtransport .btn--sm svg.lucide {
  width: 13px;
  height: 13px;
}""")
rep(""".vtransport__len {
  color: var(--text-faint);
  font-size: 11.5px;
  white-space: nowrap;
}""", """.vtransport__len {
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 11px;
  white-space: nowrap;
}""")
rep(""".tc {
  height: 24px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font-family: var(--mono);
  font-size: 12.5px;
  letter-spacing: 0.02em;
}
.tc--big {
  font-size: 15px;
  color: #fff;
}""", """.tc {
  height: 24px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--well);
  box-shadow: inset 0 1px 0 var(--lo);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.tc--big {
  height: 28px;
  padding: 0 9px;
  font-size: 16px;
  color: #fff;
  display: inline-flex;
  align-items: center;
}""")
rep(""".srcbar__range {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(90, 143, 208, 0.3);""", """.srcbar__range {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.12);""")
rep(""".wall__on {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--program);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}""", """.wall__on {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--program);
  color: #fff;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
}""")

# ---- timeline bar ----
rep(""".tl__tools {
  flex: none;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;""", """.tl__tools {
  flex: none;
  height: 36px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 6px;""")
rep(""".tl__seq,
.tl__seqs {
  max-width: 160px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--well);
  color: #fff;
  font-weight: 600;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}""", """.tl__seq,
.tl__seqs {
  max-width: 180px;
  height: 26px;
  padding: 0 9px 0 7px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: #fff;
  font-weight: 600;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tl__seq:hover {
  background: var(--button);
  border-color: var(--border-strong);
}
.tl__seq svg.lucide {
  color: var(--text-dim);
}
.tl__seq span {
  overflow: hidden;
  text-overflow: ellipsis;
}""")
rep(""".tl__tool {
  width: 28px;
  height: 22px;
  border: 0;
  border-right: 1px solid var(--border);
  border-radius: 0;
  background: var(--button-active);
  color: var(--text-dim);
  font-size: 12px;
}""", """.tl__tool {
  width: 30px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-right: 1px solid var(--border);
  border-radius: 0;
  background: var(--button-active);
  color: var(--text-dim);
  font-size: 12px;
}
.tl__tool svg.lucide {
  width: 15px;
  height: 15px;
  stroke-width: 1.75;
}""")
rep(""".tl__tool.is-on {
  background: var(--selected);
  color: #fff;
  box-shadow: inset 0 -2px 0 var(--accent);
}""", """.tl__tool.is-on {
  background: var(--selected);
  color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}""")
rep(""".tl__toggle {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border-strong);""", """.tl__toggle {
  height: 26px;
  padding: 0 9px 0 7px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border-strong);""")
rep(""".tl__toggle.is-on {
  border-color: var(--accent);
  color: #fff;
  background: var(--selected);
}""", """.tl__toggle svg.lucide {
  width: 13px;
  height: 13px;
}
.tl__toggle.is-on {
  border-color: var(--accent);
  color: #fff;
  background: var(--selected);
}
.tl__toggle.is-on svg.lucide {
  color: var(--accent);
}
.tl__tools .btn--sm {
  height: 26px;
}
.tl__tools .btn--sm svg.lucide {
  width: 13px;
  height: 13px;
}""")

# ---- track headers ----
rep(""".th {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;""", """.th {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;""")
rep(""".th__target {
  width: 24px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--button-active);
  color: var(--text-dim);
  font-size: 10.5px;
  font-weight: 600;
}""", """.th__target {
  width: 26px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--button-active);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 600;
}""")
rep(""".th__target.is-on {
  background: var(--accent-deep);
  border-color: var(--accent);
  color: #fff;
}""", """.th__target.is-on {
  background: var(--selected);
  border-color: var(--accent);
  color: #fff;
}""")
rep(""".th__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  color: var(--text);
}""", """.th__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: var(--text);
}""")
rep(""".th__btn {
  min-width: 18px;
  height: 18px;
  padding: 0 3px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--button-active);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}
.th__btn:hover {
  background: var(--button);
  color: var(--text);
}
.th__btn.is-on {
  color: #fff;
  border-color: var(--text-faint);
  background: var(--button-hover);
}
.th__btn--m.is-on {
  color: var(--warning);
  border-color: var(--warning);
  background: var(--warning-bg);
}
.th__btn--s.is-on {
  color: #fff;
  border-color: var(--accent);
  background: var(--selected);
}""", """/* Lock / hide / mute / solo: small square keys with line icons. A pressed key
   lights: lock and hide in white, mute in amber, solo as a lit (light) key. */
.th__btn {
  min-width: 22px;
  height: 20px;
  padding: 0 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}
.th__btn svg.lucide {
  width: 12px;
  height: 12px;
}
.th__btn:hover {
  background: var(--button);
  border-color: var(--border-strong);
  color: var(--text);
}
.th__btn.is-on {
  color: #fff;
  border-color: var(--border-strong);
  background: var(--button-hover);
}
.th__btn--m.is-on {
  color: var(--warning);
  border-color: var(--warning);
  background: var(--warning-bg);
}
.th__btn--s.is-on {
  color: #0c0e11;
  border-color: #dde0e4;
  background: #dde0e4;
}""")

# ---- ruler ----
rep(""".ruler__tick {
  position: absolute;
  top: 0;
  bottom: 0;
  padding: 2px 0 0 4px;
  border-left: 1px solid var(--border-strong);
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text-dim);""", """.ruler__tick {
  position: absolute;
  top: 0;
  bottom: 0;
  padding: 3px 0 0 5px;
  border-left: 1px solid var(--border-strong);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--text-dim);""")

# ---- clips ----
rep("""/* Clips: the label color, muted toward graphite so a full timeline stays calm;
   a thin darker edge, and a white outline when selected. */
.clip {
  position: absolute;
  z-index: 2;
  border-radius: var(--radius-sm);
  overflow: visible;
  background: color-mix(in srgb, var(--clip) 46%, #2a2a2c);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--clip) 40%, #000);
}
.clip--audio {
  background: color-mix(in srgb, var(--clip) 36%, #222224);
}
.clip.is-sel {
  background: color-mix(in srgb, var(--clip) 60%, #3a3a3d);
  box-shadow:
    inset 0 0 0 1px #fff,
    0 0 0 1px #fff;
  z-index: 3;
}""", """/* Clips: a muted body per kind (picture slate, sound green) tinted by the
   clip's label or camera color, a thin darker edge, and the accent outline
   when selected. */
.clip {
  position: absolute;
  z-index: 2;
  border-radius: var(--radius-sm);
  overflow: visible;
  background: color-mix(in srgb, var(--clip) 30%, #2d3239);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--clip) 35%, #090a0c);
}
.clip--audio {
  background: color-mix(in srgb, var(--clip) 26%, #252b27);
}
.clip.is-sel {
  background: color-mix(in srgb, var(--clip) 40%, #383e46);
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 0 0 1px var(--accent);
  z-index: 3;
}
.clip--audio.is-sel {
  background: color-mix(in srgb, var(--clip) 34%, #2e3630);
}""")
rep(""".clip__thumbs {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: var(--radius-sm);
  pointer-events: none;
  opacity: 0.6;
}""", """.clip__thumbs {
  position: absolute;
  inset: 16px 1px 1px;
  overflow: hidden;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  pointer-events: none;
  opacity: 0.85;
}""")
rep(""".clip__name {
  position: absolute;
  top: 2px;
  right: 6px;
  display: flex;
  gap: 4px;
  align-items: center;
  font-size: 11px;
  font-weight: 400;
  color: #fff;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.9);""", """.clip__name {
  position: absolute;
  top: 1px;
  right: 6px;
  height: 14px;
  display: flex;
  gap: 4px;
  align-items: center;
  font-size: 11px;
  font-weight: 500;
  color: #eef0f2;""")
rep(""".tl__marquee {
  position: absolute;
  z-index: 7;
  border: 1px solid var(--accent);
  background: rgba(90, 143, 208, 0.12);""", """.tl__marquee {
  position: absolute;
  z-index: 7;
  border: 1px solid var(--accent);
  background: rgba(79, 179, 191, 0.08);""")

# ---- color page ----
rep("""  background-color: #161617;
  background-image: radial-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px);
  background-size: 12px 12px;
}""", """  background: #111316;
}""")
rep(""".ngraph__gap {""", """.ngraph__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: 8px;
  font-size: 12px;
  font-weight: 600;
}
.ngraph__title svg.lucide {
  color: var(--text-dim);
}
.ngraph__bar .btn--sm svg.lucide {
  width: 13px;
  height: 13px;
}
.ngraph__gap {""")
rep(""".gnode {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 112px;
  height: 28px;
  padding: 0 6px 0 0;
  border: 1px solid #000;
  border-radius: var(--radius-sm);
  background: #3a3a3d;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);""", """.gnode {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 112px;
  height: 30px;
  padding: 0 6px 0 0;
  border: 1px solid #000;
  border-radius: var(--radius-sm);
  background: #2b2f35;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);""")
rep(""".gnode:hover {
  background: #424246;
}
.gnode.is-on {
  border-color: var(--accent);
  background: #3a3a3d;
  box-shadow: 0 0 0 1px var(--accent);
}""", """.gnode:hover {
  background: #333840;
}
.gnode.is-on {
  border-color: var(--accent);
  background: #2b2f35;
  box-shadow: 0 0 0 1px var(--accent);
}""")
rep("""  border-right: 1px solid #000;
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  background: #2a2a2c;""", """  border-right: 1px solid #000;
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  background: #1d2025;""")
rep(""".gnode.is-on .gnode__num {
  background: var(--accent-deep);
  color: #fff;
}""", """.gnode.is-on .gnode__num {
  background: var(--selected);
  color: var(--accent);
}""")
rep("""  font-size: 12px;
}
.colorp__col h3 .sect__btn {""", """  font-size: 12px;
}
.colorp__col h3 > svg.lucide {
  width: 13px;
  height: 13px;
  color: var(--text-dim);
}
.colorp__col h3 .sect__btn {""")
rep("""    radial-gradient(circle closest-side, #1c1c1e 0, #1c1c1e calc(100% - 7px), transparent calc(100% - 6px)),""", """    radial-gradient(circle closest-side, #16181c 0, #16181c calc(100% - 7px), transparent calc(100% - 6px)),""")
rep(""".scopes__head {
  flex: none;
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 6px;""", """.scopes__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 6px 0 10px;""")
rep(""".scopes__canvas {""", """.scopes__head > svg.lucide {
  color: var(--text-dim);
}
.scopes__title {
  margin-right: auto;
  font-size: 12px;
  font-weight: 600;
}
.scopes__canvas {""")

# ---- mixer ----
rep(""".estrip__name {
  width: calc(100% + 12px);
  margin: -6px -6px 0;
  height: 24px;
  line-height: 24px;
  background: var(--bar);
  border-bottom: 1px solid var(--border);
  text-align: center;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}""", """.estrip__name {
  width: calc(100% + 12px);
  margin: -6px -6px 0;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 6px;
  background: var(--bar);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
}
.estrip__name svg.lucide {
  width: 13px;
  height: 13px;
  color: var(--text-faint);
}""")

# ---- dialogs ----
rep(""".modal__head h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.modal__x {
  width: 26px;
  height: 26px;
  border: 0;""", """.modal__head h2 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}
.modal__head h2 svg.lucide {
  width: 15px;
  height: 15px;
  color: var(--text-dim);
}
.modal__x {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;""")
rep(""".modal__head {
  height: 36px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 0 14px;
  background: var(--raised);
  border-bottom: 1px solid var(--border);
}""", """.modal__head {
  height: 38px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 0 14px;
  background: var(--raised);
  border-bottom: 1px solid var(--border);
  box-shadow: inset 0 1px 0 var(--hi);
}""")
rep(""".fchip {
  height: 24px;
  padding: 0 10px;""", """.fchip {
  height: 26px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;""")
rep(""".expo__bar i {
  display: block;
  height: 100%;
  background: var(--accent);""", """.expo__bar i {
  display: block;
  height: 100%;
  background: #c4c8ce;""")
rep(""".getting__bar i {
  display: block;
  height: 100%;
  background: var(--accent);""", """.getting__bar i {
  display: block;
  height: 100%;
  background: #c4c8ce;""")
rep(""".help__keys dt {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text);
}""", """.help__keys dt {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text);
}""")
rep(""".tscript__w.is-sel {
  background: var(--accent-deep);
  color: #fff;
}""", """.tscript__w.is-sel {
  background: var(--selected);
  color: #fff;
  box-shadow: inset 0 -1px 0 var(--accent);
}""")
rep(""".tscript__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px;
  border-bottom: 1px solid var(--border);
}""", """.tscript__bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px;
  background: var(--bar);
  border-bottom: 1px solid var(--border);
}""")
open(P, 'w').write(s)
print('ok')
