/** The event file Lumora writes next to a recording (`<name>.lumora`). */
export interface EventFile {
  app: 'Lumora';
  version: 1;
  name: string;
  /** When the recording started (ms since 1970). */
  startedAt: number;
  durationMs: number | null;
  /** The Live Screen recording (it may have become an .mp4 when it finished). */
  program: { path: string | null; mp4: string | null };
  files: EventMedia[];
  /** What was on air when (ms after the start). */
  cuts: { at: number; id: string | null; name: string }[];
}

export interface EventMedia {
  kind: 'camera' | 'microphone';
  sourceId: string;
  name: string;
  path: string;
  startMs: number;
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

/** Read an event file, or say plainly why it can't be used. */
export function parseEvent(text: string): EventFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Lumora event file (it could not be read).');
  }
  if (!raw || typeof raw !== 'object' || (raw as { app?: unknown }).app !== 'Lumora') {
    throw new Error('This file is not a Lumora event file.');
  }
  const r = raw as Record<string, unknown>;
  if (num(r.version, 1) > 1) throw new Error('This event file is from a newer Lumora. Update Lumora Studio (Help → Check for updates).');
  const program = (r.program && typeof r.program === 'object' ? r.program : {}) as Record<string, unknown>;
  const files = Array.isArray(r.files) ? r.files : [];
  const cuts = Array.isArray(r.cuts) ? r.cuts : [];
  return {
    app: 'Lumora',
    version: 1,
    name: str(r.name, 'Event'),
    startedAt: num(r.startedAt, 0),
    durationMs: typeof r.durationMs === 'number' && Number.isFinite(r.durationMs) ? r.durationMs : null,
    program: {
      path: typeof program.path === 'string' ? program.path : null,
      mp4: typeof program.mp4 === 'string' ? program.mp4 : null,
    },
    files: files
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as { path?: unknown }).path === 'string')
      .map((f) => ({
        kind: f.kind === 'microphone' ? 'microphone' : 'camera',
        sourceId: str(f.sourceId),
        name: str(f.name, 'Camera'),
        path: str(f.path),
        startMs: Math.max(0, num(f.startMs)),
      })),
    cuts: cuts
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({ at: Math.max(0, num(c.at)), id: typeof c.id === 'string' ? c.id : null, name: str(c.name) }))
      .sort((a, b) => a.at - b.at),
  };
}
