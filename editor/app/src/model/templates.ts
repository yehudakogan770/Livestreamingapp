// Motion title templates: ready-made titles built on the text clip (words,
// box, bar, how they come on and go off) and the clip's keyframed motion
// (push-ins, punches, pulses, scrolling credits). Everything stays editable in
// the Inspector afterwards, and any title can be saved as a template of your own.
import { placeClips } from './edit';
import { textAnimatorPreset } from './textanim';
import { current } from './seq';
import { DEFAULT_TEXT, newClip, type Anim, type Clip, type Motion, type Project, type TextData } from './types';

export type TemplateGroup = 'Lower thirds' | 'Titles' | 'Event' | 'End cards' | 'Social' | 'Quotes' | 'Chapters' | 'Countdowns' | 'Buttons' | 'My templates';

/** Keyframed motion for a clip of a length (frames) at a frame rate. */
type MotionKeys = (length: number, fps: number) => Partial<Motion>;

export interface TitleTemplate {
  id: string;
  name: string;
  group: TemplateGroup;
  /** How long it is when added (seconds). */
  seconds: number;
  text: Partial<TextData>;
  motion?: MotionKeys;
  /** Saved motion of a title of your own (keyframes as they were). */
  savedMotion?: Partial<Motion>;
}

const ease = (a: number, b: number, from: number, to: number): Anim => ({
  k: [
    { t: from, v: a, e: 'ease' },
    { t: to, v: b, e: 'ease' },
  ],
});

/** A slow push in over the whole clip (a cinematic drift). */
const push =
  (amount: number): MotionKeys =>
  (len) =>
    ({
      scale: {
        k: [
          { t: 0, v: 100, e: 'linear' },
          { t: Math.max(1, len - 1), v: 100 + amount, e: 'linear' },
        ],
      },
    }) as Partial<Motion>;

/** Lands with a punch: big to its size in a few frames, and a quick shrink away at the end. */
const punch: MotionKeys = (len, fps) => {
  const n = Math.max(2, Math.round(fps * 0.25));
  return {
    scale: {
      k: [
        { t: 0, v: 135, e: 'ease' },
        { t: n, v: 100, e: 'hold' },
        { t: Math.max(n + 1, len - n), v: 100, e: 'ease' },
        { t: len - 1, v: 80, e: 'linear' },
      ],
    },
  };
};

/** A gentle beat every second (buttons and countdowns ask to be looked at). */
const pulse =
  (amount: number): MotionKeys =>
  (len, fps) => {
    const k: Anim['k'] = [];
    const every = Math.max(2, Math.round(fps));
    for (let t = 0; t < len; t += every) {
      k.push({ t, v: 100 + amount, e: 'ease' });
      k.push({ t: Math.min(len - 1, t + Math.round(every / 3)), v: 100, e: 'ease' });
    }
    return { scale: { k: k.filter((x, i) => i === 0 || x.t > (k[i - 1] as { t: number }).t) } };
  };

/** Credits that scroll up through the frame. */
const roll: MotionKeys = (len) => ({ y: ease(900, -900, 0, Math.max(1, len - 1)) }) as Partial<Motion>;

/** Slides in from the side and back out. */
const slide =
  (from: number): MotionKeys =>
  (len, fps) => {
    const n = Math.max(2, Math.round(fps * 0.4));
    return {
      x: {
        k: [
          { t: 0, v: from, e: 'ease' },
          { t: n, v: 0, e: 'hold' },
          { t: Math.max(n + 1, len - n), v: 0, e: 'ease' },
          { t: len - 1, v: from, e: 'linear' },
        ],
      },
    };
  };

const LOWER = { align: 'left' as const, px: 0.08, py: 0.82, shadow: 0, animLength: 14 };

export const TITLE_TEMPLATES: TitleTemplate[] = [
  // ---- lower thirds ----
  {
    id: 'lt-bar',
    name: 'Accent bar',
    group: 'Lower thirds',
    seconds: 5,
    text: {
      ...LOWER,
      text: 'Dana Levi\nDirector of Photography',
      size: 60,
      box: true,
      boxColor: '#101418',
      boxOpacity: 85,
      boxPad: 22,
      accent: '#e5a823',
      accentSize: 10,
      boxGrow: true,
      animIn: 'wipe',
      animOut: 'wipe',
    },
  },
  {
    id: 'lt-line',
    name: 'Clean line',
    group: 'Lower thirds',
    seconds: 5,
    text: {
      ...LOWER,
      text: 'Dana Levi\nDirector',
      size: 64,
      weight: 600,
      shadow: 4,
      accent: '#ffffff',
      accentSide: 'bottom',
      accentSize: 4,
      animIn: 'up',
      animOut: 'fade',
    },
  },
  {
    id: 'lt-block',
    name: 'Bold block',
    group: 'Lower thirds',
    seconds: 5,
    text: {
      ...LOWER,
      text: 'Breaking news\nLive from the city center',
      size: 58,
      weight: 800,
      caps: true,
      box: true,
      boxColor: '#d6453d',
      boxOpacity: 100,
      boxPad: 20,
      boxGrow: true,
      animIn: 'wipe',
      animOut: 'fade',
    },
  },
  {
    id: 'lt-pill',
    name: 'Rounded pill',
    group: 'Lower thirds',
    seconds: 5,
    text: {
      ...LOWER,
      text: 'Noa Cohen\nGuest speaker',
      size: 56,
      color: '#16181c',
      color2: '#4a5260',
      box: true,
      boxColor: '#ffffff',
      boxOpacity: 96,
      boxPad: 26,
      boxRadius: 40,
      animIn: 'pop',
      animOut: 'fade',
    },
  },
  {
    id: 'lt-news',
    name: 'Newsroom',
    group: 'Lower thirds',
    seconds: 6,
    text: {
      ...LOWER,
      px: 0.06,
      text: 'Election night\nResults coming in',
      size: 54,
      weight: 700,
      caps: true,
      box: true,
      boxColor: '#13294b',
      boxOpacity: 95,
      boxPad: 18,
      accent: '#e53935',
      accentSide: 'top',
      accentSize: 8,
      animIn: 'left',
      animOut: 'left',
    },
    motion: slide(-200),
  },
  {
    id: 'lt-right',
    name: 'Minimal right',
    group: 'Lower thirds',
    seconds: 5,
    text: {
      ...LOWER,
      align: 'right',
      px: 0.92,
      text: 'Tel Aviv\nSummer 2026',
      size: 56,
      weight: 500,
      shadow: 8,
      accent: '#4fb3bf',
      accentSide: 'right',
      accentSize: 6,
      animIn: 'right',
      animOut: 'fade',
    },
  },
  // ---- full-screen titles ----
  {
    id: 'ti-cinema',
    name: 'Cinematic',
    group: 'Titles',
    seconds: 6,
    text: { text: 'The Long Road Home', size: 120, weight: 400, tracking: 30, caps: true, shadow: 10, animIn: 'blur', animOut: 'fade', animLength: 30 },
    motion: push(8),
  },
  {
    id: 'ti-impact',
    name: 'Impact',
    group: 'Titles',
    seconds: 3,
    text: { text: 'Game day', font: 'Bebas Neue', size: 260, weight: 400, caps: true, tracking: 6, shadow: 14, animIn: 'none', animOut: 'none' },
    motion: punch,
  },
  {
    id: 'ti-serif',
    name: 'Elegant serif',
    group: 'Titles',
    seconds: 6,
    text: {
      text: 'A Wedding Story\nNoa & Daniel',
      font: 'Frank Ruhl Libre',
      size: 130,
      weight: 400,
      italic: true,
      color: '#f4ead8',
      shadow: 6,
      animIn: 'fade',
      animOut: 'fade',
      animLength: 24,
    },
    motion: push(4),
  },
  {
    id: 'ti-type',
    name: 'Typewriter',
    group: 'Titles',
    seconds: 5,
    text: {
      text: 'Somewhere, something incredible is waiting.',
      font: 'Courier New',
      size: 72,
      weight: 400,
      shadow: 0,
      animIn: 'type',
      animOut: 'fade',
      animLength: 45,
    },
  },
  // ---- end cards ----
  {
    id: 'end-thanks',
    name: 'Thanks for watching',
    group: 'End cards',
    seconds: 8,
    text: { text: 'Thanks for watching\nSee you in the next one', size: 110, weight: 800, py: 0.42, animIn: 'up', animOut: 'fade', animLength: 18 },
  },
  {
    id: 'end-credits',
    name: 'Rolling credits',
    group: 'End cards',
    seconds: 12,
    text: {
      text: 'Directed by\nDana Levi\n\nEdited by\nNoa Cohen\n\nMusic\nThe Night Owls',
      size: 64,
      weight: 600,
      even: true,
      lineHeight: 1.35,
      shadow: 4,
      animIn: 'none',
      animOut: 'none',
    },
    motion: roll,
  },
  {
    id: 'end-next',
    name: 'Up next',
    group: 'End cards',
    seconds: 8,
    text: {
      text: 'Up next\nHow we shot it',
      align: 'left',
      px: 0.08,
      py: 0.2,
      size: 90,
      weight: 800,
      box: true,
      boxColor: '#000000',
      boxOpacity: 55,
      boxPad: 30,
      boxRadius: 16,
      accent: '#e5a823',
      animIn: 'left',
      animOut: 'fade',
    },
  },
  // ---- social ----
  {
    id: 'so-handle',
    name: 'Handle tag',
    group: 'Social',
    seconds: 5,
    text: {
      text: '@yourname',
      align: 'left',
      px: 0.06,
      py: 0.9,
      size: 48,
      weight: 700,
      color: '#ffffff',
      shadow: 0,
      box: true,
      boxColor: '#000000',
      boxOpacity: 60,
      boxPad: 18,
      boxRadius: 30,
      animIn: 'pop',
      animOut: 'fade',
    },
  },
  {
    id: 'so-share',
    name: 'Like & share',
    group: 'Social',
    seconds: 4,
    text: {
      text: '♥ Like  ·  ↗ Share',
      py: 0.85,
      size: 56,
      weight: 700,
      shadow: 0,
      box: true,
      boxColor: '#ff3b5c',
      boxOpacity: 100,
      boxPad: 22,
      boxRadius: 40,
      animIn: 'up',
      animOut: 'down',
    },
    motion: pulse(4),
  },
  {
    id: 'so-hashtag',
    name: 'Hashtag',
    group: 'Social',
    seconds: 5,
    text: {
      text: '#behindthescenes',
      align: 'right',
      px: 0.94,
      py: 0.1,
      size: 50,
      weight: 800,
      color: '#4fb3bf',
      shadow: 6,
      animIn: 'type',
      animOut: 'fade',
      animLength: 20,
    },
  },
  // ---- quotes ----
  {
    id: 'qu-bar',
    name: 'Quote with bar',
    group: 'Quotes',
    seconds: 8,
    text: {
      text: '“The best camera is the one\nthat’s with you.”\n— Chase Jarvis',
      align: 'left',
      px: 0.16,
      size: 76,
      weight: 400,
      italic: true,
      font: 'Georgia',
      even: true,
      color2: '#c9c2b4',
      accent: '#e5a823',
      accentSize: 8,
      shadow: 6,
      animIn: 'fade',
      animOut: 'fade',
      animLength: 20,
    },
  },
  {
    id: 'qu-card',
    name: 'Quote card',
    group: 'Quotes',
    seconds: 8,
    text: {
      text: '“Simplicity is the ultimate sophistication.”\nLeonardo da Vinci',
      font: 'Frank Ruhl Libre',
      size: 84,
      weight: 400,
      color: '#1b1b1b',
      color2: '#5b5b5b',
      box: true,
      boxColor: '#f6f1e7',
      boxOpacity: 100,
      boxPad: 60,
      boxRadius: 8,
      shadow: 0,
      animIn: 'pop',
      animOut: 'fade',
    },
  },
  // ---- chapters ----
  {
    id: 'ch-number',
    name: 'Chapter',
    group: 'Chapters',
    seconds: 4,
    text: {
      text: 'Chapter one\nThe beginning',
      size: 120,
      weight: 800,
      caps: true,
      tracking: 8,
      accent: '#e5a823',
      accentSide: 'bottom',
      accentSize: 6,
      animIn: 'wipe',
      animOut: 'fade',
      animLength: 18,
    },
  },
  {
    id: 'ch-divider',
    name: 'Section divider',
    group: 'Chapters',
    seconds: 3,
    text: {
      text: 'Part 2',
      font: 'Chakra Petch',
      size: 150,
      weight: 700,
      tracking: 40,
      caps: true,
      shadow: 0,
      box: true,
      boxColor: '#000000',
      boxOpacity: 100,
      boxPad: 50,
      animIn: 'blur',
      animOut: 'blur',
    },
    motion: push(5),
  },
  // ---- countdowns ----
  {
    id: 'cd-big',
    name: 'Big countdown',
    group: 'Countdowns',
    seconds: 5,
    text: { text: '{count}', font: 'Bebas Neue', size: 420, weight: 400, shadow: 16, animIn: 'none', animOut: 'none' },
    motion: pulse(12),
  },
  {
    id: 'cd-clock',
    name: 'Starts in',
    group: 'Countdowns',
    seconds: 30,
    text: { text: 'Starting in\n{clock}', size: 110, weight: 700, py: 0.5, shadow: 8, animIn: 'fade', animOut: 'fade' },
  },
  // ---- buttons ----
  {
    id: 'bt-subscribe',
    name: 'Subscribe button',
    group: 'Buttons',
    seconds: 4,
    text: {
      text: '▶ Subscribe',
      py: 0.82,
      size: 64,
      weight: 800,
      caps: true,
      shadow: 0,
      box: true,
      boxColor: '#e62117',
      boxOpacity: 100,
      boxPad: 26,
      boxRadius: 14,
      animIn: 'pop',
      animOut: 'pop',
    },
    motion: pulse(5),
  },
  {
    id: 'bt-follow',
    name: 'Follow button',
    group: 'Buttons',
    seconds: 4,
    text: {
      text: '+ Follow',
      py: 0.82,
      size: 60,
      weight: 700,
      color: '#111111',
      shadow: 0,
      box: true,
      boxColor: '#ffffff',
      boxOpacity: 100,
      boxPad: 24,
      boxRadius: 40,
      animIn: 'up',
      animOut: 'fade',
    },
    motion: pulse(4),
  },
  // ---- more lower thirds ----
  {
    id: 'lt-split',
    name: 'Two-tone',
    group: 'Lower thirds',
    seconds: 6,
    text: {
      ...LOWER,
      text: 'Rachel Adler\nKeynote speaker',
      size: 60,
      weight: 700,
      color: '#ffffff',
      color2: '#f2c48d',
      box: true,
      boxColor: '#141414',
      boxOpacity: 85,
      boxPad: 22,
      animIn: 'left',
      animOut: 'fade',
    },
  },
  {
    id: 'lt-underline',
    name: 'Underline',
    group: 'Lower thirds',
    seconds: 6,
    text: {
      ...LOWER,
      text: 'Jonah Weiss\nHost',
      size: 58,
      weight: 600,
      accent: '#e0973f',
      accentSide: 'bottom',
      accentSize: 4,
      boxGrow: true,
      animIn: 'wipe',
      animOut: 'fade',
    },
  },
  {
    id: 'lt-glass',
    name: 'Soft glass',
    group: 'Lower thirds',
    seconds: 6,
    text: {
      ...LOWER,
      text: 'Maya Green\nDirector of Programs',
      size: 56,
      weight: 600,
      box: true,
      boxColor: '#ffffff',
      boxOpacity: 18,
      boxPad: 26,
      boxRadius: 14,
      animIn: 'up',
      animOut: 'fade',
    },
  },
  {
    id: 'lt-location',
    name: 'Place and date',
    group: 'Lower thirds',
    seconds: 5,
    text: {
      ...LOWER,
      text: 'GRAND HALL, CHICAGO\nMay 14, 2026',
      size: 44,
      weight: 700,
      tracking: 4,
      even: false,
      accent: '#e0973f',
      accentSize: 6,
      animIn: 'right',
      animOut: 'fade',
    },
  },
  {
    id: 'lt-words',
    name: 'Word by word',
    group: 'Lower thirds',
    seconds: 6,
    text: {
      ...LOWER,
      text: 'Eli Brooks\nFounder and CEO',
      size: 60,
      weight: 700,
      animIn: 'none',
      animOut: 'fade',
      animators: [textAnimatorPreset('fadeUpWord', 18)],
    },
  },
  // ---- more titles ----
  {
    id: 'ti-kinetic',
    name: 'Kinetic words',
    group: 'Titles',
    seconds: 5,
    text: {
      text: 'Every voice matters',
      size: 140,
      weight: 800,
      shadow: 10,
      animIn: 'none',
      animOut: 'fade',
      animators: [textAnimatorPreset('fadeUpWord', 20)],
    },
  },
  {
    id: 'ti-spaced',
    name: 'Wide reveal',
    group: 'Titles',
    seconds: 6,
    text: {
      text: 'Beginnings',
      size: 110,
      weight: 300,
      caps: true,
      shadow: 8,
      animIn: 'none',
      animOut: 'fade',
      animators: [textAnimatorPreset('tracking', 40)],
    },
    motion: push(5),
  },
  {
    id: 'ti-stack',
    name: 'Stacked',
    group: 'Titles',
    seconds: 5,
    text: {
      text: 'Annual\nAWARDS NIGHT',
      size: 150,
      weight: 800,
      lineHeight: 1.05,
      color2: '#e0973f',
      shadow: 8,
      animIn: 'none',
      animOut: 'fade',
      animators: [textAnimatorPreset('kineticSlide', 16)],
    },
  },
  {
    id: 'ti-letters',
    name: 'Letter pop',
    group: 'Titles',
    seconds: 4,
    text: { text: 'Hello!', size: 220, weight: 900, shadow: 12, animIn: 'none', animOut: 'fade', animators: [textAnimatorPreset('popLetter', 14)] },
  },
  {
    id: 'ti-boxed',
    name: 'Boxed headline',
    group: 'Titles',
    seconds: 5,
    text: {
      text: 'Breaking ground',
      size: 120,
      weight: 800,
      caps: true,
      color: '#111111',
      box: true,
      boxColor: '#f2f2f2',
      boxOpacity: 100,
      boxPad: 30,
      shadow: 0,
      boxGrow: true,
      animIn: 'wipe',
      animOut: 'fade',
    },
    motion: punch,
  },
  // ---- event ----
  {
    id: 'ev-welcome',
    name: 'Welcome',
    group: 'Event',
    seconds: 6,
    text: {
      text: 'Welcome\nto the Spring Gala',
      size: 150,
      weight: 700,
      color2: '#f2c48d',
      shadow: 10,
      animIn: 'none',
      animOut: 'fade',
      animators: [textAnimatorPreset('fadeUpWord', 24)],
    },
    motion: push(4),
  },
  {
    id: 'ev-program',
    name: 'Program',
    group: 'Event',
    seconds: 10,
    text: {
      text: 'Tonight\n7:00  Welcome\n7:20  Dinner\n8:15  Awards\n9:00  Dancing',
      size: 64,
      weight: 600,
      align: 'left',
      px: 0.12,
      even: true,
      lineHeight: 1.5,
      box: true,
      boxColor: '#101010',
      boxOpacity: 70,
      boxPad: 40,
      boxRadius: 10,
      animIn: 'none',
      animOut: 'fade',
      animators: [textAnimatorPreset('kineticSlide', 30)],
    },
  },
  {
    id: 'ev-sponsors',
    name: 'Thank our sponsors',
    group: 'Event',
    seconds: 8,
    text: {
      text: 'With thanks to our sponsors\nNorthwind Bank · Fable Coffee · Hill & Co.',
      size: 72,
      weight: 700,
      py: 0.5,
      color2: '#d9d9d9',
      animIn: 'up',
      animOut: 'fade',
      animLength: 18,
    },
  },
  {
    id: 'ev-break',
    name: 'Back soon',
    group: 'Event',
    seconds: 10,
    text: { text: 'We’ll be right back', size: 120, weight: 700, shadow: 8, animIn: 'fade', animOut: 'fade', animLength: 20 },
    motion: pulse(2),
  },
  {
    id: 'ev-award',
    name: 'Award winner',
    group: 'Event',
    seconds: 7,
    text: {
      text: 'Volunteer of the Year\nSarah Klein',
      size: 110,
      weight: 800,
      color2: '#f2c48d',
      shadow: 12,
      animIn: 'none',
      animOut: 'fade',
      animators: [textAnimatorPreset('kineticSlide', 20)],
    },
    motion: punch,
  },
  {
    id: 'ev-speaker',
    name: 'Next speaker',
    group: 'Event',
    seconds: 6,
    text: {
      text: 'Next\nDr. Aaron Hale',
      size: 100,
      weight: 700,
      color2: '#ffffff',
      even: true,
      accent: '#e0973f',
      accentSide: 'left',
      accentSize: 10,
      align: 'left',
      px: 0.1,
      animIn: 'right',
      animOut: 'fade',
    },
  },
  // ---- more end cards, social and chapters ----
  {
    id: 'end-link',
    name: 'Find us online',
    group: 'End cards',
    seconds: 8,
    text: { text: 'More at\nexample.org/events', size: 110, weight: 700, color2: '#e0973f', py: 0.45, animIn: 'up', animOut: 'fade', animLength: 18 },
  },
  {
    id: 'soc-question',
    name: 'Question card',
    group: 'Social',
    seconds: 5,
    text: {
      text: 'What would you have done?',
      size: 96,
      weight: 800,
      box: true,
      boxColor: '#ffffff',
      boxOpacity: 100,
      color: '#111111',
      boxPad: 34,
      boxRadius: 24,
      shadow: 0,
      animIn: 'pop',
      animOut: 'fade',
    },
  },
  {
    id: 'soc-hook',
    name: 'Hook line',
    group: 'Social',
    seconds: 3,
    text: {
      text: 'Wait for the end',
      size: 110,
      weight: 900,
      caps: true,
      py: 0.2,
      stroke: 4,
      strokeColor: '#000000',
      shadow: 0,
      animIn: 'none',
      animOut: 'fade',
      animators: [textAnimatorPreset('popLetter', 10)],
    },
  },
  {
    id: 'qt-pull',
    name: 'Pull quote',
    group: 'Quotes',
    seconds: 7,
    text: {
      text: '“The best way to predict the future is to create it.”\n— Peter Drucker',
      font: 'Frank Ruhl Libre',
      size: 84,
      weight: 400,
      italic: true,
      color2: '#bfbfbf',
      lineHeight: 1.3,
      shadow: 6,
      animIn: 'none',
      animOut: 'fade',
      animators: [textAnimatorPreset('fadeUpWord', 36)],
    },
  },
  {
    id: 'ch-numbered',
    name: 'Numbered chapter',
    group: 'Chapters',
    seconds: 4,
    text: {
      text: '01\nWelcome',
      size: 150,
      weight: 300,
      color2: '#ffffff',
      even: false,
      align: 'left',
      px: 0.1,
      animIn: 'none',
      animOut: 'fade',
      animators: [textAnimatorPreset('kineticSlide', 18)],
    },
  },
];

/** The text and motion a template gives a clip of a length (frames). */
export function templateLook(t: TitleTemplate, length: number, fps: number): { text: TextData; motion: Partial<Motion> } {
  const motion = t.savedMotion ? structuredClone(t.savedMotion) : (t.motion?.(length, fps) ?? {});
  // Keyframes in order, one per frame, inside the clip (a short clip squeezes them).
  for (const [k, v] of Object.entries(motion)) {
    if (!v || typeof v !== 'object' || !('k' in v)) continue;
    const keys = [...(v as Anim).k].map((x) => ({ ...x, t: Math.max(0, Math.min(length - 1, x.t)) })).sort((a, b) => a.t - b.t);
    (motion as Record<string, unknown>)[k] = { k: keys.filter((x, i) => i === 0 || x.t !== (keys[i - 1] as { t: number }).t) };
  }
  return { text: { ...DEFAULT_TEXT, ...t.text }, motion };
}

/** A template as a new clip on a track. */
export function templateClip(t: TitleTemplate, track: string, at: number, fps: number): Clip {
  const length = Math.max(1, Math.round(t.seconds * fps));
  const look = templateLook(t, length, fps);
  const clip = newClip(
    track,
    at,
    length,
    { kind: 'text', text: look.text },
    (look.text.text.split('\n')[0] ?? t.name).replace(/\{\w+\}/g, '').trim() || t.name,
  );
  return { ...clip, motion: { ...clip.motion, ...look.motion } };
}

/**
 * Put a template on the timeline at a frame: on the track given (a video
 * track), or the first free track above the pictures.
 */
export function addTemplate(p: Project, t: TitleTemplate, at: number, fps: number, track?: string): { project: Project; id: string } {
  const s = current(p);
  const length = Math.max(1, Math.round(t.seconds * fps));
  const video = s.tracks.filter((x) => x.kind === 'video' && !x.captions);
  const given = track ? video.find((x) => x.id === track && !x.locked) : undefined;
  const free =
    given ??
    video.slice(1).find((x) => !x.locked && !s.clips.some((c) => c.track === x.id && c.start < at + length && c.start + c.length > at)) ??
    video[video.length - 1];
  if (!free) return { project: p, id: '' };
  const clip = templateClip(t, free.id, at, fps);
  return { project: placeClips(p, [clip], 'overwrite'), id: clip.id };
}

/** A title of your own, saved as a template (its words, look and motion). */
export function templateFromClip(c: Clip, name: string, fps: number): TitleTemplate | null {
  if (c.source.kind !== 'text') return null;
  return {
    id: `my-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    name: name.trim() || 'My title',
    group: 'My templates',
    seconds: Math.max(0.5, Math.round((c.length / fps) * 100) / 100),
    text: structuredClone(c.source.text),
    savedMotion: structuredClone(c.motion),
  };
}

// ---- your own templates (kept on this computer) ----

const KEY = 'lumora-edit-title-templates';

/** Read saved templates (anything malformed is left out). */
export function parseSaved(json: string | null): TitleTemplate[] {
  try {
    const v = JSON.parse(json ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (t): t is TitleTemplate =>
          !!t &&
          typeof t === 'object' &&
          typeof (t as TitleTemplate).id === 'string' &&
          typeof (t as TitleTemplate).name === 'string' &&
          typeof (t as TitleTemplate).text === 'object',
      )
      .map((t) => ({ ...t, group: 'My templates' as const, seconds: Number(t.seconds) > 0 ? Number(t.seconds) : 5 }));
  } catch {
    return [];
  }
}

export function savedTemplates(): TitleTemplate[] {
  try {
    return parseSaved(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function saveTemplates(list: TitleTemplate[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map(({ motion: _m, ...t }) => t)));
  } catch {
    // Not kept: fine.
  }
  for (const f of savedListeners) f();
}

const savedListeners = new Set<() => void>();
export const onSavedTemplates = (f: () => void): (() => void) => {
  savedListeners.add(f);
  return () => savedListeners.delete(f);
};

/** Every template: the built-in ones, then your own. */
export const allTemplates = (): TitleTemplate[] => [...TITLE_TEMPLATES, ...savedTemplates()];
export const templateById = (id: string): TitleTemplate | undefined => allTemplates().find((t) => t.id === id);
