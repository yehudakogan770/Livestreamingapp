// Smart > Rough cut from a script: paste the script, see which lines were
// found (and in which take), and make the rough cut as a new sequence.
import { useMemo, useState } from 'react';
import { open as chooseFile } from '@tauri-apps/plugin-dialog';
import { useDoc, type Doc } from '../doc';
import { inApp, native } from '../native';
import { Choice, Modal } from '../ui/controls';
import type { Ui } from '../ui/state';
import { buildRoughCut, matchScript, scriptLines, type LineMatch } from './scriptcut';

const secs = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function ScriptDialog({ doc, ui, onClose }: { doc: Doc; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const transcribed = project.media.filter((m) => m.transcript?.words.length);
  const [script, setScript] = useState('');
  const [pad, setPad] = useState(0.2);
  const [alternates, setAlternates] = useState(true);
  const [matches, setMatches] = useState<LineMatch[] | null>(null);
  const lines = useMemo(() => scriptLines(script), [script]);
  const found = matches?.filter((m) => m.best).length ?? 0;

  const openFile = async () => {
    const picked = await chooseFile({ title: 'Open a script', filters: [{ name: 'Text', extensions: ['txt', 'md', 'fountain'] }] });
    if (typeof picked !== 'string') return;
    setScript(await native.readText(picked));
    setMatches(null);
  };

  const make = () => {
    if (!matches) return;
    let placed = 0;
    doc.edit((p) => {
      const out = buildRoughCut(p, matches, { pad, alternates, name: 'Rough cut from the script' });
      placed = out.placed;
      return out.project;
    }, 'Rough cut from a script');
    ui.note(
      `Rough cut: ${placed} of ${matches.length} lines${placed < matches.length ? ' (the others have a red marker where they would go)' : ''}.${alternates ? ' Other takes are on the hidden Alt tracks.' : ''}`,
    );
    onClose();
  };

  return (
    <Modal title="Rough cut from a script" onClose={onClose} wide>
      <div className="form">
        <label className="form__row smart__top">
          <span>Script</span>
          <textarea
            className="text smart__script"
            rows={8}
            value={script}
            placeholder="Paste the script, or what should be said in order. Each sentence or line becomes one shot."
            onChange={(e) => {
              setScript(e.target.value);
              setMatches(null);
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        {inApp() && (
          <div className="form__row">
            <span />
            <button type="button" className="linkbtn" onClick={() => void openFile()}>
              Open a text file…
            </button>
          </div>
        )}
        <div className="form__row">
          <span>Room around lines</span>
          <Choice
            value={pad}
            options={[
              [0, 'None'],
              [0.2, 'A little'],
              [0.5, 'Half a second'],
            ]}
            onChange={setPad}
            label="Room around each line"
          />
        </div>
        <div className="form__row">
          <span />
          <label className="check">
            <input type="checkbox" checked={alternates} onChange={(e) => setAlternates(e.target.checked)} /> Put the other good takes on hidden tracks above
          </label>
        </div>
        <p className="insp__note">
          Studio looks for each line in what was said in every transcribed file ({transcribed.length} now) and takes the closest take.
          {transcribed.length ? '' : ' Transcribe the recordings first (Captions > Transcribe).'}
        </p>
        {matches && (
          <ol className="smart__list">
            {matches.map((m, i) => (
              <li key={i} className={m.best ? 'is-on' : ''}>
                <span className="smart__score" title="How closely it matches">
                  {m.best ? Math.round(m.best.score * 100) : '—'}
                </span>
                <span className="smart__why" title={m.line}>
                  {m.line}
                </span>
                <small>
                  {m.best
                    ? `${project.media.find((x) => x.id === m.best?.media)?.name ?? ''} ${secs(m.best.from)}${m.others.length ? ` · ${m.others.length} more` : ''}`
                    : 'Not found'}
                </small>
              </li>
            ))}
          </ol>
        )}
        <div className="form__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={!lines.length || !transcribed.length} onClick={() => setMatches(matchScript(lines, project.media))}>
            {matches ? 'Find again' : `Find ${lines.length || ''} lines`}
          </button>
          <button type="button" className="btn btn--primary" disabled={!found} onClick={make}>
            Make the rough cut
          </button>
        </div>
      </div>
    </Modal>
  );
}
