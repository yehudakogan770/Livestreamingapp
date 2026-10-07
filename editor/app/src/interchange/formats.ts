// The timeline formats other editors read and write, and how to tell which
// one a file is.
import { readEdl, writeEdl } from './edl';
import { readFcpxml, writeFcpxml } from './fcpxml';
import { readOtio, writeOtio } from './otio';
import type { XTimeline } from './timeline';
import { readXmeml, writeXmeml } from './xmeml';

export type InterchangeFormat = 'fcpxml' | 'xml' | 'edl' | 'otio';

export interface FormatInfo {
  id: InterchangeFormat;
  name: string;
  /** Which editors take it. */
  for: string;
  extension: string;
  /** What it can't hold (shown before exporting). */
  limits: string;
  write: (t: XTimeline) => string;
}

export const FORMATS: FormatInfo[] = [
  {
    id: 'fcpxml',
    name: 'FCPXML',
    for: 'Final Cut Pro, DaVinci Resolve',
    extension: 'fcpxml',
    limits: 'Clips, tracks (as lanes), speed, volume, titles and markers. Effects, grades and dissolves stay here.',
    write: writeFcpxml,
  },
  {
    id: 'xml',
    name: 'Premiere XML (FCP 7)',
    for: 'Premiere Pro, DaVinci Resolve, Avid (through its importer)',
    extension: 'xml',
    limits: 'Clips, every track, speed, volume, dissolves and markers. Titles, effects and grades stay here.',
    write: writeXmeml,
  },
  {
    id: 'edl',
    name: 'EDL (CMX3600)',
    for: 'Any editor, online and finishing systems',
    extension: 'edl',
    limits: 'One picture track (V1) and four sound tracks, cuts, dissolves and speed. No markers, titles or effects.',
    write: writeEdl,
  },
  {
    id: 'otio',
    name: 'OpenTimelineIO',
    for: 'DaVinci Resolve, Premiere (plug-in), Avid, Nuke Studio, pipeline tools',
    extension: 'otio',
    limits: 'Clips, every track, speed, dissolves and markers. Effects and grades stay here.',
    write: writeOtio,
  },
];

export const formatInfo = (id: InterchangeFormat): FormatInfo => FORMATS.find((f) => f.id === id) as FormatInfo;

/** The extensions a timeline can be imported from. */
export const TIMELINE_EXTENSIONS = ['fcpxml', 'xml', 'edl', 'otio'];

/** Which format a file is, from its contents (and its name when that doesn't settle it). */
export function detectFormat(text: string, name = ''): InterchangeFormat | null {
  const head = text.replace(/^﻿/, '').slice(0, 4000).trimStart();
  if (/<fcpxml[\s>]/.test(head)) return 'fcpxml';
  if (/<xmeml[\s>]/.test(head)) return 'xml';
  if (head.startsWith('{') && /"OTIO_SCHEMA"/.test(head)) return 'otio';
  if (/^TITLE:/im.test(head) || /^\d{3,6}\s+\S+\s+\S+\s+[CDWK]/m.test(head)) return 'edl';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'fcpxmld') return 'fcpxml';
  return (TIMELINE_EXTENSIONS as string[]).includes(ext) ? (ext as InterchangeFormat) : null;
}

/** Read a timeline file of any of the formats. EDLs don't say their frame rate: `edlFps` is used. */
export function readTimeline(text: string, name = '', edlFps = 30): XTimeline {
  const f = detectFormat(text, name);
  if (f === 'fcpxml') return readFcpxml(text);
  if (f === 'xml') return readXmeml(text);
  if (f === 'otio') return readOtio(text);
  if (f === 'edl')
    return readEdl(
      text,
      edlFps,
      name
        .replace(/\.[^.]+$/, '')
        .split(/[\\/]/)
        .pop() ?? '',
    );
  throw new Error('This is not a timeline Lumora Studio can read (FCPXML, Premiere / FCP 7 XML, EDL or OpenTimelineIO).');
}
