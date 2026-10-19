import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad/py')
from rep import apply

apply('streamdeck/src/show.ts', [
("""  /** Countdown, camera, video… */
  kind: string;
}""", """  /** Countdown, camera, video… */
  kind: string;
  /** Its sound level, 0 – 1, and whether it is muted. */
  volume: number;
  muted: boolean;
}

/** A sound level and its mute (the Stream mix, mix A, mix B). */
export interface DeckLevel {
  volume: number;
  muted: boolean;
}"""),
("""export interface DeckScreen {
  program: string | null;
  preview: string | null;
  blank: boolean;
}""", """export interface DeckScreen {
  program: string | null;
  preview: string | null;
  blank: boolean;
  /** The manual fader (T-bar), 0 – 1. */
  tbar: number;
}"""),
("""  run: DeckRun;
  app: AppState;
}""", """  run: DeckRun;
  app: AppState;
  /** The Stream mix (master) and mixes A and B. */
  audio: { master: DeckLevel; a: DeckLevel; b: DeckLevel };
}"""),
("""  return { program: str(s.program), preview: str(s.preview), blank: s.blank === true };""",
"""  return { program: str(s.program), preview: str(s.preview), blank: s.blank === true, tbar: clamp01(num(s.tbar) ?? 0) };"""),
("""const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);""",
"""const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
function level(v: unknown, volume: unknown = obj(v).volume): DeckLevel {
  return { volume: clamp01(num(volume) ?? 1), muted: obj(v).muted === true };
}"""),
("""    name: str(x.name) ?? `Input ${i + 1}`,
    kind: str(obj(x.kind).type) ?? '',
  }));""", """    name: str(x.name) ?? `Input ${i + 1}`,
    kind: str(obj(x.kind).type) ?? '',
    volume: clamp01(num(x.volume) ?? 1),
    muted: x.muted === true,
  }));"""),
("""    run: { cues: cues.length, current, running: run.running === true, next: nextCue ? (str(nextCue.name) ?? null) : null },
    app,
  };""", """    run: { cues: cues.length, current, running: run.running === true, next: nextCue ? (str(nextCue.name) ?? null) : null },
    app,
    audio: {
      master: { volume: clamp01(num(s.masterVolume) ?? 1), muted: obj(s.audio).masterMuted === true },
      a: level(obj(s.audio).a),
      b: level(obj(s.audio).b),
    },
  };"""),
])
