import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/core/easing.ts'
s=open(p).read()
s+='''
/** How far a segment goes (a number's change, or a point's distance). */
export function segmentChange(a: Keyframe<Value>, b: Keyframe<Value>): number {
  if (typeof a.v === 'number') return (b.v as number) - a.v;
  const bv = b.v as Vec2;
  return Math.hypot(bv[0] - a.v[0], bv[1] - a.v[1]);
}

/**
 * A segment's easing as speeds and influences (After Effects' Keyframe
 * Velocity): leaving and arriving speed in units per second, influence in
 * percent of the segment's time.
 */
export function toVelocity(a: Keyframe<Value>, b: Keyframe<Value>): { outSpeed: number; outInfluence: number; inSpeed: number; inInfluence: number } {
  const dt = Math.max(1e-6, b.t - a.t);
  const rate = segmentChange(a, b) / dt;
  const o = a.o ?? LINEAR_OUT;
  const i = b.i ?? LINEAR_IN;
  const ox = Math.max(1e-6, o[0]);
  const ix = Math.max(1e-6, 1 - i[0]);
  const lin = o[0] === 0 && o[1] === 0;
  const linIn = i[0] === 1 && i[1] === 1;
  return {
    outSpeed: lin ? rate : (o[1] / ox) * rate,
    outInfluence: lin ? 0 : o[0] * 100,
    inSpeed: linIn ? rate : ((1 - i[1]) / ix) * rate,
    inInfluence: linIn ? 0 : (1 - i[0]) * 100,
  };
}

/** The bezier handles for speeds and influences (see toVelocity); influences are kept in 0.1–100 %. */
export function fromVelocity(a: Keyframe<Value>, b: Keyframe<Value>, v: { outSpeed: number; outInfluence: number; inSpeed: number; inInfluence: number }): { o: Vec2; i: Vec2 } {
  const dt = Math.max(1e-6, b.t - a.t);
  const change = segmentChange(a, b);
  const k = Math.abs(change) < 1e-9 ? 0 : dt / change;
  const ox = Math.min(1, Math.max(0.001, v.outInfluence / 100));
  const ix = Math.min(1, Math.max(0.001, v.inInfluence / 100));
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { o: [r(ox), r(v.outSpeed * ox * k)], i: [r(1 - ix), r(1 - v.inSpeed * ix * k)] };
}

/** Handles from CSS ("cubic-bezier(0.4, 0, 0.2, 1)", "ease-in-out", or four numbers), or null. */
export function parseCubicBezier(text: string): { o: Vec2; i: Vec2 } | null {
  const named: Record<string, [number, number, number, number]> = {
    linear: [0, 0, 1, 1],
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  const t = text.trim().toLowerCase();
  const n = named[t] ?? (t.replace(/^cubic-bezier\\(|\\)$/g, '').split(/[\\s,]+/).filter(Boolean).map(Number) as number[]);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x)) || n[0]! < 0 || n[0]! > 1 || n[2]! < 0 || n[2]! > 1) return null;
  return { o: [n[0]!, n[1]!], i: [n[2]!, n[3]!] };
}
'''
open(p,'w').write(s)

p='titler/src/designer/GraphEditor.tsx'
rep(p,"import { EASES, isAnimated, valueAt } from '../core/easing';","import { EASES, fromVelocity, isAnimated, parseCubicBezier, toVelocity, valueAt } from '../core/easing';\nimport { NumberField } from './fields';")
rep(p,"""          <div className="tt-dim tt-small">
            cubic-bezier({o[0]}, {o[1]}, {iH[0]}, {iH[1]})
          </div>""","""          {!a.hold && <Velocity a={a} b={b} unit={pi.unit} onChange={(h) => setHandles(h.o, h.i)} />}
          <label className="tt-css-ease">
            <span className="tt-dim tt-small">CSS</span>
            <input
              key={`${o.join()}|${iH.join()}`}
              className="tt-input"
              aria-label="Easing as CSS cubic-bezier"
              defaultValue={`cubic-bezier(${o[0]}, ${o[1]}, ${iH[0]}, ${iH[1]})`}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              onBlur={(e) => {
                const h = parseCubicBezier(e.target.value);
                if (h) setHandles(h.o, h.i);
                else e.target.value = `cubic-bezier(${o[0]}, ${o[1]}, ${iH[0]}, ${iH[1]})`;
              }}
            />
          </label>""")
s=open(p).read()
s+='''
/** Speeds and influences of the segment (After Effects' Keyframe Velocity), typed in. */
function Velocity({ a, b, unit, onChange }: { a: Keyframe<Value>; b: Keyframe<Value>; unit?: string; onChange: (h: { o: Vec2; i: Vec2 }) => void }) {
  const v = toVelocity(a, b);
  const r = (n: number) => Math.round(n * 100) / 100;
  const set = (patch: Partial<typeof v>) => onChange(fromVelocity(a, b, { ...v, ...patch }));
  const speed = `${unit ?? 'units'}/s`;
  return (
    <div className="tt-velocity" aria-label="Keyframe velocity">
      <span className="tt-dim tt-small">Leaving</span>
      <NumberField label="Leaving speed" value={r(v.outSpeed)} unit={speed} onChange={(n) => set({ outSpeed: n, outInfluence: v.outInfluence || 33.33 })} />
      <NumberField label="Leaving influence" value={r(v.outInfluence)} unit="%" min={0.1} max={100} onChange={(n) => set({ outInfluence: n })} />
      <span className="tt-dim tt-small">Arriving</span>
      <NumberField label="Arriving speed" value={r(v.inSpeed)} unit={speed} onChange={(n) => set({ inSpeed: n, inInfluence: v.inInfluence || 33.33 })} />
      <NumberField label="Arriving influence" value={r(v.inInfluence)} unit="%" min={0.1} max={100} onChange={(n) => set({ inInfluence: n })} />
    </div>
  );
}
'''
open(p,'w').write(s)
s=open('titler/src/designer/designer.css').read()
s+='''.tt-velocity {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  align-items: center;
  gap: 4px 6px;
  margin-top: 6px;
}
.tt-velocity > span {
  grid-column: 1;
}
.tt-css-ease {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.tt-css-ease .tt-input {
  flex: 1;
  font-family: var(--tt-mono);
  font-size: 11px;
}
'''
open('titler/src/designer/designer.css','w').write(s)
