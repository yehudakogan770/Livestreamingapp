// The library: things made for one event, kept on this computer for later
// ones. An item holds an input, a preset or a run of show; using it adds a
// copy to the event open now (links to inputs that aren't there are left out).

import type { Action } from './types/Action';
import type { Cue } from './types/Cue';
import type { NewSource } from './types/NewSource';
import type { Preset } from './types/Preset';
import type { Show } from './types/Show';
import type { Source } from './types/Source';
import type { SourceKind } from './types/SourceKind';
import type { Step } from './types/Step';

interface Base {
  id: string;
  name: string;
  category: string;
  /** When it was saved (ms since 1970). */
  savedAt: number;
}

export type LibraryItem = (Base & { type: 'input'; source: NewSource }) | (Base & { type: 'preset'; preset: Preset }) | (Base & { type: 'cues'; cues: Cue[] });

const newId = () => `lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const KIND_NAMES: Record<string, string> = {
  camera: 'Camera',
  video: 'Video',
  image: 'Picture',
  color: 'Color',
  pattern: 'Test pattern',
  countdown: 'Countdown',
  pesukim: '12 Pesukim',
  text: 'Text',
  credits: 'Credits',
  split: 'Split screen',
  slideshow: 'Slideshow',
  microphone: 'Microphone',
};

export function describeItem(it: LibraryItem): string {
  if (it.type === 'preset') return `Preset · ${it.preset.buttons.length} buttons`;
  if (it.type === 'cues') return `Run of show · ${it.cues.length} cues`;
  return KIND_NAMES[it.source.kind.type] ?? 'Input';
}

export function inputItem(src: Source, category: string, name = src.name): LibraryItem {
  const { id: _id, ...rest } = src;
  return { id: newId(), name, category, savedAt: Date.now(), type: 'input', source: structuredClone({ ...rest, name }) };
}

export function presetItem(p: Preset, category: string): LibraryItem {
  return { id: newId(), name: p.name, category, savedAt: Date.now(), type: 'preset', preset: structuredClone(p) };
}

export function cuesItem(cues: Cue[], name: string, category: string): LibraryItem {
  return { id: newId(), name, category, savedAt: Date.now(), type: 'cues', cues: structuredClone(cues) };
}

/** A kind with links to inputs that aren't in this event left out. */
function cleanKind(kind: SourceKind, has: (id: string) => boolean): SourceKind {
  const k = structuredClone(kind);
  if (k.type === 'pesukim' && k.look.behind && !has(k.look.behind)) k.look.behind = null;
  if (k.type === 'split') for (const b of k.boxes) if (b.sourceId && !has(b.sourceId)) b.sourceId = null;
  if (k.type === 'slideshow') {
    k.slides = k.slides.filter((s) => s.type === 'image' || has(s.sourceId));
    if (k.behind && !has(k.behind)) k.behind = null;
    k.current = 0;
  }
  if (k.type === 'countdown') Object.assign(k.timer, { endsAt: null, remainingMs: k.timer.lengthMs, fired: false });
  if (k.type === 'credits') Object.assign(k, { playing: false, posMs: 0, at: 0 });
  return k;
}

/** Steps whose inputs and presets are all in this event. */
function cleanSteps(steps: Step[], show: Show): Step[] {
  const has = (id: string | null | undefined) => !id || show.sources.some((s) => s.id === id);
  return steps.filter((st) => {
    if ('sourceId' in st && !has(st.sourceId)) return false;
    if (st.type === 'preset' && !show.presets.some((p) => p.id === st.presetId)) return false;
    return true;
  });
}

/** What to do to add an item to this event. */
export function useItemActions(it: LibraryItem, show: Show): Action[] {
  const has = (id: string) => show.sources.some((s) => s.id === id);
  switch (it.type) {
    case 'input':
      return [{ type: 'addSource', source: { ...it.source, id: undefined, kind: cleanKind(it.source.kind, has) } }];
    case 'preset':
      return [
        {
          type: 'addPreset',
          preset: {
            ...structuredClone(it.preset),
            id: '',
            sources: it.preset.sources.filter(has),
            buttons: it.preset.buttons.map((b) => ({ ...b, steps: cleanSteps(b.steps, show) })),
          },
        },
      ];
    case 'cues': {
      const stamp = Date.now().toString(36);
      const added = it.cues.map((c, i) => ({ ...structuredClone(c), id: `cue-${stamp}-${i}`, steps: cleanSteps(c.steps, show) }));
      return [{ type: 'setCues', cues: [...show.run.cues, ...added] }];
    }
  }
}
