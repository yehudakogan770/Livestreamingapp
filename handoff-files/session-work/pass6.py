import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File
f = File('editor/app/src/ui/SmartBins.tsx')
f.rep("""        <span>Smart bins</span>
        <span className="ed__fill" />
        <button type="button" className="tbtn" title="New smart bin" aria-label="New smart bin" onClick={() => panels.show({ kind: 'smartBin', id: null })}>
          +
        </button>
        <button
          type="button"
          className="linkbtn"
          title="Remove the media no sequence uses\"""", """        <FolderSearch />
        <span>Smart bins</span>
        <span className="ed__fill" />
        <button type="button" className="sect__btn" title="New smart bin" aria-label="New smart bin" onClick={() => panels.show({ kind: 'smartBin', id: null })}>
          <Plus />
        </button>
        <button
          type="button"
          className="sect__btn"
          title="Remove unused: take out the media no sequence uses (Undo brings it back)"
          aria-label="Remove unused\"""", icons=['FolderSearch', 'Plus'])
f.rep("""        >
          Remove unused
        </button>""", """        >
          <ListX />
        </button>""", icons=['ListX'])
f.rep("""              <span>{open === b.id ? '▾' : '▸'}</span>
              <span className="media__name">⚙ {b.name}</span>""", """              {open === b.id ? <ChevronDown /> : <ChevronRight />}
              <FolderCog className="media__folder" />
              <span className="media__name">{b.name}</span>""", icons=['ChevronDown', 'ChevronRight', 'FolderCog'])
f.save()
