// Recording a voiceover: the microphone recorded while the film plays, kept
// in Documents/Lumora/Voiceovers, imported, and placed on a Voiceover track
// at the frame the recording started.
import { invoke } from '@tauri-apps/api/core';
import { addMedia } from '../model/build';
import { addTrack, updateTrack } from '../model/edit';
import { current } from '../model/seq';
import type { Project } from '../model/types';

export const VOICEOVER_TRACK = 'Voiceover';

/** The track a voiceover goes on: the Voiceover track (made at the bottom of the sound tracks when there is none). */
export function voiceoverTrack(p: Project): { project: Project; track: string } {
  const s = current(p);
  const have = s.tracks.find((t) => t.kind === 'audio' && t.name === VOICEOVER_TRACK && !t.locked);
  if (have) return { project: p, track: have.id };
  const before = new Set(s.tracks.map((t) => t.id));
  let q = addTrack(p, 'audio');
  const made = current(q).tracks.find((t) => !before.has(t.id));
  if (!made) return { project: p, track: s.tracks.find((t) => t.kind === 'audio')?.id ?? '' };
  q = updateTrack(q, made.id, { name: VOICEOVER_TRACK, role: 'dialogue' });
  return { project: q, track: made.id };
}

/** A recorded voiceover on its track at `frame` (over whatever is there). */
export function placeVoiceover(p: Project, media: string, frame: number): Project {
  const { project, track } = voiceoverTrack(p);
  return addMedia(project, media, Math.max(0, Math.round(frame)), 'overwrite', undefined, track);
}

/** A file name for a take: the sequence and where it starts ("Gala 00-12-04"), plain letters only. */
export function takeName(sequence: string, at: string): string {
  return (
    `${sequence} ${at}`
      .replace(/[^A-Za-z0-9 _-]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'Voiceover'
  );
}

/** The recorder's best format here (WebM with Opus where the browser has it). */
export function recordingType(): string {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (typeof MediaRecorder === 'undefined') return '';
  return options.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

/** Keep a take on the computer; gives its path. */
export async function saveTake(name: string, blob: Blob): Promise<string> {
  const data = new Uint8Array(await blob.arrayBuffer());
  return invoke<string>('voiceover_save', data, { headers: { 'x-name': name, 'x-type': blob.type || 'audio/webm' } });
}

/** The microphone, recording, with a level for the meter. */
export class Take {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(1024);
  constructor(private stream: MediaStream) {
    if (typeof AudioContext !== 'undefined') {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.ctx.createMediaStreamSource(stream).connect(this.analyser);
    }
  }

  /** The microphones on this computer (names only once the person has allowed one). */
  static async microphones(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  }

  /** Open a microphone: its sound exactly as it is (no cleanup that would change the voice). */
  static async open(deviceId: string | null): Promise<Take> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This computer offers no microphone to Studio.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      return new Take(stream);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      throw new Error(
        name === 'NotAllowedError'
          ? 'Studio wasn’t allowed to use the microphone. Allow it in Windows Settings > Privacy & security > Microphone.'
          : name === 'NotFoundError'
            ? 'No microphone was found. Plug one in and try again.'
            : `The microphone couldn’t be opened (${e instanceof Error ? e.message : String(e)}).`,
      );
    }
  }

  /** How loud it is now (dB peak). */
  level(): number {
    if (!this.analyser) return -90;
    this.analyser.getFloatTimeDomainData(this.buf);
    let m = 0;
    for (const v of this.buf) m = Math.max(m, Math.abs(v));
    return m > 0 ? Math.max(-90, 20 * Math.log10(m)) : -90;
  }

  /** Start recording; `onStart` is told when the first sound is really being kept. */
  start(onStart: () => void) {
    const type = recordingType();
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type, audioBitsPerSecond: 192_000 } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.onstart = onStart;
    this.recorder.start(1000);
  }

  /** Stop and give the take. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const r = this.recorder;
      if (!r || r.state === 'inactive') return resolve(new Blob(this.chunks));
      r.onstop = () => resolve(new Blob(this.chunks, { type: r.mimeType }));
      r.stop();
    });
  }

  close() {
    for (const t of this.stream.getTracks()) t.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
