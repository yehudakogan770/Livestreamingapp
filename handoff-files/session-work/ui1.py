import sys
def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/app/src/ui/state.ts', [
("""  quality: 1 | 0.5 | 0.25;
  /** Panel sizes""","""  quality: 1 | 0.5 | 0.25;
  /** Play heavy files from their lighter proxies (the film is always made from the originals). */
  proxies: boolean;
  /** Panel sizes"""),
("""      quality: s.quality ?? 1,
""","""      quality: s.quality ?? 1,
      proxies: s.proxies ?? true,
"""),
("""      const { snapping, linked, quality, left, right, bottom, scope } = this.state;
      localStorage.setItem(KEY, JSON.stringify({ snapping, linked, quality, left, right, bottom, scope }));""",
"""      const { snapping, linked, quality, proxies, left, right, bottom, scope } = this.state;
      localStorage.setItem(KEY, JSON.stringify({ snapping, linked, quality, proxies, left, right, bottom, scope }));"""),
])
edit('editor/app/src/ui/Editor.tsx', [
("""    engine.quality = u.quality;
    engine.redraw();
  }, [engine, u.quality]);""","""    engine.quality = u.quality;
    engine.redraw();
  }, [engine, u.quality]);
  useEffect(() => {
    engine.useProxies = u.proxies;
  }, [engine, u.proxies]);"""),
("""        { label: 'Playback: quarter', checked: u.quality === 0.25, run: () => ui.set({ quality: 0.25 }) },
""","""        { label: 'Playback: quarter', checked: u.quality === 0.25, run: () => ui.set({ quality: 0.25 }) },
        { label: 'Use proxies for playback', checked: u.proxies, run: () => ui.set({ proxies: !u.proxies }) },
"""),
])
print('ok')
