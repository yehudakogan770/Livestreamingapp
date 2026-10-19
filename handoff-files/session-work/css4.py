P = '/home/user/Livestreamingapp/.claude/worktrees/agent-a22c0ed40f10ed52f/editor/app/src/editor.css'
s = open(P).read()
i = s.index('/* ---- start ---- */')
j = s.index('/* ---- getting ready ---- */')
s = s[:i] + """/* ---- start ----
   Like a project manager: the brand and the two actions on the left, the
   recent projects as a plain list on the right. No picture behind it. */
.start {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg);
}
.start__card {
  width: min(1040px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--panel);
  box-shadow:
    inset 0 1px 0 var(--hi),
    var(--shadow-pop);
  overflow: hidden;
}
.start__main {
  display: flex;
  flex-direction: column;
  padding: 36px 36px 28px;
}
.start__logo {
  align-self: flex-start;
  height: 30px;
  margin: 0 0 40px -2px;
}
.start h1 {
  margin: 0 0 10px;
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.start__lead {
  margin: 0 0 28px;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.6;
}
.start__open {
  width: 100%;
  height: 38px;
  justify-content: center;
  font-size: 13px;
}
.start__open svg.lucide {
  width: 15px;
  height: 15px;
}
.start__hint {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 14px 0 0;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.5;
}
.start__problem {
  margin: 16px 0 0;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--raised);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--danger);
  color: var(--text);
  font-size: 13px;
  line-height: 1.45;
  user-select: text;
}
.start__recent {
  padding: 0;
  border-left: 1px solid var(--border);
  background: var(--bar);
  min-height: 460px;
  max-height: 600px;
  overflow: auto;
}
.start__recent h2 {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  height: 34px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 14px;
  background: var(--raised);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.start__recent h2 svg.lucide {
  color: var(--text-dim);
}
.start__empty {
  margin: 0;
  padding: 12px 14px;
  color: var(--text-faint);
  font-size: 12.5px;
}
.start__recent ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
}
.start__recent li {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border);
}
.start__item {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px 8px;
  text-align: left;
  padding: 9px 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.start__item:hover {
  background: var(--raised);
}
.start__item:active {
  background: var(--button-active);
}
.start__kind {
  grid-row: 1 / 3;
  width: 28px !important;
  height: 28px !important;
  padding: 6px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--well);
  color: var(--text-dim);
  stroke-width: 1.75 !important;
}
.start__name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.start__when {
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 11px;
}
.start__where {
  grid-column: 2 / -1;
  color: var(--text-faint);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.start__forget {
  width: 34px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--text-faint);
}
.start__forget:hover {
  background: var(--button);
  color: var(--text);
}
.start__forget:active {
  background: var(--button-active);
}

""" + s[j:]
s = s.replace(""".start__h2 {
  margin-top: 22px !important;
}""", """.start__h2 {
  margin-top: 0 !important;
  border-top: 1px solid var(--border);
}""")
open(P, 'w').write(s)
print('ok')
