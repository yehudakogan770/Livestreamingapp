import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Shortcuts.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''      ['H, or hold Space', 'Move the view'],
      ['M', 'Note on the canvas'],
      ['N', 'New text layer'],''','''      ['H, or hold Space and drag', 'Move the view'],
      ['M', 'Note on the canvas'],
      ['N', 'New text layer'],
      ['Double-click text', 'Type on the canvas (Esc to finish)'],''')
rep('''      ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
      ['Ctrl+Shift+C', 'Precompose'],''','''      ['Ctrl+A', 'Select all layers'],
      ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
      ['Ctrl+Shift+C', 'Precompose'],
      ['Ctrl+] / Ctrl+[', 'Forward / backward (Shift: to front / back)'],''')
rep('''      ['Alt+P, S, R, T', 'A keyframe of position, scale, rotation, opacity'],''','''      ['Alt+P, S, R, T, A', 'A keyframe of position, scale, rotation, opacity, anchor point'],''')
rep('''      ['`', 'The canvas on its own'],
      ['?', 'This sheet'],''','''      ['`', 'The canvas on its own'],
      ['Ctrl+0', 'Fit the canvas'],
      ['Ctrl+= / Ctrl+-', 'Zoom in / out (or Ctrl+wheel)'],
      ['Ctrl+wheel on the timeline', 'Zoom in time'],
      ['Esc', 'Deselect; close a dialog or menu'],
      ['?', 'This sheet'],''')
rep('''      ['Space', 'Play / pause'],''','''      ['Space', 'Play / pause'],''')
open(p,'w').write(s)
