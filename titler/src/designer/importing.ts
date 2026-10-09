// Import: a Lottie animation (After Effects / Bodymovin, LottieFiles…), a
// template pack, or a .lumtitle file.

import { fromLottie, isLottie } from '../core/lottie';
import { newProject } from '../core/build';
import { fromSvg, spanning } from '../core/svgImport';
import { unpack } from '../core/package';
import { readPack, type ReadPack } from '../core/titlePack';
import type { TitleProject } from '../core/types';

export type Imported = { kind: 'project'; project: TitleProject; notes: string[] } | { kind: 'pack'; pack: ReadPack };

export const IMPORT_ACCEPT = '.json,.lottie.json,.lumpack,.zip,.lumtitle,.svg,application/json,application/zip,image/svg+xml';

export function pickImportFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMPORT_ACCEPT;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

const baseName = (name: string) => name.replace(/\.(lottie\.json|json|lumpack|zip|lumtitle|svg)$/i, '');

/** An SVG drawing as a title: its shapes as layers, on a composition of its size (at least 16 px a side). */
export function svgProject(text: string, name: string): { project: TitleProject; notes: string[] } {
  const r = fromSvg(text);
  const w = Math.max(16, Math.round(r.width));
  const h = Math.max(16, Math.round(r.height));
  const p = newProject(name, w, h);
  p.compositions[0]!.layers = spanning(r.layers, p.compositions[0]!.duration);
  return { project: p, notes: r.notes };
}

/** What a file holds, read into titles. */
export async function readImport(name: string, bytes: Uint8Array): Promise<Imported> {
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zipped) return { kind: 'pack', pack: await readPack(bytes, baseName(name)) };
  const text = new TextDecoder().decode(bytes);
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) return { kind: 'project', ...svgProject(text, baseName(name)) };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file could not be read: it is not a Lottie animation, a template pack or a Lumora title.');
  }
  if (isLottie(json)) {
    const r = fromLottie(json, baseName(name));
    return { kind: 'project', project: r.project, notes: r.notes };
  }
  const r = unpack(text);
  if (!r.project) throw new Error(r.error ?? 'This file could not be read.');
  return { kind: 'project', project: r.project, notes: r.notes };
}
