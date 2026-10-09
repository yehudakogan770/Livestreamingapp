// Import: a Lottie animation (After Effects / Bodymovin, LottieFiles…), a
// template pack, or a .lumtitle file.

import { fromLottie, isLottie } from '../core/lottie';
import { unpack } from '../core/package';
import { readPack, type ReadPack } from '../core/titlePack';
import type { TitleProject } from '../core/types';

export type Imported = { kind: 'project'; project: TitleProject; notes: string[] } | { kind: 'pack'; pack: ReadPack };

export const IMPORT_ACCEPT = '.json,.lottie.json,.lumpack,.zip,.lumtitle,application/json,application/zip';

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

const baseName = (name: string) => name.replace(/\.(lottie\.json|json|lumpack|zip|lumtitle)$/i, '');

/** What a file holds, read into titles. */
export async function readImport(name: string, bytes: Uint8Array): Promise<Imported> {
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zipped) return { kind: 'pack', pack: await readPack(bytes, baseName(name)) };
  const text = new TextDecoder().decode(bytes);
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
