import re
P = '/home/user/Livestreamingapp/.claude/worktrees/agent-a22c0ed40f10ed52f/editor/app/src/editor.css'
s = open(P).read()


def block(start, end_marker):
    """Replace from a line starting `start` up to (not including) `end_marker`."""
    i = s.index(start)
    j = s.index(end_marker, i)
    return i, j


def replace_range(start, end_marker, new):
    global s
    i, j = block(start, end_marker)
    s = s[:i] + new + s[j:]


def rep(a, b, cnt=1):
    global s
    n = s.count(a)
    assert n == cnt, (a[:60], n)
    s = s.replace(a, b)


rep("""/* Lumora Studio — the same look as Lumora (tokens in app/src/styles.css), laid out
   like a finishing suite (Resolve / Premiere / Avid): dense panels split by 1px
   dividers, 24-28px controls, 3px corners, no gradients or glows, pictures and
   scopes on black. Red is the playhead and nothing else on the Edit page; the
   accent marks selection and focus. Fits 1280×760. */""", """/* Lumora Studio — Lumora's broadcast-console look (tokens in app/src/styles.css)
   laid out like a finishing suite (Resolve / Media Composer / Premiere): a dark
   app bar with menus, panels with an icon + title header, 1px dividers, dense
   24-28px controls, line icons with tooltips, Inter for words and JetBrains Mono
   for every timecode. No gradients, glows, grids or decorative stripes; pictures
   and scopes sit on black. Colors mean one thing each: red is the playhead (and
   clipping), the accent teal is selection and focus, amber is a warning or a
   mute, the light-gray key is the one primary action. Fits 1280×760. */""")

# ---- app bar, status / page bar ----
replace_range(".ed__top {\n  flex: none;\n  height: 36px;", "/* pages */", """.ed__top {
  flex: none;
  height: 40px;
}
.ed__status {
  flex: none;
  height: 38px;
}
/* The app bar: the darkest strip, like Lumora's title bar. */
.ed__top {
  position: relative;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px 0 12px;
  background: #0f1114;
  border-bottom: 1px solid #000;
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.04);
  min-width: 0;
}
.ed__logo {
  height: 18px;
  padding-right: 12px;
  margin-right: 4px;
  border-right: 1px solid var(--border);
  box-sizing: content-box;
}
.ed__menus {
  display: flex;
  gap: 0;
  min-width: 0;
}
.ed__menu {
  height: 28px;
  padding: 0 7px 0 8px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-dim);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
}
.ed__menu .ed__caret {
  width: 11px;
  height: 11px;
  color: var(--text-faint);
  margin-right: -2px;
}
.ed__menu:hover {
  background: var(--button);
  color: var(--text);
}
.ed__menu:active {
  background: var(--button-hover);
  border-color: var(--border-strong);
}
.ed__name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  height: 24px;
  margin-left: 8px;
  padding-left: 12px;
  border-left: 1px solid var(--border);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  min-width: 0;
}
.ed__name > span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.ed__name svg.lucide {
  color: var(--text-faint);
}
.ed__fill {
  flex: 1;
}
.ed__saved {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  margin: 0 8px 0 6px;
  padding: 0 10px 0 12px;
  border-left: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 12px;
  white-space: nowrap;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ed__saved svg.lucide {
  width: 13px;
  height: 13px;
}
.ed__saved.is-problem {
  color: var(--danger);
}
.ed__export {
  height: 28px;
  padding: 0 14px 0 11px;
  font-size: 12.5px;
}
.ed__warn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  background: var(--warning-bg);
  border-bottom: 1px solid var(--border);
  border-left: 3px solid var(--warning);
  color: var(--text);
  font-size: 12.5px;
}
.ed__warnx {
  margin-left: auto;
  display: inline-flex;
  border: 0;
  background: none;
  color: inherit;
}
/* The bottom bar: what just happened on the left, the pages in the middle (as
   in Resolve's page bar), the sequence format on the right. */
.ed__status {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: #0f1114;
  border-top: 1px solid #000;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
}
.ed__note {
  overflow: hidden;
  text-overflow: ellipsis;
}
.ed__seqinfo {
  justify-self: end;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 11px;
}
.ed__pages {
  display: flex;
  gap: 2px;
}
.ed__pages button {
  height: 30px;
  min-width: 92px;
  padding: 0 14px 0 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-dim);
  font-size: 12.5px;
  font-weight: 500;
}
.ed__pages button svg.lucide {
  width: 16px;
  height: 16px;
  stroke-width: 1.75;
  color: var(--text-faint);
}
.ed__pages button:hover:not(.is-on) {
  background: var(--button);
  color: var(--text);
}
.ed__pages button:hover:not(.is-on) svg.lucide {
  color: var(--text-dim);
}
.ed__pages button.is-on {
  border-color: var(--border-strong);
  border-top-color: #424852;
  background: #22262c;
  color: #fff;
  font-weight: 600;
}
.ed__pages button.is-on svg.lucide {
  color: var(--accent);
}

""")

# ---- panel tabs: icon + title ----
replace_range("/* Panel tabs: flat, the open one lifted", "/* small controls */", """/* Panel headers: tabs with an icon and a title. The open one is lifted to the
   panel color, with the accent along its top edge. */
.tabs {
  flex: none;
  display: flex;
  height: 30px;
  padding: 0;
  background: var(--bar);
  border-bottom: 1px solid var(--border);
}
.tabs button {
  height: 30px;
  padding: 0 12px 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-right: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--text-dim);
  font-weight: 500;
  font-size: 12px;
  white-space: nowrap;
}
.tabs button svg.lucide {
  width: 13px;
  height: 13px;
  color: var(--text-faint);
}
.tabs button:hover:not(.is-on) {
  color: var(--text);
  background: var(--raised);
}
.tabs button.is-on {
  height: 31px;
  background: var(--panel);
  color: #fff;
  font-weight: 600;
  box-shadow: inset 0 2px 0 var(--accent);
}
.tabs button.is-on svg.lucide {
  color: var(--text);
}

""")

# ---- small buttons ----
rep(""".tbtn {
  min-width: 26px;
  height: 24px;
  padding: 0 5px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--button);
  color: var(--text);
  font-size: 12px;
  line-height: 1;
}""", """.tbtn {
  min-width: 26px;
  height: 24px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  border-top-color: #424852;
  background: var(--button);
  color: var(--text);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}
.tbtn svg.lucide {
  color: var(--text-dim);
}
.tbtn:hover:not(:disabled) svg.lucide {
  color: var(--text);
}
/* Icon-only buttons: no key cap until the pointer is on them (transport, bars). */
.tbtn--icon {
  width: 28px;
  min-width: 28px;
  height: 26px;
  padding: 0;
  border-color: transparent;
  background: transparent;
}
.tbtn--icon svg.lucide {
  width: 15px;
  height: 15px;
}
.tbtn--icon:hover:not(:disabled) {
  border-color: var(--border-strong);
}""")
rep(""".tbtn.is-on {
  border-color: var(--accent);
  background: var(--selected);
  color: #fff;
}
.tbtn--play {
  min-width: 38px;
  height: 26px;
  font-size: 12px;
}
input[type='range'] {
  accent-color: var(--accent);
}""", """.tbtn.is-on {
  border-color: var(--accent);
  background: var(--selected);
  color: #fff;
}
.tbtn.is-on svg.lucide {
  color: var(--accent);
}
/* Play: the one lit key in the transport. */
.tbtn--play {
  min-width: 40px;
  height: 28px;
  margin: 0 2px;
  background: #dde0e4;
  border-color: #dde0e4;
  border-top-color: #f2f3f5;
  color: #0c0e11;
}
.tbtn--play svg.lucide,
.tbtn--play:hover:not(:disabled) svg.lucide {
  width: 15px;
  height: 15px;
  color: #0c0e11;
  fill: #0c0e11;
}
.tbtn--play:hover:not(:disabled) {
  background: #eceef1;
}
.tbtn--play:active:not(:disabled) {
  background: #c4c8ce;
}
.tbtn--play.is-on {
  border-color: #dde0e4;
  background: #dde0e4;
}""")
rep(""".choice button {
  height: 24px;
  padding: 0 10px;""", """.choice button {
  height: 24px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;""")

# ---- menus: like Lumora's drops ----
rep(""".pop {
  position: fixed;
  z-index: 100;
  min-width: 220px;
  padding: 3px;""", """.pop {
  position: fixed;
  z-index: 100;
  min-width: 240px;
  padding: 4px;""")
rep(""".pop button {
  width: 100%;
  height: 26px;""", """.pop button {
  width: 100%;
  height: 28px;""")
rep("""  font-size: 13px;
  text-align: left;
}
.pop button:hover:not(:disabled),
.pop button.is-open {
  background: var(--accent-deep);
  color: #fff;
}""", """  font-size: 12.5px;
  text-align: left;
}
.pop button:hover:not(:disabled),
.pop button.is-open {
  background: var(--selected);
  color: #fff;
  box-shadow: inset 2px 0 0 var(--accent);
}""")
rep(""".pop__check {
  color: var(--accent);
  text-align: center;
}
.pop__keys {
  color: var(--text-faint);
  font-size: 11.5px;
}""", """.pop__check {
  display: inline-flex;
  justify-content: center;
  color: var(--accent);
}
.pop__check svg.lucide {
  width: 13px;
  height: 13px;
}
.pop__keys {
  display: inline-flex;
  align-items: center;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 10.5px;
}
.pop__keys svg.lucide {
  width: 12px;
  height: 12px;
}""")
rep(""".pop button:hover .pop__keys,
.pop button.is-open .pop__keys {
  color: rgba(255, 255, 255, 0.75);
}
.pop button:hover .pop__check {
  color: #fff;
}""", """.pop button:hover .pop__keys,
.pop button.is-open .pop__keys {
  color: var(--text-dim);
}""")

# ---- sections ----
rep(""".sect__arrow {
  width: 12px;
  color: var(--text-faint);
  font-size: 10px;
}""", """.sect__arrow {
  display: inline-flex;
  width: 12px;
  color: var(--text-faint);
}
.sect__arrow svg.lucide {
  width: 12px;
  height: 12px;
}
.sect__fold > svg.sect__icon {
  width: 13px;
  height: 13px;
  color: var(--text-dim);
}""")
rep(""".sect__btn {
  width: 20px;
  height: 20px;
  border: 0;""", """.sect__btn {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;""")
rep(""".sect__head {
  display: flex;
  align-items: center;
  min-height: 26px;
}""", """.sect__head {
  display: flex;
  align-items: center;
  min-height: 28px;
}
.sect__btn svg.lucide {
  width: 13px;
  height: 13px;
}""")
rep(""".prow__watch {
  width: 18px;
  height: 18px;
  padding: 0;""", """.prow__watch {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;""")
rep(""".prow__keys button {
  width: 18px;
  height: 18px;
  padding: 0;""", """.prow__watch svg.lucide,
.prow__keys svg.lucide {
  width: 12px;
  height: 12px;
}
.prow__keys button {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;""")
rep(""".prow__keys button.is-on {
  color: var(--accent);
}""", """.prow__keys button.is-on {
  color: var(--accent);
}
.prow__keys button.is-on svg.lucide {
  fill: var(--accent);
}""")

open(P, 'w').write(s)
print('ok')
