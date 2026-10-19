import os
os.chdir('/home/user/Livestreamingapp/.claude/worktrees/agent-ac66441c90a567d82')
def rep(p, old, new):
    s = open(p).read()
    assert old in s, (p, old)
    s = s.replace(old, new, 1)
    open(p, 'w').write(s)

p = 'app/src/ControlApp.tsx'
rep(p, "import { CircleHelp, Layers, LibraryBig, ListChecks, Radio, SquarePlus, Spotlight, Type } from 'lucide-react';",
    "import { CircleHelp, Layers, LibraryBig, ListChecks, Radio, Search, SquarePlus, Spotlight, Type } from 'lucide-react';\nimport { CommandPalette, menuEntries, showEntries } from './views/CommandPalette';")
rep(p, """  // Ctrl + / Ctrl − / Ctrl 0, like any app.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') setTextSize((t) => stepTextSize(t, 1));""", """  // Find a command (Ctrl + K).
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Ctrl + / Ctrl − / Ctrl 0, like any app.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if ((e.key === 'k' || e.key === 'K') && !e.shiftKey && !e.altKey) setPaletteOpen((o) => !o);
      else if (e.key === '=' || e.key === '+') setTextSize((t) => stepTextSize(t, 1));""")
rep(p, """      { icon: CircleHelp, label: 'How to use Lumora', onClick: () => sendCommand({ type: 'help' }) },
    ],
    [openBroadcast],""", """      { icon: CircleHelp, label: 'How to use Lumora', onClick: () => sendCommand({ type: 'help' }) },
      { icon: Search, label: 'Find a command (Ctrl+K)', onClick: () => setPaletteOpen(true) },
    ],
    [openBroadcast],""")
rep(p, """      {dataOpen && show && <DataDialog""", """      {paletteOpen && show && (
        <CommandPalette
          entries={[...menuEntries(menus), ...showEntries(show, controlling, (a) => void client.dispatch(a).catch(fail))]}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {dataOpen && show && <DataDialog""")

p = 'app/src/views/ShortcutsDialog.tsx'
rep(p, """      ['F1 · F2 · F3', 'Control the Live Screen · Back Screen · Monitor'],
    ],
  },""", """      ['F1 · F2 · F3', 'Control the Live Screen · Back Screen · Monitor'],
    ],
  },
  {
    title: 'Anything',
    keys: [['Ctrl + K', 'Find a command: type what you want to do, ↑ ↓ to choose, Enter to run']],
  },""")
