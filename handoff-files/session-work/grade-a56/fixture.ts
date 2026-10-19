import { writeFileSync } from 'node:fs';
import { gradeAt, newNode, type GradeNode } from '/home/user/Livestreamingapp/.claude/worktrees/agent-a56fa05a9279b9a91/editor/app/src/model/grade';
import { gradePx, nodeUniforms, planGrade, type RGB } from '/home/user/Livestreamingapp/.claude/worktrees/agent-a56fa05a9279b9a91/editor/app/src/render/grade';

const nodes: GradeNode[] = [
  { ...newNode(), p: { exposure: 0.7, contrast: 30, pivot: 40, highlights: -20, shadows: 25, whites: 10, blacks: -15, temperature: 30, tint: -20, saturation: 130, vibrance: 20 } },
  { ...newNode(), p: { liftX: 0.3, liftY: -0.2, lift: 10, gammaX: -0.4, gamma: -15, gainY: 0.5, gain: 20, offsetX: 0.2, offset: 5 } },
  { ...newNode(), p: { hslHue: 20, hslRange: 50, hslShift: 30, hslSat: 40, hslLight: -20, hue: 45 } },
  {
    ...newNode(),
    p: { exposure: 1 },
    qualifier: { hue: 20, hueWidth: 80, satLo: 20, satHi: 90, lumLo: 10, lumHi: 90, soft: 20, invert: false },
    window: { shape: 'circle', x: 0.4, y: 0.6, w: 0.5, h: 0.4, soft: 40, invert: false },
  },
  { ...newNode(), p: { gain: -30 }, window: { shape: 'rect', x: 0.5, y: 0.5, w: 0.6, h: 0.3, soft: 20, invert: true } },
];
const pixels: RGB[] = [];
for (let i = 0; i < 64; i++) pixels.push([((i * 37) % 64) / 63, ((i * 11) % 64) / 63, ((i * 53) % 64) / 63]);
const out = nodes.map((n) => {
  const now = gradeAt({ steps: [{ kind: 'serial', node: n }] }, 0);
  const step = now.steps[0];
  if (step?.kind !== 'serial') throw new Error('no node');
  const plan = planGrade(now);
  // An 8 × 8 picture: row 0 is the bottom (as GL stores it); uv is measured down from the top.
  const expected = pixels.map((c, i) => gradePx(plan, c, [((i % 8) + 0.5) / 8, 1 - (Math.floor(i / 8) + 0.5) / 8], 1));
  return { uniforms: nodeUniforms(step.node), expected };
});
writeFileSync(`${process.argv[2]}/fixture.json`, JSON.stringify({ pixels, nodes: out }));
console.log('fixture written');
