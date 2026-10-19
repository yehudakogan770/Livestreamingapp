import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='Viewport.tsx'; s=open(p).read()
s=s.replace("import { TextEditOverlay, withoutEdited } from './TextEditOverlay';","import { TextEditOverlay } from './TextEditOverlay';")
s=s.replace("""      else renderFrame(ctx, withoutEdited(s), { comp: c.id, time: t, clock, values: s.values, brand: s.brand ?? undefined, env });""","""      else {
        // A text layer being typed into is shown by its text box instead.
        const editing = s.editingText;
        renderFrame(ctx, s.project, { comp: c.id, time: t, clock, values: s.values, brand: s.brand ?? undefined, env, skip: editing ? (l) => l.id === editing : undefined });
      }""")
open(p,'w').write(s)
p='TextEditOverlay.tsx'; s=open(p).read()
a=s.index("/** The project as drawn while a layer is edited")
s=s[:a].rstrip()+"\n"
s=s.replace("import type { TextLayer, Vec2 } from '../core/types';","import type { Vec2 } from '../core/types';")
open(p,'w').write(s)

p='Panels.tsx'; s=open(p).read()
a='''      ctx.fillStyle = '#5d6168';
      ctx.fillRect(0, 0, cv.width, cv.height);
      try {
        renderFrame(ctx, project, { time: at ?? c.markers.inEnd + 0.4, clock: 3, env, width: cv.width, height: cv.height });
      } catch {
        /* nothing drawn */
      }'''
b='''      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#55585e';
      ctx.fillRect(0, 0, cv.width, cv.height);
      const time = at ?? c.markers.inEnd + 0.4;
      // A small graphic (a bug, a lower third) is shown closer, so it can be told apart.
      const r = crop ? thumbCrop(project, time) : { x: 0, y: 0, w: c.width, h: c.height };
      const k = cv.width / r.w;
      ctx.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
      try {
        renderFrame(ctx, project, { time, clock: 3, env });
      } catch {
        /* nothing drawn */
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);'''
assert a in s
s=s.replace(a,b)
s=s.replace('''export function Thumb({ project, env, width = 192, at }: { project: TitleProject; env: BrowserEnv; width?: number; at?: number }) {''','''export function Thumb({ project, env, width = 192, at, crop = false }: { project: TitleProject; env: BrowserEnv; width?: number; at?: number; crop?: boolean }) {''')
s=s.replace("  }, [project, env, width, height, at, c.markers.inEnd]);","  }, [project, env, width, height, at, c.markers.inEnd, crop]);")
s=s.replace('''            <Thumb project={t} env={env} width={176} />''','''            <Thumb project={t} env={env} width={176} crop />''')
s=s.replace('''/** A small picture of a project (its main composition at the end of IN). */''','''/**
 * The part of the frame a thumbnail shows: the whole frame, or (for a small
 * graphic) the part around it, the frame's shape, at least 40 % of its width.
 */
export function thumbCrop(project: TitleProject, t: number): { x: number; y: number; w: number; h: number } {
  const c = compOf(project, project.main);
  const whole = { x: 0, y: 0, w: c.width, h: c.height };
  const look = { project, comp: c, t, values: {}, brand: null };
  const boxes = c.layers.filter((l) => l.visible && t >= l.start && t < l.end).map((l) => layerBounds(look, l)).filter((b): b is NonNullable<typeof b> => !!b);
  if (!boxes.length) return whole;
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)));
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)));
  const x1 = Math.min(c.width, Math.max(...boxes.map((b) => b.x + b.w)));
  const y1 = Math.min(c.height, Math.max(...boxes.map((b) => b.y + b.h)));
  if (x1 <= x0 || y1 <= y0) return whole;
  const aspect = c.width / c.height;
  let w = Math.max((x1 - x0) * 1.3, ((y1 - y0) * 1.3) * aspect, c.width * 0.4);
  if (w >= c.width * 0.8) return whole;
  w = Math.min(w, c.width);
  const h = w / aspect;
  const x = Math.min(c.width - w, Math.max(0, (x0 + x1) / 2 - w / 2));
  const y = Math.min(c.height - h, Math.max(0, (y0 + y1) / 2 - h / 2));
  return { x, y, w, h };
}

/** A small picture of a project (its main composition at the end of IN). */''')
s=s.replace("import { addLayers, compOf, updateComp } from './ops';","import { addLayers, compOf, updateComp } from './ops';\nimport { layerBounds } from './geometry';")
open(p,'w').write(s)
