import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File

f = File('editor/app/src/ui/Editor.tsx')
# Pages: icon + label tabs in a Resolve-style page bar at the bottom of the window.
f.rep("""        {collab && <HereChips collab={collab} doc={doc} />}
        <div className="ed__pages" role="tablist" aria-label="Pages">
          {(
            [
              ['edit', 'Edit'],
              ['color', 'Color'],
              ['audio', 'Audio'],
            ] as const
          ).map(([p, n]) => (
            <button key={p} type="button" role="tab" aria-selected={u.page === p} className={u.page === p ? 'is-on' : ''} onClick={() => ui.set({ page: p })}>
              {n}
            </button>
          ))}
        </div>
        <span className="ed__fill" />""", """        {collab && <HereChips collab={collab} doc={doc} />}
        <span className="ed__fill" />""")
f.rep("""        <span className="ed__name" title={collab ? 'Shared project (online)' : path || 'Not saved yet'}>
          {state.project.name}
        </span>""", """        <span className="ed__name" title={collab ? 'Shared project (online)' : path || 'Not saved yet'}>
          {collab ? <Cloud /> : <FileVideo />}
          <span>{state.project.name}</span>
        </span>""", icons=['Cloud', 'FileVideo'])
f.rep("""        <span className={`ed__saved${problemShown ? ' is-problem' : ''}`} title={savedText}>
          {savedText}
        </span>""", """        <span className={`ed__saved${problemShown ? ' is-problem' : ''}`} title={savedText}>
          {problemShown ? <CircleAlert /> : savedText === 'Saved' ? <Check /> : <Save />}
          {savedText}
        </span>""", icons=['CircleAlert', 'Check', 'Save'])
f.rep("""title="Make the finished film (Ctrl+M)">
          Export
        </button>""", """title="Make the finished film (Ctrl+M)">
          <Upload />
          Export
        </button>""", icons=['Upload'])
f.rep("""      <footer className="ed__status">
        <span>{u.note || (doc.undoLabel ? `Last: ${doc.undoLabel}` : 'Ready')}</span>
        <span className="ed__fill" />
        <span>
          {s.name} · {s.width}×{s.height} · {s.fps} fps{path ? ` · ${folderOf(path)}` : ''}
        </span>
      </footer>""", """      <footer className="ed__status">
        <span className="ed__note">{u.note || (doc.undoLabel ? `Last: ${doc.undoLabel}` : 'Ready')}</span>
        <div className="ed__pages" role="tablist" aria-label="Pages">
          {(
            [
              ['edit', 'Edit', Film, 'Cut and arrange (Shift+4)'],
              ['color', 'Color', Palette, 'Grade the picture: wheels, curves, nodes and scopes (Shift+5)'],
              ['audio', 'Audio', AudioLines, 'Mix the sound: faders, meters and tracks (Shift+6)'],
            ] as const
          ).map(([p, n, Icon, tip]) => (
            <button key={p} type="button" role="tab" aria-selected={u.page === p} className={u.page === p ? 'is-on' : ''} title={tip} onClick={() => ui.set({ page: p })}>
              <Icon />
              {n}
            </button>
          ))}
        </div>
        <span className="ed__seqinfo" title={path ? folderOf(path) : 'Not saved yet'}>
          {s.name} · {s.width}×{s.height} · {s.fps} fps
        </span>
      </footer>""", icons=['Film', 'Palette', 'AudioLines'])

# Left panel tabs: icon + title.
for key, label, icon in [('controls', 'Effect controls', 'SlidersHorizontal'), ('source', 'Source', 'SquarePlay'), ('transcript', 'Transcript', 'FileText'), ('comments', 'Comments', 'MessageSquare')]:
    import re
    pat = r"(onClick=\{\(\) => setLeftTab\('" + key + r"'\)\}\n(\s*)>\n\s*)" + label + r"\n"
    f.sub(pat, lambda m, icon=icon, label=label: m.group(1) + f"<{icon} />\n{m.group(2)}  {label}\n", icons=[icon])
f.save()
