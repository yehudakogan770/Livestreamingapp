// The AI menu and its dialogs: auto color match, music tools (beats, cut to
// the beat, beat montage, fit music to length), media search, caption
// translation, enhance speech and ducking presets, and chapter markers. All
// of it runs on this computer; every change is one step that Undo takes back,
// and what is made (grade nodes, markers, clips, caption tracks) stays editable.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { captionTracks } from '../model/captions';
import { current, editSeq, end, mediaOf, rate, seqLength, trackOf } from '../model/seq';
import type { Clip, Project, Sequence } from '../model/types';
import { selectedIds, useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { inApp, native } from '../native';
import { Choice, Modal, type MenuEntry } from '../ui/controls';
import type { Ui } from '../ui/state';
import { check, Stopped, wordsInSeconds, type Job } from '../smart/analysis';
import { LANGUAGES } from '../../../../app/src/captions/whisper';
import type { SpeechModel } from '../speech/transcribe';
import { addBeatMarkers, applyFit, buildMontage, clipBeatFrames, planFit, removeBeatMarkers, snapCutsToBeats, type Beats, type FitPlan } from './beats';
import { CHAPTER_DEFAULTS, chapterStamp, findChapters, placeChapterMarkers, youtubeChapters, youtubeProblems, type Chapter } from './chapters';
import { MATCH_DEFAULTS, matchColors, withMatchNode, type MatchOptions } from './colormatch';
import { clipPixels } from './colorsample';
import { MT_LANGUAGES } from './marian';
import { beatsOf, savedBeats } from './musicjob';
import { hitsToBin, search, selectsSequence, type Hit, type LookIndex } from './search';
import { indexPictures, knownLooks } from './searchjob';
import { addTranslatedTrack, englishFromSpeech, trackBlocks, Translator } from './translate';
import { applyDuckPreset, DUCK_PRESETS, enhanceSpeech, noSpeechTrack } from './voice';
import './extras.css';

export type ExtrasTool = 'colormatch' | 'music' | 'search' | 'translate' | 'chapters' | 'voice';

let open: ExtrasTool | null = null;
const listeners = new Set<() => void>();
export function openExtras(t: ExtrasTool | null): void {
  open = t;
  for (const f of listeners) f();
}
const useOpen = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => open,
  );

const isVideoClip = (s: Sequence, c: Clip) => trackOf(s, c.track)?.kind === 'video' && !trackOf(s, c.track)?.captions && c.source.kind !== 'caption';
const isAudioClip = (s: Sequence, c: Clip) => trackOf(s, c.track)?.kind === 'audio' && c.source.kind === 'media';

/** The AI menu. */
export function extrasMenu(p: Project, doc: Doc, ui: Ui): MenuEntry[] {
  const s = current(p);
  const ids = selectedIds(doc.state.selection);
  const sound = s.clips.filter((c) => ids.includes(c.id) && isAudioClip(s, c));
  return [
    { label: 'Media search…', disabled: p.media.length === 0, run: () => openExtras('search') },
    'sep',
    { label: 'Auto color match…', disabled: !s.clips.some((c) => isVideoClip(s, c)), run: () => openExtras('colormatch') },
    { label: 'Music: beats, cut to the beat, fit to length…', disabled: !s.clips.some((c) => isAudioClip(s, c)), run: () => openExtras('music') },
    'sep',
    {
      label: 'Enhance speech (chosen sound clips)',
      disabled: sound.length === 0,
      run: () => {
        const r = enhanceSpeech(doc.project, ids);
        doc.edit(() => r.project, 'Enhance speech');
        ui.note(`Enhance speech on ${r.count} clip${r.count === 1 ? '' : 's'}: noise, hum, harsh “s”, level. Each step is an effect you can change.`);
      },
    },
    { label: 'Ducking presets…', disabled: !s.clips.some((c) => isAudioClip(s, c)), run: () => openExtras('voice') },
    'sep',
    { label: 'Translate captions…', disabled: !s.clips.some((c) => isAudioClip(s, c)) && captionTracks(s).length === 0, run: () => openExtras('translate') },
    { label: 'Chapter markers from the transcript…', disabled: !s.clips.length, run: () => openExtras('chapters') },
  ];
}

export function ExtrasDialogs({ doc, engine, ui }: { doc: Doc; engine: Engine; ui: Ui }) {
  const t = useOpen();
  const close = () => openExtras(null);
  if (t === 'colormatch') return <ColorMatchDialog doc={doc} ui={ui} onClose={close} />;
  if (t === 'music') return <MusicDialog doc={doc} engine={engine} ui={ui} onClose={close} />;
  if (t === 'search') return <SearchDialog doc={doc} ui={ui} onClose={close} />;
  if (t === 'translate') return <TranslateDialog doc={doc} ui={ui} onClose={close} />;
  if (t === 'chapters') return <ChaptersDialog doc={doc} engine={engine} ui={ui} onClose={close} />;
  if (t === 'voice') return <DuckingDialog doc={doc} ui={ui} onClose={close} />;
  return null;
}

// ---------------------------------------------------------------------------
// Running a job with progress and Stop.

interface Running {
  done: number;
  message: string;
}

function useJob() {
  const [running, setRunning] = useState<Running | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const onStop = useRef<(() => void) | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = async <T,>(f: (job: Job) => Promise<T>, stop?: () => void): Promise<T | null> => {
    const c = new AbortController();
    ctl.current = c;
    onStop.current = stop ?? null;
    setProblem(null);
    setRunning({ done: 0, message: 'Starting…' });
    try {
      return await f({ signal: c.signal, progress: (done, message) => !c.signal.aborted && setRunning({ done, message }) });
    } catch (e) {
      if (!(e instanceof Stopped) && !c.signal.aborted) setProblem(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      ctl.current = null;
      setRunning(null);
    }
  };
  const stop = () => {
    ctl.current?.abort();
    onStop.current?.();
  };
  return { running, problem, run, stop, setProblem };
}

function Progress({ running, onStop }: { running: Running; onStop: () => void }) {
  return (
    <div className="expo">
      <p className="expo__msg">{running.message}</p>
      <div className="expo__bar">
        <i style={{ width: `${Math.round(Math.min(1, Math.max(0, running.done)) * 100)}%` }} />
      </div>
      <div className="form__foot">
        <button type="button" className="btn" onClick={onStop}>
          Stop
        </button>
      </div>
    </div>
  );
}

const secs = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function ClipSelect({ s, clips, value, onChange, label }: { s: Sequence; clips: Clip[]; value: string; onChange: (id: string) => void; label: string }) {
  const fps = rate(s);
  return (
    <label className="form__row">
      <span>{label}</span>
      <select className="text" value={value} onChange={(e) => onChange(e.target.value)}>
        {clips.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} · {trackOf(s, c.track)?.name} at {secs(c.start / fps)}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Auto color match.

function ColorMatchDialog({ doc, ui, onClose }: { doc: Doc; ui: Ui; onClose: () => void }) {
  const { project, selection } = useDoc(doc);
  const s = current(project);
  const pictures = s.clips.filter((c) => isVideoClip(s, c) && (c.source.kind === 'media' || c.source.kind === 'multicam' || c.source.kind === 'color'));
  const chosen = selectedIds(selection);
  const [ref, setRef] = useState(() => pictures.find((c) => chosen.includes(c.id))?.id ?? pictures[0]?.id ?? '');
  const [o, setO] = useState<MatchOptions>(MATCH_DEFAULTS);
  const job = useJob();
  const targets = pictures.filter((c) => chosen.includes(c.id) && c.id !== ref);
  const reference = pictures.find((c) => c.id === ref);

  const go = async (list: Clip[]) => {
    if (!reference || !list.length) return;
    const res = await job.run(async (j) => {
      const refPx = await clipPixels(doc.project, current(doc.project), reference, o.skin, { ...j, progress: (d, m) => j.progress(d / (list.length + 1), m) });
      if (!refPx) throw new Error(`The picture of ${reference.name} can't be read.`);
      const nodes = new Map<string, ReturnType<typeof matchColors>['node']>();
      for (const [i, c] of list.entries()) {
        check(j);
        const px = await clipPixels(doc.project, current(doc.project), c, o.skin, { ...j, progress: (d, m) => j.progress((i + 1 + d) / (list.length + 1), m) });
        if (!px) continue;
        nodes.set(c.id, matchColors(px, refPx, o).node);
        await new Promise((r) => setTimeout(r, 0));
      }
      return nodes;
    });
    if (!res) return;
    doc.edit((p) => editSeq(p, (seq) => ({ ...seq, clips: seq.clips.map((c) => (res.has(c.id) ? withMatchNode(c, res.get(c.id)!) : c)) })), 'Auto color match');
    ui.note(`Matched ${res.size} clip${res.size === 1 ? '' : 's'} to ${reference.name}: a “Color match” node on the Color page, ready to tweak.`);
    onClose();
  };

  return (
    <Modal title="Auto color match" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : pictures.length < 2 ? (
        <p className="insp__note">Put at least two picture clips on the timeline: one to match to, and one to change.</p>
      ) : (
        <div className="form">
          <ClipSelect s={s} clips={pictures} value={ref} onChange={setRef} label="Reference (match to)" />
          <p className="insp__note">
            {targets.length
              ? `${targets.length} chosen clip${targets.length === 1 ? '' : 's'} will be matched to the reference.`
              : 'Choose the clips to change on the timeline (the reference can be chosen too), or match every other clip.'}{' '}
            The colors are compared in a perceptual color space (lightness and two color axes), and the change is written as a “Color match” grade node: a
            saturation amount and red, green and blue curves you can tweak on the Color page.
          </p>
          <label className="form__check">
            <input type="checkbox" checked={o.histogram} onChange={(e) => setO({ ...o, histogram: e.target.checked })} /> Match the whole brightness histogram
            (not only the average and contrast)
          </label>
          <label className="form__check">
            <input type="checkbox" checked={o.skin} onChange={(e) => setO({ ...o, skin: e.target.checked })} /> Skin-tone aware (finds people with the person
            model and keeps faces looking right)
          </label>
          <label className="form__row">
            <span>Amount</span>
            <span className="smart__slider">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(o.amount * 100)}
                onChange={(e) => setO({ ...o, amount: Number(e.target.value) / 100 })}
                aria-label="Amount"
              />
              <small>{Math.round(o.amount * 100)}%</small>
            </span>
          </label>
          {job.problem && <p className="form__problem">{job.problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={!reference}
              onClick={() => void go(pictures.filter((c) => c.id !== ref && c.source.kind !== 'color'))}
            >
              Match all to reference
            </button>
            <button type="button" className="btn btn--primary" disabled={!reference || targets.length === 0} onClick={() => void go(targets)}>
              Match chosen clips
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Music tools.

function MusicDialog({ doc, engine, ui, onClose }: { doc: Doc; engine: Engine; ui: Ui; onClose: () => void }) {
  const { project, selection } = useDoc(doc);
  const s = current(project);
  const fps = rate(s);
  const chosen = selectedIds(selection);
  const sounds = s.clips.filter((c) => isAudioClip(s, c));
  const guess = sounds.find((c) => chosen.includes(c.id)) ?? sounds.find((c) => trackOf(s, c.track)?.role === 'music') ?? sounds[0];
  const [clipId, setClipId] = useState(guess?.id ?? '');
  const music = sounds.find((c) => c.id === clipId);
  const media = music ? mediaOf(project, music) : undefined;
  const [beats, setBeats] = useState<Beats | null>(null);
  const [barsOnly, setBarsOnly] = useState(false);
  const [every, setEvery] = useState<number>(4);
  const [within, setWithin] = useState(Math.round(fps / 2));
  const others = s.clips.filter((c) => c.id !== clipId && !(music?.link && c.link === music.link));
  const sequenceEnd = others.reduce((m, c) => Math.max(m, end(c)), 0);
  const [target, setTarget] = useState(() => Math.max(1, Math.round((sequenceEnd - (music?.start ?? 0)) / fps)));
  const job = useJob();
  const pictures = s.clips.filter((c) => chosen.includes(c.id) && isVideoClip(s, c)).sort((a, b) => a.start - b.start);

  useEffect(() => {
    setBeats(null);
    if (media) void savedBeats(media).then((b) => b && setBeats(b));
  }, [media?.id]);

  const analyze = async () => {
    if (!media) return;
    const b = await job.run((j) => beatsOf(media, j));
    if (b) setBeats(b);
  };
  const plan: FitPlan | null = useMemo(() => {
    if (!beats || !media) return null;
    const bars = beats.downbeats.map((i) => beats.beats[i] as number);
    return planFit(bars, media.duration, target);
  }, [beats, media, target]);
  const frames = music && beats ? clipBeatFrames(music, beats, fps) : [];

  return (
    <Modal title="Music tools" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : !music ? (
        <p className="insp__note">Put a song on a sound track first.</p>
      ) : (
        <div className="form">
          <ClipSelect s={s} clips={sounds} value={clipId} onChange={setClipId} label="Song" />
          {beats ? (
            <p className="insp__note">
              <b>{beats.bpm} BPM</b>, {beats.beats.length} beats, {beats.downbeats.length} bars of {beats.meter}. {frames.length} beats fall inside the clip on
              the timeline.
            </p>
          ) : (
            <p className="insp__note">Find the song’s tempo, beats and bars first (it listens to the whole file once, then remembers).</p>
          )}
          {job.problem && <p className="form__problem">{job.problem}</p>}
          {!beats && (
            <div className="form__foot">
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
              <button type="button" className="btn btn--primary" onClick={() => void analyze()}>
                Find the beats
              </button>
            </div>
          )}
          {beats && (
            <>
              <h3 className="extras__h">Beat markers</h3>
              <div className="extras__row">
                <label className="form__check">
                  <input type="checkbox" checked={barsOnly} onChange={(e) => setBarsOnly(e.target.checked)} /> Bars only
                </label>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const r = addBeatMarkers(doc.project, music.id, beats, barsOnly);
                    doc.edit(() => r.project, 'Beat markers');
                    ui.note(`${r.count} beat markers. Clips snap to them while you drag.`);
                  }}
                >
                  Add beat markers
                </button>
                <button type="button" className="btn" onClick={() => doc.edit((p) => removeBeatMarkers(p), 'Remove beat markers')}>
                  Remove beat markers
                </button>
              </div>
              <h3 className="extras__h">Cut to the beat</h3>
              <div className="extras__row">
                <span className="insp__note">
                  {pictures.length
                    ? `${pictures.length} chosen picture clip${pictures.length === 1 ? '' : 's'}.`
                    : 'Choose picture clips on the timeline (as well as the song) to use these.'}
                </span>
              </div>
              <div className="extras__row">
                <label className="extras__inline">
                  Within
                  <input
                    className="text smart__num"
                    type="number"
                    min={1}
                    max={Math.round(fps * 2)}
                    value={within}
                    onChange={(e) => setWithin(Math.max(1, Number(e.target.value) || 1))}
                  />
                  frames
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={!pictures.length}
                  onClick={() => {
                    const r = snapCutsToBeats(
                      doc.project,
                      pictures.map((c) => c.id),
                      frames.map((f) => f.frame),
                      within,
                    );
                    doc.edit(() => r.project, 'Cut to the beat');
                    ui.note(`${r.moved} cut${r.moved === 1 ? '' : 's'} moved onto the beat.`);
                  }}
                >
                  Snap chosen cuts to beats
                </button>
              </div>
              <div className="extras__row">
                <span>Montage: a cut every</span>
                <Choice
                  value={every}
                  options={[
                    [1, 'beat'],
                    [2, '2 beats'],
                    [4, 'bar'],
                    [8, '2 bars'],
                  ]}
                  onChange={setEvery}
                  label="Cut every"
                />
                <button
                  type="button"
                  className="btn"
                  disabled={!pictures.length}
                  onClick={() => {
                    const made = buildMontage(doc.project, music, pictures, beats, every);
                    if (!made) return;
                    doc.edit(() => made.project, 'Beat montage');
                    ui.note('A new sequence, “Beat montage”, cut on the beat. Undo takes it away.');
                    onClose();
                  }}
                >
                  Build montage from chosen clips
                </button>
              </div>
              <h3 className="extras__h">Fit music to length</h3>
              <div className="extras__row">
                <label className="extras__inline">
                  End after
                  <input
                    className="text smart__num"
                    type="number"
                    min={1}
                    value={target}
                    onChange={(e) => setTarget(Math.max(1, Number(e.target.value) || 1))}
                  />
                  s
                </label>
                <button type="button" className="smart__link" onClick={() => setTarget(Math.max(1, Math.round((sequenceEnd - music.start) / fps)))}>
                  At the end of the sequence ({secs((sequenceEnd - music.start) / fps)})
                </button>
              </div>
              <p className="insp__note">
                {plan
                  ? `${plan.summary} Cut only at bar lines, with crossfades, so the song ends exactly ${target} s after it starts.`
                  : 'The song can’t be fitted (no bars were found).'}{' '}
                The whole song is used (from the start of the file).
              </p>
              <div className="form__foot">
                <button type="button" className="btn" onClick={() => void analyze()} title="Listen again">
                  Analyze again
                </button>
                <button type="button" className="btn" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!plan}
                  onClick={() => {
                    if (!plan) return;
                    doc.edit((p) => applyFit(p, music.id, plan, Math.round(target * fps)), 'Fit music to length');
                    engine.pause();
                    engine.seek(music.start + Math.round(target * fps) - Math.round(fps * 3));
                    ui.note(`The song now ends at ${secs((music.start + target * fps) / fps)}. Each part is its own clip; Undo puts it back.`);
                    onClose();
                  }}
                >
                  Fit to length
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Media search.

function SearchDialog({ doc, ui, onClose }: { doc: Doc; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const [text, setText] = useState('');
  const [looks, setLooks] = useState<Map<string, LookIndex>>(new Map());
  const [scenes, setScenes] = useState<boolean | null>(null);
  const job = useJob();
  useEffect(() => {
    void knownLooks(project.media).then(setLooks);
  }, [project.media.length]);
  const hits: Hit[] = useMemo(() => (text.trim() ? search(project.media, looks, text) : []), [text, looks, project.media]);
  const transcribed = project.media.filter((m) => m.transcript?.words.length).length;
  const visual = project.media.filter((m) => m.hasVideo);
  const indexed = visual.filter((m) => looks.has(m.id)).length;
  const name = (id: string) => project.media.find((m) => m.id === id)?.name ?? id;

  const index = async (again: boolean) => {
    const r = await job.run((j) => indexPictures(project.media, j, again));
    if (r) {
      setLooks(r.looks);
      setScenes(r.scenes);
    }
  };
  const openHit = (h: Hit) => {
    ui.set({ source: { media: h.media, time: h.from, in: h.from, out: h.to }, sourceTab: 'source' });
    ui.note(`${name(h.media)} at ${secs(h.from)} is in the source monitor (in and out marked).`);
  };

  return (
    <Modal title="Media search" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : (
        <div className="form">
          <input
            className="text extras__search"
            type="search"
            autoFocus
            placeholder="Words said, things seen, “2 people”, “close-up”, “wide shot beach”…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Search all media"
          />
          <p className="insp__note">
            {transcribed} of {project.media.length} files transcribed (spoken words: Transcribe in the Captions menu). {indexed} of {visual.length} picture
            files looked at (people, faces, shot type, objects{scenes === false ? '' : ' and scenes'}).
            {scenes === false && ' The scene model could not be downloaded, so only objects are labeled.'}
          </p>
          {job.problem && <p className="form__problem">{job.problem}</p>}
          {text.trim() && (
            <ul className="smart__list extras__hits">
              {hits.length === 0 && <li className="smart__empty">Nothing found.</li>}
              {hits.map((h, i) => (
                <li key={`${h.media}-${h.from}-${i}`} className="is-on">
                  <button type="button" className="smart__time" onClick={() => openHit(h)}>
                    {secs(h.from)}
                  </button>
                  <span className={`smart__tag${h.kind === 'speech' ? '' : ' smart__tag--filler'}`}>{h.kind === 'speech' ? 'said' : 'seen'}</span>
                  <span className="smart__why" title={h.text}>
                    <b>{name(h.media)}</b> {h.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="form__foot">
            <button type="button" className="btn" disabled={!visual.length} onClick={() => void index(indexed === visual.length)}>
              {indexed === visual.length && visual.length ? 'Look at pictures again' : 'Look at pictures'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!hits.length}
              onClick={() => {
                const r = hitsToBin(doc.project, hits, `Search: ${text.trim()}`);
                doc.edit(() => r.project, 'Search results to a bin');
                ui.note(`${r.count} file${r.count === 1 ? '' : 's'} put in the bin “Search: ${text.trim()}”.`);
              }}
            >
              Put files in a bin
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!hits.length}
              onClick={() => {
                const r = selectsSequence(doc.project, hits, `Selects: ${text.trim()}`);
                doc.edit(() => r.project, 'Selects sequence');
                ui.note(`A selects sequence with ${r.count} moments. Undo takes it away.`);
                onClose();
              }}
            >
              Make a selects sequence
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Caption translation.

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  he: 'Hebrew',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
  ar: 'Arabic',
  zh: 'Chinese',
};

function TranslateDialog({ doc, ui, onClose }: { doc: Doc; ui: Ui; onClose: () => void }) {
  const { project, selection } = useDoc(doc);
  const s = current(project);
  const tracks = captionTracks(s);
  const [target, setTarget] = useState('en');
  const [from, setFrom] = useState(tracks[0]?.id ?? '');
  const [model, setModel] = useState<SpeechModel>('whisper-base');
  const [spoken, setSpoken] = useState('auto');
  const job = useJob();
  const ids = selectedIds(selection);
  const stopRef = useRef<{ stop?: () => void }>({});
  const mt = MT_LANGUAGES.find((l) => l.code === target);

  const go = async () => {
    const res = await job.run(
      async (j) => {
        const report = (x: { done: number; message: string }) => j.progress(x.done, x.message);
        if (target === 'en')
          return {
            blocks: await englishFromSpeech(doc.project, ids.length ? ids : null, model, spoken === 'auto' ? null : spoken, report, stopRef.current),
            name: 'English',
          };
        const t = new Translator(target, report);
        stopRef.current.stop = () => t.stop();
        const blocks = trackBlocks(current(doc.project), from);
        if (!blocks.length) throw new Error('That captions track is empty.');
        return { blocks: await t.blocks(blocks), name: mt?.name ?? target };
      },
      () => stopRef.current.stop?.(),
    );
    if (!res) return;
    if (!res.blocks.length) {
      job.setProblem('No speech was heard.');
      return;
    }
    doc.edit((p) => addTranslatedTrack(p, res.blocks, res.name, target === 'en' ? undefined : from).project, `Captions in ${res.name}`);
    ui.note(`A new captions track in ${res.name}, ${res.blocks.length} lines. Every line can be edited; the original track is kept.`);
    onClose();
  };

  return (
    <Modal title="Translate captions" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : (
        <div className="form">
          <label className="form__row">
            <span>Into</span>
            <select className="text" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="en">English (from the speech, any language)</option>
              {MT_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} (from English captions)
                </option>
              ))}
            </select>
          </label>
          {target === 'en' ? (
            <>
              <label className="form__row">
                <span>Spoken language</span>
                <select className="text" value={spoken} onChange={(e) => setSpoken(e.target.value)}>
                  <option value="auto">Work it out</option>
                  {LANGUAGES.filter((l) => l !== 'en').map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_NAMES[l] ?? l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form__row">
                <span>Speech model</span>
                <Choice
                  value={model}
                  options={[
                    ['whisper-base', 'Faster'],
                    ['whisper-small', 'More accurate'],
                  ]}
                  onChange={setModel}
                  label="Speech model"
                />
              </label>
              <p className="insp__note">
                Whisper listens to {ids.length ? 'the chosen clips’' : 'the sequence’s'} speech again and writes it in English, offline. The result is a new
                captions track timed to the speech.
              </p>
            </>
          ) : (
            <>
              <label className="form__row">
                <span>From the track</span>
                <select className="text" value={from} onChange={(e) => setFrom(e.target.value)}>
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="insp__note">
                {tracks.length === 0
                  ? 'Make English captions first (Captions menu, or translate into English here).'
                  : `Each caption line is translated on this computer by a small translation model (Opus-MT, downloaded the first time, about 110 MB for ${mt?.name}). Timings stay the same. Machine translation of short lines is a first draft: read it over.`}{' '}
                Only English captions can be translated into other languages; for anything else, translate into English first.
              </p>
            </>
          )}
          {!inApp() && <p className="form__problem">Translation needs the installed app (the models run on this computer).</p>}
          {job.problem && <p className="form__problem">{job.problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={!inApp() || (target !== 'en' && !from)} onClick={() => void go()}>
              Translate
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Chapter markers.

function ChaptersDialog({ doc, engine, ui, onClose }: { doc: Doc; engine: Engine; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const words = useMemo(() => wordsInSeconds(project, s), [project, s]);
  const [minLength, setMinLength] = useState(CHAPTER_DEFAULTS.minLength);
  const [sensitivity, setSensitivity] = useState(50);
  const found = useMemo(() => findChapters(words, { ...CHAPTER_DEFAULTS, minLength, sensitivity: sensitivity / 100 }), [words, minLength, sensitivity]);
  const [titles, setTitles] = useState<Record<number, string>>({});
  useEffect(() => setTitles({}), [found]);
  const chapters: Chapter[] = found.map((c, i) => ({ ...c, title: titles[i] ?? c.title }));
  const text = youtubeChapters(chapters);
  const problem = youtubeProblems(chapters);
  const length = seqLength(s) / rate(s);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      ui.note('YouTube chapters copied: paste them into the video’s description.');
    } catch {
      ui.note('Could not copy. Use “Save as text” instead.');
    }
  };
  const saveText = async () => {
    if (!inApp()) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = `${project.name || 'Chapters'} chapters.txt`;
      a.click();
      return;
    }
    const picked = await save({
      title: 'Save YouTube chapters',
      defaultPath: `${project.name || 'Chapters'} chapters.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (picked) await native.writeText(picked, text);
  };

  return (
    <Modal title="Chapter markers" onClose={onClose} wide>
      {words.length === 0 ? (
        <p className="insp__note">Chapters are found in what is said: transcribe the sequence first (Captions menu → Transcribe).</p>
      ) : (
        <div className="form">
          <label className="form__row">
            <span>Shortest chapter</span>
            <span className="smart__slider">
              <input
                type="range"
                min={10}
                max={300}
                step={5}
                value={minLength}
                onChange={(e) => setMinLength(Number(e.target.value))}
                aria-label="Shortest chapter"
              />
              <small>{minLength} s</small>
            </span>
          </label>
          <label className="form__row">
            <span>Chapters</span>
            <span className="smart__slider">
              <small>Fewer</small>
              <input
                type="range"
                min={0}
                max={100}
                value={sensitivity}
                onChange={(e) => setSensitivity(Number(e.target.value))}
                aria-label="How many chapters"
              />
              <small>More</small>
            </span>
          </label>
          <p className="insp__note">
            A new chapter starts where the talk turns to another topic (the words used change); each is named after the words that set it apart. Rename them
            here before adding them. {secs(length)} of film.
          </p>
          <ul className="smart__list">
            {chapters.map((c, i) => (
              <li key={i} className="is-on">
                <button type="button" className="smart__time" onClick={() => (engine.pause(), engine.seek(Math.round(c.at * rate(s))))}>
                  {chapterStamp(c.at)}
                </button>
                <input
                  className="text extras__title"
                  value={c.title}
                  onChange={(e) => setTitles({ ...titles, [i]: e.target.value })}
                  aria-label={`Chapter ${i + 1} title`}
                />
              </li>
            ))}
          </ul>
          {problem && <p className="form__problem">{problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={() => void copy()}>
              Copy YouTube chapters
            </button>
            <button type="button" className="btn" onClick={() => void saveText()}>
              Save as text…
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!chapters.length}
              onClick={() => {
                doc.edit((p) => placeChapterMarkers(p, chapters, rate(s)), 'Chapter markers');
                ui.note(`${chapters.length} chapter markers on the timeline.`);
                onClose();
              }}
            >
              Add as markers
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ducking presets.

function DuckingDialog({ doc, ui, onClose }: { doc: Doc; ui: Ui; onClose: () => void }) {
  const { project, selection } = useDoc(doc);
  const ids = selectedIds(selection);
  const [preset, setPreset] = useState(DUCK_PRESETS[1]?.id ?? 'podcast');
  const chosen = DUCK_PRESETS.find((d) => d.id === preset) ?? DUCK_PRESETS[0]!;
  return (
    <Modal title="Ducking presets" onClose={onClose}>
      <div className="form">
        <div className="extras__presets" role="radiogroup" aria-label="Preset">
          {DUCK_PRESETS.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={d.id === preset}
              className={`extras__preset${d.id === preset ? ' is-on' : ''}`}
              onClick={() => setPreset(d.id)}
            >
              <b>{d.name}</b>
              <small>{d.about}</small>
            </button>
          ))}
        </div>
        <p className="insp__note">
          {ids.length ? 'Goes on the chosen sound clips.' : 'Goes on every clip on the Music tracks.'} Music ducks under tracks marked Speech
          {noSpeechTrack(project) ? ': no track is marked Speech yet (click the track’s role in its header, or in the Mixer).' : '.'} The settings go into each
          clip’s “Duck under speech” effect, where they can be changed.
        </p>
        <div className="form__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              const r = applyDuckPreset(doc.project, ids, chosen);
              if (!r.count) {
                ui.note('No music clips to duck: choose sound clips, or mark a track Music.');
                return;
              }
              doc.edit(() => r.project, `Ducking: ${chosen.name}`);
              ui.note(`Ducking “${chosen.name}” on ${r.count} clip${r.count === 1 ? '' : 's'}.`);
              onClose();
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </Modal>
  );
}
