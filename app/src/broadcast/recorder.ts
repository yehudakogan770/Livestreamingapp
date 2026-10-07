// Records and streams the Live Screen: the compositor's picture and the
// Stream mix are encoded by the WebView (hardware encoder where there is one)
// and sent, chunk by chunk and in order, to the app, which writes the file or
// feeds FFmpeg. See src-tauri/src/capture.rs.
//
// With the unified engine (Settings → Engine → Unified), the engine encodes
// its own picture of the Live Screen and this window only sends it the
// sound mix (audio/engineTap.ts): no compositor here, no camera opened.
// Chapters, cuts, the event file and the microphones' own files stay here.

import type { CaptureKind, CaptureRunning, CaptureSettings, EngineClient, Quality, SessionKind } from '../engine/client';
import type { Show } from '../engine/types/Show';
import type { SoundEngine } from '../audio/soundEngine';
import { ProgramCompositor } from './compositor';
import { ReplayBuffer, type Piece } from './replay';
import { VerticalFrame } from './vertical';
import { CaptionLayer } from './captionLayer';
import type { Captions } from '../engine/types/Captions';
import { EngineTap } from '../audio/engineTap';
import { engineCaptureStart, engineCaptureStop, onEngineFeedLost, refreshEngineInfo, sendEngineSound, unifiedOn } from '../engine/unified';

export const QUALITIES: Record<Quality, { name: string; width: number; height: number; fps: number; kbps: number }> = {
  '720p': { name: '720p (1280 × 720), 30 frames a second', width: 1280, height: 720, fps: 30, kbps: 3000 },
  '720p60': { name: '720p, 60 frames a second', width: 1280, height: 720, fps: 60, kbps: 4500 },
  '1080p': { name: '1080p (1920 × 1080), 30 frames a second', width: 1920, height: 1080, fps: 30, kbps: 6000 },
  '1080p60': { name: '1080p, 60 frames a second (smoothest, needs a fast computer)', width: 1920, height: 1080, fps: 60, kbps: 9000 },
  '1440p': { name: '1440p (2560 × 1440), 30 frames a second', width: 2560, height: 1440, fps: 30, kbps: 12000 },
  '1440p60': { name: '1440p, 60 frames a second (fast computer)', width: 2560, height: 1440, fps: 60, kbps: 18000 },
  '2160p': { name: '4K (3840 × 2160), 30 frames a second (recording; YouTube 4K)', width: 3840, height: 2160, fps: 30, kbps: 25000 },
  '2160p60': { name: '4K, 60 frames a second (powerful computer with a graphics card)', width: 3840, height: 2160, fps: 60, kbps: 40000 },
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
  /** The WebView's encoder (null: the unified engine encodes it). */
  recorder: MediaRecorder | null;
  video: MediaStream | null;
  audio: MediaStream | null;
  /** The mix the unified engine is sent (its sessions only). */
  engineMix: 'master' | 'b' | null;
  /** Chunks are sent one after another, never out of order. */
  sending: Promise<void>;
  /** Each camera's own recording (ISO). */
  isos: Iso[];
  /** What was on air when (recordings). */
  chapters: { at: number; name: string }[] | null;
  /** Every change of what was on air (recordings, for the editing program). */
  cuts: { at: number; id: string | null; name: string }[];
  name: string;
  startedAt: number;
  /** It sends the vertical picture (not the wide one). */
  vertical: boolean;
}

interface Iso {
  id: number;
  /** Null: the unified engine records it (from its own frames of the camera). */
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  sending: Promise<void>;
  kind: 'camera' | 'microphone';
  /** The input it records. */
  sourceId: string;
  name: string;
  path: string;
  /** When it started, ms after the recording did. */
  startMs: number;
  /** Stop listening (microphones). */
  release?: () => void;
}

/** The event file: everything the editing program needs to lay out the whole event. */
export interface EventFile {
  app: 'Lumora';
  version: 1;
  name: string;
  /** When the recording started (ms since 1970). */
  startedAt: number;
  durationMs: number | null;
  /** The Live Screen recording (it may have become an .mp4 when it finished). */
  program: { path: string | null; mp4: string | null };
  files: { kind: 'camera' | 'microphone'; sourceId: string; name: string; path: string; startMs: number }[];
  /** What was on air when (ms after the start). */
  cuts: { at: number; id: string | null; name: string }[];
}

/** The event file for a recording so far (or finished). */
export function eventFile(live: Pick<Live, 'name' | 'startedAt' | 'running' | 'isos' | 'cuts'>, endedAt: number | null): EventFile {
  const path = live.running.path ?? null;
  return {
    app: 'Lumora',
    version: 1,
    name: live.name,
    startedAt: live.startedAt,
    durationMs: endedAt === null ? null : endedAt - live.startedAt,
    program: { path, mp4: path ? path.replace(/\.(mkv|webm)$/i, '.mp4') : null },
    files: live.isos.map((i) => ({ kind: i.kind, sourceId: i.sourceId, name: i.name, path: i.path, startMs: i.startMs })),
    cuts: live.cuts,
  };
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
  /** The stream's copy of the picture, with captions when asked (the recording stays clean). */
  private readonly layer = typeof document === 'undefined' ? null : ((l) => (l.works ? l : null))(new CaptionLayer());
  /** The captions to write in the stream picture now (none: nothing written). */
  captionsInPicture: () => { lines: string[]; look: Captions } | null = () => null;
  /** A session's encoder stopped by itself (the app does not know yet). */
  onLost: ((kind: SessionKind, session: number, message: string) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private fps = 0;

  constructor(
    private readonly client: EngineClient,
    private readonly sound: SoundEngine | null,
  ) {
    // The unified engine's own encoder stopping is a lost session too.
    onEngineFeedLost((kind, session, message) => {
      if (this.live.get(kind)?.running.session === session) this.onLost?.(kind, session, message);
    });
  }

  // ---- the unified engine ----

  /** One tap per mix the engine is sent, shared by the sessions that use it. */
  private readonly taps = new Map<'master' | 'b', { tap: EngineTap; users: number }>();

  private tapMix(mix: 'master' | 'b'): void {
    const t = this.taps.get(mix);
    if (t) {
      t.users++;
      return;
    }
    const sound = this.sound;
    if (!sound) return;
    const tap = new EngineTap(
      sound.context,
      (into) => sound.tapMix(mix, into),
      (pcm, at, rate) => sendEngineSound(mix, pcm, at, rate),
    );
    this.taps.set(mix, { tap, users: 1 });
  }

  private untapMix(mix: 'master' | 'b'): void {
    const t = this.taps.get(mix);
    if (!t || --t.users > 0) return;
    t.tap.stop();
    this.taps.delete(mix);
  }

  /** The engine's encoder, as {@link frameStats} reports the WebView's: frames a second sent, and late ones. */
  private engineFrames: { fps: number; target: number; dropped: number } | null = null;
  private enginePoll: ReturnType<typeof setInterval> | null = null;

  private watchEngine(target: number): void {
    if (this.enginePoll) return;
    let last: { n: number; t: number } | null = null;
    this.engineFrames = { fps: 0, target, dropped: 0 };
    this.enginePoll = setInterval(() => {
      void refreshEngineInfo()
        .then((i) => {
          const f = i?.stats?.feed;
          if (!f || !this.engineFrames) return;
          const now = performance.now();
          if (last && now > last.t) this.engineFrames.fps = Math.round(((f.framesIn - last.n) / ((now - last.t) / 1000)) * 10) / 10;
          this.engineFrames.dropped = f.framesDropped;
          last = { n: f.framesIn, t: now };
        })
        .catch(() => {});
    }, 1000);
  }

  private unwatchEngine(): void {
    if ([...this.live.values()].some((l) => l.engineMix)) return;
    if (this.enginePoll) clearInterval(this.enginePoll);
    this.enginePoll = null;
    this.engineFrames = null;
  }

  /** Start a session the unified engine encodes (its picture of the Live Screen, this window's sound). */
  private async openEngine(
    kind: SessionKind,
    q: { width: number; height: number; fps: number },
    vertical: boolean,
    settings: CaptureSettings,
    name: string,
    rehearse: boolean,
  ): Promise<CaptureRunning> {
    if (this.live.has(kind)) throw new Error(kind === 'record' ? 'Already recording.' : 'Already streaming.');
    const mix = kind === 'record' && settings.recordMix === 'recording' ? 'b' : 'master';
    const { running, isos } = await engineCaptureStart({
      kind,
      name,
      rehearse,
      width: q.width,
      height: q.height,
      fps: q.fps,
      vertical,
      mix,
      sampleRate: this.sound?.context.sampleRate ?? 48000,
      iso: kind === 'record' && settings.iso,
      isoSkip: settings.isoSkip ?? [],
      isoKbps: settings.isoKbps ?? null,
    });
    this.tapMix(mix);
    this.watchEngine(q.fps);
    const live: Live = {
      running,
      recorder: null,
      video: null,
      audio: null,
      engineMix: mix,
      sending: Promise.resolve(),
      isos: isos.map((i) => ({
        id: i.id,
        recorder: null,
        stream: null,
        sending: Promise.resolve(),
        kind: 'camera' as const,
        sourceId: i.sourceId,
        name: i.name,
        path: i.path,
        startMs: 0,
      })),
      chapters: kind === 'record' && settings.chapters ? [] : null,
      cuts: [],
      name,
      startedAt: running.startedAt || Date.now(),
      vertical,
    };
    this.live.set(kind, live);
    if (this.show) this.setShow(this.show);
    // The microphones' own files and the event file (the cameras' are the engine's).
    if (kind === 'record') void this.startIsos(live, 0, false, settings.isoSkip ?? [], settings.iso);
    return running;
  }

  setShow(show: Show): void {
    this.show = show;
    this.compositor?.setShow(show);
    // A new chapter whenever something else goes on air.
    const rec = this.live.get('record');
    if (rec) {
      const id = show.screens.live.program;
      const name = show.sources.find((x) => x.id === id)?.name ?? 'Black';
      const at = Date.now() - rec.startedAt;
      if (rec.cuts[rec.cuts.length - 1]?.id !== id) rec.cuts.push({ at, id, name });
      const last = rec.chapters?.[rec.chapters.length - 1];
      if (rec.chapters && last?.name !== name) rec.chapters.push({ at, name });
    }
  }

  running(kind: SessionKind): CaptureRunning | null {
    return this.live.get(kind)?.running ?? null;
  }

  /**
   * Start recording or streaming.
   * @throws Error with a message for the operator if it can't start.
   */
  async start(kind: CaptureKind, settings: CaptureSettings, name: string, rehearse = false): Promise<CaptureRunning> {
    if (this.live.has(kind)) throw new Error(kind === 'record' ? 'Already recording.' : 'Already streaming.');
    if (unifiedOn()) {
      const vertical = settings.quality === 'vertical';
      return this.openEngine(kind, QUALITIES[settings.quality], vertical, settings, name, rehearse);
    }
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
    const running = await this.open(kind, vertical, q.fps, settings.videoKbps, settings, name, mime, rehearse);
    if (kind === 'record')
      void this.startIsos(this.live.get('record')!, settings.isoKbps ?? Math.min(settings.videoKbps, 8000), settings.iso, settings.isoSkip ?? [], settings.iso);
    return running;
  }

  /**
   * Start the vertical version beside the stream (for the destinations that want it).
   * @throws Error with a message for the operator if it can't start.
   */
  async startVertical(settings: CaptureSettings, name: string, rehearse = false): Promise<CaptureRunning | null> {
    if (this.live.has('vertical') || !this.live.has('stream') || !wantsVertical(settings)) return null;
    if (unifiedOn()) return this.openEngine('vertical', QUALITIES.vertical, true, settings, name, rehearse);
    const mime = recordingType();
    if (!mime) return null;
    const q = QUALITIES.vertical;
    return this.open('vertical', true, q.fps, Math.min(settings.videoKbps, q.kbps), settings, name, mime, rehearse);
  }

  /**
   * Offer the Live Screen on the network as NDI (the clean picture, as recorded).
   * @throws Error with a message for the operator if it can't start.
   */
  async startNdi(settings: CaptureSettings): Promise<CaptureRunning> {
    if (this.live.has('ndi')) throw new Error('Already sending NDI.');
    if (unifiedOn()) return this.openEngine('ndi', QUALITIES[settings.quality === 'vertical' ? '1080p' : settings.quality], false, settings, 'NDI', false);
    const mime = recordingType();
    if (!mime) throw new Error('This computer’s web view can’t encode video for NDI.');
    const q = QUALITIES[settings.quality === 'vertical' ? '1080p' : settings.quality];
    if (!this.compositor) {
      this.compositor = new ProgramCompositor(this.client, q.width, q.height);
      if (this.show) this.compositor.setShow(this.show);
    }
    if (this.live.size === 0) this.compositor.resize(q.width, q.height);
    // Plenty of bitrate: it's only unpacked again on this computer.
    return this.open('ndi', false, q.fps, Math.max(settings.videoKbps, 12000), settings, 'NDI', mime);
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
    rehearse = false,
  ): Promise<CaptureRunning> {
    const compositor = this.compositor!;
    let running: CaptureRunning;
    try {
      running = await this.client.captureStart(kind, mime, name, rehearse);
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    this.run(Math.max(fps, this.fps));
    const streamed = (kind === 'stream' || kind === 'vertical') && this.layer;
    if (streamed) this.drawLayer(compositor.canvas);
    if (vertical) this.verticalFrame().draw(streamed ? this.layer!.canvas : compositor.canvas);
    const video = (vertical ? this.verticalFrame().canvas : streamed ? this.layer!.canvas : compositor.canvas).captureStream(fps);
    const audio = this.sound ? this.sound.mixStream(kind === 'record' && settings.recordMix === 'recording' ? 'b' : 'master') : null;
    const stream = new MediaStream([...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        // When FFmpeg encodes again (a hardware encoder, a smaller stream), the app asks for more here.
        videoBitsPerSecond: (running.sourceKbps ?? videoKbps) * 1000,
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
      engineMix: null,
      sending: Promise.resolve(),
      isos: [],
      chapters: kind === 'record' && settings.chapters ? [] : null,
      cuts: [],
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
    // The encoder stopping by itself (a graphics driver reset, the picture
    // ending) sends nothing more: say so, so it is started again.
    const lost = (why: string) => {
      if (this.live.get(kind) === live) this.onLost?.(kind, running.session, why);
    };
    recorder.onerror = (e) => lost(`The video encoder stopped (${(e as Event & { error?: DOMException }).error?.message ?? 'error'}).`);
    recorder.onstop = () => lost('The video encoder stopped.');
    this.live.set(kind, live);
    // The program's clock starts when its encoder does (the cameras' own files are timed from it).
    recorder.onstart = () => {
      live.startedAt = Math.round(performance.timeOrigin + performance.now());
    };
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
    if (live.engineMix) {
      // The engine writes the last of the picture and sound (and the cameras' files), then the session ends.
      await engineCaptureStop(live.running.session).catch(() => {});
      this.untapMix(live.engineMix);
      this.unwatchEngine();
    } else if (live.recorder && live.recorder.state !== 'inactive') {
      const recorder = live.recorder;
      // The last chunk arrives before `stop` fires.
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    await live.sending;
    await Promise.all(live.isos.map((i) => this.stopIso(i)));
    if (!live.engineMix) await this.client.captureStop(live.running.session).catch(() => {});
    if (live.chapters?.length) await this.client.saveChapters(live.name, chapterText(live.chapters)).catch(() => {});
    if (live === this.recordLive) {
      this.recordLive = null;
      await this.client.saveEventFile(live.name, JSON.stringify(eventFile(live, Date.now()), null, 2)).catch(() => {});
    }
    if (live.video) this.release(live.video, live.audio);
    if (this.live.size === 0 && !this.replay) this.run(0);
  }

  /** The app ended this session by itself (it failed): stop encoding for it. */
  abandon(kind: SessionKind, session: number): void {
    if (this.live.get(kind)?.running.session === session) void this.stop(kind);
  }

  // ---- ISO: each camera to its own file ----

  /** The recording whose event file is kept up to date. */
  private recordLive: Live | null = null;

  private async startIsos(live: Live, kbps: number, cameras: boolean, skip: string[] = [], ownFiles = cameras) {
    this.recordLive = live;
    const save = () => void this.client.saveEventFile(live.name, JSON.stringify(eventFile(live, null), null, 2)).catch(() => {});
    save();
    if (!ownFiles) return;
    const mime = recordingType();
    const sources = this.show?.sources ?? [];
    if (cameras && mime && navigator.mediaDevices?.getUserMedia) {
      for (const cam of sources) {
        if (cam.kind.type !== 'camera' || skip.includes(cam.id)) continue;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: cam.kind.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          });
          const file = await this.client.isoStart(live.name, cam.name, mime.includes('matroska') ? 'mkv' : 'webm');
          if (file === null || this.live.get('record') !== live) {
            stream.getTracks().forEach((t) => t.stop());
            if (file !== null) void this.client.isoStop(file.id);
            return;
          }
          const recorder = new MediaRecorder(stream, { mimeType: mime.replace(/,opus/, ''), videoBitsPerSecond: kbps * 1000 });
          this.keep(live, { ...file, recorder, stream, sending: Promise.resolve(), kind: 'camera', sourceId: cam.id, name: cam.name, startMs: 0 });
        } catch {
          // A camera that can't be opened twice is left out; the main recording carries on.
        }
      }
    }
    // Each microphone as it hears (before its fader), for the editing program.
    const sound = this.sound;
    const audioType = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : null;
    if (sound && audioType) {
      for (const mic of sources) {
        if (mic.kind.type !== 'microphone' || skip.includes(mic.id) || this.live.get('record') !== live) continue;
        try {
          const dest = sound.context.createMediaStreamDestination();
          const release = sound.listen(mic.id, dest, true);
          const file = await this.client.isoStart(live.name, `${mic.name} (sound)`, 'webm');
          if (file === null) {
            release();
            continue;
          }
          const recorder = new MediaRecorder(dest.stream, { mimeType: audioType, audioBitsPerSecond: 192_000 });
          this.keep(live, {
            ...file,
            recorder,
            stream: dest.stream,
            sending: Promise.resolve(),
            kind: 'microphone',
            sourceId: mic.id,
            name: mic.name,
            startMs: 0,
            release,
          });
        } catch {
          // A microphone that can't be recorded on its own is left out.
        }
      }
    }
    save();
  }

  /** Start a camera's or microphone's own recording, noting when it began. */
  private keep(live: Live, iso: Iso & { recorder: MediaRecorder }) {
    iso.recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      iso.sending = iso.sending
        .then(() => e.data.arrayBuffer())
        .then((b) => this.client.isoChunk(iso.id, b))
        .catch(() => {});
    };
    // Lined up by when each encoder really began (its start event), on the
    // same clock as the program recording's, so Studio can put them in step.
    iso.recorder.onstart = () => {
      iso.startMs = Math.max(0, Math.round(performance.timeOrigin + performance.now() - live.startedAt));
    };
    iso.recorder.start(1000);
    iso.startMs = Date.now() - live.startedAt;
    live.isos.push(iso);
  }

  private async stopIso(iso: Iso) {
    // The engine's own (cameras in Unified): stopped with its session.
    const recorder = iso.recorder;
    if (!recorder) return;
    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    await iso.sending;
    iso.release?.();
    iso.stream?.getTracks().forEach((t) => t.stop());
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
    // It would draw the picture here again, cameras and all.
    if (unifiedOn()) throw new Error('Instant replay is not in the unified engine yet (beta). Switch to Standard in Settings → Engine to use it.');
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

  private drawLayer(src: HTMLCanvasElement) {
    const c = this.captionsInPicture();
    this.layer?.draw(src, c?.lines ?? [], c?.look ?? null);
  }

  /** When each of the last frames was drawn, and how many came late. */
  private drawn: number[] = [];
  private late = 0;

  /** Frames drawn in the last second and frames late (dropped) since drawing began; null when not drawing. */
  frameStats(): { fps: number; target: number; dropped: number } | null {
    if (this.engineFrames) return { ...this.engineFrames };
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
        const streaming = this.live.has('stream') || this.live.has('vertical');
        if (streaming) this.drawLayer(c.canvas);
        if (this.frame && [...this.live.values()].some((l) => l.vertical)) this.frame.draw(streaming && this.layer ? this.layer.canvas : c.canvas);
        this.drawn.push(t);
        if (this.drawn.length > fps * 2) this.drawn.splice(0, this.drawn.length - fps * 2);
      };
      draw();
      this.timer = setInterval(draw, frame);
    }
  }
}
