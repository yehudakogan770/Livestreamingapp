import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src')
p='core/types.ts'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''   * ("{{guest_2}}"). Fields not given come from the title.
   */
  values?: Values;
}''','''   * ("{{guest_2}}"). Fields not given come from the title.
   */
  values?: Values;
  /** This copy's changes to the layers inside it, by layer id (see core/components.ts). */
  overrides?: Record<string, LayerOverride>;
}

/** One copy's changes to a layer of the composition it shows. */
export interface LayerOverride {
  /** Shown or hidden in this copy. */
  visible?: boolean;
  /** Other words (a text layer). */
  text?: string;
  /** Another color (a text's or a shape's fill). */
  fill?: ColorRef;
  /** Another picture (an image or video layer): an asset id or {{field}}. */
  picture?: string;
  /** Moved by, px (added to its animation). */
  move?: Vec2;
  /** Scaled by, percent of its own scale. */
  scale?: number;
  /** Turned by, degrees. */
  rotate?: number;
  /** Faded to, percent of its own opacity. */
  opacity?: number;
}''')
open(p,'w').write(s)
p='core/render.ts'; s=open(p).read()
rep('''      drawComp(ctx, inner, t - l.offset, world, f2);''','''      // This copy's changes to the layers inside (a component's overrides).
      drawComp(ctx, withOverrides(inner, l.overrides), t - l.offset, world, f2);''')
rep("import { pickFormat } from './formats';","import { pickFormat } from './formats';\nimport { withOverrides } from './components';")
open(p,'w').write(s)
