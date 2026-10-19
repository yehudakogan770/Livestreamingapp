def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/app/src/ui/importer.ts', [
("""import { mediaFrom } from '../model/build';
import { uid, type Project } from '../model/types';
import type { Doc } from '../doc';
import { fileName, inApp, native, onImportProgress } from '../native';""","""import { linkPrepared, mediaFrom, setPlaybackProxy } from '../model/build';
import { uid, type MediaItem, type Project } from '../model/types';
import type { Doc } from '../doc';
import { fileName, inApp, native, onImportProgress, onProxyProgress } from '../native';
import { wantsProxy } from '../player/files';"""),
("""onImportProgress(([path, done]) => importing.set(importing.list.map((x) => (x.path === path ? { ...x, done } : x))));""","""onImportProgress(([path, done]) => importing.set(importing.list.map((x) => (x.path === path ? { ...x, done } : x))));
onProxyProgress(([path, done]) => importing.set(importing.list.map((x) => (x.path === `proxy:${path}` ? { ...x, done } : x))));"""),
("""  const run = async () => {
    for (let path = work.shift(); path; path = work.shift()) {
      try {
        const prepared = await native.importMedia(path);
        const item = mediaFrom(prepared, fileName(path).replace(/\\.[^.]+$/, ''), bin);
        added.push(item.id);
        doc.edit((p: Project) => ({ ...p, media: [...p.media, item] }), 'Import');
        importing.set(importing.list.filter((x) => x.path !== path));
      } catch (e) {
        const problem = e instanceof Error ? e.message : String(e);
        importing.set(importing.list.map((x) => (x.path === path ? { ...x, problem } : x)));
      }
    }
  };""","""  const run = async () => {
    for (let path = work.shift(); path; path = work.shift()) {
      const name = fileName(path).replace(/\\.[^.]+$/, '');
      let item: MediaItem | null = null;
      try {
        // A quick look first: the file is in the bin straight away, and any copy it needs is made in the background.
        const look = await native.probeMedia(path).catch(() => null);
        if (look) {
          const it = mediaFrom(look, name, bin);
          item = it;
          added.push(it.id);
          doc.edit((p: Project) => ({ ...p, media: [...p.media, it] }), 'Import');
        }
        if (!look?.pending) {
          if (!item) {
            const prepared = await native.importMedia(path);
            const it = mediaFrom(prepared, name, bin);
            item = it;
            added.push(it.id);
            doc.edit((p: Project) => ({ ...p, media: [...p.media, it] }), 'Import');
          }
        } else if (item) {
          const prepared = await native.importMedia(path);
          const id = item.id;
          // Linked without a step to undo (the copy simply takes over playback).
          doc.rebase((p) => linkPrepared(p, id, prepared), true);
          item = doc.project.media.find((m) => m.id === id) ?? item;
        }
        importing.set(importing.list.filter((x) => x.path !== path));
        if (item) makeProxies(doc, [item]);
      } catch (e) {
        const problem = e instanceof Error ? e.message : String(e);
        importing.set(importing.list.map((x) => (x.path === path ? { ...x, problem } : x)));
        const id = item?.id;
        if (id) doc.rebase((p) => ({ ...p, media: p.media.map((m) => (m.id === id ? { ...m, preparing: false } : m)) }), true);
      }
    }
  };"""),
("""export const dismissProblem""","""/** Playback proxies being made, one at a time (heavy work, in the background). */
const proxyJobs: { id: string; path: string }[] = [];
let proxyBusy = false;

/** Make playback proxies for heavy files that don't have one yet (4K and up, high bit rates, HEVC). */
export function makeProxies(doc: Doc, media: MediaItem[]) {
  if (!inApp()) return;
  for (const m of media) {
    if (!wantsProxy(m) || proxyJobs.some((j) => j.id === m.id)) continue;
    proxyJobs.push({ id: m.id, path: m.path });
    importing.set([...importing.list, { path: `proxy:${m.path}`, name: `${m.name} (proxy)`, done: 0 }]);
  }
  void pumpProxies(doc);
}

async function pumpProxies(doc: Doc) {
  if (proxyBusy) return;
  proxyBusy = true;
  try {
    for (let job = proxyJobs[0]; job; job = proxyJobs[0]) {
      const key = `proxy:${job.path}`;
      try {
        const out = await native.makeProxy(job.path);
        const id = job.id;
        doc.rebase((p) => setPlaybackProxy(p, id, out), true);
        importing.set(importing.list.filter((x) => x.path !== key));
      } catch (e) {
        const problem = `No proxy: ${e instanceof Error ? e.message : String(e)}`;
        importing.set(importing.list.map((x) => (x.path === key ? { ...x, problem } : x)));
      }
      proxyJobs.shift();
    }
  } finally {
    proxyBusy = false;
  }
}

export const dismissProblem"""),
])

edit('editor/app/src/model/build.ts', [
("""/** How long a still picture is when it goes on the timeline. */""","""/** A file's edit-friendly copy is made: it is linked to the media (and plays from now on). */
export function linkPrepared(p: Project, id: string, prepared: Prepared): Project {
  return {
    ...p,
    media: p.media.map((m) => {
      if (m.id !== id) return m;
      const { preparing: _was, ...rest } = m;
      const source = sourceInfo(prepared.source);
      return {
        ...rest,
        proxy: prepared.proxy ?? null,
        duration: m.kind === 'image' ? 0 : prepared.durationMs / 1000 || m.duration,
        fps: prepared.fps ?? m.fps,
        width: prepared.width || m.width,
        height: prepared.height || m.height,
        ...(source ? { source } : {}),
      };
    }),
  };
}

/** A heavy file's playback proxy is made. */
export function setPlaybackProxy(p: Project, id: string, path: string): Project {
  return { ...p, media: p.media.map((m) => (m.id === id ? { ...m, playbackProxy: path } : m)) };
}

/** How long a still picture is when it goes on the timeline. */"""),
])
print('ok')
