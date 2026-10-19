// Send to Lumora, Lumora Studio and Lumora Titler. The desktop app writes
// into the folders those apps share (Documents/Lumora/Pictures for pictures,
// Documents/Lumora/Titles for titles); on the web the file is downloaded and
// the message says where to put it.

import { current, toast, busy } from './state';
import { getHost } from './host';
import { exportBytes } from './files';
import { newProject, newImage } from '../../../titler/src/core/build';
import { pack, fileName } from '../../../titler/src/core/package';

export type FamilyApp = 'lumora' | 'studio' | 'titler';

const APP_NAME: Record<FamilyApp, string> = { lumora: 'Lumora', studio: 'Lumora Studio', titler: 'Lumora Titler' };

function dataUrl(bytes: Uint8Array, mime: string): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
}

/** The picture as a title: one picture layer, centered on a 1920×1080 canvas, fitted inside it. */
export async function titleFromPicture(name: string, png: Uint8Array, w: number, h: number): Promise<{ name: string; text: string }> {
  const p = newProject(name, 1920, 1080);
  const k = Math.min(1, 1920 / w, 1080 / h);
  const size: [number, number] = [Math.round(w * k), Math.round(h * k)];
  const asset = { id: `a${Date.now().toString(36)}`, name: `${name}.png`, kind: 'image' as const, src: dataUrl(png, 'image/png'), width: w, height: h };
  p.assets.push(asset);
  const comp = p.compositions[0]!;
  const layer = newImage(comp, asset.id, size, [(1920 - size[0]) / 2, (1080 - size[1]) / 2], name);
  comp.layers.push(layer);
  return { name: fileName(p), text: await pack(p) };
}

export async function sendTo(target: FamilyApp): Promise<void> {
  const s = current();
  if (!s) return;
  const host = getHost();
  try {
    const png = await busy(`Sending to ${APP_NAME[target]}…`, () =>
      exportBytes(s.doc, { format: 'png', quality: 1, scale: 1, depth: 8, embedProfile: true, toSrgb: true, transparency: true, background: [1, 1, 1] }),
    );
    if (target === 'titler') {
      const t = await titleFromPicture(s.doc.name, png, s.doc.width, s.doc.height);
      const bytes = new TextEncoder().encode(t.text);
      if (host.sendToFamily) {
        const where = await host.sendToFamily('titles', t.name, bytes);
        toast(`Sent to Lumora Titler: ${where}`);
      } else {
        await host.saveFile(t.name, bytes, [{ name: 'Lumora Titler title', extensions: ['lumtitle'] }]);
        toast('Saved as a title. Open it in Lumora Titler, or put it in Documents/Lumora/Titles.');
      }
      return;
    }
    const name = `${s.doc.name}.png`;
    if (host.sendToFamily) {
      const where = await host.sendToFamily('pictures', name, png);
      toast(`Sent to ${APP_NAME[target]}: ${where}. Add it from the media library.`);
    } else {
      await host.saveFile(name, png, [{ name: 'PNG', extensions: ['png'] }]);
      toast(`Saved ${name}. Add it to ${APP_NAME[target]} from its media library.`);
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}
