import os,re
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
p='titler/src/core/lottie.ts'
s=open(p).read()
def rep(a,b):
    global s
    assert a in s,a; s=s.replace(a,b,1)
rep("""function hex(rgba: number[], alpha = 1): string {
  const scale = rgba.some((x) => x > 1) ? 1 : 255;
  const h = (x: number) =>
    Math.round(Math.max(0, Math.min(255, x * scale)))
      .toString(16)
      .padStart(2, '0');
  const a = (rgba[3] ?? 1) * alpha;
  return `#${h(rgba[0] ?? 0)}${h(rgba[1] ?? 0)}${h(rgba[2] ?? 0)}${a < 0.999 ? h(a / (scale === 1 ? 255 : 1)) : ''}`;
}""","""/** A Lottie color (0–1, or 0–255 in some old files) as #rrggbb[aa]. */
export function hex(rgba: number[], alpha = 1): string {
  const k = rgba.slice(0, 3).some((x) => x > 1) ? 1 / 255 : 1;
  const h = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  const a = Math.max(0, Math.min(1, (rgba[3] ?? 1) * alpha));
  return `#${h((rgba[0] ?? 0) * k)}${h((rgba[1] ?? 0) * k)}${h((rgba[2] ?? 0) * k)}${a < 0.999 ? h(a) : ''}`;
}""")
rep("offset: (st - c.ip + shift) / c.fr + c.ip / c.fr }","offset: (st - c.ip + shift) / c.fr }")
rep("  if (arr(o.chars).length) c0note(fonts);\n","")
rep("""
function c0note(_fonts: Map<string, unknown>) {
  // Glyph outlines inside the file ("chars") are not needed: the font family is used.
}
""","")
rep("text: words.replace(/\\[/g, '［'),","text: words,")
open(p,'w').write(s)
