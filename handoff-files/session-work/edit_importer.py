import sys
p = sys.argv[1]
s = open(p).read()


def rep(a, b):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, 1)


rep("import { shotsAfterImport } from '../manage/shots';\n", "import { shotsAfterImport } from '../manage/shots';\nimport { ProxyScheduler } from '../cache/proxyqueue';\n")
a = s.index("/** Playback proxies being made, one at a time (heavy work, in the background). */")
b = s.index("export const dismissProblem")
s = s[:a] + '''/** Where the playhead is (proxies for the files near it are made first). */
let focus: () => { p: Project | null; playhead: number } = () => ({ p: null, playhead: 0 });
export function setProxyFocus(f: () => { p: Project | null; playhead: number }) {
  focus = f;
}

/** Hardware encoding for proxies (the graphics card's encoder when one works). */
export const proxyOptions = { hardware: true };

let proxyDoc: Doc | null = null;

/** Playback proxies being made, a few at a time (heavy work, in the background), nearest the playhead first. */
const proxies = new ProxyScheduler(
  async (job, threads) => {
    const key = `proxy:${job.path}`;
    try {
      const out = await native.makeProxy(job.path, threads, proxyOptions.hardware);
      const id = job.id;
      proxyDoc?.rebase((p) => setPlaybackProxy(p, id, out), true);
      importing.set(importing.list.filter((x) => x.path !== key));
    } catch (e) {
      const problem = `No proxy: ${e instanceof Error ? e.message : String(e)}`;
      importing.set(importing.list.map((x) => (x.path === key ? { ...x, problem } : x)));
    }
  },
  () => focus(),
  typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4,
);

/**
 * Make playback proxies for heavy files that don't have one yet (4K and up,
 * high bit rates, HEVC). `chosen`: any video asked for by hand (made first, heavy or not).
 */
export function makeProxies(doc: Doc, media: MediaItem[], chosen = false) {
  if (!inApp()) return;
  proxyDoc = doc;
  const jobs = [];
  for (const m of media) {
    const wanted = chosen ? m.kind === 'video' && m.hasVideo && !m.missing && !m.playbackProxy : wantsProxy(m);
    if (!wanted) continue;
    if (!proxies.has(m.id)) importing.set([...importing.list, { path: `proxy:${m.path}`, name: `${m.name} (proxy)`, done: 0 }]);
    jobs.push({ id: m.id, path: m.path, urgent: chosen });
  }
  proxies.add(jobs);
}

''' + s[b:]
open(p, 'w').write(s)
