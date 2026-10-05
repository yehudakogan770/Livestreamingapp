import { useSyncExternalStore } from 'react';

export type Tool = 'select' | 'ripple' | 'roll' | 'razor' | 'slip' | 'slide' | 'hand' | 'text';
export type Page = 'edit' | 'color' | 'audio';

export interface Source {
  media: string;
  /** Seconds. */
  time: number;
  in: number | null;
  out: number | null;
}

export interface UiState {
  page: Page;
  tool: Tool;
  snapping: boolean;
  /** Clicking a clip selects its linked sound (or picture) too. */
  linked: boolean;
  /** Pixels per frame on the timeline. */
  zoom: number;
  /** What the source monitor shows. */
  source: Source | null;
  /** Source monitor or the camera wall. */
  sourceTab: 'source' | 'cameras';
  quality: 1 | 0.5 | 0.25;
  /** Panel sizes (pixels). */
  left: number;
  right: number;
  bottom: number;
  /** Tracks that Insert and Overwrite put things on (the first video and audio track when empty). */
  targetVideo: string | null;
  targetAudio: string | null;
  scope: 'waveform' | 'parade' | 'vectorscope' | 'histogram';
  safeMargins: boolean;
  /** The grade node chosen on the Color page, and whether the viewer shows its matte. */
  gradeNode: string | null;
  showMatte: boolean;
  dialog: null | 'export' | 'sequence' | 'newSequence' | 'help' | 'speed' | 'marker' | 'project' | 'share' | 'history' | 'transcribe';
  /** A short message at the bottom (what just happened). */
  note: string;
}

const KEY = 'lumora-edit-ui';

function saved(): Partial<UiState> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<UiState>;
    return typeof v === 'object' && v ? v : {};
  } catch {
    return {};
  }
}

export class Ui {
  state: UiState;
  private listeners = new Set<() => void>();
  private noteTimer = 0;

  constructor() {
    const s = saved();
    this.state = {
      page: 'edit',
      tool: 'select',
      snapping: s.snapping ?? true,
      linked: s.linked ?? true,
      zoom: 2,
      source: null,
      sourceTab: 'source',
      quality: s.quality ?? 1,
      left: s.left ?? 330,
      right: s.right ?? 330,
      bottom: s.bottom ?? 330,
      targetVideo: null,
      targetAudio: null,
      scope: s.scope ?? 'waveform',
      safeMargins: false,
      gradeNode: null,
      showMatte: false,
      dialog: null,
      note: '',
    };
  }

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };

  set(change: Partial<UiState>) {
    this.state = { ...this.state, ...change };
    for (const f of this.listeners) f();
    try {
      const { snapping, linked, quality, left, right, bottom, scope } = this.state;
      localStorage.setItem(KEY, JSON.stringify({ snapping, linked, quality, left, right, bottom, scope }));
    } catch {
      // Not kept: fine.
    }
  }

  note(text: string) {
    this.set({ note: text });
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => this.set({ note: '' }), 3500);
  }
}

export function useUi(ui: Ui): UiState {
  return useSyncExternalStore(ui.subscribe, () => ui.state);
}
