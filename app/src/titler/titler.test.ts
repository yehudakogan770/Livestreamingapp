// A Titler graphic in Lumora: added as an input, put over the Live Screen
// (IN plays), held, taken off (OUT plays, then it is gone), with its fields
// filled by the operator and by the scoreboard.

import { beforeAll, describe, expect, it } from 'vitest';
import { demoApply } from '../engine/demo';
import { emptyShow } from '../engine/client';
import { overlayActions, overlayShowing } from '../engine/overlays';
import { overlayPlanes } from '../engine/overlayPlanes';
import { defaultBrand } from '../engine/brand';
import { defaultScoreboard } from '../engine/score';
import type { Show } from '../engine/types/Show';
import { fromTemplate, starterTemplates } from '../../../titler/src/core/templates';
import { brandTokens, boundValues, projectOf, titlerKind, titlerOutMs, valuesOf } from './titlerSource';
import { TitlerPainter } from './drawTitler';
import { canvas, env, pixels, preload, registerTestFont } from '../../../titler/src/test/nodeCanvas';

const tpl = (name: string) => fromTemplate(starterTemplates().find((t) => t.name === name)!);

function withTitler(name: string): { show: Show; id: string } {
  let s = emptyShow();
  s = demoApply(s, { type: 'addSource', source: { id: 'lt', name, kind: titlerKind(tpl(name)) } }, 0);
  return { show: s, id: 'lt' };
}

/** How much of the picture is drawn (share of pixels not see-through). */
function coverage(show: Show, now: number): number {
  const c = canvas(480, 270);
  const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  const painter = new TitlerPainter((p) => p);
  (painter as unknown as { env: unknown }).env = env;
  const src = show.sources.find((x) => x.id === 'lt')!;
  const o = show.overlays.find((x) => x.sourceId === 'lt');
  if (!o || !overlayShowing(o, now) || src.kind.type !== 'titler') return 0;
  painter.paint(ctx, src, src.kind, show, now, 480, 270, { on: o.on, changedAt: o.changedAt }, o.changedAt);
  const px = pixels(c);
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]! > 8) n++;
  return n / (px.length / 4);
}

beforeAll(async () => {
  registerTestFont();
  for (const t of starterTemplates()) await preload(t);
});

describe('a Titler graphic in Lumora', () => {
  it('is added as an input carrying its template', () => {
    const { show } = withTitler('Name and role');
    const src = show.sources.find((s) => s.id === 'lt')!;
    expect(src.kind.type).toBe('titler');
    expect(projectOf(src.kind as never)!.name).toBe('Name and role');
  });

  it('goes over the screen with a cut channel that stays on for its OUT', () => {
    const { show, id } = withTitler('Name and role');
    const acts = overlayActions(show, id, 'live', true);
    const patch = acts.find((a) => a.type === 'updateOverlay');
    expect(patch).toMatchObject({ patch: { animIn: 'cut', animOut: 'cut', animMs: titlerOutMs(show.sources.find((s) => s.id === id)) } });
    expect(titlerOutMs(show.sources.find((s) => s.id === id))).toBe(600);
  });

  it('plays IN when taken, holds, plays OUT when taken off, then is gone (frames checked)', () => {
    let { show, id } = withTitler('Name and role');
    const t0 = 100_000;
    for (const a of overlayActions(show, id, 'live', true)) show = demoApply(show, a, t0);
    const ch = show.overlays.findIndex((o) => o.sourceId === id);
    expect(show.overlays[ch]!.on).toBe(true);
    // The plane the unified engine's overlay renderer draws, with the channel's state.
    const planes = overlayPlanes(show, 'live', t0 + 500, 1920, 1080);
    expect(planes.find((p) => p.name === `g:${id}`)).toMatchObject({ kind: 'channel', on: true });
    const start = coverage(show, t0 + 1);
    const mid = coverage(show, t0 + 300);
    const hold = coverage(show, t0 + 3000);
    expect(start).toBeLessThan(0.002);
    expect(mid).toBeGreaterThan(start);
    expect(hold).toBeGreaterThan(mid);
    expect(hold).toBeGreaterThan(0.02);
    // Taken off: the OUT plays for 0.6 s, then nothing.
    const t1 = t0 + 10_000;
    show = demoApply(show, { type: 'setOverlayOn', channel: ch, value: false }, t1);
    const outMid = coverage(show, t1 + 300);
    expect(outMid).toBeGreaterThan(0);
    expect(outMid).toBeLessThan(hold);
    expect(coverage(show, t1 + 700)).toBe(0);
  });

  it('the operator changes fields live; bound fields come from the scoreboard', () => {
    let { show, id } = withTitler('Scoreboard bug');
    show = demoApply(show, { type: 'addSource', source: { id: 'sb', name: 'Score', kind: { type: 'scoreboard', ...defaultScoreboard() } } }, 0);
    show = demoApply(show, { type: 'score', id: 'sb', side: 'home', delta: 4 }, 0);
    show = demoApply(show, { type: 'setTitlerValues', id, values: [{ key: 'team_home', value: 'NYC' }] }, 0);
    const src = show.sources.find((s) => s.id === id)!;
    const k = src.kind as Extract<typeof src.kind, { type: 'titler' }>;
    const p = projectOf(k)!;
    const { values, bound } = valuesOf(p, k, show, 0);
    expect(values.score_home).toBe('4');
    expect(bound.score_home).toBe('4');
    // Bound wins over what was typed for a bound field; typed fields stay.
    expect(values.team_home).toBe(show.sources.find((s) => s.id === 'sb')!.kind.type === 'scoreboard' ? 'HOM' : '');
    show = demoApply(show, { type: 'setTitlerValues', id, values: [{ key: 'period', value: 'OT' }] }, 0);
    expect((show.sources.find((s) => s.id === id)!.kind as typeof k).values.map((v) => v.key)).toEqual(['team_home', 'period']);
  });

  it('takes the event look as brand tokens', () => {
    const b = { ...defaultBrand(), accent: '#ffcc00', font: 'Georgia', subFont: '' };
    const t = brandTokens(b);
    expect(t).toMatchObject({ accent: '#ffcc00', font: 'Georgia', fontSub: 'Georgia', accentText: '#111111' });
    const bv = boundValues(withTitler('Clock and place').show, { scoreboard: null }, Date.UTC(2026, 0, 1, 15, 4));
    expect(bv['clock:time']).toMatch(/\d{1,2}:04/);
  });
});
