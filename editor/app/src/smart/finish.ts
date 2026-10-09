// Smart > Finish the event: one click from a recorded event to everything
// that goes out. On the open sequence, in order: cut between the cameras by
// who is talking, write down what is said, captions, chapter markers; then a
// highlight reel and clips for social made from it. Every step is one of the
// Smart tools, run with its usual settings; the whole result is one change
// (one Undo). The listening, transcribing and face finding are passed in, so
// the order and the results can be checked without a computer's files.
import { captionBlocks, captionTracks, CAPTION_LOOKS, placeCaptions, rulesFor, sequenceWords, setCaptionStyle, addCaptionTrack } from '../model/captions';
import { current, editSeq, rate } from '../model/seq';
import { DEFAULT_CAPTION_STYLE, type CaptionStyle, type MulticamGroup, type Project, type Sequence } from '../model/types';
import { findChapters, placeChapterMarkers, CHAPTER_DEFAULTS } from '../extras/chapters';
import { check, wordsInSeconds, type Job } from './analysis';
import { applyShots, DETECT_DEFAULTS, groupsIn, guessWide, micSources, planCuts, rulesForPacing } from './autocam';
import { findClips, makeClipSequence } from './clips';
import { addReel, buildReel, DEFAULT_KEYWORDS, pickMoments, scoreMoments } from './highlights';
import type { Aspect } from './reframe';

export interface FinishPlan {
  /** Cut between the cameras by who is talking (0–1: calm to lively), or null. */
  cut: number | null;
  /** Write down what is said (when nothing in the sequence has been yet). */
  transcribe: boolean;
  /** A caption look's name, or null for none. */
  captions: string | null;
  chapters: boolean;
  /** The highlight reel's length (seconds), or null. */
  reel: number | null;
  /** How many clips for social, or 0. */
  clips: number;
  clipShape: Aspect;
  /** Frame the clips on the people talking (slower). */
  faces: boolean;
}

export const FINISH_DEFAULTS: FinishPlan = {
  cut: 0.5,
  transcribe: true,
  captions: 'Broadcast',
  chapters: true,
  reel: 90,
  clips: 5,
  clipShape: '9:16',
  faces: true,
};

/** What the steps need from the computer. */
export interface FinishServices {
  /** Each microphone's loudness on the group's time (step `hop` seconds). */
  micLevels(p: Project, s: Sequence, g: MulticamGroup, mics: { media: string; offset: number }[], hop: number, job: Job): Promise<Float32Array[]>;
  /** Who is talking, from the microphones' loudness. */
  speakers(envs: Float32Array[]): Int16Array;
  /** The sequence's loudness (step `hop` seconds). */
  levels(p: Project, s: Sequence, hop: number, job: Job): Promise<Float32Array>;
  /** The project with what is said in the sequence written down. */
  transcribe(p: Project, s: Sequence, job: Job): Promise<Project>;
  /** A clip's sequence framed on the people talking. */
  frame(p: Project, seq: string, shape: Aspect, job: Job): Promise<Project>;
}

export interface FinishResult {
  project: Project;
  /** The edited event (the sequence that was open). */
  film: string;
  reel: string | null;
  clips: string[];
  /** What was done, in plain words. */
  done: string[];
  /** Steps that were skipped, and why. */
  skipped: string[];
}

const HOP = 0.5;

/** The captions track's look set (made if there is none). */
function withLook(p: Project, look: string): { project: Project; track: string; style: CaptionStyle } {
  const style: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, ...(CAPTION_LOOKS.find((l) => l.name === look)?.style ?? {}) };
  const have = captionTracks(current(p))[0];
  if (have) return { project: setCaptionStyle(p, have.id, style), track: have.id, style };
  const made = addCaptionTrack(p, style);
  return { project: made.project, track: made.id, style };
}

export async function finishEvent(p0: Project, plan: FinishPlan, svc: FinishServices, job: Job): Promise<FinishResult> {
  let p = p0;
  const film = p.open;
  const done: string[] = [];
  const skipped: string[] = [];
  const step = (k: number, msg: string) => job.progress(k, msg);

  // 1. Cameras.
  if (plan.cut !== null) {
    const s = current(p);
    const g = groupsIn(p, s)[0];
    const mics = g ? micSources(p, s, g).filter((m) => m.angle) : [];
    if (!g) skipped.push('Cutting between cameras: the sequence has no multicam clip.');
    else if (!mics.length) skipped.push('Cutting between cameras: no microphone could be matched to a camera.');
    else {
      step(0.02, 'Listening to the microphones…');
      const envs = await svc.micLevels(
        p,
        s,
        g,
        mics.map((m) => ({ media: m.media.id, offset: m.offset })),
        DETECT_DEFAULTS.hop,
        job,
      );
      check(job);
      const shots = planCuts(
        svc.speakers(envs),
        DETECT_DEFAULTS.hop,
        mics.map((m) => m.angle),
        rulesForPacing(plan.cut, guessWide(g)),
      );
      p = applyShots(p, g.id, shots);
      done.push(`Cut between the cameras: ${Math.max(0, shots.length - 1)} cuts.`);
    }
  }

  // 2. What is said.
  const heard = () => sequenceWords(p, current(p)).length > 0;
  if (plan.transcribe && !heard()) {
    step(0.2, 'Writing down what is said…');
    p = await svc.transcribe(p, current(p), job);
    check(job);
    if (heard()) done.push('Wrote down what is said.');
  }
  const words = heard();
  if (!words && (plan.captions || plan.chapters)) skipped.push('Captions and chapters: nothing was heard to write down.');

  // 3. Captions.
  if (plan.captions && words) {
    step(0.6, 'Making captions…');
    const look = withLook(p, plan.captions);
    // Made again from the whole transcript, in the chosen look.
    p = editSeq(look.project, (q) => ({ ...q, clips: q.clips.filter((c) => c.track !== look.track) }));
    const s = current(p);
    p = placeCaptions(p, captionBlocks(sequenceWords(p, s), rate(s), rulesFor(look.style)), look.track).project;
    done.push(`Captions (${plan.captions}).`);
  }

  // 4. Chapters.
  if (plan.chapters && words) {
    const s = current(p);
    const chapters = findChapters(wordsInSeconds(p, s), CHAPTER_DEFAULTS);
    if (chapters.length >= 2) {
      p = placeChapterMarkers(p, chapters, rate(s));
      done.push(`${chapters.length} chapter markers.`);
    } else skipped.push('Chapters: the talk did not change topic clearly enough.');
  }

  // 5 and 6. The reel and the clips, both from the finished event.
  const source = current(p);
  const fps = rate(source);
  let reel: string | null = null;
  const clips: string[] = [];
  if (plan.reel || plan.clips) {
    step(0.7, 'Finding the best moments…');
    const levels = await svc.levels(p, source, HOP, job);
    check(job);
    const inp = {
      hop: HOP,
      levels,
      words: wordsInSeconds(p, source),
      markers: source.markers.map((m) => ({ at: m.at / fps, name: m.name })),
      changes: [],
      keywords: DEFAULT_KEYWORDS,
    };
    const scores = scoreMoments(inp);
    const duration = levels.length * HOP;
    if (plan.reel) {
      const moments = pickMoments(inp, scores, { target: plan.reel, length: 8, minLength: 3 }, duration);
      if (moments.length) {
        const r = buildReel(source, moments, { fade: Math.round(fps * 0.4), title: null, name: `${source.name} highlights` });
        p = { ...addReel(p, r), open: film };
        reel = r.id;
        done.push(`A highlight reel of ${moments.length} moments.`);
      } else skipped.push('Highlight reel: no moments stood out.');
    }
    if (plan.clips) {
      const found = findClips(inp, scores, { count: plan.clips, min: 20, max: 60 }, duration);
      for (const [i, c] of found.entries()) {
        check(job);
        step(0.8 + (0.18 * i) / found.length, `Making clip ${i + 1} of ${found.length}…`);
        const out = makeClipSequence(p, source, c, i, {
          aspect: plan.clipShape,
          captions: words ? (plan.captions && plan.captions !== 'Broadcast' ? plan.captions : 'Highlight') : null,
          title: false,
        });
        p = out.project;
        if (plan.faces) p = await svc.frame(p, out.sequence, plan.clipShape, job);
        clips.push(out.sequence);
      }
      if (found.length) done.push(`${found.length} clips for social.`);
      else skipped.push('Clips for social: no moment was long enough.');
      p = { ...p, open: film };
    }
  }
  step(1, 'Done.');
  return { project: { ...p, open: film }, film, reel, clips, done, skipped };
}
