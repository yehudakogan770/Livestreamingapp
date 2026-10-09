// Smart > Clips for social: find the strongest stand-alone moments, check
// them (play, untick), and make each one its own vertical (or square) sequence
// with captions that light up as words are said, framed on the people talking.
// Optionally every clip goes straight into the render queue.
import { useEffect, useRef, useState } from 'react';
import { open as chooseFolder } from '@tauri-apps/plugin-dialog';
import { CAPTION_LOOKS } from '../model/captions';
import { current, rate } from '../model/seq';
import type { Clip, Project, Sequence } from '../model/types';
import { useDoc, type Doc } from '../doc';
import { planDelivery } from '../export/deliver';
import { BUILT_IN } from '../export/presets';
import { renderQueue } from '../export/renderQueue';
import { inApp, joinPath } from '../native';
import type { Engine } from '../player/engine';
import { Choice, Modal } from '../ui/controls';
import { encodersHere } from '../ui/Deliver';
import type { Ui } from '../ui/state';
import { check, sequenceLevels, wordsInSeconds } from './analysis';
import { clipSize, findClips, makeClipSequence, withMotions, type SocialClip } from './clips';
import { FaceFinder } from './detect';
import { DEFAULT_KEYWORDS, scoreMoments } from './highlights';
import { Progress, useJob } from './job';
import { ASPECTS, framedClips, REFRAME_DEFAULTS, reframeMotion, sampleTimes, type Aspect } from './reframe';

const HOP = 0.25;

const LENGTHS: [string, string, number, number][] = [
  ['short', '15–30 s', 15, 30],
  ['medium', '30–60 s', 30, 60],
  ['long', '60–90 s', 60, 90],
];

const secs = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** The export preset for a clip's shape. */
function presetFor(aspect: Aspect | 'same') {
  const p = BUILT_IN.find((x) => x.id === (aspect === '9:16' ? 'shorts' : aspect === '1:1' ? 'square' : 'match')) ?? BUILT_IN[0]!;
  // Social loudness for every clip.
  return { ...p, loudness: -14 };
}

/** Camera changes on the main picture track (seconds), for the scores. */
function changesOf(s: Sequence): number[] {
  const fps = rate(s);
  const v1 = s.tracks.find((t) => t.kind === 'video' && !t.captions);
  if (!v1) return [];
  const clips = s.clips.filter((c) => c.track === v1.id).sort((a, b) => a.start - b.start);
  const key = (c: Clip) => (c.source.kind === 'multicam' ? c.source.angle : c.source.kind === 'media' ? c.source.media : c.source.kind);
  const out: number[] = [];
  for (let i = 1; i < clips.length; i++) if (key(clips[i] as Clip) !== key(clips[i - 1] as Clip)) out.push((clips[i] as Clip).start / fps);
  return out;
}

export function ClipsDialog({ doc, engine, ui, onClose }: { doc: Doc; engine: Engine; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const transcribed = project.media.some((m) => m.transcript?.words.length);
  const [count, setCount] = useState(5);
  const [length, setLength] = useState('medium');
  const [aspect, setAspect] = useState<Aspect | 'same'>('9:16');
  const [look, setLook] = useState<string>(transcribed ? 'Highlight' : '');
  const [title, setTitle] = useState(false);
  const [faces, setFaces] = useState(true);
  const [queue, setQueue] = useState(false);
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS.join(', '));
  const [found, setFound] = useState<(SocialClip & { on: boolean })[] | null>(null);
  const [seq, setSeq] = useState<Sequence | null>(null);
  const job = useJob();
  const finder = useRef<FaceFinder | null>(null);
  useEffect(() => () => finder.current?.stop(), []);
  const stale = !!seq && (seq.id !== s.id || seq.clips !== s.clips);
  const chosen = (found ?? []).filter((c) => c.on);

  const find = async () => {
    const p = doc.project;
    const sq = current(p);
    const [, , min, max] = LENGTHS.find((l) => l[0] === length) ?? LENGTHS[1]!;
    const res = await job.run(async (j) => {
      const levels = await sequenceLevels(p, sq, HOP, false, j);
      j.progress(0.95, 'Ranking the moments…');
      const fps = rate(sq);
      const inp = {
        hop: HOP,
        levels,
        words: wordsInSeconds(p, sq),
        markers: sq.markers.map((m) => ({ at: m.at / fps, name: m.name })),
        changes: changesOf(sq),
        keywords: keywords
          .split(/[,\n]/)
          .map((k) => k.trim())
          .filter(Boolean),
      };
      return findClips(inp, scoreMoments(inp), { count, min, max }, levels.length * HOP);
    });
    if (res) {
      setFound(res.map((c) => ({ ...c, on: true })));
      setSeq(sq);
    }
  };

  const make = async () => {
    if (!found || !seq) return;
    const list = chosen;
    let folder: string | null = null;
    if (queue && inApp()) {
      const picked = await chooseFolder({ directory: true, title: 'Export the clips to' });
      if (typeof picked !== 'string') return;
      folder = picked;
    }
    const source = seq;
    const f = faces && aspect !== 'same' ? new FaceFinder() : null;
    finder.current = f;
    const made = await job.run(
      async (j) => {
        let q: Project = doc.project;
        const ids: string[] = [];
        if (f) {
          j.progress(0, 'Starting the face finder…');
          await f.start();
        }
        for (const [i, c] of list.entries()) {
          check(j);
          j.progress(i / list.length, `Making clip ${i + 1} of ${list.length}…`);
          const out = makeClipSequence(q, source, c, i, { aspect, captions: look || null, title });
          q = out.project;
          ids.push(out.sequence);
          if (!f || aspect === 'same') continue;
          // Framed on the people in it: faces looked for every few frames, the picture following them smoothly.
          const cs = q.sequences.find((x) => x.id === out.sequence) as Sequence;
          const size = clipSize(source, aspect);
          const motions = new Map<string, Clip['motion']>();
          const framed = framedClips(q, cs);
          for (const [k, { clip, media }] of framed.entries()) {
            check(j);
            const { t, seconds } = sampleTimes(q, clip, cs, REFRAME_DEFAULTS.every);
            const looked = await f.look(media.proxy ?? media.path, seconds, (d) =>
              j.progress((i + (k + d) / Math.max(1, framed.length)) / list.length, `Framing clip ${i + 1} of ${list.length}…`),
            );
            const samples = t.map((frame, n) => ({ t: frame, found: looked[n] ?? [] }));
            if (samples.some((x) => x.found.length))
              motions.set(clip.id, reframeMotion(clip, media, { w: size.width, h: size.height }, samples, { ...REFRAME_DEFAULTS, aspect }));
          }
          q = withMotions(q, out.sequence, motions);
        }
        return { project: { ...q, open: ids[0] ?? q.open }, ids };
      },
      () => f?.stop(),
    );
    f?.stop();
    finder.current = null;
    if (!made) return;
    doc.edit(() => made.project, list.length === 1 ? 'Make a clip' : `Make ${list.length} clips`);
    let note = `Made ${list.length} ${list.length === 1 ? 'clip' : 'clips'} for social: “${current(made.project).name}” is open.`;
    if (folder) {
      try {
        const encoders = await encodersHere();
        const preset = presetFor(aspect);
        for (const id of made.ids) {
          const cs = made.project.sequences.find((x) => x.id === id) as Sequence;
          const len = Math.max(...cs.clips.map((c) => c.start + c.length), 1);
          const plan = planDelivery(made.project, {
            preset,
            seq: id,
            range: { from: 0, to: len },
            out: joinPath(folder, `${cs.name}.${preset.container}`),
            chapters: false,
            captions: { burn: true, embed: false, sidecar: false },
            encoders,
            app: inApp(),
          });
          renderQueue.add(plan, cs.name, preset.name);
        }
        note += ` ${made.ids.length} exports are in the render queue.`;
      } catch (e) {
        note += ` They could not be queued: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    ui.note(note);
    onClose();
  };

  const fps = rate(s);
  return (
    <Modal title="Clips for social" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : (
        <div className="form">
          <div className="form__row">
            <span>How many</span>
            <Choice
              value={count}
              options={[
                [3, '3'],
                [5, '5'],
                [8, '8'],
                [12, '12'],
              ]}
              onChange={(v) => {
                setCount(v);
                setFound(null);
              }}
              label="How many clips"
            />
          </div>
          <div className="form__row">
            <span>Length</span>
            <Choice
              value={length}
              options={LENGTHS.map(([id, name]) => [id, name] as [string, string])}
              onChange={(v) => {
                setLength(v);
                setFound(null);
              }}
              label="Length of each clip"
            />
          </div>
          <label className="form__row smart__top">
            <span>Key words</span>
            <textarea className="text smart__words" rows={2} value={keywords} onChange={(e) => setKeywords(e.target.value)} aria-label="Key words" />
          </label>
          <div className="form__row">
            <span>Shape</span>
            <Choice value={aspect} options={[...ASPECTS, ['same', 'Same as the sequence']]} onChange={setAspect} label="Shape" />
          </div>
          <label className="form__row">
            <span>Captions</span>
            <select className="text" value={look} onChange={(e) => setLook(e.target.value)} disabled={!transcribed} aria-label="Caption look">
              <option value="">None</option>
              {CAPTION_LOOKS.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}: {l.note.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <div className="form__row">
            <span />
            <span className="smart__checks">
              <label className="check">
                <input type="checkbox" checked={faces} disabled={aspect === 'same'} onChange={(e) => setFaces(e.target.checked)} /> Follow the people talking
                (slower)
              </label>
              <label className="check">
                <input type="checkbox" checked={title} onChange={(e) => setTitle(e.target.checked)} /> Its first line as a title at the start
              </label>
              <label className="check">
                <input type="checkbox" checked={queue} disabled={!inApp()} onChange={(e) => setQueue(e.target.checked)} /> Export each one when made
              </label>
            </span>
          </div>
          <p className="insp__note">
            Finds moments that stand on their own: whole sentences, a strong opening line, the room reacting, key words and highlight markers.
            {transcribed ? '' : ' Transcribe first (Captions > Transcribe) for clips that start and end on whole sentences, and for captions.'}
          </p>
          {found && !stale && (
            <ol className="smart__list">
              {found.map((c) => (
                <li key={c.id} className={c.on ? 'is-on' : ''}>
                  <input
                    type="checkbox"
                    checked={c.on}
                    onChange={() => setFound(found.map((x) => (x.id === c.id ? { ...x, on: !x.on } : x)))}
                    aria-label="Make this clip"
                  />
                  <span className="smart__score" title="How strong it is next to the rest of the sequence">
                    {c.strength}
                  </span>
                  <button type="button" className="smart__time" onClick={() => (engine.pause(), engine.seek(Math.round(c.from * fps)))}>
                    {secs(c.from)}
                  </button>
                  <small>{Math.round(c.to - c.from)} s</small>
                  <span className="smart__why" title={c.title}>
                    <b>{c.why}</b> {c.title && `“${c.title}”`}
                  </span>
                </li>
              ))}
              {found.length === 0 && <li className="smart__empty">No moments long enough. Try a shorter length.</li>}
            </ol>
          )}
          {stale && <p className="form__problem">The sequence changed since it was looked at. Find the moments again.</p>}
          {job.problem && <p className="form__problem">{job.problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn" disabled={!s.clips.length} onClick={() => void find()}>
              {found && !stale ? 'Find again' : 'Find moments'}
            </button>
            <button type="button" className="btn btn--primary" disabled={!found || stale || chosen.length === 0} onClick={() => void make()}>
              Make {chosen.length || ''} {chosen.length === 1 ? 'clip' : 'clips'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
