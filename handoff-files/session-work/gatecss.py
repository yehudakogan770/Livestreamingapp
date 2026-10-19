root='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/'
p=root+'auth/Gate.css'
s=open(p).read()
a=s.index('/* Signing in, before Lumora opens. */')
b=s.index('.gate h1 {')
new='''/* Signing in, before Lumora opens: a two-part card on a faint multiviewer
   grid. The left part carries the mark; the right part the form. */
.gate {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  overflow: auto;
  background:
    radial-gradient(ellipse 60% 50% at 50% 45%, rgba(79, 179, 191, 0.07), transparent 70%),
    linear-gradient(rgba(255, 255, 255, 0.022) 1px, transparent 1px) 0 0 / 48px 48px,
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px) 0 0 / 48px 48px,
    var(--bg);
}
.gate__card {
  width: min(760px, 100%);
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  border-radius: var(--radius);
  border: 1px solid #000;
  background: var(--panel);
  box-shadow:
    0 0 0 1px var(--border-strong),
    0 24px 60px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.gate__side {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  padding: 32px 28px;
  background:
    radial-gradient(circle at 30% 30%, rgba(79, 179, 191, 0.12), transparent 60%),
    linear-gradient(160deg, #15191e, #0b0d10);
  border-right: 1px solid #000;
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.04);
}
.gate__side img {
  display: block;
  width: 200px;
  height: auto;
}
.gate__tag {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding-left: 4px;
}
/* The logo's three blade colors as a hairline rule. */
.gate__rule {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  height: 3px;
}
.gate__rule i {
  flex: 1;
}
.gate__rule i:nth-child(1) {
  background: #4fb3bf;
}
.gate__rule i:nth-child(2) {
  background: #d6d8dc;
}
.gate__rule i:nth-child(3) {
  background: #8f949c;
}
.gate__main {
  min-width: 0;
  padding: 28px 32px 28px;
}
/* The small mark above the form only shows when the card is one column. */
.gate__brand {
  display: none;
  align-items: center;
  margin: 0 0 18px;
}
.gate__brand img {
  display: block;
  height: 26px;
}
@media (max-width: 720px) {
  .gate__card {
    grid-template-columns: minmax(0, 1fr);
    width: min(420px, 100%);
  }
  .gate__side {
    display: none;
  }
  .gate__brand {
    display: flex;
  }
}
'''
s=s[:a]+new+s[b:]
s=s.replace('''.gate h1 {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
}''','''.gate h1 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.015em;
}''')
s=s.replace('''.gate__go {
  height: 34px;''','''.gate__go {
  height: 36px;''')
open(p,'w').write(s)
