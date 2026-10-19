import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ae2e4fb2496ef2830')


def edit(p, pairs):
    s = open(p).read()
    for old, new in pairs:
        assert old in s, (p, old[:70])
        s = s.replace(old, new)
    open(p, 'w').write(s)


T_OLD = '{ port: number | null; captured: boolean }'
T_NEW = 'BrowserInfo'
edit('app/src/engine/browser.ts', [
    ("""let info: Promise<{ port: number | null; captured: boolean }> | null = null;
/** Where frames come from (asked once per window). */
export function browserInfo(get: () => Promise<{ port: number | null; captured: boolean }>) {
  info ??= get().catch(() => ({ port: null, captured: false }));
  return info;
}""", """/** Where the app serves web pages' and stream inputs' pictures and sound (on this computer only), and the key it asks for. */
export interface BrowserInfo {
  port: number | null;
  captured: boolean;
  /** Only Lumora's own windows know it, so other programs and web pages can't watch or listen. */
  key?: string;
}

/** A picture or sound the app serves: `path` like `stream/<id>`. */
export function servedUrl(info: BrowserInfo, path: string, query = ''): string | null {
  if (!info.port) return null;
  return `http://127.0.0.1:${info.port}/${path}?k=${encodeURIComponent(info.key ?? '')}${query ? `&${query}` : ''}`;
}

let info: Promise<BrowserInfo> | null = null;
/** Where frames come from (asked once per window). */
export function browserInfo(get: () => Promise<BrowserInfo>) {
  info ??= get().catch(() => ({ port: null, captured: false }));
  return info;
}"""),
])
edit('app/src/engine/client.ts', [
    ("  browserInfo(): Promise<{ port: number | null; captured: boolean }>;", "  browserInfo(): Promise<BrowserInfo>;"),
    ("  browserInfo(): Promise<{ port: number | null; captured: boolean }> {\n    return invoke('browser_info');", "  browserInfo(): Promise<BrowserInfo> {\n    return invoke('browser_info');"),
    ("  browserInfo(): Promise<{ port: number | null; captured: boolean }> {\n    return Promise.resolve({ port: null, captured: false });", "  browserInfo(): Promise<BrowserInfo> {\n    return Promise.resolve({ port: null, captured: false });"),
])
s = open('app/src/engine/client.ts').read()
lines = s.split('\n')
i = max(k for k, l in enumerate(lines[:80]) if l.startswith('import '))
lines.insert(i + 1, "import type { BrowserInfo } from './browser';")
open('app/src/engine/client.ts', 'w').write('\n'.join(lines))

edit('app/src/components/BrowserView.tsx', [
    ("""  if (info.captured && info.port) return <FramePicture port={info.port} id={id} fit={fit} kind="browser" />;""",
     """  if (info.captured && info.port) return <FramePicture info={info} id={id} fit={fit} kind="browser" />;"""),
    ("""export function FramePicture({ port, id, fit, kind }: { port: number; id: string; fit: 'cover' | 'contain'; kind: string }) {
  return (
    <img src={`http://127.0.0.1:${port}/stream/${encodeURIComponent(id)}`} alt="" draggable={false} style={{ ...fill, objectFit: fit }} data-kind={kind} />
  );
}""", """export function FramePicture({ info, id, fit, kind }: { info: BrowserInfo; id: string; fit: 'cover' | 'contain'; kind: string }) {
  return <img src={servedUrl(info, `stream/${encodeURIComponent(id)}`) ?? ''} alt="" draggable={false} style={{ ...fill, objectFit: fit }} data-kind={kind} />;
}"""),
    ("""        <FramePicture port={info.port} id={id} fit={fit} kind="stream" />""", """        <FramePicture info={info} id={id} fit={fit} kind="stream" />"""),
    ("import { browserInfo } from '../engine/browser';", "import { browserInfo, servedUrl, type BrowserInfo } from '../engine/browser';"),
])
edit('app/src/audio/soundEngine.ts', [
    ("""      const url = () => this.client.browserInfo().then((i) => (i.port ? `http://127.0.0.1:${i.port}/audio/${encodeURIComponent(id)}` : null));""",
     """      const url = () => this.client.browserInfo().then((i) => servedUrl(i, `audio/${encodeURIComponent(id)}`));"""),
])
s = open('app/src/audio/soundEngine.ts').read()
lines = s.split('\n')
i = max(k for k, l in enumerate(lines[:60]) if l.startswith('import '))
lines.insert(i + 1, "import { servedUrl } from '../engine/browser';")
open('app/src/audio/soundEngine.ts', 'w').write('\n'.join(lines))

edit('app/src/broadcast/compositor.ts', [
    ("""      void fetch(`http://127.0.0.1:${port}/frame/${encodeURIComponent(id)}?after=${page.n}`)""",
     """      void fetch(servedUrl(this.pageInfo, `frame/${encodeURIComponent(id)}`, `after=${page.n}`) ?? '')"""),
])
s = open('app/src/broadcast/compositor.ts').read()
if 'servedUrl' not in s.split('\n', 60)[0:60].__str__():
    lines = s.split('\n')
    i = max(k for k, l in enumerate(lines[:80]) if l.startswith('import '))
    lines.insert(i + 1, "import { servedUrl } from '../engine/browser';")
    open('app/src/broadcast/compositor.ts', 'w').write('\n'.join(lines))
