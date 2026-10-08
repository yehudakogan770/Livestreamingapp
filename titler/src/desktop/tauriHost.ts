// The designer's files inside a desktop app (Lumora Titler, Lumora, Lumora
// Studio): the title library in Documents/Lumora/Titles, .lumtitle files
// chosen with the system's dialogs, autosave in the app's data folder, and
// films rendered through FFmpeg. The commands are in crates/titler-host.

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { fileName, pack, unpack } from '../core/package';
import type { TitleProject } from '../core/types';
import type { FrameSink, Host, LibraryEntry, VideoTarget } from '../designer/host';

const ext: Record<VideoTarget['format'], string> = { prores4444: 'mov', 'webm-alpha': 'webm', mp4: 'mp4', 'png-sequence': 'png' };

const FILTERS: Record<string, { name: string; extensions: string[] }> = {
  image: { name: 'Pictures and SVG logos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] },
  video: { name: 'Videos (WebM with alpha, MP4, MOV)', extensions: ['webm', 'mp4', 'mov', 'm4v'] },
  font: { name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] },
  audio: { name: 'Sounds', extensions: ['wav', 'mp3', 'm4a', 'ogg'] },
  sequence: { name: 'Image sequence frames', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
};

const baseName = (p: string) => p.replace(/^.*[\\/]/, '');

/** A desktop host: `kind` changes the wording; `key` keeps each app's autosave apart. */
export function tauriHost(kind: 'desktop' | 'lumora' | 'studio'): Host {
  const dialog = () => import('@tauri-apps/plugin-dialog');
  const host: Host = {
    kind,
    libraryName: 'Documents/Lumora/Titles',
    renderFormats: ['prores4444', 'webm-alpha', 'mp4', 'png-sequence'],
    async listLibrary(): Promise<LibraryEntry[]> {
      const list = await invoke<{ path: string; name: string; category: string; modified: number }[]>('titler_library_list');
      return list.map((e) => ({ id: e.path, name: e.name, category: e.category, modified: e.modified }));
    },
    async readLibrary(id) {
      try {
        return unpack(await invoke<string>('titler_read', { path: id }));
      } catch (e) {
        return { project: null, error: String(e), notes: [] };
      }
    },
    async saveLibrary(p, id) {
      const text = await pack({ ...p, modified: Date.now() }, (src) => host.readAsDataUrl!(src));
      return invoke<string>('titler_write', { path: id ?? null, name: p.name, text });
    },
    async removeLibrary(id) {
      await invoke('titler_remove', { path: id });
    },
    async openFile() {
      const { open } = await dialog();
      const path = await open({ multiple: false, filters: [{ name: 'Lumora titles', extensions: ['lumtitle'] }] });
      if (typeof path !== 'string') return null;
      try {
        return { result: unpack(await invoke<string>('titler_read', { path })), path };
      } catch (e) {
        return { result: { project: null, error: String(e), notes: [] }, path };
      }
    },
    async saveFile(p: TitleProject, path?: string | null) {
      let target = path && /\.lumtitle$/i.test(path) ? path : null;
      if (!target) {
        const { save } = await dialog();
        target = await save({ defaultPath: fileName(p), filters: [{ name: 'Lumora title', extensions: ['lumtitle'] }] });
      }
      if (!target) return null;
      const text = await pack({ ...p, modified: Date.now() }, (src) => host.readAsDataUrl!(src));
      return invoke<string>('titler_write', { path: target, name: p.name, text });
    },
    async pickFiles(what) {
      const { open } = await dialog();
      const picked = await open({ multiple: true, filters: [FILTERS[what]!] });
      const paths = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
      paths.sort();
      // Pictures and fonts go inside the title; videos stay linked (they can be large).
      return Promise.all(paths.map(async (p) => ({ name: baseName(p), src: what === 'video' ? p : await invoke<string>('titler_data_url', { path: p }) })));
    },
    urlFor: (src) => (src.startsWith('data:') || src.startsWith('blob:') || /^https?:/.test(src) ? src : convertFileSrc(src)),
    async readAsDataUrl(src) {
      if (src.startsWith('data:')) return src;
      try {
        return await invoke<string>('titler_data_url', { path: src });
      } catch {
        return null;
      }
    },
    autosave(p) {
      void invoke('titler_autosave', { key: kind, text: p ? JSON.stringify({ ...p, modified: Date.now() }) : null }).catch(() => {});
    },
    async recover() {
      try {
        const text = await invoke<string | null>('titler_recover', { key: kind });
        return text ? unpack(text).project : null;
      } catch {
        return null;
      }
    },
    async renderTo(target, w, h, fps): Promise<FrameSink | null> {
      const { save } = await dialog();
      const path = await save({ defaultPath: `${target.name}.${ext[target.format]}`, filters: [{ name: target.format === 'png-sequence' ? 'PNG sequence (a folder)' : 'Film', extensions: [ext[target.format]] }] });
      if (!path) return null;
      const id = await invoke<number>('titler_render_start', { path, width: w, height: h, fps, format: target.format });
      return {
        async frame(rgba) {
          await invoke('titler_render_frame', new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), { headers: { 'x-job': String(id) } });
        },
        finish: () => invoke<string>('titler_render_finish', { id }),
        cancel: () => invoke<void>('titler_render_cancel', { id }),
      };
    },
  };
  return host;
}
