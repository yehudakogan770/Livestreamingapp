// Import: a Lottie animation (After Effects / Bodymovin, LottieFiles…), a
// Photoshop file (its layers as pictures, in place), an SVG drawing, a
// template pack, or a .lumtitle file.

import { fromLottie, isLottie } from '../core/lottie';
import { newGroup, newImage, newProject, uid } from '../core/build';
import { isPsd, readPsd, type PsdNode } from '../core/psd';
import { dataUrl, encodePng } from '../core/png';
import type { Asset, Layer } from '../core/types';
import { fromSvg, spanning } from '../core/svgImport';
import { unpack } from '../core/package';
import { readPack, type ReadPack } from '../core/titlePack';
import type { TitleProject } from '../core/types';

export type Imported = { kind: 'project'; project: TitleProject; notes: string[] } | { kind: 'pack'; pack: ReadPack };

export const IMPORT_ACCEPT = '.json,.lottie.json,.lumpack,.zip,.lumtitle,.svg,.psd,application/json,application/zip,image/svg+xml,image/vnd.adobe.photoshop';

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

const baseName = (name: string) => name.replace(/\.(lottie\.json|json|lumpack|zip|lumtitle|svg|psd)$/i, '');

/**
 * A Photoshop file as a title: a composition of its size with each pixel
 * layer as a picture where it was (its opacity, blend mode and whether it is
 * shown kept), and layer groups as groups. The pictures travel in the title.
 */
export async function psdProject(bytes: Uint8Array, name: string): Promise<{ project: TitleProject; notes: string[] }> {
  const psd = readPsd(bytes);
  const p = newProject(name, psd.width, psd.height);
  const c = p.compositions[0]!;
  const assets: Asset[] = [];
  const toLayer = async (n: PsdNode): Promise<Layer | null> => {
    if (n.kind === 'group') {
      const kids = (await Promise.all(n.children.map(toLayer))).filter((l): l is Layer => !!l);
      if (!kids.length) return null;
      const g = newGroup(c, kids, n.name);
      g.visible = n.visible;
      if (n.opacity < 255) g.transform.opacity = { v: Math.round((n.opacity / 255) * 1000) / 10 };
      if (n.blend !== 'normal') g.blend = n.blend;
      return g;
    }
    const id = uid('a');
    assets.push({ id, name: `${n.name}.png`, kind: 'image', src: dataUrl(await encodePng(n.width, n.height, n.rgba), 'image/png'), width: n.width, height: n.height });
    const l = newImage(c, id, [n.width, n.height], [n.left, n.top], n.name);
    l.fit = 'stretch';
    l.visible = n.visible;
    if (n.opacity < 255) l.transform.opacity = { v: Math.round((n.opacity / 255) * 1000) / 10 };
    if (n.blend !== 'normal') l.blend = n.blend;
    return l;
  };
  c.layers = (await Promise.all(psd.layers.map(toLayer))).filter((l): l is Layer => !!l);
  p.assets = assets;
  return { project: p, notes: psd.notes };
}

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
  if (isPsd(bytes)) return { kind: 'project', ...(await psdProject(bytes, baseName(name))) };
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (zipped) return { kind: 'pack', pack: await readPack(bytes, baseName(name)) };
  const text = new TextDecoder().decode(bytes);
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) return { kind: 'project', ...svgProject(text, baseName(name)) };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file could not be read: it is not a Lottie animation, a Photoshop file, an SVG drawing, a template pack or a Lumora title.');
  }
  if (isLottie(json)) {
    const r = fromLottie(json, baseName(name));
    return { kind: 'project', project: r.project, notes: r.notes };
  }
  const r = unpack(text);
  if (!r.project) throw new Error(r.error ?? 'This file could not be read.');
  return { kind: 'project', project: r.project, notes: r.notes };
}
