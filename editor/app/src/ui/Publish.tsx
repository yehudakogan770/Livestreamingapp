// Render queue > Publish to YouTube: the channel, the video's details
// (title, description with chapters, tags, category, who can see it, made for
// kids), its thumbnail and captions, and the upload with its progress. The
// upload keeps going if this window is closed; the queue shows how far it is.
import { useEffect, useState } from 'react';
import { renderQueue } from '../export/renderQueue';
import { baseName } from '../native';
import {
  CATEGORIES,
  checkDetails,
  publish,
  startingDescription,
  useUploads,
  youtube,
  type VideoDetails,
  type Visibility,
  type YoutubeInfo,
} from '../publish/youtube';
import { Choice, Modal } from './controls';
import type { Ui } from './state';

export function PublishDialog({ job, ui, onClose }: { job: string; ui: Ui; onClose: () => void }) {
  const src = renderQueue.publishSource(job);
  const uploads = useUploads();
  const up = uploads[job];
  const [info, setInfo] = useState<YoutubeInfo | null>(null);
  const [busy, setBusy] = useState<'connect' | null>(null);
  const [problem, setProblem] = useState('');
  const [d, setD] = useState<VideoDetails>(() => ({
    title: src?.title ?? '',
    description: src ? startingDescription(src.markers, src.fps, src.range) : '',
    tags: [],
    category: '22',
    visibility: 'private',
    madeForKids: false,
  }));
  const [tags, setTags] = useState('');
  const [thumb, setThumb] = useState(!!src?.thumbnail);
  const [caps, setCaps] = useState(!!src?.srt);
  const [language, setLanguage] = useState('en');

  useEffect(() => {
    let live = true;
    void youtube
      .info()
      .then((i) => live && setInfo(i))
      .catch((e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  if (!src)
    return (
      <Modal title="Publish to YouTube" onClose={onClose}>
        <p className="insp__note">Only a finished video export can be published. Export the sequence first, then publish it from the render queue.</p>
      </Modal>
    );

  const connect = async () => {
    setBusy('connect');
    setProblem('');
    try {
      setInfo(await youtube.connect());
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const details: VideoDetails = {
    ...d,
    tags: tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  };
  const bad = checkDetails(details);
  const running = up && (up.stage === 'starting' || up.stage === 'uploading' || up.stage === 'finishing');

  const start = () => {
    setProblem('');
    void publish(job, src.path, details, {
      thumbnail: thumb ? src.thumbnail : null,
      captions: caps && src.srt ? { path: src.srt, language, name: language === 'en' ? 'English' : language } : null,
    })
      .then((r) => ui.note(`Published to YouTube: ${r.url}${r.notes.length ? ` (${r.notes.join(' ')})` : ''}`))
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  };

  const pct = up && up.total ? Math.round((up.bytes / up.total) * 100) : 0;
  return (
    <Modal title="Publish to YouTube" onClose={onClose} wide>
      <div className="form">
        <div className="form__row">
          <span>Channel</span>
          {info === null ? (
            <small className="insp__note">Checking…</small>
          ) : !info.setUp ? (
            <small className="insp__note">
              Publishing to YouTube isn’t set up in this copy of Lumora Studio yet. Upload {baseName(src.path)} at studio.youtube.com.
            </small>
          ) : info.connected ? (
            <span className="form__pair">
              <b>{info.channel || 'Connected'}</b>
              <button type="button" className="linkbtn" disabled={!!running} onClick={() => void youtube.disconnect().then(setInfo)}>
                Disconnect
              </button>
            </span>
          ) : busy === 'connect' ? (
            <span className="form__pair">
              <small className="insp__note">Finish signing in in the browser…</small>
              <button type="button" className="btn btn--sm" onClick={() => void youtube.cancel()}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="btn" onClick={() => void connect()}>
              Connect a YouTube channel
            </button>
          )}
        </div>
        <label className="form__row">
          <span>Title</span>
          <input
            className="text"
            value={d.title}
            maxLength={100}
            onChange={(e) => setD({ ...d, title: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="form__row smart__top">
          <span>Description</span>
          <textarea
            className="text pub__desc"
            rows={6}
            value={d.description}
            onChange={(e) => setD({ ...d, description: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="form__row">
          <span>Tags</span>
          <input
            className="text"
            value={tags}
            placeholder="gala, awards, 2026"
            onChange={(e) => setTags(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <label className="form__row">
          <span>Category</span>
          <select className="text" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
            {CATEGORIES.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="form__row">
          <span>Who can see it</span>
          <Choice<Visibility>
            value={d.visibility}
            options={[
              ['private', 'Only me', 'Private: only you, until you change it in YouTube Studio'],
              ['unlisted', 'Anyone with the link', 'Unlisted'],
              ['public', 'Everyone', 'Public'],
            ]}
            onChange={(v) => setD({ ...d, visibility: v })}
            label="Who can see it"
          />
        </div>
        <div className="form__row">
          <span>Made for kids</span>
          <Choice
            value={d.madeForKids ? 'yes' : 'no'}
            options={[
              ['no', 'No'],
              ['yes', 'Yes', 'YouTube turns off comments and some features on videos made for kids'],
            ]}
            onChange={(v) => setD({ ...d, madeForKids: v === 'yes' })}
            label="Made for kids"
          />
        </div>
        <div className="form__row">
          <span />
          <span className="smart__checks">
            <label className="check">
              <input type="checkbox" checked={thumb} disabled={!src.thumbnail} onChange={(e) => setThumb(e.target.checked)} />{' '}
              {src.thumbnail ? `Thumbnail: ${baseName(src.thumbnail)}` : 'Thumbnail (choose one under Thumbnail when exporting)'}
            </label>
            <label className="check">
              <input type="checkbox" checked={caps} disabled={!src.srt} onChange={(e) => setCaps(e.target.checked)} />{' '}
              {src.srt ? 'Captions viewers can turn on' : 'Captions (export with a captions file to add them)'}
              {src.srt && caps && (
                <select className="text text--sm pub__lang" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Captions language">
                  {[
                    ['en', 'English'],
                    ['he', 'Hebrew'],
                    ['es', 'Spanish'],
                    ['fr', 'French'],
                    ['de', 'German'],
                    ['ru', 'Russian'],
                    ['yi', 'Yiddish'],
                  ].map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </span>
        </div>
        {up && (
          <div className="expo">
            <p className="expo__msg">
              {up.stage === 'done' && up.result ? (
                <>
                  Published.{' '}
                  <button type="button" className="linkbtn" onClick={() => up.result && void youtube.watch(up.result.id)}>
                    Watch on YouTube
                  </button>{' '}
                  <button type="button" className="linkbtn" onClick={() => up.result && void navigator.clipboard?.writeText(up.result.url)}>
                    Copy the link
                  </button>
                  {up.result.notes.length > 0 && <small> {up.result.notes.join(' ')}</small>}
                </>
              ) : up.stage === 'failed' || up.stage === 'stopped' ? (
                up.error
              ) : up.stage === 'uploading' ? (
                `Uploading… ${pct}%`
              ) : up.stage === 'finishing' ? (
                'Adding the thumbnail and captions…'
              ) : (
                'Starting the upload…'
              )}
            </p>
            {running && (
              <div className="expo__bar">
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}
        {problem && !up?.error && <p className="form__problem">{problem}</p>}
        {!problem && bad && d.title && <p className="form__problem">{bad}</p>}
        <div className="form__foot">
          <button type="button" className="btn" onClick={onClose}>
            {running ? 'Close (it keeps uploading)' : 'Close'}
          </button>
          {running ? (
            <button type="button" className="btn" onClick={() => void youtube.stop(job)}>
              Stop the upload
            </button>
          ) : (
            <button type="button" className="btn btn--primary" disabled={!info?.connected || !!bad || up?.stage === 'done'} onClick={start}>
              Publish
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
