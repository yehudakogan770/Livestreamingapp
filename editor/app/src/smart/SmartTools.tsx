// The Smart menu and its dialogs: auto multicam edit, remove silences and
// filler words, auto reframe to vertical or square, and highlight reel. Each
// one analyzes first (with progress, and a Stop button), shows what it would
// do, and only then changes the project, as one step that Undo takes back.
import { ArrowDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { timecode } from '../model/build';
import { current, rate } from '../model/seq';
import type { Clip, MulticamGroup, Project, Sequence } from '../model/types';
import { useDoc, type Doc } from '../doc';
import type { Engine } from '../player/engine';
import { Choice, Modal, type MenuEntry } from '../ui/controls';
import type { Ui } from '../ui/state';
import { check, micEnvelopes, sequenceLevels, wordsInSeconds } from './analysis';
import {
  applyShots,
  DETECT_DEFAULTS,
  detectSpeakers,
  groupsIn,
  guessWide,
  micSources,
  planCuts,
  rulesForPacing,
  summarize,
  targetClips,
  type MicSource,
  type Shot,
} from './autocam';
import { FaceFinder } from './detect';
import { addReel, buildReel, DEFAULT_KEYWORDS, pickMoments, scoreMoments, type Moment } from './highlights';
import {
  addReframed,
  aspectSize,
  ASPECTS,
  framedClips,
  REFRAME_DEFAULTS,
  reframedSequence,
  reframeMotion,
  sampleTimes,
  type Aspect,
  type Sample,
} from './reframe';
import {
  DEFAULT_FILLERS,
  fillerRemovals,
  findFillers,
  findSilences,
  rippleRanges,
  savedFrames,
  SILENCE_DEFAULTS,
  silenceRemovals,
  suggestThreshold,
  type Removal,
} from './silence';
import './smart.css';
import { openSmart, reframeAspect, useOpen } from './open';
import { Progress, useJob } from './job';
import { MakeMulticamDialog } from './MakeMulticam';
import { ClipsDialog } from './ClipsDialog';
import { FinishDialog } from './FinishDialog';

export type { SmartTool } from './open';
export { openSmart };

/** The Smart menu. */
export function smartMenu(p: Project): MenuEntry[] {
  const s = current(p);
  const hasClips = s.clips.length > 0;
  return [
    { label: 'Finish the event (cameras, captions, chapters, reel, clips)…', disabled: !hasClips, run: () => openSmart('finish') },
    'sep',
    { label: 'Auto multicam edit…', disabled: groupsIn(p, s).length === 0, run: () => openSmart('multicam') },
    { label: 'Remove silences and filler words…', disabled: !hasClips, run: () => openSmart('silence') },
    'sep',
    { label: 'Auto reframe (vertical, square)…', disabled: !hasClips, run: () => openSmart('reframe') },
    { label: 'Highlight reel…', disabled: !hasClips, run: () => openSmart('highlights') },
    { label: 'Clips for social (vertical, captioned)…', disabled: !hasClips, run: () => openSmart('clips') },
  ];
}

export function SmartDialogs({ doc, engine, ui }: { doc: Doc; engine: Engine; ui: Ui }) {
  const t = useOpen();
  const close = () => openSmart(null);
  if (t === 'multicam') return <MulticamDialog doc={doc} engine={engine} ui={ui} onClose={close} />;
  if (t === 'silence') return <SilenceDialog doc={doc} engine={engine} ui={ui} onClose={close} />;
  if (t === 'reframe') return <ReframeDialog doc={doc} ui={ui} onClose={close} />;
  if (t === 'highlights') return <HighlightDialog doc={doc} engine={engine} ui={ui} onClose={close} />;
  if (t === 'makeMulticam') return <MakeMulticamDialog doc={doc} ui={ui} onClose={close} />;
  if (t === 'clips') return <ClipsDialog doc={doc} engine={engine} ui={ui} onClose={close} />;
  if (t === 'finish') return <FinishDialog doc={doc} ui={ui} onClose={close} />;
  return null;
}

const secs = (t: number): string => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const seek = (engine: Engine, frame: number) => {
  engine.pause();
  engine.seek(Math.max(0, Math.round(frame)));
};

/** The sequence changed since it was analyzed (the preview no longer matches). */
const changed = (a: Sequence | null, b: Sequence): boolean => !!a && (a.id !== b.id || a.clips !== b.clips);

// ---------------------------------------------------------------------------
// Auto multicam edit.

function MulticamDialog({ doc, engine, ui, onClose }: { doc: Doc; engine: Engine; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const groups = groupsIn(project, s);
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const group = groups.find((g) => g.id === groupId) ?? groups[0];
  const [mics, setMics] = useState<MicSource[]>(() => (group ? micSources(project, s, group) : []));
  const [wide, setWide] = useState<string | null>(() => (group ? guessWide(group) : null));
  const [pacing, setPacing] = useState(50);
  const [analysis, setAnalysis] = useState<{ who: Int16Array; angles: (string | null)[]; seq: Sequence } | null>(null);
  const job = useJob();

  useEffect(() => {
    if (!group) return;
    setMics(micSources(doc.project, current(doc.project), group));
    setWide(guessWide(group));
    setAnalysis(null);
  }, [groupId]);

  const shots: Shot[] = useMemo(
    () => (analysis ? planCuts(analysis.who, DETECT_DEFAULTS.hop, analysis.angles, rulesForPacing(pacing / 100, wide)) : []),
    [analysis, pacing, wide],
  );
  if (!group)
    return (
      <Modal title="Auto multicam edit" onClose={onClose}>
        <p className="insp__note">
          This sequence has no multicam clips. Open a recorded event (each camera becomes one multicam clip), or put a multicam clip on the timeline first.
        </p>
      </Modal>
    );
  const mapped = mics.filter((m) => m.angle);
  const cams = group.angles;
  const targets = targetClips(s, group.id);

  const analyze = async () => {
    const used = mics.filter((m) => m.angle);
    const res = await job.run(async (j) => {
      const envs = await micEnvelopes(used, group.duration, DETECT_DEFAULTS.hop, j);
      j.progress(0.95, 'Working out who is talking…');
      await new Promise((r) => setTimeout(r, 0));
      check(j);
      return detectSpeakers(envs, DETECT_DEFAULTS);
    });
    if (res) setAnalysis({ who: res, angles: used.map((m) => m.angle), seq: current(doc.project) });
  };
  const apply = () => {
    doc.edit((p) => applyShots(p, group.id, shots), 'Auto multicam edit');
    ui.note(`Auto multicam edit: ${Math.max(0, shots.length - 1)} cuts. Undo takes them all back.`);
    onClose();
  };
  const stale = changed(analysis?.seq ?? null, s);

  return (
    <Modal title="Auto multicam edit" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : (
        <div className="form">
          {groups.length > 1 && (
            <label className="form__row">
              <span>Multicam clip</span>
              <select className="text" value={group.id} onChange={(e) => setGroupId(e.target.value)}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="form__row smart__top">
            <span>Microphones</span>
            <div className="smart__map">
              {mics.length === 0 && <p className="insp__note">No sound was found for these cameras.</p>}
              {mics.map((m, i) => (
                <label key={m.key} className="smart__maprow">
                  <span title={m.media.path}>{m.name}</span>
                  <span aria-hidden="true">→</span>
                  <select
                    className="text"
                    value={m.angle ?? ''}
                    onChange={(e) => {
                      const v = e.target.value || null;
                      setMics(mics.map((x, k) => (k === i ? { ...x, angle: v } : x)));
                      setAnalysis(null);
                    }}
                  >
                    <option value="">Not used</option>
                    {cams.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
          <label className="form__row">
            <span>Wide shot</span>
            <select className="text" value={wide ?? ''} onChange={(e) => setWide(e.target.value || null)}>
              <option value="">None (stay on the last speaker)</option>
              {cams.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form__row">
            <span>Pacing</span>
            <span className="smart__slider">
              <small>Calm</small>
              <input type="range" min={0} max={100} value={pacing} onChange={(e) => setPacing(Number(e.target.value))} aria-label="Pacing" />
              <small>Fast</small>
            </span>
          </label>
          <p className="insp__note">
            Cuts to whoever is talking (shots of at least {rulesForPacing(pacing / 100, wide).minShot.toFixed(1)} s), to the wide shot when people talk at once
            or nobody talks, and to the wide shot now and then in a long monologue.{' '}
            {s.inPoint !== null || s.outPoint !== null ? 'Only between the in and out marks. ' : ''}
            {targets.length} clip{targets.length === 1 ? '' : 's'} on the timeline will be cut.
          </p>
          {analysis && !stale && <ShotPreview shots={shots} group={group} total={group.duration} />}
          {stale && <p className="form__problem">The sequence changed since it was analyzed. Analyze again.</p>}
          {job.problem && <p className="form__problem">{job.problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn" disabled={mapped.length === 0} onClick={() => void analyze()}>
              {analysis ? 'Analyze again' : 'Analyze'}
            </button>
            <button type="button" className="btn btn--primary" disabled={!analysis || stale || shots.length === 0 || targets.length === 0} onClick={apply}>
              Make the cuts
            </button>
          </div>
          {analysis && (
            <button type="button" className="smart__link" onClick={() => seek(engine, (shots[1]?.from ?? 0) * rate(s))}>
              Go to the first cut
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

function ShotPreview({ shots, group, total }: { shots: Shot[]; group: MulticamGroup; total: number }) {
  const sum = summarize(shots);
  const name = (id: string) => group.angles.find((a) => a.id === id)?.name ?? id;
  const color = (id: string) => group.angles.find((a) => a.id === id)?.color ?? '#666';
  return (
    <div className="smart__preview">
      <div className="smart__strip" aria-label="The cuts, along the whole recording">
        {shots.map((sh, i) => (
          <i
            key={i}
            style={{ left: `${(sh.from / total) * 100}%`, width: `${((sh.to - sh.from) / total) * 100}%`, background: color(sh.angle) }}
            title={`${secs(sh.from)}–${secs(sh.to)} ${name(sh.angle)} (${sh.why})`}
          />
        ))}
      </div>
      <p className="insp__note">
        {sum.cuts} cuts · shots average {sum.average.toFixed(1)} s, shortest {sum.shortest.toFixed(1)} s ·{' '}
        {[...sum.byAngle.entries()].map(([a, t]) => `${name(a)} ${Math.round((t / Math.max(1e-6, total)) * 100)}%`).join(' · ')}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remove silences and filler words.

const HOP_SILENCE = 0.05;

function SilenceDialog({ doc, engine, ui, onClose }: { doc: Doc; engine: Engine; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const fps = rate(s);
  const [threshold, setThreshold] = useState(SILENCE_DEFAULTS.thresholdDb);
  const [minDuration, setMinDuration] = useState(SILENCE_DEFAULTS.minDuration);
  const [padding, setPadding] = useState(SILENCE_DEFAULTS.padding);
  const [silences, setSilences] = useState(true);
  const [fillers, setFillers] = useState(true);
  const [list, setList] = useState(DEFAULT_FILLERS.join(', '));
  const [levels, setLevels] = useState<{ v: Float32Array; seq: Sequence } | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [on, setOn] = useState<Set<string>>(new Set());
  const job = useJob();
  const words = useMemo(() => (fillers ? wordsInSeconds(project, s) : []), [project, s, fillers]);
  const removals: Removal[] = useMemo(() => {
    if (!levels) return [];
    const found: Removal[] = [];
    if (silences) found.push(...silenceRemovals(findSilences(levels.v, HOP_SILENCE, { thresholdDb: threshold, minDuration, padding }), fps));
    if (fillers) {
      const inFrames = words.map((w) => ({ w: w.w, from: Math.round(w.from * fps), to: Math.round(w.to * fps) }));
      found.push(...fillerRemovals(findFillers(inFrames, list.split(/[,\n]/))));
    }
    return found.sort((a, b) => a.from - b.from).map((r) => ({ ...r, on: off.has(r.id) ? false : on.has(r.id) ? true : r.on }));
  }, [levels, silences, fillers, threshold, minDuration, padding, words, list, fps, off, on]);
  const stale = changed(levels?.seq ?? null, s);
  const chosen = removals.filter((r) => r.on);
  const locked = s.tracks.some((t) => t.locked && s.clips.some((c) => c.track === t.id));

  const analyze = async () => {
    const v = await job.run((j) => sequenceLevels(doc.project, current(doc.project), HOP_SILENCE, true, j));
    if (v) {
      setLevels({ v, seq: current(doc.project) });
      setThreshold(suggestThreshold(v));
      setOff(new Set());
      setOn(new Set());
    }
  };
  const toggle = (r: Removal) => {
    const nextOff = new Set(off);
    const nextOn = new Set(on);
    if (r.on) {
      nextOff.add(r.id);
      nextOn.delete(r.id);
    } else {
      nextOn.add(r.id);
      nextOff.delete(r.id);
    }
    setOff(nextOff);
    setOn(nextOn);
  };
  const all = (v: boolean) => {
    setOff(v ? new Set() : new Set(removals.map((r) => r.id)));
    setOn(v ? new Set(removals.map((r) => r.id)) : new Set());
  };
  const apply = () => {
    const ranges = chosen.map((r) => [r.from, r.to] as [number, number]);
    doc.edit((p) => rippleRanges(p, ranges), `Remove ${chosen.length} silence${chosen.length === 1 ? '' : 's'} and fillers`);
    ui.note(`Took out ${(savedFrames(chosen) / fps).toFixed(1)} seconds. Undo puts it all back.`);
    onClose();
  };

  return (
    <Modal title="Remove silences and filler words" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : (
        <div className="form">
          <div className="form__row">
            <span>Find</span>
            <span className="form__pair">
              <label className="check">
                <input type="checkbox" checked={silences} onChange={(e) => setSilences(e.target.checked)} /> Silences
              </label>
              <label className="check">
                <input type="checkbox" checked={fillers} onChange={(e) => setFillers(e.target.checked)} /> Filler words
              </label>
            </span>
          </div>
          {silences && (
            <>
              <label className="form__row">
                <span>Quieter than</span>
                <span className="smart__slider">
                  <input type="range" min={-70} max={-15} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} aria-label="Threshold" />
                  <small>{threshold} dB</small>
                </span>
              </label>
              <label className="form__row">
                <span>For at least</span>
                <span className="smart__slider">
                  <input
                    type="range"
                    min={0.2}
                    max={3}
                    step={0.1}
                    value={minDuration}
                    onChange={(e) => setMinDuration(Number(e.target.value))}
                    aria-label="Shortest silence"
                  />
                  <small>{minDuration.toFixed(1)} s</small>
                </span>
              </label>
              <label className="form__row">
                <span>Keep either side</span>
                <span className="smart__slider">
                  <input type="range" min={0} max={0.6} step={0.05} value={padding} onChange={(e) => setPadding(Number(e.target.value))} aria-label="Padding" />
                  <small>{padding.toFixed(2)} s</small>
                </span>
              </label>
            </>
          )}
          {fillers && (
            <label className="form__row smart__top">
              <span>Filler words</span>
              <span>
                <textarea className="text smart__words" rows={2} value={list} onChange={(e) => setList(e.target.value)} aria-label="Filler words" />
                {!words.length && (
                  <small className="insp__note">Nothing is transcribed yet: transcribe the sequence (Captions → Transcribe) to find filler words.</small>
                )}
              </span>
            </label>
          )}
          {levels && !stale && (
            <>
              <div className="smart__listhead">
                <span>
                  {chosen.length} of {removals.length} chosen · {(savedFrames(chosen) / fps).toFixed(1)} s shorter
                </span>
                <button type="button" className="smart__link" onClick={() => all(true)}>
                  All
                </button>
                <button type="button" className="smart__link" onClick={() => all(false)}>
                  None
                </button>
              </div>
              <ul className="smart__list">
                {removals.map((r) => (
                  <li key={r.id} className={r.on ? 'is-on' : ''}>
                    <input type="checkbox" checked={r.on} onChange={() => toggle(r)} aria-label={`Remove ${r.label}`} />
                    <button type="button" className="smart__time" onClick={() => seek(engine, r.from)}>
                      {timecode(r.from, fps)}
                    </button>
                    <span className={`smart__tag smart__tag--${r.kind}`}>{r.kind === 'silence' ? 'Silence' : 'Filler'}</span>
                    <span>{r.label}</span>
                    <small>{((r.to - r.from) / fps).toFixed(2)} s</small>
                  </li>
                ))}
                {removals.length === 0 && <li className="smart__empty">Nothing found with these settings.</li>}
              </ul>
            </>
          )}
          {stale && <p className="form__problem">The sequence changed since it was analyzed. Analyze again.</p>}
          {locked && <p className="insp__note">Locked tracks are not cut or moved, so they may slip out of sync.</p>}
          {job.problem && <p className="form__problem">{job.problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={() => void analyze()}>
              {levels ? 'Analyze again' : 'Analyze'}
            </button>
            <button type="button" className="btn btn--primary" disabled={!levels || stale || chosen.length === 0} onClick={apply}>
              Remove {chosen.length || ''}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Auto reframe.

function ReframeDialog({ doc, ui, onClose }: { doc: Doc; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const [aspect, setAspect] = useState<Aspect>(reframeAspect());
  const [zoom, setZoom] = useState(100);
  const [lag, setLag] = useState(REFRAME_DEFAULTS.lag);
  const [every, setEvery] = useState(REFRAME_DEFAULTS.every);
  const [found, setFound] = useState<{ samples: Map<string, Sample[]>; seq: Sequence; every: number } | null>(null);
  const job = useJob();
  const finder = useRef<FaceFinder | null>(null);
  useEffect(() => () => finder.current?.stop(), []);
  const clips = framedClips(project, s);
  const stale = changed(found?.seq ?? null, s);

  const analyze = async () => {
    const p = doc.project;
    const seq = current(p);
    const list = framedClips(p, seq);
    const f = new FaceFinder();
    finder.current = f;
    const res = await job.run(
      async (j) => {
        j.progress(0, 'Starting the face finder…');
        await f.start();
        const out = new Map<string, Sample[]>();
        for (const [i, { clip, media }] of list.entries()) {
          check(j);
          const { t, seconds } = sampleTimes(p, clip, seq, every);
          const looked = await f.look(media.proxy ?? media.path, seconds, (d) =>
            j.progress((i + d) / list.length, `Looking for faces in ${clip.name} (${i + 1} of ${list.length})…`),
          );
          check(j);
          out.set(
            clip.id,
            t.map((frame, k) => ({ t: frame, found: looked[k] ?? [] })),
          );
        }
        return out;
      },
      () => f.stop(),
    );
    f.stop();
    finder.current = null;
    if (res) setFound({ samples: res, seq, every });
  };

  const stats = found
    ? clips.map(({ clip }) => {
        const sm = found.samples.get(clip.id) ?? [];
        return { clip, seen: sm.length ? sm.filter((x) => x.found.length).length / sm.length : 0 };
      })
    : [];

  const create = () => {
    if (!found) return;
    const p = doc.project;
    const seq = current(p);
    const { width, height } = aspectSize(seq, aspect);
    const size = { w: width, h: height };
    const motions = new Map<string, Clip['motion']>();
    for (const { clip, media } of framedClips(p, seq)) {
      const samples = found.samples.get(clip.id);
      if (!samples?.length) continue;
      motions.set(clip.id, reframeMotion(clip, media, size, samples, { ...REFRAME_DEFAULTS, aspect, zoom: zoom / 100, lag, every: found.every }));
    }
    const out = reframedSequence(seq, aspect, motions);
    doc.edit((q) => addReframed(q, out), `Auto reframe ${aspect}`);
    ui.note(`Made “${out.name}”. Each clip's position is keyframed: change any of it in the Inspector.`);
    onClose();
  };

  return (
    <Modal title="Auto reframe" onClose={() => !job.running && onClose()}>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : (
        <div className="form">
          <div className="form__row">
            <span>Shape</span>
            <Choice value={aspect} options={ASPECTS} onChange={setAspect} label="Shape" />
          </div>
          <label className="form__row">
            <span>Zoom</span>
            <span className="smart__slider">
              <input type="range" min={100} max={160} step={5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
              <small>{zoom}%</small>
            </span>
          </label>
          <label className="form__row">
            <span>Movement</span>
            <span className="smart__slider">
              <small>Quick</small>
              <input type="range" min={1} max={12} value={lag} onChange={(e) => setLag(Number(e.target.value))} aria-label="Smoothness" />
              <small>Smooth</small>
            </span>
          </label>
          <div className="form__row">
            <span>Look every</span>
            <Choice
              value={every}
              options={[
                [5, '5 frames'],
                [10, '10 frames'],
                [15, '15 frames'],
                [30, '30 frames'],
              ]}
              onChange={(v) => {
                setEvery(v);
                setFound(null);
              }}
              label="How often to look"
            />
          </div>
          <p className="insp__note">
            Makes a new {aspect} sequence from “{s.name}”. Faces are found on this computer in small copies of the frames; the picture follows the main person,
            holding still for small moves. {clips.length} clip{clips.length === 1 ? '' : 's'} to look at.
          </p>
          {found && !stale && (
            <ul className="smart__list smart__list--short">
              {stats.map(({ clip, seen }) => (
                <li key={clip.id}>
                  <span>{clip.name}</span>
                  <small>{seen > 0 ? `people seen in ${Math.round(seen * 100)}% of frames` : 'nobody seen: stays centered'}</small>
                </li>
              ))}
            </ul>
          )}
          {stale && <p className="form__problem">The sequence changed since it was analyzed. Analyze again.</p>}
          {job.problem && <p className="form__problem">{job.problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn" disabled={clips.length === 0} onClick={() => void analyze()}>
              {found ? 'Look again' : 'Find faces'}
            </button>
            <button type="button" className="btn btn--primary" disabled={!found || stale} onClick={create}>
              Make the {aspect} sequence
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Highlight reel.

const HOP_HIGHLIGHT = 0.5;

function HighlightDialog({ doc, engine, ui, onClose }: { doc: Doc; engine: Engine; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const fps = rate(s);
  const [target, setTarget] = useState(60);
  const [custom, setCustom] = useState(120);
  const [length, setLength] = useState(8);
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS.join(', '));
  const [fade, setFade] = useState(12);
  const [title, setTitle] = useState(s.name);
  const [withTitle, setWithTitle] = useState(true);
  const [moments, setMoments] = useState<(Moment & { on: boolean })[] | null>(null);
  const [seq, setSeq] = useState<Sequence | null>(null);
  const job = useJob();
  const stale = changed(seq, s);
  const goal = target > 0 ? target : custom;
  const chosen = (moments ?? []).filter((m) => m.on);
  const total = chosen.reduce((a, m) => a + (m.to - m.from), 0);

  const analyze = async () => {
    const p = doc.project;
    const sq = current(p);
    const res = await job.run(async (j) => {
      const levels = await sequenceLevels(p, sq, HOP_HIGHLIGHT, false, j);
      j.progress(0.95, 'Choosing the best moments…');
      const words = wordsInSeconds(p, sq);
      const inp = {
        hop: HOP_HIGHLIGHT,
        levels,
        words,
        markers: sq.markers.map((m) => ({ at: m.at / fps, name: m.name })),
        changes: cameraChanges(sq).map((f) => f / fps),
        keywords: keywords
          .split(/[,\n]/)
          .map((k) => k.trim())
          .filter(Boolean),
      };
      const scores = scoreMoments(inp);
      return pickMoments(inp, scores, { target: goal, length, minLength: Math.min(3, length) }, levels.length * HOP_HIGHLIGHT);
    });
    if (res) {
      setMoments(res.map((m) => ({ ...m, on: true })));
      setSeq(sq);
    }
  };
  const move = (i: number, d: -1 | 1) => {
    if (!moments) return;
    const next = [...moments];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as Moment & { on: boolean }, next[i] as Moment & { on: boolean }];
    setMoments(next);
  };
  const create = () => {
    const reel = buildReel(current(doc.project), chosen, { fade, title: withTitle && title.trim() ? title.trim() : null, name: `${s.name} highlights` });
    doc.edit((p) => addReel(p, reel), 'Highlight reel');
    ui.note(`Made “${reel.name}” (${secs(total)}): ${chosen.length} moments.`);
    onClose();
  };

  return (
    <Modal title="Highlight reel" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : (
        <div className="form">
          <div className="form__row">
            <span>Length</span>
            <span className="form__pair">
              <Choice
                value={target}
                options={[
                  [30, '30 s'],
                  [60, '60 s'],
                  [90, '90 s'],
                  [0, 'Custom'],
                ]}
                onChange={setTarget}
                label="Reel length"
              />
              {target === 0 && (
                <input
                  className="text smart__num"
                  type="number"
                  min={10}
                  max={1800}
                  value={custom}
                  onChange={(e) => setCustom(Math.max(10, Number(e.target.value) || 10))}
                  aria-label="Seconds"
                />
              )}
            </span>
          </div>
          <label className="form__row">
            <span>Each moment</span>
            <span className="smart__slider">
              <input type="range" min={3} max={30} value={length} onChange={(e) => setLength(Number(e.target.value))} aria-label="Moment length" />
              <small>about {length} s</small>
            </span>
          </label>
          <label className="form__row smart__top">
            <span>Key words</span>
            <textarea className="text smart__words" rows={2} value={keywords} onChange={(e) => setKeywords(e.target.value)} aria-label="Key words" />
          </label>
          <div className="form__row">
            <span>Between moments</span>
            <Choice
              value={fade}
              options={[
                [0, 'Cut'],
                [8, 'Quick dissolve'],
                [12, 'Dissolve'],
                [20, 'Slow dissolve'],
              ]}
              onChange={setFade}
              label="Between moments"
            />
          </div>
          <div className="form__row">
            <span>Title</span>
            <span className="form__pair">
              <input type="checkbox" checked={withTitle} onChange={(e) => setWithTitle(e.target.checked)} aria-label="Add a title" />
              <input className="text" value={title} disabled={!withTitle} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
            </span>
          </div>
          <p className="insp__note">
            Scores every moment by key words in the transcript, the room reacting (applause, laughter), REPLAY and highlight markers, and new speakers.
            {project.media.some((m) => m.transcript?.words.length) ? '' : ' Transcribe first for the key words to count.'}
          </p>
          {moments && !stale && (
            <>
              <div className="smart__listhead">
                <span>
                  {chosen.length} moments · {secs(total)} of {secs(goal)}
                </span>
              </div>
              <ol className="smart__list">
                {moments.map((m, i) => (
                  <li key={m.id} className={m.on ? 'is-on' : ''}>
                    <input
                      type="checkbox"
                      checked={m.on}
                      onChange={() => setMoments(moments.map((x) => (x.id === m.id ? { ...x, on: !x.on } : x)))}
                      aria-label="Use this moment"
                    />
                    <button type="button" className="smart__time" onClick={() => seek(engine, m.from * fps)}>
                      {secs(m.from)}
                    </button>
                    <small>{(m.to - m.from).toFixed(1)} s</small>
                    <span className="smart__why" title={m.text}>
                      <b>{m.why}</b> {m.text && `“${m.text}…”`}
                    </span>
                    <span className="smart__order">
                      <button type="button" aria-label="Earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                        ↑
                      </button>
                      <button type="button" aria-label="Later" disabled={i === moments.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown />
                      </button>
                    </span>
                  </li>
                ))}
                {moments.length === 0 && <li className="smart__empty">No moments stood out. Try a shorter length for each moment, or add key words.</li>}
              </ol>
            </>
          )}
          {stale && <p className="form__problem">The sequence changed since it was analyzed. Analyze again.</p>}
          {job.problem && <p className="form__problem">{job.problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn" onClick={() => void analyze()}>
              {moments ? 'Analyze again' : 'Find moments'}
            </button>
            <button type="button" className="btn btn--primary" disabled={!moments || stale || chosen.length === 0} onClick={create}>
              Make the reel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Frames where the picture changes camera (or source) on the main video track. */
function cameraChanges(s: Sequence): number[] {
  const v1 = s.tracks.find((t) => t.kind === 'video' && !t.captions);
  if (!v1) return [];
  const clips = s.clips.filter((c) => c.track === v1.id).sort((a, b) => a.start - b.start);
  const key = (c: Clip) => (c.source.kind === 'multicam' ? c.source.angle : c.source.kind === 'media' ? c.source.media : c.source.kind);
  const out: number[] = [];
  for (let i = 1; i < clips.length; i++) if (key(clips[i] as Clip) !== key(clips[i - 1] as Clip)) out.push((clips[i] as Clip).start);
  return out;
}
