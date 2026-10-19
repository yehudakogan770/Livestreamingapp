root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
p=root+'views/ControlView.css'
s=open(p).read()
a=s.index('''.toast {
  max-width: 420px;''')
b=s.index('''.addinput__body {''')
new='''.toast {
  max-width: 420px;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--raised);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--danger);
  color: var(--text);
  box-shadow:
    inset 0 1px 0 var(--hi),
    var(--shadow-pop);
}

/* ---- dialogs ----
   A raised window: a teal rule along the top, a header strip with the title
   and a close key, a quiet body and a darker footer for the actions. */
.modal {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Below the title bar (it stays on top, with its menus). */
  padding-top: 40px;
  background: rgba(4, 5, 7, 0.68);
}
.modal__box {
  width: min(880px, calc(100vw - 48px));
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius);
  background: var(--panel);
  border: 1px solid #000;
  box-shadow:
    0 0 0 1px var(--border-strong),
    0 18px 48px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.modal__head {
  position: relative;
  height: 40px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 6px 0 14px;
  background: linear-gradient(#24282e, #1e2227);
  border-bottom: 1px solid #000;
  box-shadow:
    inset 0 2px 0 var(--accent),
    0 1px 0 rgba(255, 255, 255, 0.03);
}
.modal__head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.005em;
}
.modal__head .icon svg.lucide {
  width: 16px;
  height: 16px;
}
.modal__foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 14px;
  background: #14171b;
  border-top: 1px solid #000;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.field__note {
  font-size: 12px;
  color: var(--text-dim);
}
.field__note--warn {
  color: var(--warning);
}
/* Fields are inset: a dark well with a shadowed top edge. */
.text {
  height: 28px;
  padding: 0 8px;
  border-radius: var(--radius);
  border: 1px solid #000;
  border-bottom-color: #2c3138;
  background: var(--well);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.035);
  color: var(--text);
  font: inherit;
  user-select: text;
}
textarea.text {
  height: auto;
  padding: 6px 8px;
}
.text:focus,
select:focus {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
  border-color: var(--accent);
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
select {
  height: 28px;
  border-radius: var(--radius);
  border: 1px solid #000;
  border-top-color: #424852;
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23a0a7b1' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")
      no-repeat right 8px center,
    linear-gradient(#2a2f36, #23272d);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.035);
  color: var(--text);
  font: inherit;
  padding: 0 24px 0 8px;
  appearance: none;
  -webkit-appearance: none;
}
select option {
  background: var(--raised);
  color: var(--text);
}

'''
s=s[:a]+new+s[b:]
open(p,'w').write(s)
