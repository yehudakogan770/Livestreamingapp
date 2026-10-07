// Camera files that need a word before import: RAW formats FFmpeg can't
// decode (each camera maker has a free converter), and numbered image
// sequences (frames from VFX, animation or a time-lapse) that come in as one
// clip.

export interface RawFormat {
  ext: string;
  name: string;
  /** The free program that converts it, and what to convert it to. */
  convert: string;
}

export const RAW_FORMATS: RawFormat[] = [
  { ext: 'braw', name: 'Blackmagic RAW', convert: 'DaVinci Resolve (free) or Blackmagic RAW Player' },
  { ext: 'r3d', name: 'RED RAW (R3D)', convert: 'REDCINE-X PRO (free) or DaVinci Resolve' },
  { ext: 'ari', name: 'ARRIRAW', convert: 'ARRI Reference Tool (free) or DaVinci Resolve' },
  { ext: 'arx', name: 'ARRIRAW HDE', convert: 'ARRI Reference Tool (free) or DaVinci Resolve' },
  { ext: 'crm', name: 'Canon Cinema RAW Light', convert: 'Canon Cinema RAW Development (free) or DaVinci Resolve' },
  { ext: 'nev', name: 'Nikon N-RAW', convert: 'Nikon NX Studio or DaVinci Resolve' },
];

export const RAW_EXTENSIONS = RAW_FORMATS.map((f) => f.ext);

const extOf = (path: string): string => (path.split(/[\\/]/).pop() ?? '').split('.').pop()?.toLowerCase() ?? '';

/** Why a camera RAW file can't come in, and what to do (null: not a RAW file). */
export function rawCameraProblem(path: string): string | null {
  const f = RAW_FORMATS.find((x) => x.ext === extOf(path));
  if (!f) return null;
  return `${f.name} can't be read directly. Convert it to ProRes 422 HQ or DNxHR HQX with ${f.convert}, then import the converted file. Your color and timecode carry over.`;
}

const STILL = /\.(png|jpe?g|tiff?|dpx|exr|bmp|webp)$/i;

/** A file name split around its frame number: "plate_0042.dpx" → ["plate_", "0042", ".dpx"]. */
function splitFrame(name: string): [string, string, string] | null {
  const m = /^(.*?)(\d+)(\.[^.]+)$/.exec(name);
  return m ? [m[1] as string, m[2] as string, m[3] as string] : null;
}

/**
 * Numbered pictures among the paths: runs of at least `min` frames with the
 * same name and folder become one sequence each (by their first frame); the
 * other paths are left as they were.
 */
export function numberedRuns(paths: readonly string[], min = 10): { sequences: { first: string; count: number }[]; rest: string[] } {
  const groups = new Map<string, { n: number; path: string }[]>();
  const rest: string[] = [];
  for (const p of paths) {
    const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    const folder = p.slice(0, cut + 1);
    const parts = STILL.test(p) ? splitFrame(p.slice(cut + 1)) : null;
    if (!parts) {
      rest.push(p);
      continue;
    }
    const key = `${folder}|${parts[0]}|${parts[1].length}|${parts[2].toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), { n: Number(parts[1]), path: p }]);
  }
  const sequences: { first: string; count: number }[] = [];
  for (const list of groups.values()) {
    if (list.length < min) {
      rest.push(...list.map((x) => x.path));
      continue;
    }
    list.sort((a, b) => a.n - b.n);
    sequences.push({ first: (list[0] as { path: string }).path, count: list.length });
  }
  return { sequences, rest };
}
