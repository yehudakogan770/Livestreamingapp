// Lumora Studio's project: media in bins, sequences with many video and audio
// tracks, and clips with keyframed effects. Sequence times are whole frames;
// times inside a media file are seconds.

/** A number that can change over the clip (keyframes), or stays the same. */
export type Param = number | Anim;
export interface Anim {
  k: Key[];
}
/** A keyframe: frames from the clip's start, the value, and how it moves on to the next one. */
export interface Key {
  t: number;
  v: number;
  e: Ease;
}
export type Ease = 'linear' | 'ease' | 'hold';

export interface MediaItem {
  id: string;
  name: string;
  path: string;
  /** What plays while editing when the original can't (made by Lumora Studio). */
  proxy: string | null;
  kind: 'video' | 'audio' | 'image';
  /** Seconds (0 for a picture). */
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  bin: string | null;
  /** The file was not found where it was. */
  missing?: boolean;
  /** The words spoken in it (made by Transcribe). */
  transcript?: Transcript;
}

/** A word heard in a file: seconds into the file. */
export interface Word {
  w: string;
  s: number;
  e: number;
}

/** What was said in a file, word by word. */
export interface Transcript {
  /** A language code ("en", "he"…). */
  language: string;
  /** The speech model that wrote it down. */
  model: string;
  words: Word[];
  /** The parts of the file that were listened to (seconds). */
  done: [number, number][];
}

export interface Bin {
  id: string;
  name: string;
  parent: string | null;
}

/** Cameras that filmed the same thing at the same time (a recorded event). */
export interface MulticamGroup {
  id: string;
  name: string;
  /** Seconds. */
  duration: number;
  angles: Angle[];
  /** When the event happened (ms since 1970), to show the time of day. */
  startedAt: number;
}
export interface Angle {
  id: string;
  name: string;
  media: string;
  /** Where the file starts in the group's time (seconds), plus any sync nudge. */
  offset: number;
  color: string;
  live: boolean;
}

export type TrackKind = 'video' | 'audio';
/** What a sound track carries: speech ducks music under it. */
export type TrackRole = 'dialogue' | 'music';
export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  locked: boolean;
  /** Hidden (video) or muted (audio). */
  off: boolean;
  solo: boolean;
  /** dB (audio). */
  volume: number;
  /** -1 left … 1 right (audio). */
  pan: number;
  /** Pixels on the timeline. */
  height: number;
  /** Sound: speech or music (music is turned down while someone talks). */
  role?: TrackRole;
  /** A captions track (a video track holding caption blocks), and how they look. */
  captions?: CaptionStyle;
}

/** How a captions track looks (sizes are for a 1080-high frame). */
export interface CaptionStyle {
  font: string;
  size: number;
  weight: number;
  color: string;
  stroke: number;
  strokeColor: string;
  shadow: number;
  box: boolean;
  boxColor: string;
  boxOpacity: number;
  /** Where the lines sit, and how far from the edge (percent of the height). */
  position: 'bottom' | 'middle' | 'top';
  margin: number;
  /** About this many letters on a line, and at most this many lines. */
  lineChars: number;
  lines: number;
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'add' | 'darken' | 'lighten' | 'difference' | 'softlight';

export interface Motion {
  /** Pixels from the middle of the frame. */
  x: Param;
  y: Param;
  /** Percent. */
  scale: Param;
  /** Percent across (100 = same as scale). */
  scaleX: Param;
  /** Degrees. */
  rotation: Param;
  /** Tilt toward or away (degrees, around the across and up-down lines): 3D. */
  rotX?: Param;
  rotY?: Param;
  /** Nearer (negative) or farther (positive), in pixels: 3D. */
  z?: Param;
  /** Percent of the picture taken off each side. */
  cropL: Param;
  cropR: Param;
  cropT: Param;
  cropB: Param;
  /** Percent. */
  opacity: Param;
  blend: BlendMode;
  /** Fill the frame instead of fitting inside it. */
  fill: boolean;
}

/** A video or audio effect on a clip (its kind says which numbers it has). */
export interface Effect {
  id: string;
  type: string;
  on: boolean;
  p: Record<string, Param>;
  /** Settings that aren't numbers: a color, curve points, a LUT file. */
  d?: Record<string, unknown>;
}

export interface Transition {
  type: string;
  /** Frames. */
  length: number;
}

export interface TextData {
  text: string;
  font: string;
  /** Pixels, for a 1080-high frame. */
  size: number;
  weight: number;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  /** Where the words sit before Motion moves them (0–1 across and down). */
  px: number;
  py: number;
  lineHeight: number;
  tracking: number;
  stroke: number;
  strokeColor: string;
  shadow: number;
  shadowColor: string;
  box: boolean;
  boxColor: string;
  boxOpacity: number;
  boxPad: number;
  /** How it comes on and goes off. */
  animIn: TextAnim;
  animOut: TextAnim;
  /** Frames. */
  animLength: number;
  /** Every line the same size (otherwise later lines are a little smaller). */
  even?: boolean;
}
export type TextAnim = 'none' | 'fade' | 'up' | 'down' | 'left' | 'right' | 'pop' | 'type' | 'blur' | 'wipe';

export type ClipSource =
  | { kind: 'media'; media: string; in: number }
  | { kind: 'multicam'; group: string; angle: string; in: number }
  | { kind: 'text'; text: TextData }
  | { kind: 'color'; color: string }
  | { kind: 'adjustment' }
  /** A whole sequence used as one clip (a nest). `in` is seconds into it. */
  | { kind: 'sequence'; seq: string; in: number }
  /** A picture made here: a gradient, noise, particles… */
  | { kind: 'generator'; gen: string; settings: Record<string, number | string> }
  /** A caption block on a captions track (the track says how it looks). */
  | { kind: 'caption'; text: string };

/** A spot followed through a clip: where it is at each frame (pixels from the middle of the frame). */
export interface TrackPath {
  id: string;
  name: string;
  /** [frame of the clip, x, y] */
  points: [number, number, number][];
}

export interface Clip {
  id: string;
  track: string;
  /** Frames. */
  start: number;
  length: number;
  name: string;
  source: ClipSource;
  /** 1 = normal speed. */
  speed: number;
  reverse: boolean;
  enabled: boolean;
  /** Clips with the same link move and cut together (picture and its sound). */
  link: string | null;
  label: string | null;
  motion: Motion;
  effects: Effect[];
  /** dB (keyframes make a volume line). */
  gain: Param;
  pan: Param;
  /** Into this clip (centered on its start). */
  tIn: Transition | null;
  /** Out of this clip when nothing follows it (to black or silence). */
  tOut: Transition | null;
  /** Spots followed through the clip (motion tracking). */
  paths?: TrackPath[];
}

export interface Marker {
  id: string;
  /** Frames. */
  at: number;
  length: number;
  name: string;
  color: string;
}

export interface Sequence {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Video tracks first (V1 at the bottom of the picture), then audio. */
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  /** In and out marks (frames). */
  inPoint: number | null;
  outPoint: number | null;
  /** Where the playhead was. */
  playhead: number;
  /** The color behind everything (where no clip covers the frame). */
  background: string;
}

export interface Project {
  kind: 'lumora-edit';
  version: 2;
  name: string;
  /** The event file it came from (for a recorded event). */
  eventPath: string | null;
  media: MediaItem[];
  bins: Bin[];
  groups: MulticamGroup[];
  sequences: Sequence[];
  /** The sequence on the timeline. */
  open: string;
}

export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;
export const exactRate = (fps: number): number =>
  Math.abs(fps - 23.976) < 0.01 ? 24000 / 1001 : Math.abs(fps - 29.97) < 0.01 ? 30000 / 1001 : Math.abs(fps - 59.94) < 0.01 ? 60000 / 1001 : fps;

/** Camera colors on the timeline. */
export const LABELS = ['#3d8f99', '#4a6fb5', '#7a5bb0', '#b5654a', '#3f8f5a', '#a8507a', '#5d7a8c', '#8c6d3f', '#a9443c', '#6b7a3a'];
export const LIVE_COLOR = '#a9443c';

let n = 0;
export function uid(prefix = 'c'): string {
  n += 1;
  return `${prefix}${Date.now().toString(36)}${n.toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
}

export const NO_MOTION: Motion = {
  x: 0,
  y: 0,
  scale: 100,
  scaleX: 100,
  rotation: 0,
  rotX: 0,
  rotY: 0,
  z: 0,
  cropL: 0,
  cropR: 0,
  cropT: 0,
  cropB: 0,
  opacity: 100,
  blend: 'normal',
  fill: false,
};

export const DEFAULT_TEXT: TextData = {
  text: 'Your text',
  font: 'Segoe UI',
  size: 96,
  weight: 700,
  italic: false,
  color: '#ffffff',
  align: 'center',
  px: 0.5,
  py: 0.5,
  lineHeight: 1.15,
  tracking: 0,
  stroke: 0,
  strokeColor: '#000000',
  shadow: 6,
  shadowColor: '#000000',
  box: false,
  boxColor: '#000000',
  boxOpacity: 60,
  boxPad: 24,
  animIn: 'fade',
  animOut: 'fade',
  animLength: 12,
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  font: 'Segoe UI',
  size: 54,
  weight: 600,
  color: '#ffffff',
  stroke: 0,
  strokeColor: '#000000',
  shadow: 0,
  box: true,
  boxColor: '#000000',
  boxOpacity: 65,
  position: 'bottom',
  margin: 7,
  lineChars: 42,
  lines: 2,
};

export function newTrack(kind: TrackKind, index: number): Track {
  return {
    id: uid(kind === 'video' ? 'v' : 'a'),
    kind,
    name: `${kind === 'video' ? 'V' : 'A'}${index}`,
    locked: false,
    off: false,
    solo: false,
    volume: 0,
    pan: 0,
    height: kind === 'video' ? 48 : 44,
  };
}

export function newClip(track: string, start: number, length: number, source: ClipSource, name: string): Clip {
  return {
    id: uid(),
    track,
    start,
    length,
    name,
    source,
    speed: 1,
    reverse: false,
    enabled: true,
    link: null,
    label: null,
    motion: { ...NO_MOTION },
    effects: [],
    gain: 0,
    pan: 0,
    tIn: null,
    tOut: null,
  };
}

export function newSequence(name: string, width = 1920, height = 1080, fps = 30, videoTracks = 3, audioTracks = 3): Sequence {
  const tracks: Track[] = [];
  for (let i = 1; i <= videoTracks; i++) tracks.push(newTrack('video', i));
  for (let i = 1; i <= audioTracks; i++) tracks.push(newTrack('audio', i));
  return { id: uid('s'), name, width, height, fps, tracks, clips: [], markers: [], inPoint: null, outPoint: null, playhead: 0, background: '#000000' };
}

export function emptyProject(name: string): Project {
  const seq = newSequence('Sequence 1');
  return { kind: 'lumora-edit', version: 2, name, eventPath: null, media: [], bins: [], groups: [], sequences: [seq], open: seq.id };
}
