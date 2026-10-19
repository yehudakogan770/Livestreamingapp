// Old color effects (as the old compositor sent them to the GPU) and the node they migrate to.
import { writeFileSync } from 'node:fs';
import { newEffect } from '/home/user/Livestreamingapp/.claude/worktrees/agent-a56fa05a9279b9a91/editor/app/src/model/effects';
import { gradeAt, gradeEffect, gradeOf, withGrade } from '/home/user/Livestreamingapp/.claude/worktrees/agent-a56fa05a9279b9a91/editor/app/src/model/grade';
import { newClip, type Effect } from '/home/user/Livestreamingapp/.claude/worktrees/agent-a56fa05a9279b9a91/editor/app/src/model/types';
import { curvesImage, wheelColor, type CurveSet } from '/home/user/Livestreamingapp/.claude/worktrees/agent-a56fa05a9279b9a91/editor/app/src/render/color';
import { nodeUniforms } from '/home/user/Livestreamingapp/.claude/worktrees/agent-a56fa05a9279b9a91/editor/app/src/render/grade';

const fx = (type: string, p: Record<string, number>): Effect => {
  const e = newEffect(type);
  return { ...e, p: { ...e.p, ...p } };
};
const curves = fx('curves', { mix: 80 });
const set: CurveSet = {
  master: [
    [0, 0.05],
    [0.4, 0.5],
    [1, 0.95],
  ],
  r: [
    [0, 0],
    [0.5, 0.6],
    [1, 1],
  ],
  g: [
    [0, 0],
    [1, 1],
  ],
  b: [
    [0, 0.1],
    [1, 0.9],
  ],
};
curves.d = set as unknown as Record<string, unknown>;
const effects = [
  fx('basic', { exposure: 0.4, contrast: 25, highlights: -30, shadows: 20, whites: 5, blacks: -10, temperature: -20, tint: 10, saturation: 120, vibrance: 15 }),
  fx('wheels', { liftX: 0.2, liftY: 0.1, lift: -5, gammaX: -0.3, gammaY: 0.2, gamma: 10, gainX: 0.1, gainY: -0.4, gain: 15 }),
  curves,
  fx('hsl', { hue: 200, range: 60, shift: -25, sat: 30, light: 10 }),
];

// The old compositor's numbers for each effect.
const n = (e: Effect, k: string, d = 0) => (typeof e.p[k] === 'number' ? (e.p[k] as number) : d);
const [b, w, , h] = effects as [Effect, Effect, Effect, Effect];
const wheel = (x: string, y: string, level: string, k: number) => wheelColor(n(w, x), n(w, y)).map((v) => v * k + n(w, level) / 100);
const legacy = [
  {
    name: 'basic',
    u: {
      uExposure: n(b, 'exposure'),
      uContrast: n(b, 'contrast') / 100,
      uHighlights: n(b, 'highlights') / 100,
      uShadows: n(b, 'shadows') / 100,
      uWhites: n(b, 'whites') / 100,
      uBlacks: n(b, 'blacks') / 100,
      uTemp: n(b, 'temperature') / 100,
      uTint: n(b, 'tint') / 100,
      uSat: n(b, 'saturation', 100) / 100,
      uVib: n(b, 'vibrance') / 100,
    },
  },
  {
    name: 'wheels',
    u: {
      uLift: wheel('liftX', 'liftY', 'lift', 0.15).map((v) => v * 0.5),
      uGamma: wheel('gammaX', 'gammaY', 'gamma', 0.25).map((v) => 1 + v),
      uGain: wheel('gainX', 'gainY', 'gain', 0.3).map((v) => 1 + v),
    },
  },
  { name: 'curves', u: { uMix: 0.8 } },
  { name: 'hsl', u: { uHue: n(h, 'hue') / 360, uRange: n(h, 'range', 30) / 360, uShift: n(h, 'shift') / 360, uSatS: n(h, 'sat') / 100, uLight: n(h, 'light') / 100 } },
];

const clip = withGrade({ ...newClip('v', 0, 10, { kind: 'color', color: '#000000' }, 'x'), effects });
const now = gradeAt(gradeOf(gradeEffect(clip)), 0);
if (now.steps.length !== 1 || now.steps[0]?.kind !== 'serial') throw new Error('expected one node');
const node = now.steps[0].node;
writeFileSync(
  `${process.argv[2]}/migfix.json`,
  JSON.stringify({ legacy, curve: Array.from(curvesImage(set)), node: nodeUniforms(node), nodeCurve: Array.from(curvesImage(node.curves as CurveSet)) }),
);
console.log('migration fixture written');
