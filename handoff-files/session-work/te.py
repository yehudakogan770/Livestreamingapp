root='/home/user/Livestreamingapp/.claude/worktrees/agent-aa01ea85ebaf42c39/app/src/testevent/'
def edit(name, pairs):
    p=root+name
    s=open(p).read()
    for a,b in pairs:
        assert a in s, (name, a)
        s=s.replace(a,b,1)
    open(p,'w').write(s)

edit('runner.ts', [
("""export function neededMBps(s: Pick<CaptureSettings, 'videoKbps' | 'audioKbps' | 'iso'>, cameras: number): number {
  const main = (s.videoKbps + s.audioKbps) / 8 / 1000;
  return main * (1 + (s.iso ? cameras * 0.8 : 0));
}""","""export function neededMBps(s: Pick<CaptureSettings, 'videoKbps' | 'audioKbps' | 'iso' | 'isoKbps'>, cameras: number): number {
  const main = (s.videoKbps + s.audioKbps) / 8 / 1000;
  const camera = s.isoKbps ? s.isoKbps / 8 / 1000 : main * 0.8;
  return main + (s.iso ? cameras * camera : 0);
}"""),
("""  let recStartedAt = 0;""","""  let recStartedAt = 0;
  // Which encoders did the work (the report says, since a graphics card can't be checked from here).
  const encoders: NonNullable<Measured['encoders']> = { recording: null, stream: null, vertical: null, hardware: [], failed: [] };
  const noteEncoders = () => {
    const st = deps.broadcast()?.status;
    if (!st) return;
    encoders.recording = st.recording?.encoder ?? encoders.recording;
    encoders.stream = st.streaming?.encoder ?? encoders.stream;
    encoders.vertical = st.vertical?.encoder ?? encoders.vertical;
    encoders.hardware = st.hwEncoders ?? encoders.hardware;
    encoders.failed = st.hwFailed ?? encoders.failed;
  };"""),
("""        recStartedAt = Date.now();""","""        recStartedAt = Date.now();
        noteEncoders();"""),
("""        firstSession = Math.min(firstSession, st.session);""","""        firstSession = Math.min(firstSession, st.session);
        noteEncoders();"""),
("""    captureFailures,
    restored: session.restored,""","""    captureFailures,
    encoders: (noteEncoders(), encoders),
    restored: session.restored,"""),
])
edit('verdict.ts', [("""  captureFailures: string[];
  /** The person's show came back exactly. */""","""  captureFailures: string[];
  /** The video encoders that did the work, and the graphics-card encoders found (and failed). */
  encoders?: { recording: string | null; stream: string | null; vertical: string | null; hardware: string[]; failed: string[] };
  /** The person's show came back exactly. */""")])
edit('report.ts', [
("""        ['Recording drive', `${n(st.diskMBps, ' MB/s')} (needs ${n(Math.round(m.neededMBps * 10) / 10, ' MB/s')})`],
      ],""","""        ['Recording drive', `${n(st.diskMBps, ' MB/s')} (needs ${n(Math.round(m.neededMBps * 10) / 10, ' MB/s')})`],
        ...encoderRows(m.encoders),
      ],"""),
("""  chapters: boolean;
  destinations: string[];
}""","""  chapters: boolean;
  destinations: string[];
  /** Encoder choice, speed/quality, stream picture, recordings encoded again. */
  encoder?: string;
  preset?: string;
  streamQuality?: string | null;
  recordEncode?: boolean;
}"""),
("""          ['Chapters', s.chapters ? 'on' : 'off'],""","""          ['Chapters', s.chapters ? 'on' : 'off'],
          ...(s.encoder
            ? [
                ['Encoder', `${s.encoder}${s.preset ? `, ${s.preset}` : ''}`],
                ['Stream picture', s.streamQuality ?? 'same as the recording'],
                ['Recordings encoded again', s.recordEncode ? 'yes' : 'no (saved as the app encodes them)'],
              ]
            : []),"""),
("""export function buildMarkdown(d: ReportData): string {""","""/** The encoders in use, for the at-a-glance table. */
export function encoderRows(e: Measured['encoders']): string[][] {
  if (!e) return [];
  const rows = [
    ['Graphics-card encoders found', e.hardware.length ? e.hardware.join(', ') : 'none (the processor encodes)'],
    ['Recording encoder', e.recording ?? '–'],
    ['Stream encoder', e.stream ?? '–'],
  ];
  if (e.vertical) rows.push(['Vertical stream encoder', e.vertical]);
  if (e.failed.length) rows.push(['Graphics-card encoder failed (fell back to the processor)', e.failed.join(', ')]);
  return rows;
}

export function buildMarkdown(d: ReportData): string {"""),
])
edit('TestEvent.tsx', [("""                destinations: s.destinations.filter((d) => d.enabled).map((d) => d.name),""","""                destinations: s.destinations.filter((d) => d.enabled).map((d) => d.name),
                encoder: s.encoder ?? 'auto',
                preset: s.preset ?? 'balanced',
                streamQuality: s.streamQuality ?? null,
                recordEncode: s.recordEncode ?? false,""")])
