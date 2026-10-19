p='/home/user/Livestreamingapp/.claude/worktrees/agent-aefea299a26a1206e/app/src/broadcast/recorder.ts'
s=open(p).read()
def rep(a,b,cnt=1):
    global s
    assert s.count(a)==cnt, (a, s.count(a))
    s=s.replace(a,b)
rep("""// Records and streams the Live Screen: the compositor's picture and the
// Stream mix are encoded by the WebView (hardware encoder where there is one)
// and sent, chunk by chunk and in order, to the app, which writes the file or
// feeds FFmpeg. See src-tauri/src/capture.rs.""","""// Records and streams the Live Screen: the compositor's picture and the
// Stream mix are encoded by the WebView (hardware encoder where there is one)
// and sent, chunk by chunk and in order, to the app, which writes the file or
// feeds FFmpeg. See src-tauri/src/capture.rs.
//
// With the unified engine (Settings → Engine → Unified), the engine encodes
// its own picture of the Live Screen and this window only sends it the
// sound mix (audio/engineTap.ts): no compositor here, no camera opened.
// Chapters, cuts, the event file and the microphones' own files stay here.""")
rep("""import { CaptionLayer } from './captionLayer';
import type { Captions } from '../engine/types/Captions';""","""import { CaptionLayer } from './captionLayer';
import type { Captions } from '../engine/types/Captions';
import { EngineTap } from '../audio/engineTap';
import { engineCaptureStart, engineCaptureStop, onEngineFeedLost, sendEngineSound, unifiedOn } from '../engine/unified';""")
rep("""interface Live {
  running: CaptureRunning;
  recorder: MediaRecorder;
  video: MediaStream;
  audio: MediaStream | null;""","""interface Live {
  running: CaptureRunning;
  /** The WebView's encoder (null: the unified engine encodes it). */
  recorder: MediaRecorder | null;
  video: MediaStream | null;
  audio: MediaStream | null;
  /** The mix the unified engine is sent (its sessions only). */
  engineMix: 'master' | 'b' | null;""")
rep("""interface Iso {
  id: number;
  recorder: MediaRecorder;
  stream: MediaStream;""","""interface Iso {
  id: number;
  /** Null: the unified engine records it (from its own frames of the camera). */
  recorder: MediaRecorder | null;
  stream: MediaStream | null;""")
rep("""  constructor(
    private readonly client: EngineClient,
    private readonly sound: SoundEngine | null,
  ) {}""","""  constructor(
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
    const tap = new EngineTap(sound.context, (into) => sound.tapMix(mix, into), (pcm, at, rate) => sendEngineSound(mix, pcm, at, rate));
    this.taps.set(mix, { tap, users: 1 });
  }

  private untapMix(mix: 'master' | 'b'): void {
    const t = this.taps.get(mix);
    if (!t || --t.users > 0) return;
    t.tap.stop();
    this.taps.delete(mix);
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
  }""")
# start: engine path
rep("""  async start(kind: CaptureKind, settings: CaptureSettings, name: string, rehearse = false): Promise<CaptureRunning> {
    if (this.live.has(kind)) throw new Error(kind === 'record' ? 'Already recording.' : 'Already streaming.');""","""  async start(kind: CaptureKind, settings: CaptureSettings, name: string, rehearse = false): Promise<CaptureRunning> {
    if (this.live.has(kind)) throw new Error(kind === 'record' ? 'Already recording.' : 'Already streaming.');
    if (unifiedOn()) {
      const vertical = settings.quality === 'vertical';
      return this.openEngine(kind, QUALITIES[settings.quality], vertical, settings, name, rehearse);
    }""")
rep("""    if (this.live.has('vertical') || !this.live.has('stream') || !wantsVertical(settings)) return null;
    const mime = recordingType();""","""    if (this.live.has('vertical') || !this.live.has('stream') || !wantsVertical(settings)) return null;
    if (unifiedOn()) return this.openEngine('vertical', QUALITIES.vertical, true, settings, name, rehearse);
    const mime = recordingType();""")
rep("""    if (this.live.has('ndi')) throw new Error('Already sending NDI.');
    const mime = recordingType();""","""    if (this.live.has('ndi')) throw new Error('Already sending NDI.');
    if (unifiedOn()) return this.openEngine('ndi', QUALITIES[settings.quality === 'vertical' ? '1080p' : settings.quality], false, settings, 'NDI', false);
    const mime = recordingType();""")
# open(): live object needs engineMix
rep("""    const live: Live = {
      running,
      recorder,
      video,
      audio,
      sending: Promise.resolve(),""","""    const live: Live = {
      running,
      recorder,
      video,
      audio,
      engineMix: null,
      sending: Promise.resolve(),""")
rep("""    if (kind === 'record')
      void this.startIsos(this.live.get('record')!, settings.isoKbps ?? Math.min(settings.videoKbps, 8000), settings.iso, settings.isoSkip ?? []);""","""    if (kind === 'record')
      void this.startIsos(this.live.get('record')!, settings.isoKbps ?? Math.min(settings.videoKbps, 8000), settings.iso, settings.isoSkip ?? [], settings.iso);""")
# stop
rep("""    const live = this.live.get(kind);
    if (!live) return;
    this.live.delete(kind);
    if (live.recorder.state !== 'inactive') {""","""    const live = this.live.get(kind);
    if (!live) return;
    this.live.delete(kind);
    if (live.engineMix) {
      // The engine writes the last of the picture and sound (and the cameras' files), then the session ends.
      await engineCaptureStop(live.running.session).catch(() => {});
      this.untapMix(live.engineMix);
    } else if (live.recorder && live.recorder.state !== 'inactive') {""")
rep("""    await live.sending;
    await Promise.all(live.isos.map((i) => this.stopIso(i)));
    await this.client.captureStop(live.running.session).catch(() => {});""","""    await live.sending;
    await Promise.all(live.isos.map((i) => this.stopIso(i)));
    if (!live.engineMix) await this.client.captureStop(live.running.session).catch(() => {});""")
rep("""    this.release(live.video, live.audio);
    if (this.live.size === 0 && !this.replay) this.run(0);
  }

  /** The app ended this session""","""    if (live.video) this.release(live.video, live.audio);
    if (this.live.size === 0 && !this.replay) this.run(0);
  }

  /** The app ended this session""")
# startIsos: cameras flag
rep("""  private async startIsos(live: Live, kbps: number, ownFiles: boolean, skip: string[] = []) {
    this.recordLive = live;
    const save = () => void this.client.saveEventFile(live.name, JSON.stringify(eventFile(live, null), null, 2)).catch(() => {});
    save();
    if (!ownFiles) return;
    const mime = recordingType();
    const sources = this.show?.sources ?? [];
    if (mime && navigator.mediaDevices?.getUserMedia) {""","""  private async startIsos(live: Live, kbps: number, cameras: boolean, skip: string[] = [], ownFiles = cameras) {
    this.recordLive = live;
    const save = () => void this.client.saveEventFile(live.name, JSON.stringify(eventFile(live, null), null, 2)).catch(() => {});
    save();
    if (!ownFiles) return;
    const mime = recordingType();
    const sources = this.show?.sources ?? [];
    if (cameras && mime && navigator.mediaDevices?.getUserMedia) {""")
rep("""  private async stopIso(iso: Iso) {
    if (iso.recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        iso.recorder.addEventListener('stop', () => resolve(), { once: true });
        iso.recorder.stop();
      });
    }
    await iso.sending;
    iso.release?.();
    iso.stream.getTracks().forEach((t) => t.stop());
    await this.client.isoStop(iso.id).catch(() => {});
  }""","""  private async stopIso(iso: Iso) {
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
  }""")
rep("""  private keep(live: Live, iso: Iso) {
    iso.recorder.ondataavailable = (e) => {""","""  private keep(live: Live, iso: Iso & { recorder: MediaRecorder }) {
    iso.recorder.ondataavailable = (e) => {""")
rep("""  startReplay(): void {
    if (this.replay) return;""","""  startReplay(): void {
    if (this.replay) return;
    // It would draw the picture here again, cameras and all.
    if (unifiedOn()) throw new Error('Instant replay is not in the unified engine yet (beta). Switch to Standard in Settings → Engine to use it.');""")
open(p,'w').write(s)
