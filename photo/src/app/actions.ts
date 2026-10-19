// Actions: recorded lists of commands, kept on this computer, played back on
// the current document or on many files (File ▸ Automate ▸ Batch).

import { run, startRecording, stopRecording, type Action } from './commands';
import { toast } from './state';

const KEY = 'lumora.photo.actions';

const DEFAULTS: Action[] = [
  {
    name: 'Web Sharpen',
    steps: [{ id: 'filter.apply', arg: { id: 'unsharpMask', params: { amount: 60, radius: 0.8, threshold: 2 } }, label: 'Unsharp Mask', enabled: true }],
  },
  {
    name: 'Black and White',
    steps: [{ id: 'layer.adj.blackWhite', label: 'Black & White', enabled: true }],
  },
  {
    name: 'Auto Tone and Contrast',
    steps: [
      { id: 'image.autoTone', label: 'Auto Tone', enabled: true },
      { id: 'image.autoContrast', label: 'Auto Contrast', enabled: true },
    ],
  },
  {
    name: 'Flatten and Square Crop',
    steps: [
      { id: 'layer.flatten', label: 'Flatten Image', enabled: true },
      { id: 'image.squareCrop', label: 'Square Crop', enabled: true },
    ],
  },
];

let actions: Action[] = load();
const listeners = new Set<() => void>();

function load(): Action[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Action[];
  } catch {
    /* defaults */
  }
  return structuredClone(DEFAULTS);
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(actions));
  } catch {
    /* kept for this visit */
  }
  for (const f of listeners) f();
}

export const getActions = () => actions;
export function onActions(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

export function setActions(list: Action[]): void {
  actions = list;
  save();
}

let recordingIndex: number | null = null;
export const recordingAction = () => recordingIndex;

export function record(index: number): void {
  const a = actions[index];
  if (!a) return;
  recordingIndex = index;
  startRecording(a, save);
  save();
}

export function stop(): void {
  stopRecording();
  recordingIndex = null;
  save();
}

export async function play(index: number, stepIndex?: number): Promise<void> {
  const a = actions[index];
  if (!a) return;
  const steps = stepIndex === undefined ? a.steps : a.steps.slice(stepIndex, stepIndex + 1);
  for (const st of steps) {
    if (!st.enabled) continue;
    try {
      await run(st.id, st.arg === undefined ? undefined : structuredClone(st.arg));
    } catch (e) {
      toast(`“${a.name}” stopped at ${st.label}: ${e instanceof Error ? e.message : String(e)}`, 'error');
      return;
    }
  }
}
