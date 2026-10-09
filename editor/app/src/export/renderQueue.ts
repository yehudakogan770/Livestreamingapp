// The render queue at work: exports are made one after another in the
// background while editing carries on (each from the project as it was when
// queued). Says when each is done, with a notification.
import { useSyncExternalStore } from 'react';
import { toSrt, toVtt } from '../model/captions';
import { baseName, inApp, native } from '../native';
import type { Marker } from '../model/types';
import type { DeliveryPlan } from './deliver';
import { Exporter } from './exporter';
import { loudnessReport } from './loudness';
import { manageNative } from '../manage/native';
import { EMPTY_QUEUE, nextToRun, reduce, type QueueEvent, type QueueJob, type QueueState } from './queue';

interface Work {
  plan: DeliveryPlan;
  toLumora: boolean;
  exporter: Exporter | null;
  stage: 'picture' | 'sound' | null;
}

/** Tell the person (a system notification when allowed). */
export function notify(title: string, body: string) {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') new Notification(title, { body });
  } catch {
    // No notifications here: the queue shows it.
  }
}

export function askToNotify() {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => undefined);
  } catch {
    // Fine.
  }
}

let n = 0;

export class RenderQueue {
  state: QueueState = EMPTY_QUEUE;
  private work = new Map<string, Work>();
  private listeners = new Set<() => void>();
  /** Told when an export finishes (or fails). */
  onFinished: (job: QueueJob) => void = () => {};

  subscribe = (f: () => void): (() => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };

  private send(e: QueueEvent) {
    const before = this.state;
    this.state = reduce(this.state, e);
    if (this.state === before) return;
    for (const f of this.listeners) f();
    if (e.type === 'finish' || e.type === 'fail') {
      const j = this.state.jobs.find((x) => x.id === e.id);
      if (j) {
        this.onFinished(j);
        notify(j.status === 'done' ? 'Export finished' : 'Export failed', `${j.name} · ${j.preset}${j.status === 'done' ? '' : `: ${j.message}`}`);
      }
    }
    // The next one starts when this one is over.
    if (e.type === 'finish' || e.type === 'fail' || e.type === 'cancel') queueMicrotask(() => this.pump());
  }

  /** Put an export in the queue; it starts when its turn comes (unless the queue is held). */
  add(plan: DeliveryPlan, name: string, preset: string, toLumora = false): string {
    n += 1;
    const id = `q${Date.now().toString(36)}${n}`;
    this.work.set(id, { plan, toLumora, exporter: null, stage: null });
    this.send({ type: 'add', job: { id, name, preset, out: plan.settings.out }, at: Date.now() });
    askToNotify();
    this.pump();
    return id;
  }

  private pump() {
    const next = nextToRun(this.state);
    if (!next) return;
    const w = this.work.get(next.id);
    if (!w) {
      this.send({ type: 'start', id: next.id });
      this.send({ type: 'fail', id: next.id, message: 'It was lost (start it again).', at: Date.now() });
      this.pump();
      return;
    }
    this.send({ type: 'start', id: next.id });
    if (this.state.jobs.find((j) => j.id === next.id)?.status !== 'running') return;
    void this.run(next.id, w);
  }

  private async run(id: string, w: Work) {
    const { plan } = w;
    const seconds =
      (plan.settings.range.to - plan.settings.range.from) / Math.max(1, plan.project.sequences.find((s) => s.id === plan.project.open)?.fps ?? 30);
    let finished = false;
    const ex = new Exporter(plan.project, plan.settings, (st) => {
      if (st.stage === 'picture' || st.stage === 'sound') {
        w.stage = st.stage;
        this.send({ type: 'progress', id, done: st.done, message: st.message, left: st.left });
        return;
      }
      finished = true;
      if (st.stage === 'done') {
        const notes = [...plan.notes, st.message];
        void this.after(w, st.path, seconds).then((more) =>
          this.send({ type: 'finish', id, path: st.path, message: [...notes, ...more].join(' '), at: Date.now() }),
        );
      } else if (st.stage === 'stopped') this.send({ type: 'cancel', id });
      else this.send({ type: 'fail', id, message: st.message, at: Date.now() });
    });
    w.exporter = ex;
    await ex.run();
    if (!inApp() && ex.lastBuffer) {
      const url = URL.createObjectURL(new Blob([ex.lastBuffer]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'film-picture.webm';
      a.click();
    }
    if (!finished) this.send({ type: 'fail', id, message: 'It stopped without saying why.', at: Date.now() });
    w.exporter = null;
  }

  /** Caption files next to it, and Lumora's library. */
  private async after(w: Work, path: string | null, seconds: number): Promise<string[]> {
    const out: string[] = [];
    if (!path || !inApp()) return out;
    if (w.plan.sidecar.length) {
      const base = path.replace(/\.[^.\\/]+$/, '');
      await Promise.all([native.writeText(`${base}.srt`, toSrt(w.plan.sidecar)), native.writeText(`${base}.vtt`, toVtt(w.plan.sidecar))]).catch((e: unknown) =>
        out.push(`The caption files weren't saved: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
    const th = w.plan.thumbnail;
    if (th)
      await manageNative
        .thumbnail(path, th.seconds, th.width, th.out)
        .then(() => out.push(`Thumbnail: ${baseName(th.out)}.`))
        .catch((e: unknown) => out.push(`The thumbnail wasn't saved: ${e instanceof Error ? e.message : String(e)}`));
    // How loud it came out, against the preset's target.
    if (w.plan.loudnessTarget !== undefined && !/%0\dd/.test(path))
      await manageNative
        .measureLoudness(path)
        .then((m) => {
          const r = loudnessReport(m, w.plan.loudnessTarget ?? null);
          out.push(r.line, ...(r.advice ? [r.advice] : []));
        })
        .catch(() => out.push('The loudness could not be measured.'));
    if (w.toLumora)
      await native
        .sendToLumora(path, baseName(path), seconds)
        .then(() => out.push('It is in Lumora’s library (From Lumora Studio).'))
        .catch((e: unknown) => out.push(e instanceof Error ? e.message : String(e)));
    return out;
  }

  pause(id: string) {
    this.work.get(id)?.exporter?.pause();
    this.send({ type: 'pause', id });
  }

  resume(id: string) {
    this.work.get(id)?.exporter?.resume();
    this.send({ type: 'resume', id });
  }

  cancel(id: string) {
    const w = this.work.get(id);
    const job = this.state.jobs.find((j) => j.id === id);
    if (w?.exporter) {
      w.exporter.stop();
      if (w.stage === 'sound') void native.exportCancel().catch(() => {});
    }
    // A waiting one is simply taken off; the running one says "stopped" when it has.
    if (job?.status === 'queued' || !w?.exporter) this.send({ type: 'cancel', id });
  }

  retry(id: string) {
    this.send({ type: 'retry', id });
    this.pump();
  }

  remove(id: string) {
    this.send({ type: 'remove', id });
    if (!this.state.jobs.some((j) => j.id === id)) this.work.delete(id);
  }

  move(id: string, by: number) {
    this.send({ type: 'move', id, by });
  }

  clearFinished() {
    const keep = new Set(this.state.jobs.map((j) => j.id));
    this.send({ type: 'clear' });
    for (const id of keep) if (!this.state.jobs.some((j) => j.id === id)) this.work.delete(id);
  }

  /** What a finished export needs to be published: its file, captions file and thumbnail, and its sequence's name and markers. */
  publishSource(id: string): PublishSource | null {
    const j = this.state.jobs.find((x) => x.id === id);
    const w = this.work.get(id);
    if (!j || j.status !== 'done' || !j.path || !w || /%0\dd/.test(j.path)) return null;
    const s = w.plan.project.sequences.find((x) => x.id === w.plan.project.open);
    if (!s || w.plan.settings.sound || w.plan.settings.pictureOnly) return null;
    return {
      path: j.path,
      title: s.name,
      srt: w.plan.sidecar.length ? `${j.path.replace(/\.[^.\\/]+$/, '')}.srt` : null,
      thumbnail: w.plan.thumbnail?.out ?? null,
      markers: s.markers,
      fps: s.fps,
      range: w.plan.settings.range,
    };
  }

  hold(on: boolean) {
    this.send({ type: on ? 'hold' : 'release' });
    if (!on) this.pump();
  }
}

/** A finished export, ready to publish. */
export interface PublishSource {
  path: string;
  title: string;
  /** The captions file written next to it. */
  srt: string | null;
  thumbnail: string | null;
  markers: Marker[];
  fps: number;
  range: { from: number; to: number };
}

/** The one queue (it carries on while sequences and dialogs change). */
export const renderQueue = new RenderQueue();

export function useQueue(q: RenderQueue = renderQueue): QueueState {
  return useSyncExternalStore(q.subscribe, () => q.state);
}
