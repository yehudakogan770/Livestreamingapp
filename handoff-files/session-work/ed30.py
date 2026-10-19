import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a627d341a263cc12b/titler/src/designer')
p='importing.ts'; s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1, a
    s=s.replace(a,b)
rep('''// Import: a Lottie animation (After Effects / Bodymovin, LottieFiles…), a
// template pack, or a .lumtitle file.''','''// Import: a Lottie animation (After Effects / Bodymovin, LottieFiles…), a
// Photoshop file (its layers as pictures, in place), an SVG drawing, a
// template pack, or a .lumtitle file.''')
rep('''import { fromLottie, isLottie } from '../core/lottie';
import { newProject } from '../core/build';''','''import { fromLottie, isLottie } from '../core/lottie';
import { newGroup, newImage, newProject, uid } from '../core/build';
import { isPsd, readPsd, type PsdNode } from '../core/psd';
import { dataUrl, encodePng } from '../core/png';
import type { Asset, Layer } from '../core/types';''')
rep('''export const IMPORT_ACCEPT = '.json,.lottie.json,.lumpack,.zip,.lumtitle,.svg,application/json,application/zip,image/svg+xml';''','''export const IMPORT_ACCEPT = '.json,.lottie.json,.lumpack,.zip,.lumtitle,.svg,.psd,application/json,application/zip,image/svg+xml,image/vnd.adobe.photoshop';''')
rep('''const baseName = (name: string) => name.replace(/\\.(lottie\\.json|json|lumpack|zip|lumtitle|svg)$/i, '');''','''const baseName = (name: string) => name.replace(/\\.(lottie\\.json|json|lumpack|zip|lumtitle|svg|psd)$/i, '');

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
  const notes = [...psd.notes];
  if (c.layers.length) notes.push('Text layers come in as pictures; type them again with the text tool to make them fields.');
  return { project: p, notes };
}''')
rep('''export async function readImport(name: string, bytes: Uint8Array): Promise<Imported> {
  const zipped''','''export async function readImport(name: string, bytes: Uint8Array): Promise<Imported> {
  if (isPsd(bytes)) return { kind: 'project', ...(await psdProject(bytes, baseName(name))) };
  const zipped''')
rep("throw new Error('This file could not be read: it is not a Lottie animation, a template pack or a Lumora title.');","throw new Error('This file could not be read: it is not a Lottie animation, a Photoshop file, an SVG drawing, a template pack or a Lumora title.');")
open(p,'w').write(s)

p='Designer.tsx'; s=open(p).read()
rep('''title="Import a Lottie animation (After Effects, LottieFiles), a template pack or a .lumtitle file"''','''title="Import a Lottie animation (After Effects, LottieFiles), a Photoshop file, an SVG drawing, a template pack or a .lumtitle file"''')
open(p,'w').write(s)
