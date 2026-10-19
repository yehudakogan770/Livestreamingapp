import sys
root = sys.argv[1]


def edit(path, pairs):
    p = root + '/' + path
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (path, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)


edit('docs/COMPETITORS-STUDIO.md', [
    ('| Publish to TikTok, Facebook, Vimeo                                       | ❌         |',
     '| Publish to Vimeo, TikTok, Facebook (Studio: Vimeo) | ◐ **new** |'),
    ('| ◐   | 4                 | 5                |', '| ◐   | 4                 | 6                |'),
    ('| ❌  | 23                | 7                |', '| ❌  | 23                | 6                |'),
    ('''B-roll, VST plug-ins, HDR and color management, a node compositor, publishing
to platforms other than YouTube, and client review links. Still ◐: a magnetic''', '''B-roll, VST plug-ins, HDR and color management, a node compositor, and client
review links. Still ◐: publishing (YouTube and Vimeo; not TikTok or Facebook), a magnetic'''),
    ('| Publishing to TikTok, Facebook, Vimeo; client review links |', '| Publishing to TikTok and Facebook; client review links |'),
])
edit('editor/app/src/ui/guide.ts', [
    ("""    title: 'Publishing to YouTube',
    where: 'The render queue: Publish to YouTube on a finished export',""", """    title: 'Publishing to YouTube and Vimeo',
    where: 'The render queue: Publish on a finished export',"""),
    ("""Videos start as Only me unless you choose otherwise.',""", """Videos start as Only me unless you choose otherwise.',
      'To publish to Vimeo, choose Vimeo and paste a personal access token: make one at developer.vimeo.com/apps (any app of yours, Generate an access token) with Upload, Edit and Private access. Studio checks it with Vimeo and keeps it in Windows Credential Manager. Choose the title, description and who can see it; the captions file goes up as captions viewers can turn on.',"""),
])
edit('docs/FEATURES.md', [
    ('(66 of 78 tools ✅, 5 ◐, 7 ❌)', '(66 of 78 tools ✅, 6 ◐, 6 ❌)'),
    ('- ✅ **Publish to YouTube** — resumable upload with chapters, thumbnail and captions; the channel connection shared with Lumora',
     '- ✅ **Publish to YouTube and Vimeo** — resumable uploads with chapters, thumbnail and captions; the YouTube connection shared with Lumora; Vimeo with a personal token'),
    ('publishing to other platforms, client review links', 'publishing to TikTok and Facebook, client review links'),
])
