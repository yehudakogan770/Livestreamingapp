import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-a155a6f1093a2d850')
def rep(p,a,b):
    s=open(p).read(); assert a in s,(p,a); s=s.replace(a,b,1); open(p,'w').write(s)
p='titler/src/designer/Designer.tsx'
rep(p,"import { Splitter } from './Splitter';","import { Splitter } from './Splitter';\nimport { ExportDialog } from './ExportDialog';")
rep(p,"  const [renderOpen, setRenderOpen] = useState(false);","  const [renderOpen, setRenderOpen] = useState(false);\n  const [exportOpen, setExportOpen] = useState(false);")
rep(p,"""            <button onClick={() => void exportFile()} title="Save as a .lumtitle file with its pictures and fonts inside (Ctrl+Shift+S)">
              <Download size={15} /> Export .lumtitle
            </button>""","""            <button onClick={() => setExportOpen(true)} title="Export: a .lumtitle file (Ctrl+Shift+S), an HTML template for other playout systems, or Lottie">
              <Download size={15} /> Export
            </button>""")
rep(p,"""        {renderOpen && <RenderDialog""","""        {exportOpen && <ExportDialog store={store} host={host} onClose={() => setExportOpen(false)} onLumtitle={() => void exportFile()} />}
        {renderOpen && <RenderDialog""")
