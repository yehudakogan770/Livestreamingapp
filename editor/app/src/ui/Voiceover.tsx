// Sequence > Record a voiceover: choose the microphone, watch its level, and
// record from the playhead while the film plays (a short count-in first).
// The take is placed on the Voiceover track where it started; one Undo.
import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { timecode } from '../model/build';
import { current, rate } from '../model/seq';
import { useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { placeVoiceover, saveTake, takeName, Take } from '../player/voiceover';
import { importFiles } from './importer';
import { Modal } from './controls';
import type { Ui } from './state';

type Stage = 'ready' | 'counting' | 'recording' | 'saving';

const COUNT_IN = 3;

export function VoiceoverDialog({ doc, engine, ui, onClose }: { doc: Doc; engine: Engine; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const fps = rate(s);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [mic, setMic] = useState<string>('');
  const [take, setTake] = useState<Take | null>(null);
  const [level, setLevel] = useState(-90);
  const [stage, setStage] = useState<Stage>('ready');
  const [count, setCount] = useState(COUNT_IN);
  const [problem, setProblem] = useState('');
  const [play, setPlay] = useState(true);
  const started = useRef<{ frame: number; at: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // The microphone (again when another is chosen), and its level.
  useEffect(() => {
    let live = true;
    let opened: Take | null = null;
    setProblem('');
    Take.open(mic || null)
      .then(async (t) => {
        if (!live) return t.close();
        opened = t;
        setTake(t);
        const list = await Take.microphones();
        if (live) setMics(list);
      })
      .catch((e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      opened?.close();
      setTake(null);
    };
  }, [mic]);
  useEffect(() => {
    if (!take) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      setLevel(take.level());
      if (started.current) setElapsed((performance.now() - started.current.at) / 1000);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [take]);

  const begin = () => {
    if (!take) return;
    setStage('counting');
    setCount(COUNT_IN);
    let n = COUNT_IN;
    const id = window.setInterval(() => {
      n -= 1;
      setCount(n);
      if (n > 0) return;
      window.clearInterval(id);
      setStage('recording');
      take.start(() => {
        // The take starts where the film is the moment the first sound is kept.
        started.current = { frame: engine.time, at: performance.now() };
        if (play) engine.play();
      });
    }, 1000);
  };

  const finish = async (keep: boolean) => {
    if (!take) return;
    engine.pause();
    const at = started.current?.frame ?? engine.time;
    started.current = null;
    const blob = await take.stop();
    if (!keep || blob.size === 0) {
      setStage('ready');
      return;
    }
    setStage('saving');
    try {
      const path = await saveTake(takeName(s.name, timecode(at, fps)), blob);
      const [media] = await importFiles(doc, [path], null);
      if (!media) throw new Error('The take was saved but couldn’t be brought in. It is in Documents/Lumora/Voiceovers.');
      doc.edit((p) => placeVoiceover(p, media, at), 'Record a voiceover');
      ui.note(`Voiceover added at ${timecode(at, fps)} on the Voiceover track.`);
      onClose();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
      setStage('ready');
    }
  };

  const busy = stage === 'counting' || stage === 'recording' || stage === 'saving';
  const pct = Math.max(0, Math.min(100, ((level + 60) / 60) * 100));
  return (
    <Modal title="Record a voiceover" onClose={() => !busy && onClose()}>
      <div className="form">
        <label className="form__row">
          <span>Microphone</span>
          <select className="text" value={mic} disabled={busy} onChange={(e) => setMic(e.target.value)}>
            <option value="">The computer’s usual microphone</option>
            {mics
              .filter((m) => m.deviceId && m.deviceId !== 'default')
              .map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label || 'Microphone'}
                </option>
              ))}
          </select>
        </label>
        <div className="form__row">
          <span>Level</span>
          <span className="vo__meter" role="meter" aria-label="Microphone level" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(level)}>
            <i style={{ width: `${pct}%` }} className={level > -3 ? 'is-hot' : ''} />
          </span>
        </div>
        <div className="form__row">
          <span>Starts at</span>
          <b>{timecode(stage === 'recording' && started.current ? started.current.frame : engine.time, fps)}</b>
        </div>
        <div className="form__row">
          <span />
          <label className="check">
            <input type="checkbox" checked={play} disabled={busy} onChange={(e) => setPlay(e.target.checked)} /> Play the film while recording (use headphones)
          </label>
        </div>
        {stage === 'counting' && <p className="vo__big">{count}</p>}
        {stage === 'recording' && (
          <p className="vo__rec">
            <i aria-hidden="true" />
            Recording {elapsed.toFixed(1)} s
          </p>
        )}
        {stage === 'saving' && <p className="insp__note">Saving the take…</p>}
        {problem && <p className="form__problem">{problem}</p>}
        <p className="insp__note">The take goes on the Voiceover track where it started. Takes are kept in Documents/Lumora/Voiceovers.</p>
        <div className="form__foot">
          {stage === 'recording' ? (
            <>
              <button type="button" className="btn" onClick={() => void finish(false)}>
                Discard
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void finish(true)}>
                <Square />
                Stop and keep
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" disabled={busy} onClick={onClose}>
                Close
              </button>
              <button type="button" className="btn btn--primary" disabled={!take || busy} onClick={begin}>
                <Mic />
                Record
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
