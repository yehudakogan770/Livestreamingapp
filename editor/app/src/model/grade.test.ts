import { describe, expect, it } from 'vitest';
import { Doc } from '../doc';
import { setKey, valueAt } from './anim';
import { readProject } from './build';
import { newEffect } from './effects';
import {
  addBeside,
  addSerial,
  allNodes,
  changeGrade,
  cloneGrade,
  gradeAt,
  gradeEffect,
  gradeOf,
  migrateProject,
  moveStep,
  newGrade,
  newNode,
  nodeNumber,
  nudgeNode,
  removeNode,
  resetNode,
  setMix,
  shownGrade,
  updateNode,
  withGrade,
  type Grade,
  type GradeNode,
} from './grade';
import { current, editSeq, trimLeft } from './seq';
import { emptyProject, newClip, type Clip, type Effect, type Project } from './types';

const fx = (type: string, p: Record<string, number> = {}, on = true): Effect => {
  const e = newEffect(type);
  return { ...e, on, p: { ...e.p, ...p } };
};

function clipWith(effects: Effect[]): Clip {
  return { ...newClip('v', 0, 100, { kind: 'color', color: '#808080' }, 'Gray'), effects };
}

function projectWith(clips: Clip[]): Project {
  const p = emptyProject('Test');
  const v = current(p).tracks[0]?.id as string;
  return editSeq(p, (s) => ({ ...s, clips: clips.map((c) => ({ ...c, track: v })) }));
}

const serialNodes = (g: Grade): GradeNode[] => g.steps.map((s) => (s.kind === 'serial' ? s.node : (null as unknown as GradeNode)));

describe('moving old color effects into nodes', () => {
  it('puts a row of color effects into one node, in the same place', () => {
    const curves = fx('curves', { mix: 50 });
    curves.d = {
      ...curves.d,
      master: [
        [0, 0.1],
        [1, 0.9],
      ],
    };
    const c = clipWith([
      fx('blur'),
      fx('basic', { exposure: 1, contrast: 20 }),
      fx('wheels', { liftX: 0.3, gain: 10 }),
      curves,
      fx('hsl', { hue: 120, shift: 15 }),
      fx('lut'),
    ]);
    const out = withGrade(c);
    expect(out.effects.map((e) => e.type)).toEqual(['blur', 'grade', 'lut']);
    const g = gradeOf(gradeEffect(out));
    expect(g.steps).toHaveLength(1);
    const [n] = serialNodes(g) as [GradeNode];
    expect(n.on).toBe(true);
    expect(n.p).toMatchObject({ exposure: 1, contrast: 20, liftX: 0.3, gain: 10, curveMix: 50, hslHue: 120, hslShift: 15 });
    expect(n.curves?.master).toEqual([
      [0, 0.1],
      [1, 0.9],
    ]);
  });

  it('starts a new node when the order goes back, and keeps an effect that was off as a bypassed node', () => {
    const c = clipWith([fx('curves'), fx('basic', { exposure: 1 }), fx('wheels', { gain: 5 }, false), fx('hsl', { shift: 10 })]);
    const nodes = serialNodes(gradeOf(gradeEffect(withGrade(c))));
    expect(nodes.map((n) => n.on)).toEqual([true, true, false, true]);
    expect(nodes[1]?.p.exposure).toBe(1);
    expect(nodes[2]?.p.gain).toBe(5);
    expect(nodes[3]?.p.hslShift).toBe(10);
  });

  it('keeps keyframes', () => {
    const c = clipWith([{ ...fx('basic'), p: { exposure: setKey(setKey(0, 0, 0), 10, 2) } }]);
    const g = gradeOf(gradeEffect(withGrade(c)));
    expect(gradeAt(g, 5).steps[0]).toMatchObject({ kind: 'serial', node: { p: { exposure: 1, saturation: 100 } } });
  });

  it('leaves projects without old color effects alone, and runs once', () => {
    const clean = projectWith([clipWith([fx('blur')])]);
    expect(migrateProject(clean)).toBe(clean);
    const old = projectWith([clipWith([fx('basic', { exposure: 1 })]), clipWith([])]);
    const read = readProject(JSON.stringify(old));
    const clips = current(read).clips;
    expect(clips[0]?.effects.map((e) => e.type)).toEqual(['grade']);
    expect(clips[1]?.effects).toEqual([]);
    expect(migrateProject(read)).toBe(read);
  });

  it('shows the grade a clip would get before its first change, then makes it', () => {
    const c = clipWith([fx('basic', { exposure: 1 }), fx('curves'), fx('basic', { exposure: 2 })]);
    const shown = shownGrade(c);
    expect(allNodes(shown).map((n) => n.id)).toEqual(['new0', 'new1']);
    expect(gradeEffect(c)).toBeUndefined();
    const made = changeGrade(c, (g) => updateNode(g, (allNodes(g)[1] as GradeNode).id, (n) => ({ ...n, label: 'Skin' })));
    const nodes = allNodes(gradeOf(gradeEffect(made)));
    expect(nodes.map((n) => n.label)).toEqual(['', 'Skin']);
    expect(nodes[1]?.p.exposure).toBe(2);
    // A clip with no color effects gets an empty grade at the end.
    expect(withGrade(clipWith([fx('blur')])).effects.map((e) => e.type)).toEqual(['blur', 'grade']);
  });
});

describe('changing the node graph', () => {
  const one = (): [Grade, string] => {
    const g = newGrade();
    return [g, (allNodes(g)[0] as GradeNode).id];
  };

  it('adds serial, parallel and layer nodes', () => {
    const [g, a] = one();
    const b = newNode();
    const g2 = addSerial(g, a, b);
    expect(g2.steps.map((s) => s.kind)).toEqual(['serial', 'serial']);
    const c = newNode();
    const g3 = addBeside(g2, a, 'parallel', c);
    expect(g3.steps[0]).toMatchObject({ kind: 'parallel', nodes: [{ id: a }, { id: c.id }] });
    const d = newNode();
    const g4 = addBeside(g3, c.id, 'parallel', d);
    expect(g4.steps[0]).toMatchObject({ kind: 'parallel', nodes: [{ id: a }, { id: c.id }, { id: d.id }] });
    // Adding a layer node to a parallel group makes it a layer mix.
    const g5 = addBeside(g4, a, 'layer');
    expect(g5.steps[0]?.kind).toBe('layer');
    expect(setMix(g5, 0, 'parallel').steps[0]?.kind).toBe('parallel');
    expect(allNodes(g5).map((n) => nodeNumber(g5, n.id))).toEqual(['01', '02', '03', '04', '05']);
  });

  it('removes nodes (a group of one becomes serial; the last node is reset instead)', () => {
    const [g, a] = one();
    const b = newNode();
    const g2 = addBeside(g, a, 'parallel', b);
    const g3 = removeNode(g2, a);
    expect(g3.steps).toEqual([{ kind: 'serial', node: b }]);
    const busy = updateNode(g3, b.id, (n) => ({
      ...n,
      on: false,
      p: { exposure: 1 },
      window: { shape: 'rect', x: 0.5, y: 0.5, w: 1, h: 1, soft: 0, invert: false },
    }));
    const g4 = removeNode(busy, b.id);
    expect(allNodes(g4)).toEqual([{ ...b, on: true, p: {}, curves: null, qualifier: null, window: null }]);
    expect(resetNode(busy, b.id)).toEqual(g4);
  });

  it('reorders nodes and steps', () => {
    const [g, a] = one();
    const b = newNode();
    const c = newNode();
    const g2 = addSerial(addSerial(g, a, b), b.id, c);
    expect(allNodes(moveStep(g2, 0, 2)).map((n) => n.id)).toEqual([b.id, c.id, a]);
    expect(allNodes(nudgeNode(g2, c.id, -1)).map((n) => n.id)).toEqual([a, c.id, b.id]);
    expect(nudgeNode(g2, a, -1)).toEqual(g2);
    const grouped = addBeside(g2, a, 'layer', newNode());
    const inGroup = allNodes(grouped)[1] as GradeNode;
    expect(allNodes(nudgeNode(grouped, inGroup.id, -1))[0]?.id).toBe(inGroup.id);
  });

  it('copies a grade with new node ids', () => {
    const [g] = one();
    const copy = cloneGrade(addBeside(g, null, 'parallel'));
    expect(allNodes(copy)).toHaveLength(2);
    expect(allNodes(copy).some((n) => allNodes(g).some((m) => m.id === n.id))).toBe(false);
  });

  it('leaves bypassed nodes out of the frame', () => {
    const [g, a] = one();
    const b = newNode();
    const g2 = updateNode(addBeside(g, a, 'parallel', b), b.id, (n) => ({ ...n, on: false }));
    const now = gradeAt(g2, 0);
    expect(now.steps).toEqual([{ kind: 'parallel', nodes: [expect.objectContaining({ id: a })] }]);
    expect(
      gradeAt(
        updateNode(g, a, (n) => ({ ...n, on: false })),
        0,
      ).steps,
    ).toEqual([]);
  });

  it('moves node keyframes with the clip when it is trimmed', () => {
    const c = changeGrade(clipWith([]), (g) =>
      updateNode(g, (allNodes(g)[0] as GradeNode).id, (n) => ({ ...n, p: { exposure: setKey(setKey(0, 10, 0), 20, 1) } })),
    );
    const t = trimLeft(c, 5, 30);
    const n = allNodes(gradeOf(gradeEffect(t)))[0] as GradeNode;
    expect(valueAt(n.p.exposure, 15)).toBe(1);
  });

  it('can be undone', () => {
    const p = projectWith([clipWith([fx('basic', { exposure: 1 })])]);
    const doc = new Doc(p);
    const id = current(p).clips[0]?.id as string;
    const grade = (q: Project) => gradeOf(gradeEffect(current(q).clips[0] as Clip));
    doc.edit((q) => editSeq(q, (s) => ({ ...s, clips: s.clips.map((c) => (c.id === id ? changeGrade(c, (g) => addSerial(g, null)) : c)) })), 'Add node');
    expect(allNodes(grade(doc.project))).toHaveLength(2);
    doc.undo();
    expect(doc.project).toBe(p);
    doc.redo();
    expect(allNodes(grade(doc.project))).toHaveLength(2);
  });
});
