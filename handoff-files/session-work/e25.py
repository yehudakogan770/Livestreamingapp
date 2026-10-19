W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('app/src/engine/overlayPlanes.ts', [
("""  | { kind: 'panic'; name: 'panic'; w: number; h: number };""","""  | { kind: 'panic'; name: 'panic'; w: number; h: number }
  /** The words of the engine's multiview (the Live Screen's renderer draws them). */
  | { kind: 'multiview'; name: 'mv'; w: number; h: number };"""),
])
edit('app/src/broadcast/compositor.ts', [
("""        case 'panic': {
          // The engine draws PANIC's black itself; the logo comes from here.""","""        case 'multiview':
          // Drawn by the overlay renderer itself (engine/multiviewLabels.ts).
          return;
        case 'panic': {
          // The engine draws PANIC's black itself; the logo comes from here."""),
])
edit('app/src/engine/overlayRenderer.ts', [
("""import { cutRect, encodeWire, type WireRecord } from './overlayWire';""","""import { cutRect, encodeWire, type WireRecord } from './overlayWire';
import { drawMultiviewWords, type MvLayout } from './multiviewLabels';"""),
("""  private timer: { stop: () => void } | null = null;""","""  private timer: { stop: () => void } | null = null;
  /** The engine's multiview layout while it shows the multiview (its words are drawn here). */
  private multiview: MvLayout | null = null;"""),
("""  /** Draw on a timer that keeps going in a hidden window. */""","""  /** The engine opened, changed or (null) closed its multiview. */
  setMultiview(layout: MvLayout | null): void {
    if (JSON.stringify(layout) === JSON.stringify(this.multiview)) return;
    this.multiview = layout;
    this.pacer.wake(this.clock());
  }

  /** Draw on a timer that keeps going in a hidden window. */"""),
("""    const specs = overlayPlanes(show, this.screen, at, this.width, this.height);""","""    const specs = overlayPlanes(show, this.screen, at, this.width, this.height);
    const mv = this.multiview;
    if (mv && this.screen === 'live') specs.push({ kind: 'multiview', name: 'mv', w: mv.width, h: mv.height });"""),
("""      this.compositor.drawPlane(p.ctx, spec, at);""","""      if (spec.kind === 'multiview' && mv) drawMultiviewWords(p.ctx, mv, show, at);
      else this.compositor.drawPlane(p.ctx, spec, at);"""),
])
edit('app/src/views/OverlayView.tsx', [
("""import { useShow } from '../engine/useShow';""","""import { useShow } from '../engine/useShow';
import type { MvLayout } from '../engine/multiviewLabels';"""),
("""  useEffect(() => {
    if (renderer && snapshot) renderer.setShow(snapshot.show);
  }, [renderer, snapshot]);""","""  useEffect(() => {
    if (renderer && snapshot) renderer.setShow(snapshot.show);
  }, [renderer, snapshot]);

  // The Live Screen's renderer also draws the words of the engine's multiview, while it shows one.
  useEffect(() => {
    if (!renderer || screen !== 'live') return;
    const ask = () =>
      void invoke<MvLayout | null>('live_engine_multiview_layout').then(
        (l) => renderer.setMultiview(l),
        () => {},
      );
    ask();
    const id = setInterval(ask, 2000);
    return () => clearInterval(id);
  }, [renderer, screen, snapshot?.revision]);"""),
])
