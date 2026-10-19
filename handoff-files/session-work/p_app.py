import sys
p = sys.argv[1] + '/app/src/App.tsx'
s = open(p).read()

def rep(old, new):
    global s
    if old not in s:
        raise SystemExit('missing: ' + old[:80])
    s = s.replace(old, new, 1)

rep("  const [remoteOpen, setRemoteOpen] = useState(false);\n", "  const [remoteOpen, setRemoteOpen] = useState(false);\n  const [apiOpen, setApiOpen] = useState(false);\n")
rep("""        onClick: () => setRemoteOpen(true),
      },
      // Only on computers with the Stream Deck app.""", """        onClick: () => setRemoteOpen(true),
      },
      {
        label: 'Control API (Companion, OSC, tally)…',
        hint: 'Stream Deck through Companion, X-keys, tally lights and show-control systems',
        onClick: () => setApiOpen(true),
      },
      // Only on computers with the Stream Deck app.""")
rep("""      {remoteOpen && remote && <RemoteDialog""", """      {apiOpen && <ControlApiDialog onClose={() => setApiOpen(false)} />}
      {remoteOpen && remote && <RemoteDialog""")
i = s.index("import { RemoteDialog }")
s = s[:i] + "import { ControlApiDialog } from './views/ControlApiDialog';\n" + s[i:]
open(p, 'w').write(s)
print('ok')
