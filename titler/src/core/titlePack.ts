// Template packs (.lumpack): several titles in one file to share, sell or
// hand over (a team's look, a theme bundle, a marketplace item). A zip with
//
//   pack.json                 what it is: name, author, version, license,
//                             tags, and the titles in it
//   titles/<name>.lumtitle    each title, with its pictures and fonts inside
//   thumbs/<name>.png         a picture of each (optional)
//
// Anything else in the zip is ignored; nothing in a pack runs as code.

import { pack, unpack } from './package';
import { slug } from './htmlTemplate';
import { unzip } from './unzip';
import { zip, type ZipEntry } from './zip';
import type { TitleProject } from './types';

export const PACK_FORMAT = 'lumora-title-pack';
export const PACK_VERSION = 1;
export const PACK_EXTENSION = 'lumpack';

export interface PackInfo {
  name: string;
  author?: string;
  description?: string;
  /** The pack's own version ("1.0.0"). */
  version?: string;
  license?: string;
  url?: string;
  tags?: string[];
}

export interface PackManifest extends PackInfo {
  format: typeof PACK_FORMAT;
  formatVersion: number;
  created: string;
  titles: { file: string; name: string; category: string; description?: string; thumb?: string }[];
}

export interface ReadPack {
  info: PackManifest;
  titles: TitleProject[];
  /** Titles that could not be read, and why. */
  problems: string[];
}

/** A pack of titles as .lumpack bytes; `thumbs` gives each title's PNG (optional). */
export async function writePack(info: PackInfo, titles: TitleProject[], thumbs: (Uint8Array | null)[] = [], now = new Date()): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];
  const used = new Set<string>();
  const manifest: PackManifest = { format: PACK_FORMAT, formatVersion: PACK_VERSION, created: now.toISOString(), ...info, titles: [] };
  for (const [n, t] of titles.entries()) {
    let base = slug(t.name);
    for (let k = 2; used.has(base); k++) base = `${slug(t.name)}-${k}`;
    used.add(base);
    const file = `titles/${base}.lumtitle`;
    entries.push({ name: file, data: enc.encode(await pack(t)) });
    const thumb = thumbs[n];
    const item: PackManifest['titles'][number] = { file, name: t.name, category: t.category };
    if (t.description) item.description = t.description;
    if (thumb) {
      item.thumb = `thumbs/${base}.png`;
      entries.push({ name: item.thumb, data: thumb });
    }
    manifest.titles.push(item);
  }
  entries.unshift({ name: 'pack.json', data: enc.encode(JSON.stringify(manifest, null, 2)) });
  return zip(entries);
}

/** Read a .lumpack (or any zip of .lumtitle files). */
export async function readPack(bytes: Uint8Array, fallbackName = 'Pack'): Promise<ReadPack> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const byName = new Map(files.map((f) => [f.name.replace(/^\.?\//, ''), f]));
  let info: PackManifest | null = null;
  const m = byName.get('pack.json');
  if (m) {
    try {
      const o = JSON.parse(dec.decode(m.data)) as Partial<PackManifest>;
      if (o.format === PACK_FORMAT) info = { ...o, titles: Array.isArray(o.titles) ? o.titles : [] } as PackManifest;
    } catch {
      /* read the titles anyway */
    }
  }
  const list = info?.titles.length ? info.titles.map((t) => t.file) : [...byName.keys()].filter((n) => n.toLowerCase().endsWith('.lumtitle'));
  const titles: TitleProject[] = [];
  const problems: string[] = [];
  for (const name of list) {
    const f = byName.get(name);
    if (!f) {
      problems.push(`${name}: missing from the pack`);
      continue;
    }
    const r = unpack(dec.decode(f.data));
    if (r.project) titles.push(r.project);
    else problems.push(`${name}: ${r.error ?? 'could not be read'}`);
  }
  if (!titles.length && !problems.length) problems.push('There are no titles in it.');
  return {
    info: info ?? { format: PACK_FORMAT, formatVersion: PACK_VERSION, created: '', name: fallbackName, titles: [] },
    titles,
    problems,
  };
}
