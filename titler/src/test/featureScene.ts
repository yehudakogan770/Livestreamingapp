import { newCompLayer, newComposition, newGroup, newProject, newShape, newText } from '../core/build';
import { ellipsePath } from '../core/paths';
import type { TitleProject, Vec2 } from '../core/types';

/** One frame using every kind of layer and the effects (no template needs them all). */
export function featureScene(): TitleProject {
  const p = newProject('Features');
  const c = p.compositions[0]!;
  const inner = newComposition('Badge', 400, 400, 30, 4);
  const badge = newShape(inner, 'ellipse', [50, 50], [300, 300], '$accent');
  inner.layers = [newText(inner, 'IN', [50, 150], [300, 100], { size: 80, weight: 700, align: 'center' }), badge];
  p.compositions.push(inner);
  // A rectangle with a mask cutting a circle out.
  const masked = newShape(c, 'rect', [100, 100], [500, 300], '$box');
  masked.masks = [
    {
      id: 'm',
      name: 'Hole',
      mode: 'subtract',
      path: { closed: true, v: ellipsePath(200, 200).v.map((v) => ({ ...v, p: [v.p[0] + 150, v.p[1] + 50] as Vec2 })) },
    },
  ];
  // Words seen only through a turned shape (alpha matte).
  const matte = newShape(c, 'rect', [700, 100], [300, 300], '#ffffff');
  matte.transform.rotation = { v: 20 };
  const seen = newText(c, 'Seen through a matte', [650, 150], [600, 200], {
    size: 72,
    weight: 700,
    fill: {
      type: 'linear',
      angle: 90,
      stops: [
        { at: 0, color: '#ffffff' },
        { at: 1, color: '$accent' },
      ],
    },
  });
  seen.matte = { layer: matte.id, mode: 'alpha' };
  // A group faded to half, with a parented child.
  const g1 = newShape(c, 'rect', [100, 500], [200, 200], '$accent');
  const g2 = newShape(c, 'ellipse', [120, 0], [120, 120], '#ffffff');
  g2.parent = g1.id;
  const group = newGroup(c, [g2, g1]);
  group.transform.opacity = { v: 50 };
  // A precomp, turned and scaled.
  const pre = newCompLayer(c, inner);
  pre.transform.position = { v: [1300, 600] };
  pre.transform.rotation = { v: -12 };
  pre.transform.scale = { v: [80, 80] };
  // A drop shadow, and a stroke with trim.
  const shadowed = newText(c, 'Shadow', [600, 650], [600, 120], { size: 90, weight: 700, stroke: { paint: { type: 'solid', color: '#000000' }, width: 3 } });
  shadowed.effects = [{ id: 'e', type: 'dropShadow', on: true, color: '#000000', opacity: { v: 80 }, angle: 45, distance: { v: 10 }, softness: { v: 8 } }];
  const line = newShape(c, 'path', [600, 900], [0, 0]);
  line.fill = null;
  line.stroke = { paint: { type: 'solid', color: '#ffffff' }, width: 12, cap: 'round' };
  line.path = {
    closed: false,
    v: [
      { p: [0, 0], o: [200, -150] },
      { p: [800, 0], i: [-200, 150] },
    ],
  };
  line.trim = { start: { v: 0 }, end: { v: 70 }, offset: { v: 0 } };
  c.layers = [shadowed, line, pre, group, seen, matte, masked];
  return p;
}
