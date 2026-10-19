def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert s.count(a)==1, (p, a, s.count(a))
        s=s.replace(a,b)
    open(p,'w').write(s)

edit('editor/app/src/ui/Editor.tsx', [
("""import { chooseAndImport, importFiles, MEDIA_EXTENSIONS } from './importer';""","""import { chooseAndImport, importFiles, makeProxies, MEDIA_EXTENSIONS } from './importer';"""),
("""      if (gone.length) doc.quiet((p) => ({ ...p, media: p.media.map((m) => (gone.includes(m.id) ? { ...m, missing: true } : m)) }));
      setMissing(gone);""","""      if (gone.length) doc.quiet((p) => ({ ...p, media: p.media.map((m) => (gone.includes(m.id) ? { ...m, missing: true } : m)) }));
      setMissing(gone);
      // Playback proxies that are gone (a cleared cache) are made again, and heavy files without one get one.
      const lost: string[] = [];
      for (const m of doc.project.media) if (m.playbackProxy && !(await native.fileExists(m.playbackProxy))) lost.push(m.id);
      if (stale) return;
      if (lost.length) doc.quiet((p) => ({ ...p, media: p.media.map((m) => (lost.includes(m.id) ? { ...m, playbackProxy: null } : m)) }));
      makeProxies(doc, doc.project.media);"""),
])

edit('editor/app/src/ui/ProjectPanel.tsx', [
("""      title={`${m.path}${m.proxy ? '\\n(plays from a ready-made copy while editing)' : ''}`}""","""      title={[
        m.path,
        m.preparing ? 'Getting an edit-friendly copy ready…' : m.proxy ? '(plays from an edit-friendly copy while editing)' : '',
        m.playbackProxy ? 'Has a playback proxy (the film is made from the original)' : '',
        m.source?.note ?? '',
      ]
        .filter(Boolean)
        .join('\\n')}"""),
("""        <span className="media__name">{m.name}</span>
      )}""","""        <span className="media__name">
          {m.name}
          {m.preparing && <span className="media__badge">Preparing…</span>}
          {m.playbackProxy && <span className="media__badge">Proxy</span>}
          {m.source?.hdr && <span className="media__badge">HDR</span>}
        </span>
      )}"""),
])
print('ok')
