import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Viewport.tsx'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''    if (tool === 'hand' || e.button === 1 || spaceDown.current) {''','''    if (tool === 'hand' || e.button === 1 || spaceHold.down) {
      // Space held and dragged: the view moves, and letting go of Space does not play.
      if (spaceHold.down) spaceHold.used = true;''')
rep('''  const spaceDown = useRef(false);
''','')
rep('''        onKeyDown={(e) => {
          if (e.key === ' ') spaceDown.current = true;
        }}
        onKeyUp={(e) => {
          if (e.key === ' ') spaceDown.current = false;
        }}
''','')
rep('''/** Where the composition sits in the view''','''/**
 * Space: a tap plays or pauses; held while dragging on the canvas it moves
 * the view (the designer plays only when Space comes up unused).
 */
export const spaceHold = { down: false, used: false };

/** Where the composition sits in the view''')
open(p,'w').write(s)

p='Designer.tsx'; s=open(p).read()
rep('''        case ' ':
          handled();
          store.set((x) => ({ playing: !x.playing, rate: 1, cue: null }));
          return;''','''        case ' ':
          // Played when Space comes up (held and dragged, it moves the view instead).
          handled();
          if (!e.repeat) {
            spaceHold.down = true;
            spaceHold.used = false;
          }
          return;''')
rep('''    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, cmd]);''','''    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !spaceHold.down) return;
      spaceHold.down = false;
      const el = e.target as HTMLElement | null;
      if (spaceHold.used || el?.closest?.('input, textarea, select, [contenteditable="true"]') || modalOpen()) return;
      store.set((x) => ({ playing: !x.playing, rate: 1, cue: null }));
    };
    const onBlur = () => {
      spaceHold.down = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, cmd]);''')
rep("import { Viewport, lookOf } from './Viewport';","import { Viewport, lookOf, spaceHold } from './Viewport';")
open(p,'w').write(s)
