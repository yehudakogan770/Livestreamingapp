import { useState } from 'react';
import { addSequence, duration, updateSequence } from '../model/build';
import { current, rate } from '../model/seq';
import { FRAME_RATES } from '../model/types';
import { selectedIds, useDoc, type Doc } from '../doc';
import type { Actions } from './actions';
import { Modal } from './controls';
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
