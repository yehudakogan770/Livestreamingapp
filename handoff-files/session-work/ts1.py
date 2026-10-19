def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/app/src/doc.ts', [
("""  rebase(f: (p: Project) => Project) {
    this.past = this.past.map((x) => ({ ...x, p: f(x.p) }));
    this.future = this.future.map((x) => ({ ...x, p: f(x.p) }));
    const after = f(this.state.project);
    this.set({ project: after, selection: keep(this.state.selection, after) });
  }""","""  rebase(f: (p: Project) => Project, dirty = false) {
    this.past = this.past.map((x) => ({ ...x, p: f(x.p) }));
    this.future = this.future.map((x) => ({ ...x, p: f(x.p) }));
    const after = f(this.state.project);
    this.set({ project: after, selection: keep(this.state.selection, after), ...(dirty ? { dirty: true } : {}) });
  }"""),
])

edit('editor/app/src/native.ts', [
("""  importMedia: (path: string) => invoke<Prepared>('import_media', { path }),""","""  importMedia: (path: string) => invoke<Prepared>('import_media', { path }),
  /** What a file is and whether a copy will be made (quick: nothing is made yet). */
  probeMedia: (path: string) => invoke<Prepared>('probe_media', { path }),
  /** A lighter copy of a heavy file for smooth playback (made once, kept). */
  makeProxy: (path: string) => invoke<string>('make_proxy', { path }),
  /** Read an original's frames through FFmpeg (RGBA), for making the film from files the app can't decode. */
  framesOpen: (path: string, from: number, rate: number, width: number, height: number) => invoke<number>('frames_open', { path, from, rate, width, height }),
  framesNext: async (id: number): Promise<Uint8Array> => new Uint8Array(await invoke<ArrayBuffer>('frames_next', { id })),
  framesClose: (id: number) => invoke<void>('frames_close', { id }),"""),
("""/** How far a speech model's download is along""","""/** How far a playback proxy is along: [path, 0–1]. */
export const onProxyProgress = (f: (p: [string, number]) => void): (() => void) => subscribe('proxy-progress', f);

/** How far a speech model's download is along"""),
])

edit('editor/app/src/model/build.ts', [
("""  height: number;
  fps?: number;
}

const IMAGE""","""  height: number;
  fps?: number;
  /** What FFmpeg found and how the file is handled (files imported by hand). */
  source?: (Omit<SourceInfo, 'note'> & { note?: string | null }) | null;
  /** An edit-friendly copy is still to be made. */
  pending?: boolean;
}

/** What is kept about a file's kind from what the app found. */
export function sourceInfo(s: Prepared['source']): SourceInfo | undefined {
  if (!s) return undefined;
  const { note, ...rest } = s;
  return note ? { ...rest, note } : rest;
}

const IMAGE"""),
("""    hasAudio: !image && prepared.hasAudio,
    bin,
  };
}""","""    hasAudio: !image && prepared.hasAudio,
    bin,
    ...(prepared.source ? { source: sourceInfo(prepared.source) } : {}),
    ...(prepared.pending ? { preparing: true } : {}),
  };
}"""),
("""  type Sequence,
  type Track,
} from './types';""","""  type Sequence,
  type SourceInfo,
  type Track,
} from './types';"""),
])
print('ok')
