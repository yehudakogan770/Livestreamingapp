// Lumora Studio's project: media in bins, sequences with many video and audio
// tracks, and clips with keyframed effects. Sequence times are whole frames;
// times inside a media file are seconds.
import type { TitleProject } from '../../../../titler/src/core/types';

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
  /** Custom bezier handles (frames, value) relative to the key: `i` reaches back toward the previous key, `o` ahead toward the next. Used by 'bezier'. */
  i?: [number, number];
  o?: [number, number];
}
/**
 * How a key moves on to the next one: straight, smooth both ends (the original ease), held, slowing into the
 * next key (easeIn), leaving this key slowly (easeOut), an automatic bezier through the neighbors, or custom handles.
 */
export type Ease = 'linear' | 'ease' | 'hold' | 'easeIn' | 'easeOut' | 'auto' | 'bezier';

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
  /** A lighter copy for smooth playback of heavy files (4K, high bit rates, HEVC). Never used to make the film. */
  playbackProxy?: string | null;
  /** What FFmpeg found in the file when it was imported. */
  source?: SourceInfo;
  /** The edit-friendly copy is still being made. */
  preparing?: boolean;
  /** The words spoken in it (made by Transcribe). */
  transcript?: Transcript;
  /** Media management: stars (0–5), tags, notes, and when it was added (ms since 1970). */
  rating?: number;
  tags?: string[];
  notes?: string;
  addedAt?: number;
  /** A subclip: only this part of the file (seconds), e.g. one shot found by scene detection. */
  range?: [number, number];
}

/** What a file is (FFmpeg looked when it was imported) and how Lumora Studio handles it. */
export interface SourceInfo {
  /** The picture's codec (FFmpeg's name: h264, hevc, prores…), or the sound's for a sound file. */
  codec: string;
  /** Bits per color (8, 10, 12). */
  bitDepth: number;
  /** HDR (PQ or HLG), or Dolby Vision. */
  hdr: boolean;
  /** Turned in the file (degrees, clockwise). */
  rotation: number;
  /** The frame rate changes through the file (phones). */
  vfr: boolean;
  bitrateKbps: number;
  /** Heavy to play (4K and up, high bit rates, HEVC, 10-bit): a lighter playback proxy is made. */
  heavy: boolean;
  /** How the film is made from it: the original decoded in the app, or the original read through FFmpeg. */
  exportVia: 'original' | 'ffmpeg';
  /** What was done to it, for the person editing (e.g. HDR shown as SDR). */
  note?: string;
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
  /** Sound: the track's own processing (equalizer, compressor, limiter), before its fader. */
  fx?: Effect[];
  /** Sound: the bus it plays through (otherwise straight into the mix). */
  bus?: string | null;
}

/** A submix: sound tracks sent to it are mixed, processed and leveled together (all the dialogue, all the music). */
export interface Bus {
  id: string;
  name: string;
  /** dB. */
  volume: number;
  /** -1 left … 1 right. */
  pan: number;
  /** Muted. */
  off: boolean;
  fx: Effect[];
}

/** The sequence's mix: its buses, and the whole mix's own processing and level (what the film gets). */
export interface Mix {
  buses: Bus[];
  fx: Effect[];
  /** dB. */
  volume: number;
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
  /** Words lit as they are spoken (social-style captions); none by default. */
  anim?: CaptionAnim;
  /** The color a lit word (or its box) takes. */
  accent?: string;
  /** All capitals. */
  caps?: boolean;
}

/**
 * How the words of a caption follow the speech: the word being said in the
 * accent color (highlight), every word said so far in it (karaoke), the word
 * being said a little bigger (pop), words appearing as they are said (reveal),
 * or a box of the accent color behind the word being said (wordbox).
 */
export type CaptionAnim = 'none' | 'highlight' | 'karaoke' | 'pop' | 'reveal' | 'wordbox';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'add'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'softlight'
  | 'hardlight'
  | 'colordodge'
  | 'colorburn'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

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
  /** Rounded box corners (pixels, for a 1080-high frame). */
  boxRadius?: number;
  /** A bar of color beside the words (lower thirds, quotes). */
  accent?: string;
  accentSide?: 'left' | 'right' | 'top' | 'bottom';
  /** The bar's thickness (pixels, for a 1080-high frame). */
  accentSize?: number;
  /** The color of the second and later lines (otherwise the first line's, a little softer). */
  color2?: string;
  /** All capitals. */
  caps?: boolean;
  /** The box and bar grow in with the words (and shrink away with them). */
  boxGrow?: boolean;
  /** Letters, words or lines animated one after another (see model/textanim.ts). */
  animators?: TextAnimator[];
  /** Caption words lit as they are spoken: when each word of `text` is said (frames from the start). */
  spoken?: { anim: Exclude<CaptionAnim, 'none'>; accent: string; times: [number, number][] };
}

/** Which letters, words or lines an animator moves, and how much of its properties each gets. */
export interface TextAnimator {
  id: string;
  name: string;
  on: boolean;
  /** What the range counts: letters (spaces skipped), words or lines. */
  by: 'char' | 'word' | 'line';
  /** The range (percent of the units), moved along by `offset`. */
  start: Param;
  end: Param;
  offset: Param;
  /** How the amount falls off across the range. */
  shape: 'square' | 'rampUp' | 'rampDown' | 'triangle' | 'round' | 'smooth';
  /** Square: each unit is fully in or out (no partial coverage). */
  hard?: boolean;
  /** Count from the last unit back. */
  reverse?: boolean;
  /** Percent of the properties applied where selected. */
  amount: Param;
  /** The properties at full selection: opacity and scale (percent), position (px for a 1080-high frame), rotation (degrees), blur and tracking (px). */
  opacity?: Param;
  x?: Param;
  y?: Param;
  scale?: Param;
  rotation?: Param;
  blur?: Param;
  tracking?: Param;
}

/** A drawn shape (sizes are for a 1080-high frame). */
export interface ShapeData {
  kind: 'rect' | 'ellipse' | 'polygon' | 'star' | 'line';
  w: number;
  h: number;
  /** Where its middle sits before Motion moves it (0–1 across and down). */
  px: number;
  py: number;
  /** Polygon sides and star points. */
  sides: number;
  /** A star's inner radius (percent of the outer). */
  inner: number;
  /** Rounded corners (rectangle, polygon, star). */
  corner: number;
  fillOn: boolean;
  fill: string;
  strokeOn: boolean;
  stroke: string;
  strokeWidth: number;
  /** Trim paths: the part of the outline drawn (percent), moved along by `trimOffset` (percent). */
  trimStart: Param;
  trimEnd: Param;
  trimOffset: Param;
}

/** A clip's time remapping: its speed over the clip (keyframes make ramps; 0 is a freeze; negative plays backwards). */
export interface TimeRemap {
  /** Percent of normal speed. */
  speed: Param;
  /** How frames between the file's frames are made: the nearest frame, two frames blended, or optical-flow interpolation. */
  sampling: 'nearest' | 'blend' | 'flow';
  /** The sound keeps its pitch when sped up or slowed down (otherwise it changes like tape). */
  pitch: boolean;
}

/** Motion blur for moving pictures: how long the shutter is open (degrees, 180 = half a frame) and how many looks are averaged. */
export interface MotionBlur {
  on: boolean;
  shutter: number;
  samples: number;
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
  /** `words`: when each word is said, [from, to) frames from the clip's start (one per word of `text`). */
  | { kind: 'caption'; text: string; words?: [number, number][] }
  /** A drawn shape: rectangle, ellipse, polygon, star or line. */
  | { kind: 'shape'; shape: ShapeData }
  /** A Lumora Titler graphic (lower third, bug, ticker, card…): IN from the clip's start, OUT to its end. */
  | { kind: 'titler'; project: TitleProject; values: Record<string, string> };

/**
 * A spot (or a region) followed through a clip: motion tracking. Places are
 * 0–1 across and down the clip's own picture, so they stay right whatever the
 * clip's size, fit or the sequence's shape.
 */
export interface TrackPath {
  id: string;
  name: string;
  /** [frame of the clip, across, down, size (1: as when tracking started), turn (degrees)], in frame order. */
  points: TrackPoint[];
  /** One spot (where it is) or a region (where it is, its size and its turn). */
  kind?: 'point' | 'region';
  /** The region's width and height when tracking started (0–1 of the picture's). */
  box?: [number, number];
  /** Frames placed by hand: tracking keeps them, and starts again from them. */
  manual?: number[];
}
export type TrackPoint = [number, number, number, number?, number?];

/** A clip that follows a track of another clip (a title on a face, a graphic on a sign). */
export interface Follow {
  clip: string;
  path: string;
  /** The sequence frame it was attached at: where it was then, relative to the track, is kept. */
  at: number;
  /** Grows and turns with the region too. */
  scale: boolean;
  rotate: boolean;
}

/** Steadied with one of its own tracks (the track's movement is taken away). */
export interface Stabilize {
  path: string;
  /** How much of the camera's own movement is smoothed away (0 – 100). */
  smooth: number;
  /** No movement at all, as if on a tripod (held where it is at `at`). */
  lock: boolean;
  /** The clip frame a locked shot is held at. */
  at: number;
  /** Zoom in just enough that no edge shows. */
  crop: boolean;
  /** A region track also takes away turning and zooming. */
  rotate: boolean;
  scale: boolean;
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
  /** Moves with a track of another clip. */
  follow?: Follow | null;
  /** Steadied with one of its own tracks. */
  stabilize?: Stabilize | null;
  /** Time remapping: keyframed speed, freezes and backwards parts (replaces `reverse`; `speed` still scales it). */
  remap?: TimeRemap | null;
  /** Motion blur for its animated movement. */
  motionBlur?: MotionBlur | null;
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
  /** Buses and the whole mix's processing (none: tracks go straight into the mix). */
  mix?: Mix;
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
  /** Bins that fill themselves by rules (type, rating, tag…). */
  smartBins?: SmartBin[];
  /** Who is heard on each sound file (by media id), as shown in the transcript. */
  speakers?: Record<string, string>;
}

/** A bin that shows the media matching its rules (all of them, or any). */
export interface SmartBin {
  id: string;
  name: string;
  match: 'all' | 'any';
  rules: SmartRule[];
}
export type SmartRule =
  | { field: 'kind'; is: 'video' | 'audio' | 'image' }
  | { field: 'rating'; atLeast: number }
  | { field: 'tag'; has: string }
  | { field: 'resolution'; atLeast: number }
  | { field: 'added'; withinDays: number }
  | { field: 'transcript'; has: boolean }
  | { field: 'used'; is: boolean }
  | { field: 'text'; has: string };

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
