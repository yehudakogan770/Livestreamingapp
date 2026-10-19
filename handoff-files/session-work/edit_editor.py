import sys
root = sys.argv[1]


def patch(path, pairs):
    s = open(path).read()
    for a, b in pairs:
        assert s.count(a) == 1, (path, a[:80], s.count(a))
        s = s.replace(a, b)
    open(path, 'w').write(s)


patch(root + '/ui/Editor.tsx', [
    ("import { chooseAndImport, importFiles, makeProxies, MEDIA_EXTENSIONS } from './importer';\n",
     "import { chooseAndImport, importFiles, makeProxies, MEDIA_EXTENSIONS, proxyOptions, setProxyFocus } from './importer';\n"
     "import { renderCache } from '../cache/manager';\n"
     "import { CacheDialog, cacheMenu } from '../cache/CacheDialog';\n"),
    ('''  useEffect(() => {
    engine.useProxies = u.proxies;
  }, [engine, u.proxies]);
''', '''  useEffect(() => {
    engine.useProxies = u.proxies;
  }, [engine, u.proxies]);
  // The render cache plays heavy stretches from cached files and makes them while playback is stopped;
  // proxies are made nearest the playhead first.
  useEffect(() => {
    engine.cached = renderCache.opsAt;
    proxyOptions.hardware = renderCache.settings.hwEncode;
    const focus = () => ({ project: engine.project, playing: engine.isPlaying, playhead: Math.floor(engine.time), proxies: engine.useProxies });
    void renderCache.start(focus);
    setProxyFocus(() => ({ p: engine.project, playhead: Math.floor(engine.time) }));
    const redraw = renderCache.subscribe(() => engine.redraw());
    return () => {
      redraw();
      renderCache.stop();
      engine.cached = null;
    };
  }, [engine]);
'''),
    ('''        { label: 'Use proxies for playback', checked: u.proxies, run: () => ui.set({ proxies: !u.proxies }) },
''', '''        { label: 'Use proxies for playback', checked: u.proxies, run: () => ui.set({ proxies: !u.proxies }) },
        ...cacheMenu(doc, doc.state.selection?.kind === 'clips' ? doc.state.selection.ids : []),
'''),
    ('''      <ExtrasDialogs doc={doc} engine={engine} ui={ui} />
''', '''      <ExtrasDialogs doc={doc} engine={engine} ui={ui} />
      <CacheDialog />
'''),
])

patch(root + '/ui/Timeline.tsx', [
    ('''      {commentPins.map((p) => (''', '''      <CacheBar p={doc.project} s={s} zoom={zoom} from={from} width={width} />
      {commentPins.map((p) => ('''),
])
s = open(root + '/ui/Timeline.tsx').read()
i = s.index('\nimport ')
j = s.index('\n', i + 1)
s = s[:j + 1] + "import { CacheBar } from '../cache/CacheBar';\n" + s[j + 1:]
open(root + '/ui/Timeline.tsx', 'w').write(s)

patch(root + '/ui/ProjectPanel.tsx', [
    ('''        ...(inApp() ? [{ label: 'Show in folder', run: () => void native.reveal(m.path) }] : []),
''', '''        ...(inApp() ? [{ label: 'Show in folder', run: () => void native.reveal(m.path) }] : []),
        ...(inApp() && m.kind === 'video' && !m.playbackProxy ? [{ label: 'Generate proxy', run: () => makeProxies(doc, [m], true) }] : []),
'''),
])
