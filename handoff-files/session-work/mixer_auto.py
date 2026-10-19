import sys
root = sys.argv[1]
p = root + '/editor/app/src/ui/Mixer.tsx'
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:60]
    s = s.replace(a, b, 1)


rep("""          <div className="estrip__body">
            <Meter engine={engine} id={t.id} />
            <input
              className="estrip__fader"
              type="range"
              min={-60}
              max={12}
              step={0.5}
              value={t.volume}
              aria-label={`${t.name} volume`}
              onChange={(e) => doc.edit((p) => updateTrack(p, t.id, { volume: Number(e.target.value) }), 'Track volume', `vol-${t.id}`)}
              onDoubleClick={() => doc.edit((p) => updateTrack(p, t.id, { volume: 0 }), 'Track volume')}
            />
          </div>
          <span className="estrip__db">{dbText(t.volume)}</span>""", """          <TrackFader doc={doc} engine={engine} track={t} writing={writing.has(t.id)} />""")
rep("""              <Headphones />
            </button>
          </div>
        </div>
      ))}""", """              <Headphones />
            </button>
            <button
              type="button"
              className={`th__btn estrip__write${writing.has(t.id) ? ' is-on' : ''}`}
              aria-pressed={writing.has(t.id)}
              title="Record fader moves: while the film plays, moving this fader records it (the moves play back after)"
              aria-label="Record fader moves"
              onClick={() => {
                const next = new Set(writing);
                if (next.has(t.id)) next.delete(t.id);
                else next.add(t.id);
                setWriting(next);
              }}
            >
              <PenLine />
            </button>
          </div>
        </div>
      ))}""")
rep("""  const [chosen, setChosen] = useState<string | null>(null);""", """  const [chosen, setChosen] = useState<string | null>(null);
  const [writing, setWriting] = useState<Set<string>>(new Set());""")
rep("import { AudioLines, Headphones, Plus, Sigma, Trash2, Volume2, VolumeX, Waypoints } from 'lucide-react';",
    "import { AudioLines, Headphones, PenLine, Plus, Sigma, Trash2, Volume2, VolumeX, Waypoints } from 'lucide-react';")
rep("""  toggleFx,
  updateBus,""", """  toggleFx,
  trimLine,
  updateBus,
  volumeAt,
  writeLine,""")
rep("import type { Effect, Sequence, TrackRole } from '../model/types';", "import type { Effect, Sequence, Track, TrackRole } from '../model/types';")
rep("import { Scrub, Section } from './controls';", "import { Scrub, Section } from './controls';\nimport { usePlayhead, usePlaying } from './hooks';")
rep("""      {id === MASTER &&""", """      {track?.volumeLine?.length ? (
        <div className="insp__row">
          <span className="field__label">Fader moves</span>
          <small className="insp__note">{track.volumeLine.length} points recorded</small>
          <button type="button" className="btn btn--sm" onClick={() => doc.edit((p) => updateTrack(p, track.id, { volumeLine: undefined }), 'Clear fader moves')}>
            Clear
          </button>
        </div>
      ) : null}
      {id === MASTER &&""")
s += '''
/**
 * A track's fader. With recorded moves it follows them as the film plays;
 * moving it then moves the whole line up or down. With Record on, moving it
 * while the film plays records the moves (replacing what was there for that
 * stretch) when it is let go.
 */
function TrackFader({ doc, engine, track: t, writing }: { doc: Doc; engine: Engine; track: Track; writing: boolean }) {
  const frame = usePlayhead(engine);
  const playing = usePlaying(engine);
  const take = useRef<[number, number][] | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const line = t.volumeLine;
  const shown = held ?? (line?.length ? volumeAt(t, frame) : t.volume);
  const release = () => {
    const recorded = take.current;
    take.current = null;
    setHeld(null);
    engine.touchVolume(t.id, null);
    if (recorded && recorded.length > 1) doc.edit((p) => updateTrack(p, t.id, { volumeLine: writeLine(t.volumeLine, recorded, t.volume) }), 'Record fader moves');
  };
  return (
    <>
      <div className="estrip__body">
        <Meter engine={engine} id={t.id} />
        <input
          className={`estrip__fader${line?.length ? ' is-auto' : ''}`}
          type="range"
          min={-60}
          max={12}
          step={0.5}
          value={shown}
          aria-label={`${t.name} volume`}
          onPointerDown={() => {
            if (writing && playing) take.current = [[Math.round(engine.time), shown]];
          }}
          onPointerUp={release}
          onLostPointerCapture={release}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (take.current) {
              take.current.push([Math.round(engine.time), v]);
              setHeld(v);
              engine.touchVolume(t.id, v);
            } else if (line?.length) doc.edit((p) => updateTrack(p, t.id, { volumeLine: trimLine(line, v - shown) }), 'Move fader moves', `trim-${t.id}`);
            else doc.edit((p) => updateTrack(p, t.id, { volume: v }), 'Track volume', `vol-${t.id}`);
          }}
          onDoubleClick={() => !line?.length && doc.edit((p) => updateTrack(p, t.id, { volume: 0 }), 'Track volume')}
        />
      </div>
      <span className="estrip__db" title={line?.length ? 'Following its recorded fader moves' : undefined}>
        {dbText(shown)}
        {line?.length ? ' ·A' : ''}
      </span>
    </>
  );
}
'''
open(p, 'w').write(s)
open(root + '/editor/app/src/editor.css', 'a').write('''.estrip__fader.is-auto {
  accent-color: var(--accent);
}
.estrip__write.is-on {
  color: var(--program-bright);
}
''')
