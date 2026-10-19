import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/core')
p='threeD.test.ts'; s=open(p).read()
s=s.replace("import { newProject, newShape } from './build';","import { newCamera, newProject, newShape } from './build';")
s=s.replace("import { is3d, projector, renderFrame } from './render';","import { is3d, projector, renderFrame, sceneCamera } from './render';\nimport { parseProject } from './validate';")
s=s.replace('''  it('keeps X and Y rotation through Lottie', () => {''','''  it('a camera orbiting turns 3D layers (not flat ones), moving away makes them smaller, and is not drawn', () => {
    const p = card(0, 0);
    const c = p.compositions[0]!;
    const flat = newShape(c, 'rect', [0, 380], [400, 20], '#ffffff');
    const cam = newCamera(c);
    cam.transform.rotationY = { v: 60 };
    c.layers = [cam, ...c.layers, flat];
    const cv = draw(p);
    expect(width(cv)).toBeGreaterThan(80);
    expect(width(cv)).toBeLessThan(130);
    // The flat bar along the bottom is as it was.
    expect(width(cv, 390)).toBe(400);
    cam.transform.rotationY = { v: 0 };
    cam.transform.z = { v: 2000 };
    expect(width(draw(p))).toBeLessThan(110);
    expect(width(draw(p), 390)).toBe(400);
    // The camera at rest changes nothing.
    cam.transform.z = { v: 0 };
    expect(width(draw(p))).toBe(200);
    expect(sceneCamera(c, 1).moved).toBe(false);
  });

  it('an extruded layer shows its sides, darker than its face, and they come back from a file', () => {
    const plain = card(0, 50);
    const deep = card(0, 50);
    deep.compositions[0]!.layers[0]!.extrude = { depth: 80 };
    const a = draw(plain);
    const b = draw(deep);
    expect(width(b)).toBeGreaterThan(width(a) + 20);
    // A pixel covered only by the sides is darker than the white face.
    const ctx = b.getContext('2d') as unknown as CanvasRenderingContext2D;
    let side: number[] | null = null;
    for (let x = 0; x < 400 && !side; x++)
      if (alpha(a, x, 200) < 10 && alpha(b, x, 200) > 200) side = [...ctx.getImageData(x, 200, 1, 1).data];
    expect(side).not.toBeNull();
    expect(side![0]!).toBeLessThan(200);
    const back = parseProject(JSON.stringify(deep)).project!.compositions[0]!.layers[0]!;
    expect(back.extrude).toEqual({ depth: 80 });
  });

  it('3D layers next to each other are drawn far ones first', () => {
    const p = newProject('Depth', 400, 400);
    const c = p.compositions[0]!;
    const near = newShape(c, 'rect', [100, 100], [200, 200], '#ff0000');
    near.transform = { ...near.transform, anchor: { v: [100, 100] }, position: { v: [200, 200] }, rotationX: { v: 0 }, rotationY: { v: 0 }, z: { v: -100 } };
    const far = newShape(c, 'rect', [100, 100], [200, 200], '#0000ff');
    far.transform = { ...far.transform, anchor: { v: [100, 100] }, position: { v: [200, 200] }, rotationX: { v: 0 }, rotationY: { v: 0 }, z: { v: 300 } };
    // Listed in front, but farther away: it is hidden behind the near one.
    c.layers = [far, near];
    const px = (draw(p).getContext('2d') as unknown as CanvasRenderingContext2D).getImageData(200, 200, 1, 1).data;
    expect(px[0]).toBeGreaterThan(200);
    expect(px[2]).toBeLessThan(50);
  });

  it('keeps the camera through a file', () => {
    const p = card(0, 0);
    p.compositions[0]!.layers.unshift(newCamera(p.compositions[0]!));
    const back = parseProject(JSON.stringify(p)).project!.compositions[0]!.layers[0]!;
    expect(back.type === 'null' && back.camera).toBe(true);
    expect(back.transform.rotationY).toEqual({ v: 0 });
  });

  it('keeps X and Y rotation through Lottie', () => {''')
open(p,'w').write(s)
