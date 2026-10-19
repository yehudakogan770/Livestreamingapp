p = 'render/text.ts'
s = open(p).read()
s = s.replace("""import type { TextAnim, TextData } from '../model/types';
""", """import { charLooks, textUnits, type CharLook } from '../model/textanim';
import type { TextAnim, TextData } from '../model/types';
""")
s = s.replace("""  const { anim } = phase(t, local, length);
  if (anim !== 'none') return `${base}|${local}`;""", """  const { anim } = phase(t, local, length);
  if (anim !== 'none' || t.animators?.some((a) => a.on)) return `${base}|${local}`;""")
old = s[s.index("  let y = top;\n  lines.forEach((line, i) => {"):s.index("/** The second line is the same color")]
new = '''  // Text animators: each letter drawn on its own, with its own look.
  const looks = t.animators?.some((a) => a.on) ? charLooks(t.animators, textUnits(lines), local) : null;
  let first = 0;
  let y = top;
  lines.forEach((line, i) => {
    const lh = heights[i] ?? lineH;
    const fs = size * (sizes[i] ?? 1);
    ctx.font = `${t.italic ? 'italic ' : ''}${i === 0 || t.even ? t.weight : Math.min(t.weight, 500)} ${fs}px "${t.font}", "Segoe UI", system-ui, sans-serif`;
    const lw = widths[i] ?? 0;
    const x = t.align === 'left' ? left : t.align === 'right' ? left + blockW - lw : left + (blockW - lw) / 2;
    const shown = anim === 'type' ? line.slice(0, Math.round(line.length * reveal)) : line;
    const cy = y + lh / 2;
    const color = i === 0 ? t.color : (t.color2 ?? (t.even ? t.color : mixWhite(t.color)));
    const paint = (words: string, px: number, py: number) => {
      if (t.shadow > 0) {
        ctx.shadowColor = t.shadowColor;
        ctx.shadowBlur = t.shadow * s * 2;
        ctx.shadowOffsetY = t.shadow * s * 0.5;
      }
      if (t.stroke > 0) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = t.stroke * s * 2;
        ctx.strokeStyle = t.strokeColor;
        ctx.strokeText(words, px, py);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = color;
      ctx.fillText(words, px, py);
      ctx.shadowColor = 'transparent';
    };
    const chars = [...line];
    if (looks) drawAnimatedLine(ctx, chars, x, cy, looks.slice(first, first + chars.length), s, t.align, paint);
    else paint(shown, x, cy);
    first += chars.length;
    y += lh;
  });
  ctx.restore();
}

/** One line letter by letter, each with its animators' look (moved, turned, sized, faded, blurred, spaced out). */
function drawAnimatedLine(
  ctx: CanvasRenderingContext2D,
  chars: string[],
  x: number,
  cy: number,
  looks: CharLook[],
  s: number,
  align: TextData['align'],
  paint: (words: string, x: number, y: number) => void,
) {
  const extra = looks.reduce((a, l, i) => (i < looks.length - 1 ? a + l.tracking * s : a), 0);
  const start = x - (align === 'center' ? extra / 2 : align === 'right' ? extra : 0);
  let before = '';
  let spaced = 0;
  const alpha = ctx.globalAlpha;
  const filter = ctx.filter;
  chars.forEach((ch, k) => {
    const look = looks[k] as CharLook;
    const at = start + ctx.measureText(before).width + spaced;
    const cw = ctx.measureText(ch).width;
    before += ch;
    spaced += look.tracking * s;
    if (ch.trim() === '' || look.opacity <= 0.001 || look.scale <= 0.001) return;
    ctx.save();
    ctx.globalAlpha = alpha * Math.min(1, look.opacity);
    ctx.translate(at + cw / 2 + look.x * s, cy + look.y * s);
    if (look.rotation) ctx.rotate((look.rotation * Math.PI) / 180);
    if (look.scale !== 1) ctx.scale(look.scale, look.scale);
    if (look.blur > 0.05) ctx.filter = `blur(${look.blur * s}px)`;
    paint(ch, -cw / 2, 0);
    ctx.filter = filter;
    ctx.restore();
  });
}

'''
s = s.replace(old, new)
open(p, 'w').write(s)
