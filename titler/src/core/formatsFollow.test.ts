// Formats follow the main composition: a change there comes to each format
// (placed by the constraints), and what was changed in the format stays.

import { describe, expect, it } from 'vitest';
import { followMain, makeFormat } from './formats';
import { fromTemplate, starterTemplates } from './templates';
import { newShape } from './build';
import type { Composition, Layer, TextLayer, TitleProject, Vec2 } from './types';

const setup = () => {
  const p = fromTemplate(starterTemplates().find((t) => t.name === 'Name and role')!);
  const r = makeFormat(p, '9:16 vertical', 1080, 1920);
  return { p: r.project, vid: r.id };
};
const main = (p: TitleProject) => p.compositions.find((c) => c.id === p.main)!;
const comp = (p: TitleProject, id: string) => p.compositions.find((c) => c.id === id)!;
const editMain = (p: TitleProject, f: (c: Composition) => Composition): TitleProject => ({
  ...p,
  compositions: p.compositions.map((c) => (c.id === p.main ? f(c) : c)),
});
const editLayer = (c: Composition, name: string, f: (l: Layer) => Layer): Composition => ({ ...c, layers: c.layers.map((l) => (l.name === name ? f(l) : l)) });
const textOf = (c: Composition) => c.layers.find((l) => l.type === 'text') as TextLayer;

describe('formats follow the main composition', () => {
  it('a new style, new words and a new layer in the main one come to the format', () => {
    const { p, vid } = setup();
    const name = textOf(main(p)).name;
    const after = followMain(
      p,
      editMain(p, (c) => {
        const c2 = editLayer(c, name, (l) => ({ ...(l as TextLayer), text: 'New words', style: { ...(l as TextLayer).style, weight: 900 } }));
        return { ...c2, layers: [newShape(c2, 'rect', [10, 10], [50, 50], '#ff0000'), ...c2.layers], duration: c.duration + 1 };
      }),
    );
    const v = comp(after, vid);
    const t = v.layers.find((l) => l.name === name) as TextLayer;
    expect(t.text).toBe('New words');
    expect(t.style.weight).toBe(900);
    expect(v.layers.length).toBe(main(after).layers.length);
    expect(v.duration).toBe(main(after).duration);
    expect([v.width, v.height]).toEqual([1080, 1920]);
  });

  it('keeps what was changed in the format itself', () => {
    const { p, vid } = setup();
    const name = textOf(main(p)).name;
    // In the format: the text moved, another layer deleted, one added.
    const moved: Vec2 = [55, 1500];
    const extra = newShape(null, 'ellipse', [500, 500], [20, 20], '#00ff00');
    const victim = comp(p, vid).layers.find((l) => l.name !== name)!.id;
    const edited: TitleProject = {
      ...p,
      compositions: p.compositions.map((c) =>
        c.id === vid
          ? {
              ...editLayer(c, name, (l) => ({ ...l, transform: { ...l.transform, position: { v: moved } } })),
              layers: [
                extra,
                ...editLayer(c, name, (l) => ({ ...l, transform: { ...l.transform, position: { v: moved } } })).layers.filter((l) => l.id !== victim),
              ],
            }
          : c,
      ),
    };
    const after = followMain(
      edited,
      editMain(edited, (c) => editLayer(c, name, (l) => ({ ...(l as TextLayer), text: 'Changed in main', transform: { ...l.transform, opacity: { v: 50 } } }))),
    );
    const v = comp(after, vid);
    const t = v.layers.find((l) => l.name === name) as TextLayer;
    expect(t.text).toBe('Changed in main');
    expect(t.transform.position).toEqual({ v: moved });
    expect(t.transform.opacity).toEqual({ v: 50 });
    expect(v.layers.some((l) => l.id === victim)).toBe(false);
    expect(v.layers[0]!.id).toBe(extra.id);
  });

  it('leaves a format that stands on its own, and edits of the format itself', () => {
    const { p, vid } = setup();
    const own = { ...p, compositions: p.compositions.map((c) => (c.id === vid ? { ...c, follow: false } : c)) };
    const after = followMain(
      own,
      editMain(own, (c) => ({ ...c, duration: 99 })),
    );
    expect(comp(after, vid).duration).not.toBe(99);
    const same = { ...p, compositions: p.compositions.map((c) => (c.id === vid ? { ...c, duration: 42 } : c)) };
    expect(followMain(p, same)).toBe(same);
  });
});
