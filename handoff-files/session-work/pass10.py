import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File

f = File('editor/app/src/ui/Start.tsx')
f.rep("""            <button type="button" className="btn btn--primary btn--big start__open" onClick={onNew}>
              New project…
            </button>
            <button type="button" className="btn btn--big start__open" onClick={onChoose}>
              Open…
            </button>""", """            <button type="button" className="btn btn--primary btn--big start__open" onClick={onNew}>
              <Plus />
              New project…
            </button>
            <button type="button" className="btn btn--big start__open" onClick={onChoose}>
              <FolderOpen />
              Open…
            </button>""", icons=['Plus', 'FolderOpen'])
f.rep("""          <h2>Recent</h2>""", """          <h2>
            <History />
            Recent
          </h2>""", icons=['History'])
f.rep("""                <button type="button" className="start__item" onClick={() => onOpen(r.path)} title={r.path}>
                  <span className="start__name">{r.name}</span>""", """                <button type="button" className="start__item" onClick={() => onOpen(r.path)} title={r.path}>
                  {/\\.lumora$/i.test(r.path) ? (
                    <Cctv className="start__kind" aria-label="An event Lumora recorded" />
                  ) : (
                    <Clapperboard className="start__kind" aria-label="A Lumora Studio project" />
                  )}
                  <span className="start__name">{r.name}</span>""", icons=['Cctv', 'Clapperboard'])
f.rep("""          <p className="start__hint">Or drag a project or event file onto this window.</p>""", """          <p className="start__hint">
            <FileDown />
            Or drag a project or event file onto this window.
          </p>""", icons=['FileDown'])
f.save()

f = File('editor/app/src/collab/SharedList.tsx')
f.rep("""      <h2 className="start__h2">Shared with me</h2>""", """      <h2 className="start__h2">
        <Users />
        Shared with me
      </h2>""", icons=['Users'])
f.rep("""            <button type="button" className="start__item" onClick={() => onOpen(p.id)} title={`Version ${p.version}`}>
              <span className="start__name">{p.name}</span>""", """            <button type="button" className="start__item" onClick={() => onOpen(p.id)} title={`Version ${p.version}`}>
              <Cloud className="start__kind" aria-label="A shared project" />
              <span className="start__name">{p.name}</span>""", icons=['Cloud'])
f.save()
