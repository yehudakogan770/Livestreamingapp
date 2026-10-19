root='/home/user/Livestreamingapp/.claude/worktrees/agent-a53b9f061dc9b1bdf/'
def edit(p, pairs):
    s=open(root+p).read()
    for a,b in pairs:
        assert a in s, (p, a[:70])
        s=s.replace(a,b,1)
    open(root+p,'w').write(s)

edit('editor/app/src/ui/state.ts', [
("export type Page = 'edit' | 'color' | 'audio';","export type Page = 'edit' | 'composite' | 'color' | 'audio';"),
("""  gradeNode: string | null;
  showMatte: boolean;
  dialog:""","""  gradeNode: string | null;
  showMatte: boolean;
  /** The node chosen on the Composite page. */
  compNode: string | null;
  dialog:"""),
("""      gradeNode: null,
      showMatte: false,""","""      gradeNode: null,
      showMatte: false,
      compNode: null,"""),
])
edit('editor/app/src/ui/workspaces.ts', [
("""  ['edit', 'color', 'audio'].includes((w as Workspace).page) &&""","""  ['edit', 'composite', 'color', 'audio'].includes((w as Workspace).page) &&"""),
("""  { name: 'Color', page: 'color', left: 330, right: 330, bottom: 360 },""","""  { name: 'Color', page: 'color', left: 330, right: 330, bottom: 360 },
  { name: 'Composite', page: 'composite', left: 330, right: 360, bottom: 360 },"""),
])
edit('editor/app/src/ui/shortcuts.ts', [
("""  { id: 'pageColor', label: 'Color page', group: 'View', run: (_a, ui) => ui.set({ page: 'color' }) },""","""  { id: 'pageColor', label: 'Color page', group: 'View', run: (_a, ui) => ui.set({ page: 'color' }) },
  { id: 'pageComposite', label: 'Composite page', group: 'View', run: (_a, ui) => ui.set({ page: 'composite' }) },"""),
("""  pageColor: ['Shift+2'],
  pageAudio: ['Shift+3'],""","""  pageColor: ['Shift+2'],
  pageAudio: ['Shift+3'],
  pageComposite: ['Shift+4'],"""),
])
