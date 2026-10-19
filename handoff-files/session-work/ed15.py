import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/core')
p='render.ts'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''  const sides = s.f.env.createCanvas(cw, ch);
  const sc = sides?.getContext('2d') as Ctx | null;
  const face = projector(l, t, pivot, s.cam, s.f.px, 0);
  if (!sides || !sc) {
    drawProjected(ctx, surf as CanvasImageSource, area, face, steps);
    return;
  }
  sc.drawImage(surf as CanvasImageSource, 0, 0);
  const color = l.extrude?.color ? resolveColor(l.extrude.color, s.f.tokens, s.f.values, '#000000') : null;
  if (color) tintCanvas(sc, color);
  else {
    sc.save();
    sc.globalCompositeOperation = 'source-atop';
    sc.fillStyle = 'rgba(0,0,0,0.5)';
    sc.fillRect(0, 0, cw, ch);
    sc.restore();
  }''','''  const face = projector(l, t, pivot, s.cam, s.f.px, 0);
  // The sides in three tones: lightest next to the face, darkest at the back.
  const color = l.extrude?.color ? resolveColor(l.extrude.color, s.f.tokens, s.f.values, '#000000') : null;
  const tones: CanvasImageSource[] = [];
  for (const dark of color ? [0, 0.18, 0.34] : [0.32, 0.46, 0.58]) {
    const c = s.f.env.createCanvas(cw, ch);
    const cc = c?.getContext('2d') as Ctx | null;
    if (!c || !cc) break;
    cc.drawImage(surf as CanvasImageSource, 0, 0);
    if (color) tintCanvas(cc, color);
    cc.save();
    cc.globalCompositeOperation = 'source-atop';
    cc.fillStyle = `rgba(0,0,0,${dark})`;
    cc.fillRect(0, 0, cw, ch);
    cc.restore();
    tones.push(c as CanvasImageSource);
  }
  if (tones.length < 3) {
    drawProjected(ctx, surf as CanvasImageSource, area, face, steps);
    return;
  }''')
rep('''  const slice = (i: number) => {
    const along = (depth * i) / n;
    ctx.save();
    // Darker toward the back.
    ctx.globalAlpha *= 1;
    drawProjected(ctx, sides as CanvasImageSource, area, projector(l, t, pivot, s.cam, s.f.px, along), sliceSteps);
    ctx.restore();
  };''','''  const slice = (i: number) => {
    const f = i / n;
    const tone = tones[f <= 0.25 ? 0 : f <= 0.65 ? 1 : 2]!;
    drawProjected(ctx, tone, area, projector(l, t, pivot, s.cam, s.f.px, (depth * i) / n), sliceSteps);
  };''')
open(p,'w').write(s)
