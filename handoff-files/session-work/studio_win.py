import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-aab304a53dbb8b4d0')
p='editor/app/src/titler/StudioTitler.tsx'
s=open(p).read()
old_start=s.index("const OPEN = 'studio-open-titler';")
old_end=s.index('/** "Text & more": the Titler templates')
new=open('/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/studio_block.tsx').read()
s=s[:old_start]+new+s[old_end:]
s=s.replace("import { lazy, Suspense, useEffect, useMemo, useState } from 'react';","import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';")
s=s.replace("import type { TitleProject } from '../../../../titler/src/core/types';","import type { TitleProject, Values } from '../../../../titler/src/core/types';")
s=s.replace("import { titlerMarks } from './titlerClip';","import { titlerMarks } from './titlerClip';\nimport { serveTitler, studioChannel, TitlerClient, type Channel } from './titlerWindow';")
s=s.replace("""// title clip's fields in the Inspector, and the designer opened over the
// editor ("Titler…") with Studio's own look. "Use in Studio" puts the title
// back into its clip, or adds a new title clip at the playhead.""","""// title clip's fields in the Inspector, and the designer ("Titler…") in its
// own window with Studio's own look (over the editor only where a window
// can't open). "Use in this clip" puts the title back into its clip, or adds
// a new title clip at the playhead.""")
open(p,'w').write(s)

p='editor/app/src/ui/Editor.tsx'
s=open(p).read()
s=s.replace("<StudioTitlerHost clipOf={actions.clipById} onUse={(t, id) => (id ? actions.useTitler(t, id) : actions.addTitler(t))} />","<StudioTitlerHost clipOf={actions.clipById} onUse={actions.useTitler} onAdd={actions.addTitler} />")
open(p,'w').write(s)

p='editor/app/src/main.tsx'
s=open(p).read()
s=s.replace("""import { StrictMode } from 'react';""","""import { lazy, StrictMode, Suspense } from 'react';""")
s=s.replace("""createRoot(root, { onCaughtError: reactError, onUncaughtError: reactError }).render(
  <StrictMode>
    <App />
  </StrictMode>,
);""","""// The Titler window (`?titler=<clip or new>`, opened by "Titler…"): the designer on its own.
const TitlerWindow = lazy(() => import('./titler/StudioTitler').then((m) => ({ default: m.StudioTitlerWindow })));
const titlerWindow = new URLSearchParams(window.location.search).has('titler');

createRoot(root, { onCaughtError: reactError, onUncaughtError: reactError }).render(
  <StrictMode>
    {titlerWindow ? (
      <Suspense fallback={null}>
        <TitlerWindow />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);""")
s=s.replace("if (TEST_BUILD) void startSelfTest(studioScenario);","if (TEST_BUILD && !titlerWindow) void startSelfTest(studioScenario);")
open(p,'w').write(s)
