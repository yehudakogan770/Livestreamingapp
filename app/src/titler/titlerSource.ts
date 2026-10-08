// Lumora's side of Lumora Titler graphics: reading the template an input
// carries, filling its fields (typed by the operator, or from the event's
// scoreboard, countdown, clock and data file), and the event look as brand
// tokens. Used by every window that draws the graphic.

import { readableOn } from '../../../titler/src/core/binding';
import { cueTime, outMs } from '../../../titler/src/core/timeline';
import { readProject } from '../../../titler/src/core/validate';
import type { BrandTokens, TitleProject, Values } from '../../../titler/src/core/types';
import { dataValues } from '../engine/data';
import { mainCountdown, timerOf } from '../engine/countdowns';
import { clockShown, formatGameClock } from '../engine/score';
import { countdownRemaining, formatCountdown } from '../engine/timing';
import type { Brand } from '../engine/types/Brand';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { TitlerGraphic } from '../engine/types/TitlerGraphic';

const cache = new Map<string, TitleProject | null>();

/** The project an input carries (read once per template text). */
export function projectOf(t: Pick<TitlerGraphic, 'template'>): TitleProject | null {
  const hit = cache.get(t.template);
  if (hit !== undefined) return hit;
  let p: TitleProject | null = null;
  try {
    p = t.template ? readProject(JSON.parse(t.template)).project : null;
  } catch {
    p = null;
  }
  if (cache.size > 40) cache.clear();
  cache.set(t.template, p);
  return p;
}

/** A new Titler input's kind from a project (its sample values are the starting values). */
export function titlerKind(p: TitleProject, keepValues: TitlerGraphic['values'] = []): { type: 'titler' } & TitlerGraphic {
  return { type: 'titler', template: JSON.stringify(p), values: keepValues.filter((v) => p.variables.some((x) => x.key === v.key)), scoreboard: null };
}

/** The event look as Titler brand tokens. */
export function brandTokens(b: Brand | undefined): Partial<BrandTokens> {
  if (!b) return {};
  const hex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);
  return {
    font: b.font,
    fontSub: b.subFont || b.font,
    text: b.textColor,
    textSub: b.subColor || b.textColor,
    accent: b.accent,
    accentText: hex(b.accent) ? readableOn(b.accent) : '#ffffff',
    box: b.boxColor,
    boxAlt: hex(b.boxColor) ? shade(b.boxColor, 0.12) : b.boxColor,
  };
}

/** A color a little lighter (positive) or darker. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(Math.min(255, Math.max(0, v + (amount > 0 ? (255 - v) * amount : v * amount))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Values Lumora fills by itself, for every binding a template can ask for. */
export function boundValues(show: Show | null, t: Pick<TitlerGraphic, 'scoreboard'>, now: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (!show) return out;
  const sbSrc = (t.scoreboard ? show.sources.find((s) => s.id === t.scoreboard) : undefined) ?? show.sources.find((s) => s.kind.type === 'scoreboard');
  if (sbSrc?.kind.type === 'scoreboard') {
    const sb = sbSrc.kind;
    Object.assign(out, {
      'score:home': String(sb.home.score),
      'score:away': String(sb.away.score),
      'score:homeName': sb.home.name,
      'score:awayName': sb.away.name,
      'score:homeShort': sb.home.short,
      'score:awayShort': sb.away.short,
      'score:homeColor': sb.home.color,
      'score:awayColor': sb.away.color,
      'score:clock': formatGameClock(clockShown(sb.clock, now), sb.clock.countDown),
      'score:period': sb.period,
      'score:title': sb.title,
    });
  }
  const cd = timerOf(show, mainCountdown(show));
  if (cd) out.countdown = formatCountdown(countdownRemaining(cd, now), cd.format);
  const d = new Date(now);
  out['clock:time'] = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  out['clock:date'] = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  out['event:name'] = show.event.name;
  for (const [k, v] of Object.entries(dataValues(show.data))) out[`data:${k}`] = v;
  return out;
}

/** A show-like view of a window's Stage (what screen windows know of the show), for filling fields. */
export function showFromStage(
  stage: { event: Show['event']; sources?: Source[]; screens?: Show['screens']; data?: Record<string, string> } | null,
): Show | null {
  if (!stage) return null;
  const headers = Object.keys(stage.data ?? {});
  return {
    event: stage.event,
    sources: stage.sources ?? [],
    screens:
      stage.screens ??
      ({
        live: { program: null, preview: null },
        back: { program: null, preview: null },
        monitor: { program: null, preview: null },
      } as unknown as Show['screens']),
    data: { path: '', everyMs: 0, headers, rows: [headers.map((h) => stage.data![h]!)], row: 0, error: '', updatedAt: 0 },
  } as unknown as Show;
}

/** Is any field of this graphic filled from something that changes by itself (a clock)? */
export function ticks(p: TitleProject): boolean {
  return p.variables.some((v) => v.bind === 'score:clock' || v.bind === 'countdown' || v.bind === 'clock:time');
}

/**
 * The values to draw with: the sample values, then the operator's, then
 * Lumora's own (scoreboard, countdown, clock, data file) for bound fields.
 */
export function valuesOf(
  p: TitleProject,
  t: Pick<TitlerGraphic, 'values' | 'scoreboard'>,
  show: Show | null,
  now: number,
): { values: Values; bound: Record<string, string> } {
  const values: Values = {};
  for (const v of p.variables) values[v.key] = v.value;
  for (const v of t.values) values[v.key] = v.value;
  const all = boundValues(show, t, now);
  const bound: Record<string, string> = {};
  for (const v of p.variables) {
    if (!v.bind) continue;
    const got = all[v.bind];
    if (got !== undefined) {
      values[v.key] = got;
      bound[v.key] = got;
    }
  }
  return { values, bound };
}

/** How long the graphic's OUT takes (an overlay stays on that long after it is taken off). */
export function titlerOutMs(src: Source | undefined): number {
  if (src?.kind.type !== 'titler') return 0;
  const p = projectOf(src.kind);
  const c = p?.compositions.find((x) => x.id === p.main);
  return c ? Math.min(5000, outMs(c)) : 0;
}

/** Where on its timeline the graphic is, from when its overlay came on or went off. */
export function cueAt(p: TitleProject, on: boolean, changedAt: number, inAt: number, now: number) {
  const c = p.compositions.find((x) => x.id === p.main) ?? p.compositions[0]!;
  if (on) return { ...cueTime(c, (now - changedAt) / 1000, null), clock: (now - changedAt) / 1000 };
  return { ...cueTime(c, Math.max(0, (changedAt - inAt) / 1000), (now - changedAt) / 1000), clock: (now - inAt) / 1000 };
}
