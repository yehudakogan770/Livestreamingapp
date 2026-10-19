W='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/'
def edit(path, pairs):
    p=W+path
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (path, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('app/src/testevent/verdict.ts', [
("""  /** The person's show came back exactly. */
  restored: boolean | null;
  stopped: boolean;
}""","""  /** The person's show came back exactly. */
  restored: boolean | null;
  stopped: boolean;
  /** The unified engine's own numbers (when it drew the screens and recorded). */
  engine?: EngineMeasured | null;
}"""),
])
s=open(W+'app/src/testevent/verdict.ts').read()
first_import = s.index('import ')
s = s[:first_import] + "import type { EngineMeasured } from './engineReport';\n" + s[first_import:]
open(W+'app/src/testevent/verdict.ts','w').write(s)

edit('app/src/testevent/report.ts', [
("""        ...encoderRows(m.encoders),
      ],""","""        ...encoderRows(m.encoders),
        ...engineRows(m.engine),
      ],"""),
])
s=open(W+'app/src/testevent/report.ts').read()
first_import = s.index('import ')
s = s[:first_import] + "import { engineRows } from './engineReport';\n" + s[first_import:]
open(W+'app/src/testevent/report.ts','w').write(s)

edit('app/src/testevent/runner.ts', [
("""import { PROBE_EVENT, PROBE_RESULT, type ProbeAnswer } from './outputProbe';""","""import { PROBE_EVENT, PROBE_RESULT, type ProbeAnswer } from './outputProbe';
import { refreshEngineInfo, unifiedOn } from '../engine/unified';
import { noteEngine, type EngineMeasured } from './engineReport';"""),
("""  // ----- measuring, about once a second -----
  let sampling = true;""","""  // ----- measuring, about once a second -----
  let sampling = true;
  // The unified engine's own numbers, when it draws and records.
  let engine: EngineMeasured | null = null;"""),
("""        const perf = await client.perfStats().catch((): PerfStats | null => null);""","""        const perf = await client.perfStats().catch((): PerfStats | null => null);
        if (unifiedOn()) {
          const info = await refreshEngineInfo().catch(() => null);
          if (info?.stats) engine = noteEngine(engine, info.stats);
        }"""),
("""        const answers = await probeOutputs(2000);""","""        const answers = await probeOutputs(2000);
        // The unified engine's screens are its own windows: it answers for them.
        if (unifiedOn())
          for (const o of ['live', 'back'] as const) {
            if (answers.some((a) => a.output === o)) continue;
            const p = await call<{ fps: number; inSync: boolean | null; black: boolean | null; overlays: boolean | null; width: number; height: number } | null>(
              'live_engine_probe',
              { screen: o },
            ).catch(() => null);
            if (p) answers.push({ id: 0, output: o, fps: p.fps, inSync: p.inSync, black: p.black, overlays: p.overlays, tally: null, width: p.width, height: p.height });
          }"""),
("""    encoders: (noteEncoders(), encoders),""","""    encoders: (noteEncoders(), encoders),
    engine,"""),
])
