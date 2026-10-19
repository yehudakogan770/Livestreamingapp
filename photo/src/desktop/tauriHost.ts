// Lumora Photo's files inside the desktop app: the system's open and save
// dialogs, real paths (Save goes back to the same file), the shared Lumora
// folders for Send To, and recovery copies. The commands are in
// photo/src-tauri/src/lib.rs.

import { invoke } from '@tauri-apps/api/core';
import type { FileFilter, Host, PickedFile } from '../app/host';

const baseName = (p: string) => p.replace(/^.*[\\/]/, '');

async function readPath(path: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>('photo_read', { path });
  return new Uint8Array(buf);
}

async function writePath(path: string, bytes: Uint8Array): Promise<void> {
  await invoke('photo_write', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
}

export async function tauriHost(): Promise<Host> {
  const dialog = await import('@tauri-apps/plugin-dialog');
  const host: Host = {
    kind: 'desktop',
    async openFiles(filters: FileFilter[], multiple: boolean): Promise<PickedFile[]> {
      const picked = await dialog.open({ multiple, filters });
      const paths = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
      return Promise.all(paths.map(async (p) => ({ name: baseName(p), path: p, bytes: await readPath(p) })));
    },
    async saveFile(name, bytes, filters, target) {
      let path = target?.path ?? null;
      if (!path) path = await dialog.save({ defaultPath: name, filters });
      if (!path) return null;
      await writePath(path, bytes);
      return { path, name: baseName(path) };
    },
    readPath,
    sendToFamily: (kind, name, bytes) => invoke<string>('photo_send_to_family', bytes, { headers: { 'x-kind': kind, 'x-name': encodeURIComponent(name) } }),
    async autosave(key, bytes) {
      if (bytes) await invoke('photo_autosave', bytes, { headers: { 'x-key': encodeURIComponent(key) } });
      else await invoke('photo_autosave_clear', { key });
    },
    async recover() {
      const keys = await invoke<string[]>('photo_recover_list');
      return Promise.all(keys.map(async (key) => ({ key, bytes: new Uint8Array(await invoke<ArrayBuffer>('photo_recover_read', { key })) })));
    },
    async initialFile() {
      const p = await invoke<string | null>('initial_file');
      if (!p) return null;
      return { name: baseName(p), path: p, bytes: await readPath(p) };
    },
    print: () => window.print(),
  };
  return host;
}
