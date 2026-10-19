import sys
f=sys.argv[1]
s=open(f).read()
a=s.index("  for (const e of fx) {\n    if (e.type === 'dropShadow') {")
b=s.index("  ctx.drawImage(surf as CanvasImageSource, 0, 0);\n  ctx.restore();\n}")
s=s[:a]+"""  for (const e of fx) {
    if (e.type !== 'dropShadow' && e.type !== 'glow') continue;
    // The layer's shape in the effect's color, softened, drawn under it.
    const tint = s.f.env.createCanvas(cw, ch);
    const tc = tint?.getContext('2d') as Ctx | null;
    if (!tint || !tc) continue;
    tc.drawImage(surf as CanvasImageSource, 0, 0);
    tintCanvas(tc, resolveColor(e.color, s.f.tokens, s.f.values, e.type === 'glow' ? '#ffffff' : '#000000'));
    const soft = (e.type === 'dropShadow' ? num(e.softness, t, 10) : num(e.radius, t, 12)) * s.f.px;
    const dist = e.type === 'dropShadow' ? num(e.distance, t, 6) * s.f.px : 0;
    const ang = e.type === 'dropShadow' ? (e.angle * Math.PI) / 180 : 0;
    ctx.save();
    ctx.globalAlpha = opacity * (num(e.opacity, t, e.type === 'glow' ? 50 : 60) / 100);
    if (soft > 0.05) ctx.filter = `blur(${round(soft / 2)}px)`;
    ctx.drawImage(tint as CanvasImageSource, Math.cos(ang) * dist, Math.sin(ang) * dist);
    ctx.restore();
  }
"""+s[b:]
open(f,'w').write(s)
