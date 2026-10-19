p='/home/user/Livestreamingapp/.claude/worktrees/agent-a198c635ae755b425/app/src/views/ControlView.css'
s=open(p).read()
a=s.index('''.tile {
  position: relative;''')
b=s.index('''.menu {
  position: absolute;''')
new='''.tile {
  position: relative;
  min-width: 0;
  border-radius: var(--radius-sm);
  background: #121418;
  border: 1px solid #262a31;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
}
.tile:hover {
  border-color: #3a3f48;
}
/* Tally: a 3px bar over the picture and an outline in the bus color. */
.tile::after {
  content: '';
  position: absolute;
  left: -1px;
  right: -1px;
  top: -1px;
  height: 3px;
  z-index: 3;
  pointer-events: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.tile--pgm {
  border-color: var(--program-bright);
}
.tile--pgm::after {
  background: var(--program-bright);
}
.tile--pvw {
  border-color: var(--preview-bright);
}
.tile--pvw::after {
  background: var(--preview-bright);
}
.tile__pick {
  position: absolute;
  inset: 0;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  display: flex;
  flex-direction: column;
  text-align: left;
  overflow: hidden;
}
.tile__pick:disabled {
  cursor: default;
}
.tile__thumb {
  position: relative;
  flex: 1;
  min-height: 60px;
  background: #000;
  overflow: hidden;
  pointer-events: none;
}
/* The label strip under the picture: number, name, and what kind it is. */
.tile__foot {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px 8px 0 6px;
  border-top: 1px solid #000;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.tile__num {
  min-width: 20px;
  height: 18px;
  padding: 0 4px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background: var(--well);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
.tile--pgm .tile__num {
  border-color: var(--program);
  background: var(--program);
  color: #fff;
}
.tile--pvw .tile__num {
  border-color: var(--preview);
  background: var(--preview);
  color: #fff;
}
.tile__badge {
  position: absolute;
  right: 32px;
  top: 6px;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  color: #fff;
  font-family: var(--mono);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 18px;
}
.tile__badge--pgm {
  background: var(--program);
}
.tile__badge--pvw {
  background: var(--preview);
}
.tile__name {
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}
.tile__kind {
  padding: 1px 8px 5px 33px;
  font-size: 11px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Corner actions: small dark keys over the picture. */
.tile__more,
.tile__remove,
.tile__play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(10, 11, 13, 0.82);
  color: #e9ebee;
  backdrop-filter: blur(4px);
}
.tile__more {
  position: absolute;
  right: 5px;
  top: 5px;
  width: 24px;
  height: 20px;
  padding: 0;
  border-radius: var(--radius-sm);
  line-height: 1;
}
.tile__more:hover {
  background: var(--button-hover);
  border-color: var(--border-strong);
}
/* Remove: shows when the pointer is over the input (and stays while it asks to be sure). */
.tile__remove {
  /* Top left, clear of the ON AIR / NEXT tags on the right. */
  position: absolute;
  left: 5px;
  top: 5px;
  z-index: 2;
  min-width: 24px;
  height: 20px;
  padding: 0 5px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  opacity: 0;
}
.tile__more svg.lucide,
.tile__remove svg.lucide,
.tile__play svg.lucide {
  width: 13px;
  height: 13px;
}
.tile:hover .tile__remove,
.tile__remove:focus-visible,
.tile__remove.is-armed {
  opacity: 1;
}
.tile__remove:hover,
.tile__remove.is-armed {
  background: var(--program);
  border-color: var(--program-bright);
}
.tile--add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-style: dashed;
  border-color: var(--border-strong);
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 500;
}
.tile--add:hover {
  border-color: var(--accent);
  background: rgba(79, 179, 191, 0.05);
  color: var(--text);
}
.tile--add__plus {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  color: var(--accent);
}
.tile--add__plus svg.lucide {
  width: 16px;
  height: 16px;
}

'''
s=s[:a]+new+s[b:]
def rep(old,new,count=1):
    global s
    assert old in s, old[:80]
    s=s.replace(old,new,count)
rep('''.tile__sound {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  color: var(--text-faint);
  background: var(--well);
}
.tile__play {
  position: absolute;
  left: 34px;
  top: 3px;
  min-width: 30px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  font-size: 11px;
}
.tile__play.is-on {
  border-color: var(--preview-bright);
  color: var(--preview-bright);
}''','''.tile__sound {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  background: var(--well);
}
.tile__sound svg.lucide {
  width: 26px;
  height: 26px;
  stroke-width: 1.5;
}
.tile__play {
  position: absolute;
  left: 34px;
  top: 5px;
  min-width: 26px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
}
.tile__play.is-on {
  border-color: var(--preview-bright);
  color: var(--preview-bright);
}''')
rep('''  .tile__name {
    padding-top: 4px;
    font-size: 12px;
  }
  .tile__kind {
    padding-bottom: 5px;
  }''','''  .tile__foot {
    padding-top: 3px;
  }
  .tile__name {
    font-size: 12px;
  }
  .tile__kind {
    padding-bottom: 3px;
  }''')
# menu popover highlight
rep('''  border-radius: var(--radius);
  background: var(--raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-pop);
}
.menu__row {''','''  border-radius: var(--radius);
  background: var(--raised);
  border: 1px solid var(--border-strong);
  box-shadow:
    inset 0 1px 0 var(--hi),
    var(--shadow-pop);
}
.menu__row {''')
rep('''.bus__keys {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));''','''.bus__keys {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));''')
open(p,'w').write(s)
