// Smart > Finish the event: choose what to make, press Finish, and come back
// to the edited event with captions and chapters, a highlight reel and clips
// for social, and (if chosen) all of them in the render queue.
import { useEffect, useRef, useState } from 'react';
import { open as chooseFolder } from '@tauri-apps/plugin-dialog';
import { CAPTION_LOOKS, sequenceWords } from '../model/captions';
import { current } from '../model/seq';
import type { Project, Sequence } from '../model/types';
import { useDoc, type Doc } from '../doc';
import { planDelivery } from '../export/deliver';
import { BUILT_IN, type DeliveryPreset } from '../export/presets';
import { renderQueue } from '../export/renderQueue';
import { inApp, joinPath } from '../native';
import { spansToTranscribe, Transcriber, withTranscripts, type SpeechModel } from '../speech/transcribe';
import { Choice, Modal } from '../ui/controls';
import { encodersHere } from '../ui/Deliver';
import type { Ui } from '../ui/state';
import { micEnvelopes, sequenceLevels, type Job } from './analysis';
import { detectSpeakers, groupsIn } from './autocam';
import { FaceFinder } from './detect';
import { finishEvent, FINISH_DEFAULTS, type FinishPlan, type FinishServices } from './finish';
import { frameOnFaces } from './framejob';
import { Progress, useJob } from './job';
import { publish, startingDescription, youtube, type YoutubeInfo } from '../publish/youtube';
import { ASPECTS } from './reframe';

/** The speech model the person chose last in Transcribe (the small one is better, the base one quicker). */
function speechModel(): SpeechModel {
  try {
    return (JSON.parse(localStorage.getItem('lumora-edit-speech') ?? '{}') as { model?: SpeechModel }).model === 'whisper-small'
      ? 'whisper-small'
      : 'whisper-base';
  } catch {
    return 'whisper-base';
  }
}

/** The computer's side of each step. */
function services(stops: (() => void)[]): FinishServices {
  let finder: FaceFinder | null = null;
  return {
    micLevels: (p, _s, g, mics, hop, job) =>
      micEnvelopes(
        mics.map((m) => ({ media: p.media.find((x) => x.id === m.media)!, offset: m.offset })),
        g.duration,
        hop,
        job,
      ),
    speakers: (envs) => detectSpeakers(envs),
    levels: (p, s, hop, job) => sequenceLevels(p, s, hop, false, job),
    transcribe: async (p, s, job) => {
      const spans = spansToTranscribe(p, s, null);
      const media = p.media.filter((m) => spans.has(m.id));
      if (!media.length) return p;
      const t = new Transcriber(speechModel(), null, (x) => job.progress(0.2 + 0.4 * x.done, x.message));
      stops.push(() => t.stop());
      return withTranscripts(p, await t.run(media, spans));
    },
    frame: async (p, seq, shape, job) => {
      if (!finder) {
        finder = new FaceFinder();
        const f = finder;
        stops.push(() => f.stop());
        await f.start();
      }
      return frameOnFaces(p, seq, shape, finder, job);
    },
  };
}

const preset = (id: string, burn: boolean): { preset: DeliveryPreset; burn: boolean } => ({ preset: BUILT_IN.find((p) => p.id === id) ?? BUILT_IN[0]!, burn });

export function FinishDialog({ doc, ui, onClose }: { doc: Doc; ui: Ui; onClose: () => void }) {
  const { project } = useDoc(doc);
  const s = current(project);
  const hasGroup = groupsIn(project, s).length > 0;
  const heard = sequenceWords(project, s).length > 0;
  const [plan, setPlan] = useState<FinishPlan>({ ...FINISH_DEFAULTS, cut: hasGroup ? 0.5 : null });
  const [queue, setQueue] = useState(inApp());
  const [upload, setUpload] = useState(false);
  const [yt, setYt] = useState<YoutubeInfo | null>(null);
  useEffect(() => {
    let live = true;
    void youtube
      .info()
      .then((i) => live && setYt(i))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const job = useJob();
  const stops = useRef<(() => void)[]>([]);
  useEffect(() => () => stops.current.forEach((f) => f()), []);
  const set = (change: Partial<FinishPlan>) => setPlan({ ...plan, ...change });

  const run = async () => {
    let folder: string | null = null;
    if (queue && inApp()) {
      const picked = await chooseFolder({ directory: true, title: 'Export everything to' });
      if (typeof picked !== 'string') return;
      folder = picked;
    }
    stops.current = [];
    const res = await job.run(
      (j: Job) => finishEvent(doc.project, plan, services(stops.current), j),
      () => stops.current.forEach((f) => f()),
    );
    stops.current.forEach((f) => f());
    if (!res) return;
    doc.edit(() => res.project, 'Finish the event');
    const lines = [...res.done];
    if (folder) {
      try {
        const encoders = await encodersHere();
        const out: { seq: Sequence; choice: { preset: DeliveryPreset; burn: boolean } }[] = [];
        const find = (id: string | null) => res.project.sequences.find((x) => x.id === id);
        const film = find(res.film);
        if (film) out.push({ seq: film, choice: preset('yt1080', false) });
        const reel = find(res.reel);
        if (reel) out.push({ seq: reel, choice: preset('yt1080', true) });
        for (const id of res.clips) {
          const c = find(id);
          if (c) out.push({ seq: c, choice: preset(plan.clipShape === '1:1' ? 'square' : plan.clipShape === '9:16' ? 'shorts' : 'match', true) });
        }
        for (const { seq, choice } of out) {
          const len = Math.max(1, ...seq.clips.map((c) => c.start + c.length));
          const made = planDelivery(withOpen(res.project, seq.id), {
            preset: choice.preset,
            seq: seq.id,
            range: { from: 0, to: len },
            out: joinPath(folder, `${seq.name}.${choice.preset.container}`),
            chapters: seq.id === res.film,
            // The event's captions go up as a file viewers can turn on; the reel's and clips' are in the picture.
            captions: { burn: choice.burn, embed: false, sidecar: !choice.burn },
            encoders,
            app: inApp(),
          });
          const id = renderQueue.add(made, seq.name, choice.preset.name);
          // The event itself goes on to YouTube when it is exported (only you can see it until you change that).
          if (upload && seq.id === res.film) renderQueue.whenDone(id, () => void publishFilm(id, ui));
        }
        lines.push(`${out.length} exports are in the render queue.`);
      } catch (e) {
        lines.push(`The exports could not be queued: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    ui.note(['Finished:', ...lines, ...res.skipped].join(' '));
    onClose();
  };

  return (
    <Modal title="Finish the event" onClose={() => !job.running && onClose()} wide>
      {job.running ? (
        <Progress running={job.running} onStop={job.stop} />
      ) : (
        <div className="form">
          <p className="insp__note">Runs the Smart tools in order on “{s.name}”. Everything they make is one change: Undo takes it all back.</p>
          <div className="form__row">
            <span>Cameras</span>
            {hasGroup ? (
              <Choice
                value={plan.cut === null ? 'off' : plan.cut < 0.35 ? 'calm' : plan.cut > 0.65 ? 'lively' : 'normal'}
                options={[
                  ['off', 'Keep my edit'],
                  ['calm', 'Calm'],
                  ['normal', 'Normal'],
                  ['lively', 'Lively'],
                ]}
                onChange={(v) => set({ cut: v === 'off' ? null : v === 'calm' ? 0.2 : v === 'lively' ? 0.8 : 0.5 })}
                label="Cut between the cameras"
              />
            ) : (
              <small className="insp__note">No multicam clip in this sequence.</small>
            )}
          </div>
          <div className="form__row">
            <span>Speech</span>
            <label className="check">
              <input type="checkbox" checked={plan.transcribe} disabled={heard} onChange={(e) => set({ transcribe: e.target.checked })} />{' '}
              {heard ? 'Already written down' : 'Write down what is said (on this computer)'}
            </label>
          </div>
          <label className="form__row">
            <span>Captions</span>
            <select className="text" value={plan.captions ?? ''} onChange={(e) => set({ captions: e.target.value || null })}>
              <option value="">None</option>
              {CAPTION_LOOKS.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}: {l.note.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <div className="form__row">
            <span>Chapters</span>
            <label className="check">
              <input type="checkbox" checked={plan.chapters} onChange={(e) => set({ chapters: e.target.checked })} /> Chapter markers where the topic changes
            </label>
          </div>
          <div className="form__row">
            <span>Highlight reel</span>
            <Choice
              value={plan.reel ?? 0}
              options={[
                [0, 'None'],
                [60, '1 min'],
                [90, '1½ min'],
                [180, '3 min'],
              ]}
              onChange={(v) => set({ reel: v || null })}
              label="Highlight reel length"
            />
          </div>
          <div className="form__row">
            <span>Clips for social</span>
            <Choice
              value={plan.clips}
              options={[
                [0, 'None'],
                [3, '3'],
                [5, '5'],
                [8, '8'],
              ]}
              onChange={(v) => set({ clips: v })}
              label="How many clips for social"
            />
          </div>
          {plan.clips > 0 && (
            <div className="form__row">
              <span />
              <span className="smart__checks">
                <Choice value={plan.clipShape} options={ASPECTS} onChange={(v) => set({ clipShape: v })} label="Clip shape" />
                <label className="check">
                  <input type="checkbox" checked={plan.faces} onChange={(e) => set({ faces: e.target.checked })} /> Follow the people talking (slower)
                </label>
              </span>
            </div>
          )}
          <div className="form__row">
            <span>Export</span>
            <label className="check">
              <input type="checkbox" checked={queue} disabled={!inApp()} onChange={(e) => setQueue(e.target.checked)} /> Put everything in the render queue (the
              event for YouTube with chapters and a captions file, the reel and the clips with captions in the picture)
            </label>
          </div>
          {queue && yt?.connected && (
            <div className="form__row">
              <span>YouTube</span>
              <label className="check">
                <input type="checkbox" checked={upload} onChange={(e) => setUpload(e.target.checked)} /> Publish the event to {yt.channel || 'the channel'} when
                it is exported (only you can see it until you change that)
              </label>
            </div>
          )}
          {job.problem && <p className="form__problem">{job.problem}</p>}
          <div className="form__foot">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={!s.clips.length} onClick={() => void run()}>
              Finish
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const withOpen = (p: Project, id: string): Project => ({ ...p, open: id });

/** Publish a finished export of the event: its name, chapters, captions file and thumbnail, only for the channel's owner at first. */
async function publishFilm(job: string, ui: Ui) {
  const src = renderQueue.publishSource(job);
  if (!src) return;
  try {
    const r = await publish(
      job,
      src.path,
      {
        title: src.title.slice(0, 100),
        description: startingDescription(src.markers, src.fps, src.range),
        tags: [],
        category: '22',
        visibility: 'private',
        madeForKids: false,
      },
      { thumbnail: src.thumbnail, captions: src.srt ? { path: src.srt, language: 'en', name: 'English' } : null },
    );
    ui.note(`The event is on YouTube (only you can see it): ${r.url}`);
  } catch (e) {
    ui.note(`The event couldn’t be published: ${e instanceof Error ? e.message : String(e)} Publish it from the render queue.`);
  }
}
