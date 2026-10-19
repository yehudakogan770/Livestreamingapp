import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/core')
p='lottieExport.ts'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''      // A copy with its own field values gets its own precomp (Lottie has no fields).
      const own = Object.entries(l.values ?? {}).filter(([, v]) => v);
      const id = own.length ? `comp_${inner.id}_${l.id}` : `comp_${inner.id}`;''','''      // A copy with its own field values or changes gets its own precomp (Lottie has no fields).
      const own = Object.entries(l.values ?? {}).filter(([, v]) => v);
      const shown = withOverrides(inner, l.overrides);
      const id = own.length || shown !== inner ? `comp_${inner.id}_${l.id}` : `comp_${inner.id}`;''')
rep('''        x.assets.push({ id, nm: inner.name, w: inner.width, h: inner.height, fr: x.fr, layers: layersJson(x, inner.layers, inner.width, inner.height) });''','''        x.assets.push({ id, nm: inner.name, w: inner.width, h: inner.height, fr: x.fr, layers: layersJson(x, shown.layers, inner.width, inner.height) });''')
import re
m=re.search(r"import [^\n]*from './render';\n", s)
s=s[:m.end()]+"import { withOverrides } from './components';\n"+s[m.end():]
open(p,'w').write(s)

os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/core')
p='combine.test.ts'; s=open(p).read()
s=s.replace("import { newComposition, newCompLayer, newGroup, newProject, newShape } from './build';","import { newComposition, newCompLayer, newGroup, newProject, newShape, newText } from './build';\nimport { overrideLayer, withOverrides } from './components';\nimport { parseProject } from './validate';")
s=s.rstrip()
assert s.endswith('});')
s=s[:-3]+'''
  it('each copy can change any layer inside: color, shown, moved, scaled, words; its animation still plays', () => {
    const p = newProject('Panel', 400, 200);
    const main = p.compositions[0]!;
    const tag = newComposition('Tag', 200, 200);
    const box = newShape(tag, 'rect', [0, 0], [200, 200], '#ff0000');
    const dot = newShape(tag, 'rect', [0, 0], [20, 20], '#ffffff');
    tag.layers = [dot, box];
    p.compositions.push(tag);
    const a = newCompLayer(main, tag);
    const b = {
      ...newCompLayer(main, tag),
      overrides: { [box.id]: { fill: '#0000ff' }, [dot.id]: { move: [150, 150] as [number, number] } },
      transform: { ...newCompLayer(main, tag).transform, position: { v: [200, 0] as [number, number] } },
    };
    main.layers = [a, b];
    let c = draw(p, 400, 200);
    expect(px(c, 100, 100).slice(0, 3)).toEqual([255, 0, 0]);
    expect(px(c, 300, 100).slice(0, 3)).toEqual([0, 0, 255]);
    // The first copy's dot is at its corner; the second's moved to the other corner.
    expect(px(c, 10, 10).slice(0, 3)).toEqual([255, 255, 255]);
    expect(px(c, 210, 10).slice(0, 3)).toEqual([0, 0, 255]);
    expect(px(c, 360, 160).slice(0, 3)).toEqual([255, 255, 255]);
    // Hidden in a copy.
    b.overrides = { [box.id]: { visible: false } };
    c = draw(p, 400, 200);
    expect(px(c, 300, 100)[3]).toBe(0);
    expect(px(c, 100, 100).slice(0, 3)).toEqual([255, 0, 0]);
    // Kept through a file, and in Lottie as the copy's own precomp.
    const back = parseProject(JSON.stringify(p)).project!.compositions[0]!.layers[1]!;
    expect(back.type === 'comp' && back.overrides).toEqual({ [box.id]: { visible: false } });
    const json = toLottie(p).json as { assets: { id: string }[] };
    expect(json.assets.filter((x) => x.id.startsWith('comp_')).length).toBe(2);
  });

  it('a change is added to the layer’s own keyframes, and changes nothing when empty', () => {
    const t = newText(null, 'Guest', [0, 0], [200, 60]);
    t.transform.position = { k: [{ t: 0, v: [0, 100] }, { t: 1, v: [0, 0] }] };
    t.transform.opacity = { v: 80 };
    const o = overrideLayer(t, { text: 'Host', move: [10, 0], opacity: 50, scale: 200, rotate: 15 });
    expect(o.type === 'text' && o.text).toBe('Host');
    expect(o.transform.position).toEqual({ k: [{ t: 0, v: [10, 100] }, { t: 1, v: [10, 0] }] });
    expect(o.transform.opacity).toEqual({ v: 40 });
    expect(o.transform.scale).toEqual({ v: [200, 200] });
    expect(o.transform.rotation).toEqual({ v: 15 });
    const c = newComposition('C', 100, 100);
    expect(withOverrides(c, {})).toBe(c);
    expect(withOverrides(c, undefined)).toBe(c);
    const ov = { x: { visible: false } };
    expect(withOverrides(c, ov)).toBe(withOverrides(c, ov));
  });
});
'''
open(p,'w').write(s)
