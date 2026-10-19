import sys
sys.path.insert(0, '/tmp/claude-0/-home-user-Livestreamingapp/afbb1772-1200-52da-905a-12b6de33f858/scratchpad')
from icons_lib import File

f = File('editor/app/src/ui/ColorPage.tsx')
f.rep("""            + Serial""", """            <Plus />
            Serial""", icons=['Plus'])
f.rep("""            + Parallel""", """            <Split />
            Parallel""", icons=['Split'])
f.rep("""            + Layer""", """            <Layers />
            Layer""", icons=['Layers'])
f.rep("""            Reset node
          </button>""", """            <RotateCcw />
            Reset
          </button>""")
f.rep("""            Delete node
          </button>""", """            <Trash2 />
            Delete
          </button>""", icons=['Trash2'])
f.rep("""            Copy grade
          </button>""", """            <Copy />
            Copy grade
          </button>""", icons=['Copy'])
f.rep("""            Paste grade
          </button>""", """            <ClipboardPaste />
            Paste grade
          </button>""", icons=['ClipboardPaste'])
f.rep("""        <h3>
          Color wheels{' '}""", """        <h3>
          <Palette />
          Color wheels{' '}""", icons=['Palette'])
f.rep("""      <div className="scopes__head">
        <Choice""", """      <div className="scopes__head">
        <Activity />
        <span className="scopes__title">Scopes</span>
        <Choice""", icons=['Activity'])
f.save()
