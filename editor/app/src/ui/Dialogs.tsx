import { useEffect, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { addSequence, duration, updateSequence } from '../model/build';
import { captionCues, captionTracks, toSrt, toVtt, withoutCaptions } from '../model/captions';
import { current, rate, seqLength } from '../model/seq';
import { FRAME_RATES } from '../model/types';
import { selectedIds, useDoc, type Doc } from '../doc';
import { Exporter, suggestedMbps, type ExportState } from '../export/exporter';
import type { SoundFormat } from '../export/audioplan';
import { baseName, folderOf, inApp, joinPath, native } from '../native';
import type { Actions } from './actions';
import { Choice, Modal } from './controls';
import type { Ui } from './state';

const SIZES: [string, number, number][] = [
  ['HD 1920×1080', 1920, 1080],
  ['4K 3840×2160', 3840, 2160],
  ['720p 1280×720', 1280, 720],
  ['Vertical 1080×1920', 1080, 1920],
  ['Square 1080×1080', 1080, 1080],
  ['Wide 2560×1080', 2560, 1080],
];

export function SequenceDialog({ doc, ui, fresh }: { doc: Doc; ui: Ui; fresh: boolean }) {
  const s = current(doc.project);
  const [name, setName] = useState(fresh ? `Sequence ${doc.project.sequences.length + 1}` : s.name);
  const [w, setW] = useState(fresh ? 1920 : s.width);
  const [h, setH] = useState(fresh ? 1080 : s.height);
  const [fps, setFps] = useState<number>(fresh ? 30 : s.fps);
  const [bg, setBg] = useState(fresh ? '#000000' : s.background);
  const close = () => ui.set({ dialog: null });
  return (
    <Modal title={fresh ? 'New sequence' : 'Sequence settings'} onClose={close}>
      <div className="form">
        <label className="form__row">
          <span>Name</span>
          <input className="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <div className="form__row">
          <span>Picture</span>
          <div className="form__chips">
            {SIZES.map(([label, sw, sh]) => (
              <button key={label} type="button" className={`fchip${w === sw && h === sh ? ' is-on' : ''}`} onClick={() => (setW(sw), setH(sh))}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="form__row">
          <span>Size</span>
          <span className="form__pair">
            <input
              className="text text--num"
              type="number"
              min={64}
              max={8192}
              step={2}
              value={w}
              aria-label="Width"
              onChange={(e) => setW(Number(e.target.value))}
            />
            ×
            <input
              className="text text--num"
              type="number"
              min={64}
              max={8192}
              step={2}
              value={h}
              aria-label="Height"
              onChange={(e) => setH(Number(e.target.value))}
            />
          </span>
        </div>
        <div className="form__row">
          <span>Frames a second</span>
          <select className="text" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            {FRAME_RATES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <label className="form__row">
          <span>Background</span>
          <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} aria-label="Background color" />
        </label>
        <div className="form__foot">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              const even = (n: number) => Math.max(64, Math.round(n / 2) * 2);
              if (fresh) doc.edit((p) => updateSequence(addSequence(p, name || 'Sequence', even(w), even(h), fps), { background: bg }), 'New sequence');
              else doc.edit((p) => updateSequence(p, { name: name || s.name, width: even(w), height: even(h), fps, background: bg }), 'Sequence settings');
              close();
            }}
          >
            {fresh ? 'Make it' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function SpeedDialog({ doc, ui, actions }: { doc: Doc; ui: Ui; actions: Actions }) {
  const { project, selection } = useDoc(doc);
  const s = current(project);
  const fps = rate(s);
  const ids = selectedIds(selection);
  const c = s.clips.find((x) => ids.includes(x.id));
  const [pct, setPct] = useState(Math.round((c?.speed ?? 1) * 100));
  const [rev, setRev] = useState(c?.reverse ?? false);
  const [ripple, setRipple] = useState(true);
  const close = () => ui.set({ dialog: null });
  if (!c)
    return (
      <Modal title="Speed / duration" onClose={close}>
        <p>Select a clip first.</p>
      </Modal>
    );
  const newLen = Math.round((c.length * c.speed * 100) / Math.max(1, pct));
  return (
    <Modal title="Speed / duration" onClose={close}>
      <div className="form">
        <label className="form__row">
          <span>Speed</span>
          <span className="form__pair">
            <input
              className="text text--num"
              type="number"
              min={5}
              max={2000}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              onKeyDown={(e) => e.stopPropagation()}
            />
            %
          </span>
        </label>
        <div className="form__row">
          <span>Length</span>
          <span>
            {duration(newLen / fps)} ({(newLen / fps).toFixed(2)} s)
          </span>
        </div>
        <label className="check">
          <input type="checkbox" checked={rev} onChange={(e) => setRev(e.target.checked)} /> Play backwards
        </label>
        <label className="check">
          <input type="checkbox" checked={ripple} onChange={(e) => setRipple(e.target.checked)} /> Move what follows (ripple)
        </label>
        <div className="form__foot">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              actions.speed(c.id, Math.max(0.05, pct / 100), ripple, rev);
              close();
            }}
          >
            OK
          </button>
        </div>
      </div>
    </Modal>
  );
}

const PRESETS: { id: string; name: string; height: number | 'seq'; quality: 'high' | 'good' | 'small'; note: string }[] = [
  { id: 'match', name: 'Same as the sequence', height: 'seq', quality: 'high', note: 'H.264 MP4, the sequence size' },
  { id: 'lumora', name: 'For showing in Lumora', height: 1080, quality: 'high', note: 'Plays smoothly live. Can go straight into Lumora’s library.' },
  { id: 'youtube', name: 'YouTube / Facebook 1080p', height: 1080, quality: 'good', note: 'Even loudness for the web' },
  { id: 'youtube4k', name: 'YouTube 4K', height: 2160, quality: 'good', note: 'For 4K sequences' },
  { id: 'small', name: 'Small (to send or share)', height: 720, quality: 'small', note: 'Smaller file, 720p' },
];

export function ExportDialog({ doc, ui }: { doc: Doc; ui: Ui }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const fps = rate(s);
  const total = seqLength(s);
  const marked = s.inPoint !== null || s.outPoint !== null;
  const [preset, setPreset] = useState(PRESETS[0]?.id ?? 'match');
  const [what, setWhat] = useState<'all' | 'marked'>(marked ? 'marked' : 'all');
  const [kind, setKind] = useState<'video' | SoundFormat>('video');
  const [height, setHeight] = useState(s.height);
  const [quality, setQuality] = useState<'high' | 'good' | 'small'>('high');
  const [loudness, setLoudness] = useState(false);
  const [toLumora, setToLumora] = useState(false);
  const hasCaptions = captionTracks(s).some((t) => s.clips.some((c) => c.track === t.id));
  const [burn, setBurn] = useState(true);
  const [sidecar, setSidecar] = useState(false);
  const folder = project.eventPath ? folderOf(project.eventPath) : '';
  const [out, setOut] = useState(joinPath(folder || (inApp() ? '' : 'C:/Users/You/Videos'), `${project.name || 'Film'} (edited).mp4`));
  const [state, setState] = useState<ExportState | null>(null);
  const job = useRef<Exporter | null>(null);
  const busy = state?.stage === 'picture' || state?.stage === 'sound';
  const close = () => {
    if (busy) return;
    ui.set({ dialog: null });
  };

  useEffect(() => {
    const p = PRESETS.find((x) => x.id === preset);
    if (!p) return;
    setHeight(p.height === 'seq' ? s.height : p.height);
    setQuality(p.quality);
    setLoudness(p.id === 'youtube' || p.id === 'youtube4k');
    setToLumora(p.id === 'lumora');
  }, [preset, s.height]);

  useEffect(() => {
    const ext = kind === 'video' ? 'mp4' : kind === 'aac' ? 'm4a' : kind;
    setOut((o) => o.replace(/\.[a-z0-9]+$/i, `.${ext}`));
  }, [kind]);

  const range = what === 'marked' && marked ? { from: s.inPoint ?? 0, to: s.outPoint ?? total } : { from: 0, to: total };
  const seconds = (range.to - range.from) / fps;
  const mbps = suggestedMbps(height, s.fps, quality);
  const mb = kind === 'video' ? Math.round(((mbps + 0.256) * seconds) / 8) : Math.round((0.256 * seconds) / 8);

  const start = async () => {
    let target = out;
    if (inApp() && (!folder || !/[\\/]/.test(out))) {
      const picked = await save({
        title: 'Save the film',
        defaultPath: out,
        filters: [{ name: kind === 'video' ? 'Video' : 'Sound', extensions: [out.split('.').pop() ?? 'mp4'] }],
      });
      if (!picked) return;
      target = picked;
      setOut(picked);
    }
    const film = hasCaptions && !burn ? withoutCaptions(doc.project) : doc.project;
    // Caption files next to the film, timed from where the export starts.
    const cues = hasCaptions && sidecar ? captionCues(s, undefined, range) : [];
    const ex = new Exporter(film, { height, mbps, sound: kind === 'video' ? null : kind, range, loudness, out: target }, (st) => {
      setState(st);
      if (st.stage === 'done' && st.path && cues.length) {
        const base = st.path.replace(/\.[^.\\/]+$/, '');
        void Promise.all([native.writeText(`${base}.srt`, toSrt(cues)), native.writeText(`${base}.vtt`, toVtt(cues))]).catch((e: unknown) =>
          setState({ ...st, message: `The film is ready, but the caption files weren't saved: ${e instanceof Error ? e.message : String(e)}` }),
        );
      }
      if (st.stage === 'done' && st.path && toLumora && kind === 'video') {
        void native
          .sendToLumora(st.path, baseName(st.path), seconds)
          .then(() => setState({ ...st, message: 'The film is ready, and it is in Lumora’s library (From Lumora Edit).' }))
          .catch((e: unknown) => setState({ ...st, message: `The film is ready. ${e instanceof Error ? e.message : String(e)}` }));
      }
    });
    job.current = ex;
    setState({ stage: 'picture', done: 0, message: 'Starting…', left: null, path: null });
    await ex.run();
    if (!inApp() && ex.lastBuffer) {
      const url = URL.createObjectURL(new Blob([ex.lastBuffer]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'film-picture.webm';
      a.click();
    }
  };

  return (
    <Modal title="Export" onClose={close} wide>
      {!state || state.stage === 'error' || state.stage === 'stopped' ? (
        <div className="form">
          <div className="form__row">
            <span>Preset</span>
            <div className="form__chips">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className={`fchip${preset === p.id ? ' is-on' : ''}`} title={p.note} onClick={() => setPreset(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="form__row">
            <span>What</span>
            <Choice
              value={what}
              options={[
                ['all', `The whole sequence · ${duration(total / fps)}`],
                ['marked', marked ? `In to out · ${duration(((s.outPoint ?? total) - (s.inPoint ?? 0)) / fps)}` : 'In to out (mark them first)'],
              ]}
              onChange={(v) => marked && setWhat(v)}
              label="What to export"
            />
          </div>
          <div className="form__row">
            <span>Make</span>
            <Choice
              value={kind}
              options={[
                ['video', 'Video (.mp4)'],
                ['aac', 'Sound (.m4a)'],
                ['mp3', 'Sound (.mp3)'],
                ['wav', 'Sound (.wav)'],
              ]}
              onChange={setKind}
              label="Make"
            />
          </div>
          {kind === 'video' && (
            <>
              <div className="form__row">
                <span>Size</span>
                <Choice
                  value={height}
                  options={[...new Set([s.height, 2160, 1440, 1080, 720].filter((x) => x <= Math.max(2160, s.height)))]
                    .sort((a, b) => b - a)
                    .map(
                      (x) => [x, x === s.height ? `${s.width}×${s.height} (same)` : `${Math.round((x * s.width) / s.height / 2) * 2}×${x}`] as [number, string],
                    )}
                  onChange={setHeight}
                  label="Size"
                />
              </div>
              <div className="form__row">
                <span>Quality</span>
                <Choice
                  value={quality}
                  options={[
                    ['high', 'Best'],
                    ['good', 'Very good'],
                    ['small', 'Smaller file'],
                  ]}
                  onChange={setQuality}
                  label="Quality"
                />
              </div>
            </>
          )}
          <label className="check form__check">
            <input type="checkbox" checked={loudness} onChange={(e) => setLoudness(e.target.checked)} /> Even out the loudness (right for YouTube and Facebook)
          </label>
          {kind === 'video' && (
            <label className="check form__check">
              <input type="checkbox" checked={toLumora} onChange={(e) => setToLumora(e.target.checked)} /> Put it in Lumora’s library, ready to show live
            </label>
          )}
          {hasCaptions && kind === 'video' && (
            <label className="check form__check">
              <input type="checkbox" checked={burn} onChange={(e) => setBurn(e.target.checked)} /> Burn the captions into the picture
            </label>
          )}
          {hasCaptions && (
            <label className="check form__check">
              <input type="checkbox" checked={sidecar} onChange={(e) => setSidecar(e.target.checked)} /> Also save the captions as .srt and .vtt files next to
              it
            </label>
          )}
          <label className="form__row">
            <span>Save as</span>
            <input className="text" value={out} onChange={(e) => setOut(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          {state?.stage === 'error' && <p className="form__problem">{state.message}</p>}
          <div className="form__foot">
            <span className="form__est">
              {duration(seconds)} · about {mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.max(1, mb)} MB`}
            </span>
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={seconds <= 0} onClick={() => void start()}>
              Export
            </button>
          </div>
        </div>
      ) : (
        <div className="expo">
          <p className="expo__msg">{state.message}</p>
          <div className="expo__bar">
            <i style={{ width: `${Math.round(state.done * 100)}%` }} />
          </div>
          <p className="expo__left">
            {Math.round(state.done * 100)}%{state.left !== null && busy ? ` · about ${duration(state.left)} left` : ''}
          </p>
          {busy && (
            <div className="form__foot">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  job.current?.stop();
                  void native.exportCancel().catch(() => {});
                }}
              >
                Stop
              </button>
            </div>
          )}
          {state.stage === 'done' && (
            <div className="form__foot">
              {state.path && inApp() && (
                <button type="button" className="btn" onClick={() => state.path && void native.reveal(state.path)}>
                  Show in folder
                </button>
              )}
              <button type="button" className="btn btn--primary" onClick={() => ui.set({ dialog: null })}>
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const KEYS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['J  K  L', 'Play back · stop · play (press again: faster)'],
  ['← →', 'One frame back / on (Shift: five)'],
  ['↑ ↓', 'Previous / next cut'],
  ['Home  End', 'Start / end'],
  ['I  O', 'Mark in / out (X: mark the clip)'],
  ['Shift+I  Shift+O', 'Go to in / out'],
  ['Ctrl+K', 'Cut at the playhead (Ctrl+Shift+K: every track)'],
  ['Q  W', 'Trim the start / end to the playhead and close up'],
  ['Delete  Shift+Delete', 'Clear (leave the gap) / ripple delete'],
  [";  '", 'Lift / extract the marked part'],
  [',  .', 'Insert / overwrite from the source monitor'],
  ['Alt+← Alt+→', 'Nudge the selected clips a frame'],
  ['Ctrl+C  Ctrl+X  Ctrl+V', 'Copy · cut · paste (Ctrl+Shift+V: insert)'],
  ['Ctrl+Alt+V', 'Paste effects and settings'],
  ['Ctrl+D  Ctrl+Shift+D', 'Video / sound transition at the playhead'],
  ['Ctrl+L', 'Link / unlink picture and sound'],
  ['Shift+E', 'Enable / disable clip'],
  ['Ctrl+R', 'Speed / duration'],
  ['M', 'Add a marker (Shift+M: next marker)'],
  ['V B N C Y U H T', 'Tools: select, ripple, roll, razor, slip, slide, hand, type'],
  ['S', 'Snapping on / off'],
  ['=  -  \\', 'Zoom in / out / see everything'],
  ['1 – 9', 'Cut to camera (multicam)'],
  ['Ctrl+Z  Ctrl+Shift+Z', 'Undo / redo'],
  ['Ctrl+I', 'Import'],
  ['Ctrl+M', 'Export'],
  ['Ctrl+T', 'Add text'],
  ['Shift+1 2 3', 'Edit · Color · Audio page'],
];

export function HelpDialog({ ui }: { ui: Ui }) {
  return (
    <Modal title="Keyboard" onClose={() => ui.set({ dialog: null })} wide>
      <dl className="help__keys">
        {KEYS.map(([k, d]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{d}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
