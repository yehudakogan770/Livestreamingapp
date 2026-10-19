// Where files come from and go: the browser (file picker, downloads, the
// File System Access API where there is one) or the desktop app (the
// system's dialogs and real paths; see desktop/tauriHost.ts).

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** A desktop path (re-saving goes back there). */
  path?: string;
  handle?: FileSystemFileHandle;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Host {
  kind: 'web' | 'desktop';
  openFiles(filters: FileFilter[], multiple: boolean): Promise<PickedFile[]>;
  /** Save bytes; `target` re-saves to a known place. Returns where it went (null: cancelled). */
  saveFile(
    name: string,
    bytes: Uint8Array,
    filters: FileFilter[],
    target?: { path?: string | null; handle?: FileSystemFileHandle | null },
  ): Promise<{ path?: string; handle?: FileSystemFileHandle; name: string } | null>;
  /** Read a file by desktop path (recent files). */
  readPath?(path: string): Promise<Uint8Array>;
  /** Save into the shared Lumora folders (Send to Lumora / Titler / Studio). */
  sendToFamily?(kind: 'pictures' | 'titles', name: string, bytes: Uint8Array): Promise<string>;
  /** Recovery copies (desktop: the app's data folder). */
  autosave?(key: string, bytes: Uint8Array | null): Promise<void>;
  recover?(): Promise<{ key: string; bytes: Uint8Array }[]>;
  /** The file the app was opened with (double-clicked). */
  initialFile?(): Promise<PickedFile | null>;
  print?(): void;
}

function pickWithInput(filters: FileFilter[], multiple: boolean): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(',');
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false;
    input.addEventListener('change', async () => {
      done = true;
      const files = [...(input.files ?? [])];
      input.remove();
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    });
    // Cancel: the window gets focus back without a change.
    window.addEventListener(
      'focus',
      () =>
        setTimeout(() => {
          if (!done) {
            input.remove();
            resolve([]);
          }
        }, 600),
      { once: true },
    );
    input.click();
  });
}

type SaveFilePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;

export function webHost(): Host {
  return {
    kind: 'web',
    openFiles: pickWithInput,
    async saveFile(name, bytes, filters, target) {
      const w = window as unknown as { showSaveFilePicker?: SaveFilePicker };
      try {
        let handle = target?.handle ?? null;
        if (!handle && w.showSaveFilePicker) {
          handle = await w.showSaveFilePicker({
            suggestedName: name,
            types: filters.map((f) => ({ description: f.name, accept: { 'application/octet-stream': f.extensions.map((e) => `.${e}`) } })),
          });
        }
        if (handle) {
          const ws = await handle.createWritable();
          await ws.write(bytes as unknown as FileSystemWriteChunkType);
          await ws.close();
          return { handle, name: handle.name };
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return null;
        // Fall back to a download.
      }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { name };
    },
    print: () => window.print(),
  };
}

let host: Host = typeof window !== 'undefined' ? webHost() : ({ kind: 'web' } as Host);

export const getHost = () => host;
export const setHost = (h: Host) => {
  host = h;
};
