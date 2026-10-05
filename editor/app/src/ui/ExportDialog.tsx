import { useEffect, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { makePlan, type ExportOptions } from '../model/plan';
import { layout, timecode, type Project } from '../model/project';
import { folderOf, inApp, joinPath, native, onExportProgress, type ExportProgress } from '../native';
import { titlePng } from '../titles';

type Kind = 'video' | 'mp3' | 'wav';
type Size = '720' | '1080' | '2160';
type Quality = 'best' | 'good' | 'small';

const SIZES: Record<Size, [number, number]> = { '720': [1280, 720], '1080': [1920, 1080], '2160': [3840, 2160] };
const QUALITY: Record<Quality, { crf: number; preset: ExportOptions['preset'] }> = {
  best: { crf: 18, preset: 'medium' },
  good: { crf: 21, preset: 'faster' },
  small: { crf: 25, preset: 'faster' },
};

const ext = (k: Kind) => (k === 'video' ? 'mp4' : k);

/** Making the finished film. */
export function ExportDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const total = layout(project.clips).total;
  const has4k = project.angles.some((a) => a.height >= 2000);
  const [what, setWhat] = useState<'all' | 'range'>(project.range ? 'range' : 'all');
  const [kind, setKind] = useState<Kind>('video');
  const [size, setSize] = useState<Size>('1080');
  const [quality, setQuality] = useState<Quality>('good');
  const [fps, setFps] = useState(30);
  const [loudness, setLoudness] = useState(true);
  const [out, setOut] = useState(() => joinPath(folderOf(project.eventPath), `${project.name} (edited).mp4`));
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(0);

  useEffect(() => setOut((o) => o.replace(/\.(mp4|mp3|wav)$/i, `.${ext(kind)}`)), [kind]);
  useEffect(() => onExportProgress(setProgress), []);

  const length = what === 'range' && project.range ? project.range.to - project.range.from : total;
  const running = progress !== null && !progress.finished;

  const choose = async () => {
    const picked = await save({
      title: 'Save the film as',
      defaultPath: out,
      filters: [{ name: kind === 'video' ? 'Video' : 'Sound', extensions: [ext(kind)] }],
    });
    if (picked) setOut(/\.\w+$/.test(picked) ? picked : `${picked}.${ext(kind)}`);
  };

  const start = async () => {
    setProblem(null);
    if (project.angles.some((a) => a.path === out) || project.tracks.some((t) => t.path === out)) {
      setProblem('That is one of the event recordings. Choose another name for the film.');
      return;
    }
    if (!inApp()) {
      setProblem('Films are made in the installed Lumora Edit.');
      return;
    }
    const [width, height] = SIZES[size];
    const options: ExportOptions = {
      width,
      height,
      fps,
      ...QUALITY[quality],
      loudness,
      audio: kind === 'video' ? null : kind,
      rangeOnly: what === 'range',
    };
    try {
      const plan = makePlan(project, options);
      const titles = plan.titles.map((id) => {
        const t = project.titles.find((x) => x.id === id);
        return { id, png: t ? titlePng(t, width, height) : '' };
      });
      started.current = Date.now();
      setProgress({ done: 0, part: 0, parts: plan.jobs.length + 1, finished: false, error: null, path: null });
      await native.exportStart({ ...plan, titles }, out);
    } catch (e) {
      setProgress(null);
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const left = (() => {
    if (!progress || progress.done < 0.02) return '';
    const spent = Date.now() - started.current;
    const rest = (spent / progress.done) * (1 - progress.done);
    return rest > 60_000 ? `about ${Math.round(rest / 60_000)} min left` : 'less than a minute left';
  })();

  const done = progress?.finished && !progress.error;
  const failed = progress?.finished && progress.error;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Export the film">
      <div className="modal__card exp">
        <header className="modal__head">
          <h2>Export the film</h2>
          <button type="button" className="modal__x" onClick={running ? () => void native.exportCancel() : onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {!progress || failed ? (
          <div className="modal__body exp__form">
            <div className="exp__group">
              <span className="exp__label">What</span>
              <div className="choice">
                <button type="button" className={what === 'all' ? 'is-on' : ''} onClick={() => setWhat('all')}>
                  The whole film · {timecode(total)}
                </button>
                <button
                  type="button"
                  className={what === 'range' ? 'is-on' : ''}
                  onClick={() => setWhat('range')}
                  disabled={!project.range}
                  title={project.range ? '' : 'Mark a start (I) and an end (O) first'}
                >
                  Marked part{project.range ? ` · ${timecode(project.range.to - project.range.from)}` : ''}
                </button>
              </div>
            </div>
            <div className="exp__group">
              <span className="exp__label">Make</span>
              <div className="choice">
                <button type="button" className={kind === 'video' ? 'is-on' : ''} onClick={() => setKind('video')}>
                  Video (.mp4)
                </button>
                <button type="button" className={kind === 'mp3' ? 'is-on' : ''} onClick={() => setKind('mp3')}>
                  Sound only (.mp3)
                </button>
                <button type="button" className={kind === 'wav' ? 'is-on' : ''} onClick={() => setKind('wav')}>
                  Sound (.wav)
                </button>
              </div>
            </div>
            {kind === 'video' && (
              <>
                <div className="exp__group">
                  <span className="exp__label">Size</span>
                  <div className="choice">
                    <button type="button" className={size === '720' ? 'is-on' : ''} onClick={() => setSize('720')}>
                      720p
                    </button>
                    <button type="button" className={size === '1080' ? 'is-on' : ''} onClick={() => setSize('1080')}>
                      1080p (Full HD)
                    </button>
                    <button
                      type="button"
                      className={size === '2160' ? 'is-on' : ''}
                      onClick={() => setSize('2160')}
                      disabled={!has4k}
                      title={has4k ? '' : 'The cameras were not recorded in 4K'}
                    >
                      4K
                    </button>
                  </div>
                </div>
                <div className="exp__group">
                  <span className="exp__label">Quality</span>
                  <div className="choice">
                    <button type="button" className={quality === 'best' ? 'is-on' : ''} onClick={() => setQuality('best')}>
                      Best (slower)
                    </button>
                    <button type="button" className={quality === 'good' ? 'is-on' : ''} onClick={() => setQuality('good')}>
                      Very good
                    </button>
                    <button type="button" className={quality === 'small' ? 'is-on' : ''} onClick={() => setQuality('small')}>
                      Smaller file
                    </button>
                  </div>
                </div>
                <div className="exp__group">
                  <span className="exp__label">Frames per second</span>
                  <div className="choice">
                    {[25, 30, 60].map((f) => (
                      <button key={f} type="button" className={fps === f ? 'is-on' : ''} onClick={() => setFps(f)}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <label className="check exp__check">
              <input type="checkbox" checked={loudness} onChange={(e) => setLoudness(e.target.checked)} />
              Even out the loudness (right for YouTube and Facebook)
            </label>
            <div className="exp__group">
              <span className="exp__label">Save as</span>
              <div className="exp__save">
                <input className="text" value={out} onChange={(e) => setOut(e.target.value)} />
                <button type="button" className="btn" onClick={() => void choose()}>
                  Choose…
                </button>
              </div>
            </div>
            {(problem || failed) && <p className="exp__problem">{problem ?? progress?.error}</p>}
            <div className="modal__foot">
              <span className="exp__len">{timecode(length)} of film</span>
              <span className="grow" />
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void start()} disabled={length <= 0 || !out.trim()}>
                Export
              </button>
            </div>
          </div>
        ) : done ? (
          <div className="modal__body exp__done">
            <p className="exp__big">Your film is ready.</p>
            <p className="exp__path">{progress?.path}</p>
            <div className="modal__foot">
              <span className="grow" />
              <button type="button" className="btn" onClick={() => progress?.path && void native.reveal(progress.path)}>
                Show in folder
              </button>
              <button type="button" className="btn btn--primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="modal__body exp__running">
            <p className="exp__big">Making the film… {Math.floor((progress?.done ?? 0) * 100)}%</p>
            <div className="getting__bar">
              <i style={{ width: `${(progress?.done ?? 0) * 100}%` }} />
            </div>
            <p className="exp__note">
              Part {Math.max(1, progress?.part ?? 1)} of {progress?.parts ?? 1}
              {left ? ` · ${left}` : ''}. You can leave this open; the computer must stay on.
            </p>
            <div className="modal__foot">
              <span className="grow" />
              <button type="button" className="btn" onClick={() => void native.exportCancel()}>
                Stop
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
