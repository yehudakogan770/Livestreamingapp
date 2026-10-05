// Media files are not put online: each person has their own copies. Where
// the files are on this computer is remembered here, per shared project.

import type { Project } from '../model/types';

export interface Link {
  path: string;
  proxy: string | null;
}
export type Links = Record<string, Link>;

const key = (project: string) => `lumora-edit-links:${project}`;

export function loadLinks(project: string): Links {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key(project)) ?? '{}');
    return v && typeof v === 'object' ? (v as Links) : {};
  } catch {
    return {};
  }
}

export function saveLinks(project: string, links: Links): void {
  try {
    localStorage.setItem(key(project), JSON.stringify(links));
  } catch {
    // Not kept: the files are asked for again next time.
  }
}

/** The project with this computer's file places. */
export function applyLinks(p: Project, links: Links): Project {
  if (!p.media.some((m) => links[m.id])) return p;
  return { ...p, media: p.media.map((m) => (links[m.id] ? { ...m, path: links[m.id]!.path, proxy: links[m.id]!.proxy } : m)) };
}

/** Files that are somewhere else here than in the shared project. */
export function linksFrom(local: Project, shared: Project, before: Links = {}): Links {
  const out: Links = { ...before };
  const there = new Map(shared.media.map((m) => [m.id, m]));
  for (const m of local.media) {
    const s = there.get(m.id);
    if (!s) continue;
    if (m.path !== s.path || m.proxy !== s.proxy) out[m.id] = { path: m.path, proxy: m.proxy };
    else delete out[m.id];
  }
  return out;
}
