// Records and streams the Live Screen: the compositor's picture and the
// Stream mix are encoded by the WebView (hardware encoder where there is one)
// and sent, chunk by chunk and in order, to the app, which writes the file or
// feeds FFmpeg. See src-tauri/src/capture.rs.

import type { CaptureKind, CaptureRunning, CaptureSettings, EngineClient, Quality, SessionKind } from '../engine/client';
import type { Show } from '../engine/types/Show';
import type { SoundEngine } from '../audio/soundEngine';
import { ProgramCompositor } from './compositor';
import { ReplayBuffer, type Piece } from './replay';
import { VerticalFrame } from './vertical';

export const QUALITIES: Record<Quality, { name: string; width: number; height: number; fps: number; kbps: number }> = {
  '720p': { name: '720p (1280 × 720), 30 frames a second', width: 1280, height: 720, fps: 30, kbps: 3000 },
  '720p60': { name: '720p, 60 frames a second', width: 1280, height: 720, fps: 60, kbps: 4500 },
  '1080p': { name: '1080p (1920 × 1080), 30 frames a second', width: 1920, height: 1080, fps: 30, kbps: 6000 },
  '1080p60': { name: '1080p, 60 frames a second (smoothest, needs a fast computer)', width: 1920, height: 1080, fps: 60, kbps: 9000 },
  '1440p': { name: '1440p (2560 × 1440), 30 frames a second', width: 2560, height: 1440, fps: 30, kbps: 12000 },
  '1440p60': { name: '1440p, 60 frames a second (fast computer)', width: 2560, height: 1440, fps: 60, kbps: 18000 },
  '2160p': { name: '4K (3840 × 2160), 30 frames a second (recording; YouTube 4K)', width: 3840, height: 2160, fps: 30, kbps: 25000 },
  vertical: { name: 'Vertical 1080 × 1920 — Shorts, Reels, TikTok (the whole picture, fitted)', width: 1080, height: 1920, fps: 30, kbps: 6000 },
};

/** H.264 first: it goes to YouTube and into .mp4 files without re-encoding. */
const TYPES = ['video/x-matroska;codecs=avc1,opus', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** The best format this computer can encode, or null if it can't record at all. */
export function recordingType(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined' || !('captureStream' in HTMLCanvasElement.prototype)) return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

interface Live {
  running: CaptureRunning;
  recorder: MediaRecorder;
  video: MediaStream;
  audio: MediaStream | null;
  /** Chunks are sent one after another, never out of order. */
  sending: Promise<void>;
  /** Each camera's own recording (ISO). */
  isos: Iso[];
  /** What was on air when (recordings). */
  chapters: { at: number; name: string }[] | null;
  name: string;
  startedAt: number;
  /** It sends the vertical picture (not the wide one). */
  vertical: boolean;
}

interface Iso {
  id: number;
  recorder: MediaRecorder;
  stream: MediaStream;
  sending: Promise<void>;
}

/** Some enabled destinations want the vertical version beside the wide stream. */
export function wantsVertical(settings: CaptureSettings): boolean {
  return settings.quality !== 'vertical' && settings.destinations.some((d) => d.enabled && d.vertical && d.url.trim() !== '');
}

/** "m:ss" or "h:mm:ss" from the start, as YouTube chapters are written. */
export function chapterTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The chapter list: one line per change of what was on air (quick flicks under 10 s are left out). */
export function chapterText(chapters: { at: number; name: string }[]): string {
  const kept = chapters.filter((c, i) => i === chapters.length - 1 || chapters[i + 1]!.at - c.at >= 10_000);
  const lines: string[] = [];
  for (const c of kept)
    if (lines.length === 0 || !lines[lines.length - 1]!.endsWith(` ${c.name}`)) lines.push(`${chapterTime(lines.length === 0 ? 0 : c.at)} ${c.name}`);
  return lines.join('\n') + '\n';
}

export class Broadcaster {
  /** Made when first needed, so a computer that can't draw never affects the control window. */
  private compositor: ProgramCompositor | null = null;
  private show: Show | null = null;
  private readonly live = new Map<SessionKind, Live>();
  /** The vertical picture, made from the wide one (only while something sends it). */
  private frame: VerticalFrame | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fps = 0;

  constructor(
    private readonly client: EngineClient,
    private readonly sound: SoundEngine | null,
  ) {}

  setShow(show: Show): void {
    this.show = show;
    this.compositor?.setShow(show);
    // A new chapter whenever something else goes on air.
    const rec = this.live.get('record');
    if (rec?.chapters) {
      const id = show.screens.live.program;
      const name = show.sources.find((x) => x.id === id)?.name ?? 'Black';
      const last = rec.chapters[rec.chapters.length - 1];
      if (last?.name !== name) rec.chapters.push({ at: Date.now() - rec.startedAt, name });
    }
  }

  running(kind: SessionKind): CaptureRunning | null {
    return this.live.get(kind)?.running ?? null;
  }

  /**
   * Start recording or streaming.
   * @throws Error with a message for the operator if it can't start.
   */
  async start(kind: CaptureKind, settings: CaptureSettings, name: string): Promise<CaptureRunning> {
    if (this.live.has(kind)) throw new Error(kind === 'record' ? 'Already recording.' : 'Already streaming.');
    const mime = recordingType();
    if (!mime) throw new Error('This computer’s web view can’t record video. Recording and streaming work in the Windows app.');
    const q = QUALITIES[settings.quality];
    if (!this.compositor) {
      // Always drawn wide; the vertical version is made from it.
      const w = settings.quality === 'vertical' ? QUALITIES['1080p'] : q;
      this.compositor = new ProgramCompositor(this.client, w.width, w.height);
      if (this.show) this.compositor.setShow(this.show);
    }
    const compositor = this.compositor;
    // A vertical picture is made from the whole wide one (nothing cut off).
    const vertical = settings.quality === 'vertical';
    const wide = vertical ? QUALITIES['1080p'] : q;
    // The picture keeps the size it started with while anything is running.
    if (this.live.size === 0) compositor.resize(wide.width, wide.height);
    const running = await this.open(kind, vertical, q.fps, settings.videoKbps, settings, name, mime);
    if (kind === 'record' && settings.iso) void this.startIsos(this.live.get('record')!, settings.videoKbps);
    return running;
  }

  /**
   * Start the vertical version beside the stream (for the destinations that want it).
   * @throws Error with a message for the operator if it can't start.
   */
  async startVertical(settings: CaptureSettings, name: string): Promise<CaptureRunning | null> {
    if (this.live.has('vertical') || !this.live.has('stream') || !wantsVertical(settings)) return null;
    const mime = recordingType();
    if (!mime) return null;
    const q = QUALITIES.vertical;
    return this.open('vertical', true, q.fps, Math.min(settings.videoKbps, q.kbps), settings, name, mime);
  }

  /** The vertical picture (made when first needed). */
  private verticalFrame(): VerticalFrame {
    this.frame ??= new VerticalFrame(QUALITIES.vertical.width, QUALITIES.vertical.height);
    return this.frame;
  }

  private async open(
    kind: SessionKind,
    vertical: boolean,
    fps: number,
    videoKbps: number,
    settings: CaptureSettings,
    name: string,
    mime: string,
  ): Promise<CaptureRunning> {
    const compositor = this.compositor!;
    let running: CaptureRunning;
    try {
      running = await this.client.captureStart(kind, mime, name);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    this.run(Math.max(fps, this.fps));
    if (vertical) this.verticalFrame().draw(compositor.canvas);
    const video = (vertical ? this.verticalFrame().canvas : compositor.canvas).captureStream(fps);
    const audio = this.sound ? this.sound.mixStream(kind === 'record' && settings.recordMix === 'recording' ? 'b' : 'master') : null;
    const stream = new MediaStream([...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: videoKbps * 1000,
        audioBitsPerSecond: (settings.audioKbps || 160) * 1000,
        // A keyframe every 2 s, as streaming services ask (Chromium option).
        videoKeyFrameIntervalDuration: 2000,
      } as MediaRecorderOptions);
    } catch (e) {
      await this.client.captureStop(running.session);
      this.release(video, audio);
      if (this.live.size === 0 && !this.replay) this.run(0);
      throw new Error(`The video encoder could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
    const live: Live = {
      running,
      recorder,
      video,
      audio,
      sending: Promise.resolve(),
      isos: [],
      chapters: kind === 'record' && settings.chapters ? [] : null,
      name,
      startedAt: Date.now(),
      vertical,
    };
    recorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      live.sending = live.sending
        .then(() => e.data.arrayBuffer())
        .then((buf) => this.client.captureChunk(running.session, buf))
        // A refused chunk means the session ended; the status says why.
        .catch(() => {});
    };
    this.live.set(kind, live);
    recorder.start(500);
    if (this.show) this.setShow(this.show);
    return running;
  }

  /** Stop recording or streaming; resolves once everything has been handed over. */
  async stop(kind: SessionKind): Promise<void> {
    // The vertical version goes with the stream.
    if (kind === 'stream') await this.stop('vertical');
    const live = this.live.get(kind);
    if (!live) return;
    this.live.delete(kind);
    if (live.recorder.state !== 'inactive') {
      // The last chunk arrives before `stop` fires.
      await new Promise<void>((resolve) => {
        live.recorder.addEventListener('stop', () => resolve(), { once: true });
        live.recorder.stop();
      });
    }
    await live.sending;
    await Promise.all(live.isos.map((i) => this.stopIso(i)));
    await this.client.captureStop(live.running.session).catch(() => {});
    if (live.chapters?.length) await this.client.saveChapters(live.name, chapterText(live.chapters)).catch(() => {});
    this.release(live.video, live.audio);
    if (this.live.size === 0 && !this.replay) this.run(0);
  }

  /** The app ended this session by itself (it failed): stop encoding for it. */
  abandon(kind: SessionKind, session: number): void {
    if (this.live.get(kind)?.running.session === session) void this.stop(kind);
  }

  // ---- ISO: each camera to its own file ----

  private async startIsos(live: Live, kbps: number) {
    const cams = (this.show?.sources ?? []).filter((s) => s.kind.type === 'camera');
    const mime = recordingType();
    if (!mime || !navigator.mediaDevices?.getUserMedia) return;
    for (const cam of cams) {
      if (cam.kind.type !== 'camera') continue;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: cam.kind.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        const id = await this.client.isoStart(live.name, cam.name, mime.includes('matroska') ? 'mkv' : 'webm');
        if (id === null || this.live.get('record') !== live) {
          stream.getTracks().forEach((t) => t.stop());
          if (id !== null) void this.client.isoStop(id);
          return;
        }
        const recorder = new MediaRecorder(stream, { mimeType: mime.replace(/,opus/, ''), videoBitsPerSecond: kbps * 1000 });
        const iso: Iso = { id, recorder, stream, sending: Promise.resolve() };
        recorder.ondataavailable = (e) => {
          if (!e.data.size) return;
          iso.sending = iso.sending
            .then(() => e.data.arrayBuffer())
            .then((b) => this.client.isoChunk(id, b))
            .catch(() => {});
        };
        recorder.start(1000);
        live.isos.push(iso);
      } catch {
        // A camera that can't be opened twice is left out; the main recording carries on.
      }
    }
  }

  private async stopIso(iso: Iso) {
    if (iso.recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        iso.recorder.addEventListener('stop', () => resolve(), { once: true });
        iso.recorder.stop();
      });
    }
    await iso.sending;
    iso.stream.getTracks().forEach((t) => t.stop());
    await this.client.isoStop(iso.id).catch(() => {});
  }

  // ---- instant replay ----

  private replay: { buffer: ReplayBuffer; video: MediaStream; audio: MediaStream | null } | null = null;

  get replaying(): boolean {
    return this.replay !== null;
  }

  /** Keep the last minute of the Live Screen for replays. */
  startReplay(): void {
    if (this.replay) return;
    if (!this.compositor) {
      const q = QUALITIES['1080p'];
      this.compositor = new ProgramCompositor(this.client, q.width, q.height);
      if (this.show) this.compositor.setShow(this.show);
    }
    this.run(Math.max(30, this.fps));
    const video = this.compositor.canvas.captureStream(30);
    const audio = this.sound ? this.sound.mixStream('master') : null;
    const stream = new MediaStream([...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
    try {
      this.replay = { buffer: new ReplayBuffer(stream), video, audio };
    } catch (e) {
      this.release(video, audio);
      if (this.live.size === 0) this.run(0);
      throw e;
    }
  }

  stopReplay(): void {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    r.buffer.stop();
    this.release(r.video, r.audio);
    if (this.live.size === 0) this.run(0);
  }

  /** The last `seconds` as pieces (empty if replay is off). */
  async takeReplay(seconds: number): Promise<Piece[]> {
    return this.replay ? this.replay.buffer.take(seconds * 1000) : [];
  }

  dispose(): void {
    this.stopReplay();
    for (const kind of [...this.live.keys()]) void this.stop(kind);
    this.run(0);
    this.compositor?.dispose();
  }

  private release(video: MediaStream, audio: MediaStream | null) {
    video.getTracks().forEach((t) => t.stop());
    if (audio) this.sound?.endMixStream(audio);
  }

  /** When each of the last frames was drawn, and how many came late. */
  private drawn: number[] = [];
  private late = 0;

  /** Frames drawn in the last second and frames late (dropped) since drawing began; null when not drawing. */
  frameStats(): { fps: number; target: number; dropped: number } | null {
    if (!this.fps) return null;
    const now = performance.now();
    return { fps: this.drawn.filter((t) => now - t <= 1000).length, target: this.fps, dropped: this.late };
  }

  /** Draw `fps` frames a second (0: stop drawing). */
  private run(fps: number) {
    if (fps === this.fps) return;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.fps = fps;
    this.drawn = [];
    this.late = 0;
    const c = this.compositor;
    if (fps > 0 && c) {
      const frame = 1000 / fps;
      const draw = () => {
        const t = performance.now();
        const last = this.drawn[this.drawn.length - 1];
        // A frame that comes much later than it should means pictures were missed.
        if (last !== undefined && t - last > frame * 1.8) this.late += Math.round((t - last) / frame) - 1;
        c.draw(Date.now());
        if (this.frame && [...this.live.values()].some((l) => l.vertical)) this.frame.draw(c.canvas);
        this.drawn.push(t);
        if (this.drawn.length > fps * 2) this.drawn.splice(0, this.drawn.length - fps * 2);
      };
      draw();
      this.timer = setInterval(draw, frame);
    }
  }
}
