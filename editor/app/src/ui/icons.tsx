// Lumora Studio's line icons: lucide, plus the few marks an editor needs that
// lucide doesn't draw (in / out brackets). One place picks the icon for a
// panel section or a dialog from its title, so every header carries one.
import {
  Aperture,
  ArrowDownUp,
  AudioLines,
  Blend,
  Box,
  Captions,
  Cctv,
  Clapperboard,
  Crop,
  Crosshair,
  Droplet,
  Film,
  FolderArchive,
  Gauge,
  History,
  Keyboard,
  Languages,
  Layers,
  LayoutPanelTop,
  ListOrdered,
  Move,
  Music,
  Palette,
  Pipette,
  RectangleHorizontal,
  Scan,
  ScanSearch,
  Shapes,
  SlidersHorizontal,
  Spline,
  SquareDashed,
  Text,
  Timer,
  Type,
  Upload,
  Users,
  Video,
  Volume2,
  Wind,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react';

/** Mark in: an opening bracket. */
export const MarkIn = createLucideIcon('mark-in', [['path', { d: 'M15 4h-4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4', key: 'in' }]]);
/** Mark out: a closing bracket. */
export const MarkOut = createLucideIcon('mark-out', [['path', { d: 'M9 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H9', key: 'out' }]]);

const SECTIONS: [RegExp, LucideIcon][] = [
  [/^motion blur/i, Wind],
  [/^motion/i, Move],
  [/^3d/i, Box],
  [/^crop/i, Crop],
  [/^camera/i, Video],
  [/^tracking/i, Crosshair],
  [/^stabili/i, Scan],
  [/^time remap/i, Timer],
  [/^speed/i, Gauge],
  [/^graph/i, Spline],
  [/^text animators/i, Text],
  [/^(text|title)/i, Type],
  [/^caption/i, Captions],
  [/^sound|^volume|^audio/i, Volume2],
  [/^color|^primaries/i, Palette],
  [/^change one color/i, Droplet],
  [/^curves/i, Spline],
  [/^qualifier/i, Pipette],
  [/^window/i, SquareDashed],
  [/^adjustment/i, Layers],
  [/^nested/i, Film],
  [/^shape/i, Shapes],
];

/** The icon for a panel section, from its title (none when nothing fits). */
export function sectionIcon(title: unknown): LucideIcon | null {
  if (typeof title !== 'string') return null;
  return SECTIONS.find(([re]) => re.test(title))?.[1] ?? null;
}

const DIALOGS: [RegExp, LucideIcon][] = [
  [/export|render queue/i, Upload],
  [/silence/i, AudioLines],
  [/multicam/i, Cctv],
  [/color match/i, Palette],
  [/reframe/i, RectangleHorizontal],
  [/highlight/i, Clapperboard],
  [/chapter/i, ListOrdered],
  [/transcribe/i, Captions],
  [/media search/i, ScanSearch],
  [/music|ducking/i, Music],
  [/keyboard/i, Keyboard],
  [/history|backups/i, History],
  [/people|share/i, Users],
  [/sequence/i, Film],
  [/speed/i, Gauge],
  [/collect|archive/i, FolderArchive],
  [/workspace/i, LayoutPanelTop],
  [/smart bin/i, SlidersHorizontal],
  [/changed the same/i, ArrowDownUp],
  [/blend/i, Blend],
  [/lens|aperture/i, Aperture],
];

/** The icon for a dialog, from its title (none when nothing fits). */
export function dialogIcon(title: string): LucideIcon | null {
  if (/translate/i.test(title)) return Languages;
  return DIALOGS.find(([re]) => re.test(title))?.[1] ?? null;
}
