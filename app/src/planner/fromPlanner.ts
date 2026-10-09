// A Lumora Planner plan as Lumora cues: titles, timing and, where the plan's
// hints name something in this event (an input, an overlay, a preset, a
// transition), the steps that do it. Anything that can't be matched is listed,
// and the cue still comes in (a cue to run by hand, with no steps).

import { clock24, parseClock, segmentName, sortCues, type Plan, type PlanCue } from '../../../planner/src/model';
import type { Cue } from '../engine/types/Cue';
import type { CueTrigger } from '../engine/types/CueTrigger';
import type { Show } from '../engine/types/Show';
import type { Source } from '../engine/types/Source';
import type { Step } from '../engine/types/Step';
import type { TransitionKind } from '../engine/types/TransitionKind';

/** The most cues a run of show holds (engine MAX_CUES). */
export const MAX_CUES = 300;
const MAX_MESSAGE = 200;

export interface ConvertOptions {
  /** 'manual': every cue waits for NEXT CUE. 'planned': fixed times run on the clock, the rest after the cue before. */
  timing: 'manual' | 'planned';
  /** Add who is responsible to each cue's name ("Welcome · Rabbi Kogan"). */
  whoInName: boolean;
  /** Put each cue's notes on the Monitor when it runs. */
  notesToMonitor: boolean;
}

export const DEFAULT_OPTIONS: ConvertOptions = { timing: 'manual', whoInName: false, notesToMonitor: false };

export interface CueReport {
  title: string;
  /** What was matched, in words. */
  mapped: string[];
  /** Hints that matched nothing in this event. */
  unmapped: string[];
}

export interface Converted {
  cues: Cue[];
  report: CueReport[];
}

const TRANSITIONS: TransitionKind[] = [
  'cut',
  'fade',
  'merge',
  'dip',
  'wipe',
  'slide',
  'wipeLeft',
  'wipeDown',
  'wipeUp',
  'slideRight',
  'slideDown',
  'slideUp',
  'cover',
  'reveal',
  'split',
  'splitVertical',
  'iris',
  'diamond',
  'zoom',
  'zoomOut',
  'blur',
  'flash',
  'lumaClock',
  'lumaCircle',
  'lumaBlinds',
  'lumaDiagonal',
  'lumaSparkle',
  'lumaHeart',
  'stinger1',
  'stinger2',
];

/** Names compared loosely: case, spaces and punctuation don't matter. */
export const loose = (s: string): string => s.toLowerCase().replace(/[^a-z0-9֐-׿]+/g, '');

/** "Fade", "wipe left", "Stinger 1", "dissolve" → a transition, or null. */
export function matchTransition(hint: string): TransitionKind | null {
  const k = loose(hint);
  if (!k) return null;
  if (k === 'dissolve' || k === 'mix' || k === 'crossfade') return 'fade';
  if (k === 'hardcut' || k === 'take') return 'cut';
  if (k === 'stinger') return 'stinger1';
  return TRANSITIONS.find((t) => loose(t) === k) ?? null;
}

export function matchSource(sources: readonly Source[], hint: string): Source | null {
  const k = loose(hint);
  if (!k) return null;
  return sources.find((s) => loose(s.name) === k) ?? null;
}

type Event = Pick<Show, 'sources' | 'overlays' | 'presets'>;

/** An overlay channel whose input has this name, or a preset with this name. */
function matchOverlay(show: Event, hint: string): { step: Step; words: string } | null {
  const k = loose(hint);
  if (!k) return null;
  const n = /^(?:overlay|ovl|channel|ch)(\d{1,2})$/.exec(k);
  if (n) {
    const ch = Number(n[1]) - 1;
    if (ch >= 0 && ch < show.overlays.length) return { step: { type: 'overlay', channel: ch, value: true }, words: `Overlay ${ch + 1} on` };
  }
  const ch = show.overlays.findIndex((o) => {
    const src = show.sources.find((s) => s.id === o.sourceId);
    return src !== undefined && loose(src.name) === k;
  });
  if (ch >= 0) return { step: { type: 'overlay', channel: ch, value: true }, words: `Overlay ${ch + 1} on (${hint.trim()})` };
  const preset = show.presets.find((p) => loose(p.name) === k);
  if (preset) return { step: { type: 'preset', presetId: preset.id }, words: `Preset “${preset.name}”` };
  return null;
}

/** The steps for one planned cue, and what was and wasn't matched. */
export function cueSteps(c: PlanCue, show: Event, opts: ConvertOptions): { steps: Step[]; mapped: string[]; unmapped: string[] } {
  const steps: Step[] = [];
  const mapped: string[] = [];
  const unmapped: string[] = [];
  const transition = c.transition.trim() ? matchTransition(c.transition) : null;
  if (c.transition.trim() && !transition) unmapped.push(`transition “${c.transition.trim()}”`);

  let src = c.input.trim() ? matchSource(show.sources, c.input) : null;
  if (c.input.trim() && !src) unmapped.push(`input “${c.input.trim()}”`);

  // A countdown with no input named: the event's (first) countdown.
  if (c.segment === 'countdown' && !src && !c.input.trim()) src = show.sources.find((s) => s.kind.type === 'countdown') ?? null;

  if (c.segment === 'countdown' && src?.kind.type === 'countdown' && c.durationSec) {
    steps.push({ type: 'setCountdownLength', sourceId: src.id, lengthMs: c.durationSec * 1000 });
    mapped.push(`countdown set to ${Math.round(c.durationSec / 60)} min`);
  }
  if (src) {
    if (transition && transition !== 'cut') {
      steps.push({ type: 'preview', screen: 'live', sourceId: src.id }, { type: 'take', screen: 'live', transition });
      mapped.push(`${src.name} on Live (${transition})`);
    } else {
      steps.push({ type: 'cutTo', screen: 'live', sourceId: src.id });
      mapped.push(`${src.name} on Live`);
    }
    if (src.kind.type === 'video' && (c.segment === 'video' || c.segment === 'custom')) {
      steps.push({ type: 'play', sourceId: src.id });
      mapped.push(`play ${src.name}`);
    }
    if (src.kind.type === 'countdown' && c.segment === 'countdown') {
      steps.push({ type: 'startCountdown', sourceId: src.id });
      mapped.push('start the countdown');
    }
  } else if (transition && c.input.trim() === '') {
    // A transition alone: take whatever is in Next.
    steps.push({ type: 'take', screen: 'live', transition });
    mapped.push(`TAKE (${transition})`);
  }

  if (c.overlay.trim()) {
    const o = matchOverlay(show, c.overlay);
    if (o) {
      steps.push(o.step);
      mapped.push(o.words);
    } else unmapped.push(`overlay “${c.overlay.trim()}”`);
  }

  if (opts.notesToMonitor && c.notes.trim()) {
    const text = c.notes.trim().replace(/\s+/g, ' ').slice(0, MAX_MESSAGE);
    steps.push({ type: 'monitorMessage', text });
    mapped.push('notes on the Monitor');
  }
  return { steps, mapped, unmapped };
}

const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The plan's cues (in order) as Lumora cues. */
export function planToCues(plan: Pick<Plan, 'startTime'>, planned: readonly PlanCue[], show: Event, opts: ConvertOptions = DEFAULT_OPTIONS): Converted {
  const sorted = sortCues(planned).slice(0, MAX_CUES);
  const cues: Cue[] = [];
  const report: CueReport[] = [];
  sorted.forEach((c, i) => {
    const title = c.title.trim() || segmentName(c.segment);
    const name = short(opts.whoInName && c.who.trim() ? `${title} · ${c.who.trim()}` : title, 80);
    let trigger: CueTrigger = { type: 'manual' };
    if (opts.timing === 'planned') {
      const fixed = parseClock(c.startTime);
      const first = i === 0 ? parseClock(plan.startTime) : null;
      if (fixed !== null) trigger = { type: 'clock', time: clock24(fixed) };
      else if (first !== null) trigger = { type: 'clock', time: clock24(first) };
      else if (i > 0 && sorted[i - 1]!.durationSec) trigger = { type: 'afterPrevious' };
    }
    const { steps, mapped, unmapped } = cueSteps(c, show, opts);
    const len = c.durationSec ? Math.min(Math.max(c.durationSec, 1), 24 * 3600) * 1000 : null;
    cues.push({ id: `planner-${c.id}`, section: short(c.section.trim(), 60), name, trigger, lengthMs: len, steps });
    report.push({ title: name, mapped, unmapped });
  });
  return { cues, report };
}

/**
 * The plan's scripts as one prompter script, in cue order: each cue's name in
 * capitals, then what is said. Floated cues and cues with no script are left out.
 */
export function planScript(planned: readonly PlanCue[]): string {
  return sortCues(planned)
    .filter((c) => !c.skip && c.script.trim())
    .map((c) => `${(c.title.trim() || segmentName(c.segment)).toUpperCase()}\n\n${c.script.trim()}`)
    .join('\n\n\n')
    .slice(0, 100_000);
}

/** Put the converted cues in: instead of the current ones, or after them (at most MAX_CUES in all). */
export function combine(current: readonly Cue[], incoming: readonly Cue[], mode: 'replace' | 'append'): Cue[] {
  if (mode === 'replace') return incoming.slice(0, MAX_CUES);
  const have = new Set(current.map((c) => c.id));
  // Loading the same plan twice: the second copy gets fresh ids.
  const fresh = incoming.map((c, i) => (have.has(c.id) ? { ...c, id: `${c.id}-${Date.now().toString(36)}-${i}` } : c));
  return [...current, ...fresh].slice(0, MAX_CUES);
}
