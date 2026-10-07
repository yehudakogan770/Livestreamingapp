// A delivery request (preset, sequence, range, where it goes, chapters and
// captions) made into what the exporter runs: the project as it is now, the
// encoder chosen, FFmpeg's arguments and the files the last run reads.
import { captionCues, captionTracks, toSrt, withoutCaptions, type Cue } from '../model/captions';
import { rate, seqLength } from '../model/seq';
import type { Project, Sequence } from '../model/types';
import type { FinishOptions, SoundFormat } from './audioplan';
import { chaptersFrom, ffmetadata } from './chapters';
import { fallbackEncoder, pickVideoEncoder, type EncoderChoice } from './encoders';
import { suggestedMbps, type ExportSettings } from './exporter';
import { audioArgs, loudnormFilter, needsFfmpegPicture, outputSize, pictureArgs, pictureFile, renderSize } from './ffargs';
import { aspectSize, type Aspect } from '../smart/reframe';
import { stemPath, stemProject, stemsIn, STEM_NAMES, type StemKind } from './loudness';
import { BUILT_IN, numbered, type DeliveryPreset } from './presets';

export type RangeKind = 'all' | 'marked' | 'selected';

/** The frames to export: the whole sequence, in to out, or from the first selected clip to the end of the last. */
export function rangeFor(s: Sequence, what: RangeKind, selected: readonly string[] = []): { from: number; to: number } {
  const total = seqLength(s);
  if (what === 'marked' && (s.inPoint !== null || s.outPoint !== null)) return { from: s.inPoint ?? 0, to: s.outPoint ?? total };
  if (what === 'selected') {
    const clips = s.clips.filter((c) => selected.includes(c.id));
    if (clips.length) return { from: Math.min(...clips.map((c) => c.start)), to: Math.max(...clips.map((c) => c.start + c.length)) };
  }
  return { from: 0, to: total };
}

export interface CaptionChoice {
  /** Drawn into the picture. */
  burn: boolean;
  /** A subtitle track inside the file (MP4/MOV). */
  embed: boolean;
  /** .srt and .vtt files next to it. */
  sidecar: boolean;
}

export interface DeliveryRequest {
  preset: DeliveryPreset;
  seq: string;
  range: { from: number; to: number };
  out: string;
  chapters: boolean;
  captions: CaptionChoice;
  /** Encoders that work here (from the program). */
  encoders: readonly string[];
  /** Running in the program (FFmpeg is there). */
  app: boolean;
  /** Also save this frame of the sequence (from a marker) as a JPEG thumbnail next to the film. */
  thumbnailAt?: number | null;
}

export interface DeliveryPlan {
  /** The project as it was when queued (later edits don't change it), with the sequence open. */
  project: Project;
  settings: ExportSettings;
  /** How the picture is made. */
  engine: 'webcodecs' | 'ffmpeg' | 'none';
  encoder: EncoderChoice | null;
  /** Caption files to write next to the finished file. */
  sidecar: Cue[];
  /** Things to know before it starts (none stop it). */
  notes: string[];
  /** The finished file's loudness is measured against this (null: measured, no target); absent: not measured (no sound). */
  loudnessTarget?: { lufs: number; truePeak: number } | null;
  /** A thumbnail to save from the finished film. */
  thumbnail?: { seconds: number; width: number; out: string };
}

const LANG: Record<string, string> = {
  en: 'eng',
  he: 'heb',
  es: 'spa',
  fr: 'fra',
  de: 'deu',
  it: 'ita',
  pt: 'por',
  ru: 'rus',
  ar: 'ara',
  ja: 'jpn',
  zh: 'zho',
};

function soundFormatOf(p: DeliveryPreset): SoundFormat | null {
  if (p.video) return null;
  return p.container === 'wav' ? 'wav' : p.container === 'mp3' ? 'mp3' : 'aac';
}

/** Make a delivery request into the exporter's settings. Throws when it can't be made here. */
export function planDelivery(p: Project, req: DeliveryRequest): DeliveryPlan {
  const preset = req.preset;
  const s = p.sequences.find((x) => x.id === req.seq);
  if (!s) throw new Error('That sequence is gone.');
  const fps = rate(s);
  const notes: string[] = [];
  const hasCaptions = captionTracks(s).some((t) => s.clips.some((c) => c.track === t.id));
  let project: Project = { ...p, open: s.id };
  if (hasCaptions && !req.captions.burn) project = withoutCaptions(project);
  const cues = hasCaptions && (req.captions.sidecar || req.captions.embed) ? captionCues(s, undefined, req.range) : [];
  const v = preset.video;
  const mov = preset.container === 'mp4' || preset.container === 'mov' || preset.container === 'm4a';
  const files: [string, string][] = [];
  const extraInputs: string[][] = [];
  const extraArgs: ((n: number) => string[])[] = [];
  if (req.chapters && mov) {
    const ch = chaptersFrom(s.markers, fps, req.range);
    if (ch.length) {
      files.push(['chapters.txt', ffmetadata(ch, s.name)]);
      extraInputs.push(['-f', 'ffmetadata', '-i', '{tmp}/chapters.txt']);
      extraArgs.push((n) => ['-map_metadata', String(n), '-map_chapters', String(n)]);
    } else notes.push('There are no markers in the range, so there are no chapters.');
  }
  if (req.captions.embed && cues.length && v && (preset.container === 'mp4' || preset.container === 'mov')) {
    const lang = LANG[p.media.find((m) => m.transcript)?.transcript?.language ?? ''] ?? 'und';
    files.push(['captions.srt', toSrt(cues)]);
    extraInputs.push(['-i', '{tmp}/captions.srt']);
    extraArgs.push((n) => ['-map', `${n}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', `language=${lang}`]);
  }
  const extra: FinishOptions['extra'] = (first) => ({
    inputs: extraInputs.flat(),
    args: extraArgs.flatMap((f, i) => f(first + i)),
  });
  const loudness = preset.loudness !== null ? loudnormFilter(preset.loudness, preset.truePeak) : false;
  const sidecar = req.captions.sidecar ? cues : [];
  const thumb = thumbnailFor(req, s, preset);
  const measured = preset.audio ? { loudnessTarget: preset.loudness !== null ? { lufs: preset.loudness, truePeak: preset.truePeak } : null } : {};

  if (!v) {
    if (!preset.audio) throw new Error('This preset makes nothing.');
    return {
      project,
      settings: {
        height: s.height,
        mbps: 0,
        sound: soundFormatOf(preset),
        range: req.range,
        loudness,
        out: req.out,
        finish: { audio: audioArgs(preset.audio), extra },
        files,
      },
      engine: 'none',
      encoder: null,
      sidecar,
      notes,
      ...measured,
      ...thumb,
    };
  }

  const out = outputSize(s, v);
  const render = renderSize(s, out, v.fit);
  const hw =
    v.hardware !== 'software' && (v.codec === 'h264' || v.codec === 'hevc') && pickVideoEncoder(v.codec, v.bitDepth, v.hardware, req.encoders)?.hardware;
  const ffmpeg = req.app && (needsFfmpegPicture(preset, s) || !!hw);
  const image = preset.container === 'png' || preset.container === 'gif';
  const target = preset.container === 'png' ? numbered(req.out) : req.out;
  const finish: FinishOptions = { audio: audioArgs(preset.audio ?? { codec: 'aac', kbps: 256 }), extra };
  if (!ffmpeg) {
    if (v.codec !== 'h264') throw new Error('This preset is made with FFmpeg, in the Lumora Studio program.');
    const mbps = v.rate.mode === 'quality' ? suggestedMbps(out.height, s.fps, v.rate.q >= 85 ? 'high' : v.rate.q >= 65 ? 'good' : 'small') : v.rate.mbps;
    return {
      project,
      settings: { height: out.height, mbps, sound: null, range: req.range, loudness, out: target, finish, files },
      engine: 'webcodecs',
      encoder: null,
      sidecar,
      notes,
      ...measured,
      ...thumb,
    };
  }
  const enc = pickVideoEncoder(v.codec, v.bitDepth, v.hardware, req.encoders);
  if (!enc) throw new Error(`This computer's FFmpeg can't make ${v.codec.toUpperCase()}.`);
  if (enc.note) notes.push(enc.note);
  const fb = fallbackEncoder(enc, v.codec, req.encoders);
  if (v.codec === 'hevc') finish.extra = (first) => ({ ...extra(first), args: [...extra(first).args, '-tag:v', 'hvc1'] });
  return {
    project,
    settings: {
      height: out.height,
      mbps: 0,
      sound: null,
      range: req.range,
      loudness,
      out: target,
      pipe: {
        args: pictureArgs(preset, enc.name, s.fps, render, out),
        render,
        alpha: v.alpha,
        file: pictureFile(preset),
        ...(fb ? { fallback: pictureArgs(preset, fb.name, s.fps, render, out) } : {}),
      },
      finish,
      files,
      pictureOnly: image,
    },
    engine: 'ffmpeg',
    encoder: enc,
    sidecar,
    notes,
    ...measured,
    ...thumb,
  };
}

/** A rough size of the finished file (megabytes). */
export function estimateMb(preset: DeliveryPreset, seq: Sequence, seconds: number): number {
  const v = preset.video;
  const a = preset.audio;
  const audioMbps = !a ? 0 : a.codec === 'pcm24' ? 2.304 : a.codec === 'pcm16' ? 1.536 : a.kbps / 1000;
  if (!v) return (audioMbps * seconds) / 8;
  const out = outputSize(seq, v);
  const px = out.width * out.height * (v.fps ?? seq.fps);
  let mbps: number;
  if (v.codec === 'prores') mbps = (px / (1920 * 1080 * 30)) * (v.prores === '4444' || v.prores === '4444xq' ? 330 : v.prores === 'hq' ? 220 : 147);
  else if (v.codec === 'dnxhr') mbps = (px / (1920 * 1080 * 30)) * (v.dnxhr === 'lb' ? 45 : v.dnxhr === 'sq' ? 145 : 220);
  else if (v.codec === 'png') mbps = (px * 8 * 1.5) / 1e6;
  else if (v.codec === 'gif') mbps = (px * 0.5) / 1e6;
  else mbps = v.rate.mode === 'quality' ? suggestedMbps(out.height, seq.fps, v.rate.q >= 85 ? 'high' : v.rate.q >= 65 ? 'good' : 'small') : v.rate.mbps;
  return ((mbps + audioMbps) * seconds) / 8;
}

/** Stems for a delivery: one 24-bit WAV for each of dialogue, music and effects that has sound in the range (not loudness-matched, so they add up to the mix). */
export function planStems(p: Project, req: DeliveryRequest): { stem: StemKind; name: string; plan: DeliveryPlan }[] {
  const s = p.sequences.find((x) => x.id === req.seq);
  const wav = BUILT_IN.find((x) => x.id === 'wav') as DeliveryPreset;
  if (!s) return [];
  return stemsIn(s, req.range).map((stem) => ({
    stem,
    name: `${STEM_NAMES[stem]} stem`,
    plan: planDelivery(stemProject(p, s.id, stem), {
      ...req,
      preset: wav,
      out: stemPath(req.out, stem),
      chapters: false,
      captions: { burn: false, embed: false, sidecar: false },
    }),
  }));
}

/** The thumbnail a delivery saves (a marker's frame, from the finished film): YouTube wants 1280 wide. */
export function thumbnailFor(req: DeliveryRequest, s: Sequence, preset: DeliveryPreset): { thumbnail?: { seconds: number; width: number; out: string } } {
  const at = req.thumbnailAt;
  const v = preset.video;
  if (at === null || at === undefined || !v || preset.container === 'png' || preset.container === 'gif') return {};
  if (at < req.range.from || at >= req.range.to) return {};
  const out = outputSize(s, v);
  const width = out.width >= out.height ? Math.min(1280, out.width) : Math.min(1080, out.width);
  return { thumbnail: { seconds: (at - req.range.from) / rate(s), width, out: `${req.out.replace(/\.[^.\\/]+$/, '')} - thumbnail.jpg` } };
}

/**
 * A vertical, square or 4:5 preset for a wide sequence: its picture is cropped
 * to the middle. Auto reframe makes a version that follows the people; this
 * says which shape, and the reframed sequence when there already is one.
 */
export function reframeHint(p: Project, seq: string, preset: DeliveryPreset): { aspect: Aspect; ready: Sequence | null } | null {
  const s = p.sequences.find((x) => x.id === seq);
  const v = preset.video;
  if (!s || !v || v.width === null || v.height === null) return null;
  const want = v.width / v.height;
  const have = s.width / s.height;
  if (want > 1.01 || have < 1.2) return null;
  const aspect: Aspect = Math.abs(want - 1) < 0.02 ? '1:1' : Math.abs(want - 0.8) < 0.02 ? '4:5' : '9:16';
  const size = aspectSize(s, aspect);
  const ready = p.sequences.find((x) => x.id !== s.id && x.name === `${s.name} (${aspect})` && x.width * size.height === x.height * size.width) ?? null;
  return { aspect, ready };
}
