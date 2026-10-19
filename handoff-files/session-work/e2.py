W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
p=W+'app/src/engine/role.ts'
s=open(p).read()
s=s.replace("""export function outputScreen(): ScreenId | null {""","""/** The unified engine's hidden graphics renderer for a screen (`overlay-live`, `overlay-back`), or null. */
export function overlayScreen(): 'live' | 'back' | null {
  const name = isInsideLumora() ? getCurrentWindow().label.replace(/^overlay-/, '') : new URLSearchParams(window.location.search).get('overlay');
  return name === 'live' || name === 'back' ? name : null;
}

export function outputScreen(): ScreenId | null {""")
open(p,'w').write(s)
p=W+'app/src/App.tsx'
s=open(p).read()
s=s.replace("import { isMultiview, outputScreen } from './engine/role';","import { isMultiview, outputScreen, overlayScreen } from './engine/role';")
s=s.replace("""const MultiviewView = lazyPart(() => import('./views/MultiviewView').then((m) => m.MultiviewView));""","""const MultiviewView = lazyPart(() => import('./views/MultiviewView').then((m) => m.MultiviewView));
const OverlayView = lazyPart(() => import('./views/OverlayView').then((m) => m.OverlayView));""")
s=s.replace("""  const part = isMultiview() ? MultiviewView : outputScreen() ? OutputView : Control;""","""  const part = overlayScreen() ? OverlayView : isMultiview() ? MultiviewView : outputScreen() ? OutputView : Control;""")
s=s.replace("""  const multiview = useMemo(isMultiview, []);
  if (multiview) return <MultiviewView />;""","""  const multiview = useMemo(isMultiview, []);
  const overlay = useMemo(overlayScreen, []);
  if (overlay) return <OverlayView screen={overlay} />;
  if (multiview) return <MultiviewView />;""")
open(p,'w').write(s)
