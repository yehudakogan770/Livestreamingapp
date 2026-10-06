// Delivery presets: what the finished file is (codec, size, rate control,
// sound, loudness) for each place it goes. Built-in ones cover the web,
// social apps, broadcast and masters; people can save their own.

export type VideoCodec = 'h264' | 'hevc' | 'prores' | 'dnxhr' | 'png' | 'gif';
export type Container = 'mp4' | 'mov' | 'm4a' | 'mp3' | 'wav' | 'png' | 'gif';
export type ProresProfile = 'proxy' | 'lt' | 'standard' | 'hq' | '4444' | '4444xq';
export type DnxhrProfile = 'lb' | 'sq' | 'hq' | 'hqx' | '444';
/** Bit rate (variable or constant, megabits a second) or a quality to aim for (0–100). */
export type RateControl = { mode: 'vbr'; mbps: number } | { mode: 'cbr'; mbps: number } | { mode: 'quality'; q: number };
/** Use the graphics card's encoder when there is one, never, or only that. */
export type HardwarePref = 'auto' | 'software' | 'hardware';
export type AudioCodec = 'aac' | 'mp3' | 'pcm16' | 'pcm24';
export type PresetGroup = 'web' | 'social' | 'broadcast' | 'master' | 'audio' | 'image' | 'custom';

export interface VideoSpec {
  codec: VideoCodec;
  /** The frame size; null: the sequence's (with only one given, the other follows the sequence's shape). */
  width: number | null;
  height: number | null;
  /** When the shape differs from the sequence's: the whole picture inside bars, or filling the frame (cropped). */
  fit: 'fit' | 'fill';
  /** Frames a second; null: the sequence's. */
  fps: number | null;
  rate: RateControl;
  bitDepth: 8 | 10;
  /** Keep transparency (ProRes 4444, PNG). */
  alpha: boolean;
  prores?: ProresProfile;
  dnxhr?: DnxhrProfile;
  hardware: HardwarePref;
}

export interface AudioSpec {
  codec: AudioCodec;
  /** Kilobits a second (AAC and MP3). */
  kbps: number;
}

export interface DeliveryPreset {
  id: string;
  name: string;
  group: PresetGroup;
  note: string;
  container: Container;
  video: VideoSpec | null;
  audio: AudioSpec | null;
  /** Integrated loudness to aim for (LUFS): -14 for the web, -23 for broadcast; null leaves it as mixed. */
  loudness: number | null;
  /** The highest true peak allowed (dBTP) when the loudness is set. */
  truePeak: number;
  /** Also put it in Lumora's library, ready to show live. */
  toLumora?: boolean;
}

const web = (over: Partial<VideoSpec> = {}): VideoSpec => ({
  codec: 'h264',
  width: null,
  height: 1080,
  fit: 'fit',
  fps: null,
  rate: { mode: 'vbr', mbps: 12 },
  bitDepth: 8,
  alpha: false,
  hardware: 'auto',
  ...over,
});
const vertical = (mbps: number): VideoSpec => web({ width: 1080, height: 1920, fit: 'fill', rate: { mode: 'vbr', mbps } });
const AAC: AudioSpec = { codec: 'aac', kbps: 256 };
const PCM24: AudioSpec = { codec: 'pcm24', kbps: 0 };

export const BUILT_IN: DeliveryPreset[] = [
  {
    id: 'match',
    name: 'Same as the sequence',
    group: 'web',
    note: 'H.264 MP4 at the sequence size',
    container: 'mp4',
    video: web({ height: null, rate: { mode: 'quality', q: 80 } }),
    audio: AAC,
    loudness: null,
    truePeak: -1,
  },
  {
    id: 'lumora',
    name: 'For showing in Lumora',
    group: 'web',
    note: 'Plays smoothly live; can go straight into Lumora’s library',
    container: 'mp4',
    video: web({ rate: { mode: 'vbr', mbps: 22 } }),
    audio: AAC,
    loudness: null,
    truePeak: -1,
    toLumora: true,
  },
  {
    id: 'yt1080',
    name: 'YouTube 1080p (H.264)',
    group: 'web',
    note: 'H.264, 12 Mb/s, −14 LUFS',
    container: 'mp4',
    video: web(),
    audio: AAC,
    loudness: -14,
    truePeak: -1,
  },
  {
    id: 'yt1080hevc',
    name: 'YouTube 1080p (H.265)',
    group: 'web',
    note: 'H.265 10-bit, smaller files at the same quality',
    container: 'mp4',
    video: web({ codec: 'hevc', bitDepth: 10, rate: { mode: 'vbr', mbps: 8 } }),
    audio: AAC,
    loudness: -14,
    truePeak: -1,
  },
  {
    id: 'yt4k',
    name: 'YouTube 4K (H.264)',
    group: 'web',
    note: 'H.264, 45 Mb/s',
    container: 'mp4',
    video: web({ height: 2160, rate: { mode: 'vbr', mbps: 45 } }),
    audio: AAC,
    loudness: -14,
    truePeak: -1,
  },
  {
    id: 'yt4khevc',
    name: 'YouTube 4K (H.265)',
    group: 'web',
    note: 'H.265 10-bit, 30 Mb/s',
    container: 'mp4',
    video: web({ codec: 'hevc', height: 2160, bitDepth: 10, rate: { mode: 'vbr', mbps: 30 } }),
    audio: AAC,
    loudness: -14,
    truePeak: -1,
  },
  {
    id: 'shorts',
    name: 'YouTube Shorts',
    group: 'social',
    note: '1080×1920 vertical (the picture fills the frame)',
    container: 'mp4',
    video: vertical(12),
    audio: AAC,
    loudness: -14,
    truePeak: -1,
  },
  {
    id: 'reels',
    name: 'Instagram Reels',
    group: 'social',
    note: '1080×1920 vertical, up to 90 seconds',
    container: 'mp4',
    video: vertical(10),
    audio: AAC,
    loudness: -14,
    truePeak: -1,
  },
  {
    id: 'stories',
    name: 'Instagram Stories',
    group: 'social',
    note: '1080×1920 vertical, 60 seconds a story',
    container: 'mp4',
    video: vertical(8),
    audio: AAC,
    loudness: -14,
    truePeak: -1,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    group: 'social',
    note: '1080×1920 vertical',
    container: 'mp4',
    video: vertical(10),
    audio: AAC,
    loudness: -14,
    truePeak: -1,
  },
  {
    id: 'facebook',
    name: 'Facebook 1080p',
    group: 'social',
    note: 'H.264, 10 Mb/s',
    container: 'mp4',
    video: web({ rate: { mode: 'vbr', mbps: 10 } }),
    audio: AAC,
    loudness: -14,
    truePeak: -1,
  },
  {
    id: 'vimeo',
    name: 'Vimeo 1080p',
    group: 'web',
    note: 'H.264, high bit rate (Vimeo re-encodes gently)',
    container: 'mp4',
    video: web({ rate: { mode: 'vbr', mbps: 20 } }),
    audio: { codec: 'aac', kbps: 320 },
    loudness: -16,
    truePeak: -1,
  },
  {
    id: 'prores-hq',
    name: 'Broadcast: ProRes 422 HQ',
    group: 'broadcast',
    note: 'ProRes 422 HQ 10-bit .mov, 24-bit sound, −23 LUFS (EBU R128)',
    container: 'mov',
    video: web({ codec: 'prores', height: null, prores: 'hq', bitDepth: 10, hardware: 'software', rate: { mode: 'quality', q: 100 } }),
    audio: PCM24,
    loudness: -23,
    truePeak: -1,
  },
  {
    id: 'dnxhr-hq',
    name: 'Broadcast: DNxHR HQ',
    group: 'broadcast',
    note: 'DNxHR HQ .mov, 24-bit sound, −23 LUFS (EBU R128)',
    container: 'mov',
    video: web({ codec: 'dnxhr', height: null, dnxhr: 'hq', hardware: 'software', rate: { mode: 'quality', q: 100 } }),
    audio: PCM24,
    loudness: -23,
    truePeak: -1,
  },
  {
    id: 'master-4444',
    name: 'Master: ProRes 4444 (with alpha)',
    group: 'master',
    note: 'ProRes 4444 with transparency, for compositing and archiving',
    container: 'mov',
    video: web({ codec: 'prores', height: null, prores: '4444', bitDepth: 10, alpha: true, hardware: 'software', rate: { mode: 'quality', q: 100 } }),
    audio: PCM24,
    loudness: null,
    truePeak: -1,
  },
  { id: 'wav', name: 'Sound: WAV', group: 'audio', note: '24-bit, 48 kHz', container: 'wav', video: null, audio: PCM24, loudness: null, truePeak: -1 },
  {
    id: 'mp3',
    name: 'Sound: MP3',
    group: 'audio',
    note: '320 kb/s, −14 LUFS',
    container: 'mp3',
    video: null,
    audio: { codec: 'mp3', kbps: 320 },
    loudness: -14,
    truePeak: -1,
  },
  { id: 'aac', name: 'Sound: AAC (.m4a)', group: 'audio', note: '256 kb/s, −14 LUFS', container: 'm4a', video: null, audio: AAC, loudness: -14, truePeak: -1 },
  {
    id: 'png',
    name: 'Image sequence (PNG)',
    group: 'image',
    note: 'One PNG a frame, with transparency',
    container: 'png',
    video: web({ codec: 'png', height: null, alpha: true, hardware: 'software', rate: { mode: 'quality', q: 100 } }),
    audio: null,
    loudness: null,
    truePeak: -1,
  },
  {
    id: 'gif',
    name: 'GIF',
    group: 'image',
    note: '640 wide, 15 frames a second',
    container: 'gif',
    video: web({ codec: 'gif', width: 640, height: null, fps: 15, hardware: 'software', rate: { mode: 'quality', q: 80 } }),
    audio: null,
    loudness: null,
    truePeak: -1,
  },
];

export const GROUP_NAMES: Record<PresetGroup, string> = {
  web: 'Web',
  social: 'Social',
  broadcast: 'Broadcast',
  master: 'Master',
  audio: 'Sound only',
  image: 'Images',
  custom: 'My presets',
};

/** The file name ending a preset makes. */
export const extensionOf = (p: DeliveryPreset): string => p.container;

/** Image sequences are numbered: “Film.png” becomes “Film_%05d.png”. */
export function numbered(path: string): string {
  if (/%0\dd/.test(path)) return path;
  return path.replace(/(\.[a-z0-9]+)?$/i, (ext) => `_%05d${ext || '.png'}`);
}

/** What is wrong with a preset (nothing: an empty list). */
export function presetProblems(p: DeliveryPreset): string[] {
  const out: string[] = [];
  const v = p.video;
  if (!v && !p.audio) out.push('It makes neither picture nor sound.');
  if (v) {
    if (v.alpha && !(v.codec === 'png' || (v.codec === 'prores' && (v.prores === '4444' || v.prores === '4444xq'))))
      out.push('Only ProRes 4444 and PNG keep transparency.');
    if (v.codec === 'png' && p.container !== 'png') out.push('PNG frames make an image sequence.');
    if (v.codec === 'gif' && p.container !== 'gif') out.push('A GIF is its own file type.');
    if ((v.codec === 'prores' || v.codec === 'dnxhr') && p.container !== 'mov') out.push('ProRes and DNxHR go in a .mov file.');
    if ((v.codec === 'h264' || v.codec === 'hevc') && p.container !== 'mp4' && p.container !== 'mov') out.push('H.264 and H.265 go in .mp4 or .mov.');
    if (v.width !== null && (v.width < 16 || v.width > 8192)) out.push('The width must be between 16 and 8192.');
    if (v.height !== null && (v.height < 16 || v.height > 8192)) out.push('The height must be between 16 and 8192.');
    if (v.rate.mode !== 'quality' && !(v.rate.mbps > 0)) out.push('The bit rate must be more than zero.');
  } else if (p.container === 'mp4' || p.container === 'mov' || p.container === 'png' || p.container === 'gif') out.push('That file type needs a picture.');
  if (p.audio?.codec === 'mp3' && p.container !== 'mp3') out.push('MP3 sound goes in an .mp3 file.');
  if (p.container === 'mp3' && p.audio?.codec !== 'mp3') out.push('An .mp3 file needs MP3 sound.');
  if (p.container === 'wav' && !p.audio?.codec.startsWith('pcm')) out.push('A .wav file needs uncompressed sound.');
  if (p.audio?.codec.startsWith('pcm') && p.container === 'mp4') out.push('Uncompressed sound goes in .mov or .wav.');
  if (p.loudness !== null && (p.loudness < -70 || p.loudness > -5)) out.push('The loudness must be between −70 and −5 LUFS.');
  return out;
}

const KEY = 'lumora-edit-presets';

/** The presets this person saved (this computer only). */
export function savedPresets(): DeliveryPreset[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v)
      ? v.filter((x): x is DeliveryPreset => !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.name === 'string' && 'container' in x)
      : [];
  } catch {
    return [];
  }
}

export function savePreset(p: DeliveryPreset): DeliveryPreset[] {
  const mine: DeliveryPreset = { ...p, group: 'custom', id: p.id.startsWith('my-') ? p.id : `my-${Date.now().toString(36)}` };
  const list = [...savedPresets().filter((x) => x.id !== mine.id), mine];
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not kept: fine.
  }
  return list;
}

export function deletePreset(id: string): DeliveryPreset[] {
  const list = savedPresets().filter((x) => x.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not kept: fine.
  }
  return list;
}

export const allPresets = (): DeliveryPreset[] => [...BUILT_IN, ...savedPresets()];
export const presetById = (id: string): DeliveryPreset | undefined => allPresets().find((p) => p.id === id);
